"use client";

import { useMemo, useRef, useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, cx, Empty, Field, fmt, Input, Modal, PageHeader, Select, toast, useApi } from "@/components/ui";
import type { Asset } from "@/lib/store";

type UploadResult = { results: { file: string; ok: boolean; error?: string; duplicateOf?: string; replaced?: boolean }[] };

export default function AssetStudio() {
  const { project, base } = useProject();
  const { data: assets, reload } = useApi<Asset[]>(`${base}/assets`);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [category, setCategory] = useState("");
  const [sel, setSel] = useState<Asset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const usage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of project.config.categories)
      for (const t of c.traits) if (t.assetId) m.set(t.assetId, [...(m.get(t.assetId) ?? []), `${c.name} / ${t.name}`]);
    return m;
  }, [project]);
  const hints = useMemo(() => [...new Set((assets ?? []).map((a) => a.categoryHint ?? "Unsorted"))].sort(), [assets]);
  const shown = (assets ?? []).filter(
    (a) => (filter === "all" || (a.categoryHint ?? "Unsorted") === filter) && (!q || a.name.toLowerCase().includes(q.toLowerCase())),
  );

  async function upload(files: FileList | File[], replace?: string) {
    const list = [...files].filter((f) => /\.(png|jpe?g|webp|svg|gif|avif|tiff?)$/i.test(f.name));
    if (!list.length) return toast.err("No supported image files selected (PNG, JPEG, WebP, SVG, GIF, AVIF, TIFF).");
    setBusy(true);
    let ok = 0;
    let dup = 0;
    const errors: string[] = [];
    // Upload in batches so very large libraries don't hit request size limits.
    for (let i = 0; i < list.length; i += 20) {
      const fd = new FormData();
      for (const f of list.slice(i, i + 20)) {
        fd.append("files", f);
        fd.append("paths", (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      }
      if (category) fd.append("category", category);
      if (replace) fd.append("replace", replace);
      try {
        const r = await api<UploadResult>(`${base}/assets`, { method: "POST", body: fd });
        for (const x of r.results) {
          if (!x.ok) errors.push(`${x.file}: ${x.error}`);
          else if (x.duplicateOf && !x.replaced) dup++;
          else ok++;
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    setBusy(false);
    await reload();
    if (ok) toast.ok(`${replace ? "New version uploaded" : `Imported ${ok} asset(s)`}${dup ? ` · ${dup} duplicate(s) skipped` : ""}`);
    else if (dup) toast.ok(`${dup} duplicate(s) — already in the library`);
    if (errors.length) toast.err(errors.slice(0, 5).join("\n"));
  }

  return (
    <>
      <PageHeader
        title="Asset Studio"
        sub="Every upload is decoded and validated, converted to PNG, checked for transparency and resolution, and de-duplicated by content hash."
        right={
          <>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48">
              <option value="">Category: from folder</option>
              {project.config.categories.map((c) => (
                <option key={c.id} value={c.name}>
                  Category: {c.name}
                </option>
              ))}
            </Select>
            <Button onClick={() => dirRef.current?.click()} busy={busy}>
              Import folder
            </Button>
            <Button variant="primary" onClick={() => fileRef.current?.click()} busy={busy}>
              Upload images
            </Button>
          </>
        }
      />
      <input ref={fileRef} type="file" multiple accept="image/*" hidden onChange={(e) => e.target.files && upload(e.target.files).then(() => (e.target.value = ""))} />
      <input
        ref={dirRef}
        type="file"
        hidden
        // @ts-expect-error non-standard attribute for folder selection
        webkitdirectory=""
        onChange={(e) => e.target.files && upload(e.target.files).then(() => (e.target.value = ""))}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
        className={cx(
          "mb-6 rounded-2xl border border-dashed px-6 py-6 text-center text-sm transition",
          drag ? "border-violet bg-violet/10 text-ink" : "border-line-2 text-muted",
        )}
      >
        Drop layer images here. Organize folders by category (e.g. <code>Headgear/Royal Crown.png</code>) and use <b>Import folder</b> to tag them automatically.
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
        <div className="flex flex-wrap gap-1">
          {["all", ...hints].map((h) => (
            <button
              key={h}
              onClick={() => setFilter(h)}
              className={cx("rounded-lg px-3 py-1.5 text-[13px]", filter === h ? "bg-violet/20 text-ink ring-1 ring-violet/40" : "text-muted hover:bg-panel-2")}
            >
              {h === "all" ? `All (${assets?.length ?? 0})` : h}
            </button>
          ))}
        </div>
      </div>

      {!assets ? null : !assets.length ? (
        <Empty title="No assets yet">Upload transparent PNG layers at your canvas resolution ({project.canvas.width}×{project.canvas.height}).</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {shown.map((a) => {
            const lowRes = a.width < project.canvas.width || a.height < project.canvas.height;
            const used = usage.get(a.id);
            return (
              <button key={a.id} onClick={() => setSel(a)} className="group text-left">
                <Card className="overflow-hidden transition group-hover:border-violet/50">
                  <div className="checker relative aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${base}/assets/${a.id}?size=320&v=${a.version}`} alt={a.name} loading="lazy" className="h-full w-full object-contain" />
                    <div className="absolute top-2 left-2 flex gap-1">
                      {a.source !== "upload" && <Badge tone="violet">{a.source === "ai" ? "AI" : "PROC"}</Badge>}
                      {a.version > 1 && <Badge tone="cyan">v{a.version}</Badge>}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="truncate text-[13px] font-medium">{a.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                      <span className={lowRes ? "text-amber-300" : "text-dim"}>
                        {a.width}×{a.height}
                      </span>
                      <span className="text-dim">·</span>
                      <span className={a.hasTransparency ? "text-dim" : "text-amber-300"}>{a.hasTransparency ? "alpha" : "opaque"}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-dim">{used ? `Used: ${used[0]}` : "Unassigned"}</div>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      <AssetDetail asset={sel} usage={sel ? usage.get(sel.id) : undefined} onClose={() => setSel(null)} onChanged={reload} onReplace={(f) => sel && upload([f], sel.id).then(() => setSel(null))} />
    </>
  );
}

function AssetDetail({
  asset,
  usage,
  onClose,
  onChanged,
  onReplace,
}: {
  asset: Asset | null;
  usage?: string[];
  onClose: () => void;
  onChanged: () => void;
  onReplace: (f: File) => void;
}) {
  const { base, reload } = useProject();
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (asset && asset.id !== lastId) {
    setLastId(asset.id);
    setName(asset.name);
  }
  if (!asset) return null;
  return (
    <Modal open onClose={onClose} title={asset.name} wide>
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="checker overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${base}/assets/${asset.id}?size=900&v=${asset.version}`} alt="" className="w-full object-contain" />
        </div>
        <div className="space-y-4 text-[13px]">
          <Field label="Name">
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <Button
                onClick={async () => {
                  await api(`${base}/assets/${asset.id}`, { method: "PATCH", json: { name } });
                  onChanged();
                  toast.ok("Renamed");
                }}
              >
                Save
              </Button>
            </div>
          </Field>
          <dl className="grid grid-cols-2 gap-y-2">
            <dt className="text-muted">Resolution</dt>
            <dd>
              {asset.width}×{asset.height}
            </dd>
            <dt className="text-muted">Transparency</dt>
            <dd>{asset.hasTransparency ? "Yes" : "Fully opaque"}</dd>
            <dt className="text-muted">Size</dt>
            <dd>{fmt.bytes(asset.bytes)}</dd>
            <dt className="text-muted">Source</dt>
            <dd className="capitalize">{asset.source}</dd>
            {asset.generation && (
              <>
                <dt className="text-muted">Prompt</dt>
                <dd className="col-span-2 whitespace-pre-wrap text-[12px]">{asset.generation.prompt}</dd>
                <dt className="text-muted">Seed</dt>
                <dd>
                  {asset.generation.seed} · {asset.generation.sampler} · {asset.generation.steps} steps
                </dd>
              </>
            )}
            <dt className="text-muted">Category</dt>
            <dd>{asset.categoryHint ?? "—"}</dd>
            <dt className="text-muted">SHA-256</dt>
            <dd className="truncate font-mono text-[11px]" title={asset.sha256}>
              {asset.sha256.slice(0, 16)}…
            </dd>
          </dl>
          <div>
            <div className="mb-1 text-muted">Used by</div>
            {usage?.length ? usage.map((u) => <div key={u}>• {u}</div>) : <div className="text-dim">Not assigned to any trait</div>}
          </div>
          <div>
            <div className="mb-1 text-muted">Versions</div>
            {asset.versions
              .slice()
              .reverse()
              .map((v) => (
                <div key={v.version} className="flex justify-between text-[12px]">
                  <span>
                    v{v.version} {v.version === asset.version && <Badge tone="good">current</Badge>}
                  </span>
                  <span className="text-dim">{fmt.ago(v.at)}</span>
                </div>
              ))}
          </div>
          <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onReplace(e.target.files[0])} />
          <div className="flex gap-2 pt-2">
            <Button onClick={() => ref.current?.click()}>Upload new version</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Delete "${asset.name}"? Traits using it will lose their artwork.`)) return;
                await api(`${base}/assets/${asset.id}`, { method: "DELETE" });
                onChanged();
                await reload();
                onClose();
                toast.ok("Asset deleted");
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
