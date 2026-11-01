"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, cx, Empty, Input, Modal, PageHeader, Select, Spinner, StatusBadge, TIER_COLORS, TierBadge, toast, useApi } from "@/components/ui";
import { NONE, type Nft, type NftStatus } from "@/lib/engine/types";

type Row = Nft & { rendered: boolean; rank: number; score: number; tier: string };
type Col = { nfts: Row[] };
const PAGE = 48;

export default function Gallery() {
  const { project, base } = useProject();
  const { data, reload, setData } = useApi<Col>(`${base}/collection`);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [tier, setTier] = useState("all");
  const [sort, setSort] = useState("id");
  const [traitFilter, setTraitFilter] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const cats = project.config.categories;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of data?.nfts ?? []) for (const c of cats) m.set(`${c.id}/${n.traits[c.id] ?? NONE}`, (m.get(`${c.id}/${n.traits[c.id] ?? NONE}`) ?? 0) + 1);
    return m;
  }, [data, cats]);

  const filtered = useMemo(() => {
    let list = data?.nfts ?? [];
    const idq = q.trim().replace(/^#/, "");
    if (idq) list = list.filter((n) => String(n.tokenId) === idq || n.dna.startsWith(idq));
    if (status !== "all") list = list.filter((n) => n.status === status);
    if (tier !== "all") list = list.filter((n) => n.tier === tier);
    for (const [cid, tid] of Object.entries(traitFilter)) if (tid) list = list.filter((n) => (n.traits[cid] ?? NONE) === tid);
    if (sort === "rarity") list = [...list].sort((a, b) => a.rank - b.rank);
    if (sort === "common") list = [...list].sort((a, b) => b.rank - a.rank);
    return list;
  }, [data, q, status, tier, traitFilter, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  async function setMany(ids: number[], s: NftStatus) {
    try {
      const r = await api<{ changed: number; skipped: number[] }>(`${base}/nfts`, { method: "PATCH", json: { tokenIds: ids, status: s } });
      setData((d) => d && { nfts: d.nfts.map((n) => (ids.includes(n.tokenId) && !r.skipped.includes(n.tokenId) ? { ...n, status: s } : n)) });
      toast.ok(`${r.changed} token(s) → ${s}${r.skipped.length ? ` · ${r.skipped.length} skipped (locked, or must be approved before locking)` : ""}`);
      setSelected(new Set());
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  if (data && !data.nfts.length)
    return (
      <>
        <PageHeader title="Gallery & Review" />
        <Empty title="Nothing generated yet" action={<Link href={`/projects/${project.id}/generate`}><Button variant="primary">Open generator</Button></Link>} />
      </>
    );

  return (
    <>
      <PageHeader
        title="Gallery & Review"
        sub={`${filtered.length.toLocaleString()} of ${(data?.nfts.length ?? 0).toLocaleString()} tokens. Ctrl/⌘-click to multi-select.`}
        right={
          selected.size > 0 ? (
            <>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>✕ Deselect {selected.size}</Button>
              <Button variant="good" onClick={() => setMany([...selected], "approved")}>✓ Approve</Button>
              <Button onClick={() => setMany([...selected], "locked")}>🔒 Lock</Button>
              <Button variant="ghost" onClick={() => setMany([...selected], "draft")}>Back to draft</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setSelected(new Set(shown.map((n) => n.tokenId)))}>Select page</Button>
              <Button
                variant="good"
                disabled={!filtered.some((n) => n.status === "draft")}
                onClick={() => {
                  const ids = filtered.filter((n) => n.status === "draft").map((n) => n.tokenId);
                  if (confirm(`Approve all ${ids.length} draft tokens matching the current filters?`)) void setMany(ids, "approved");
                }}
              >
                Approve all filtered
              </Button>
              <Button
                disabled={!filtered.some((n) => n.status === "approved")}
                onClick={() => {
                  const ids = filtered.filter((n) => n.status === "approved").map((n) => n.tokenId);
                  if (confirm(`Lock all ${ids.length} approved tokens matching the current filters? Locked tokens are final: they can't be regenerated or returned to draft.`))
                    void setMany(ids, "locked");
                }}
              >
                🔒 Lock all approved
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit space-y-4 p-4 lg:sticky lg:top-6">
          <Input placeholder="Token ID or DNA…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="all">Any status</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="locked">Locked</option>
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="id">By ID</option>
              <option value="rarity">Rarest</option>
              <option value="common">Most common</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-1">
            {["all", ...Object.keys(TIER_COLORS)].map((t) => (
              <button key={t} onClick={() => { setTier(t); setPage(0); }} className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold", tier === t ? "bg-violet/25 text-ink ring-1 ring-violet/40" : "bg-panel-2 text-muted")}>
                {t !== "all" && <span className="h-2 w-2 rounded-full" style={{ background: TIER_COLORS[t] }} />}
                {t === "all" ? "All tiers" : t}
              </button>
            ))}
          </div>
          <div className="space-y-2 border-t border-line pt-3">
            <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">Traits</div>
            {cats.map((c) => (
              <Select
                key={c.id}
                value={traitFilter[c.id] ?? ""}
                onChange={(e) => { setTraitFilter({ ...traitFilter, [c.id]: e.target.value }); setPage(0); }}
                className={cx("h-9 text-[13px]", traitFilter[c.id] && "border-violet/60")}
              >
                <option value="">{c.name}: any</option>
                {[...c.traits.map((t) => ({ id: t.id, name: t.name })), ...(c.required ? [] : [{ id: NONE, name: "None" }])].map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({counts.get(`${c.id}/${t.id}`) ?? 0})
                  </option>
                ))}
              </Select>
            ))}
            {Object.values(traitFilter).some(Boolean) && (
              <button className="text-[12px] text-violet-2" onClick={() => setTraitFilter({})}>Clear trait filters</button>
            )}
          </div>
        </Card>

        <div>
          {!data ? (
            <div className="grid place-items-center py-24"><Spinner className="h-6 w-6" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
              {shown.map((n) => (
                <button
                  key={n.tokenId}
                  onClick={(e) => (e.ctrlKey || e.metaKey || selected.size ? toggle(n.tokenId) : setOpen(n.tokenId))}
                  className="group text-left"
                >
                  <div className={cx("overflow-hidden rounded-2xl border bg-panel transition", selected.has(n.tokenId) ? "border-violet ring-2 ring-violet/50" : "border-line group-hover:border-violet/40")}>
                    <div className="relative aspect-square bg-panel-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${base}/nfts/${n.tokenId}/image?size=320&d=${n.dna}`} alt={`#${n.tokenId}`} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                      <span
                        onClick={(e) => { e.stopPropagation(); toggle(n.tokenId); }}
                        className={cx("absolute top-2 left-2 grid h-6 w-6 place-items-center rounded-md border text-[12px] transition", selected.has(n.tokenId) ? "border-violet bg-violet text-white" : "border-white/30 bg-black/40 opacity-0 group-hover:opacity-100")}
                      >
                        {selected.has(n.tokenId) ? "✓" : ""}
                      </span>
                      <span className="absolute top-2 right-2"><TierBadge tier={n.tier} /></span>
                      {!n.rendered && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 text-[10px] text-muted">preview</span>}
                      {n.status !== "draft" && <span className="absolute right-2 bottom-2 rounded-md bg-black/60 backdrop-blur"><StatusBadge status={n.status} /></span>}
                    </div>
                    <div className="flex items-baseline justify-between gap-2 px-3 py-2.5">
                      <span className="text-[13px] font-semibold">#{n.tokenId}</span>
                      <span className="truncate text-[11px] text-dim">Rank {n.rank.toLocaleString()}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2 text-sm">
              <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</Button>
              <span className="tabular-nums text-muted">{page + 1} / {pages}</span>
              <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</Button>
            </div>
          )}
        </div>
      </div>

      {open !== null && (
        <TokenDetail
          tokenId={open}
          row={data?.nfts.find((n) => n.tokenId === open)}
          total={data?.nfts.length ?? 0}
          counts={counts}
          onClose={() => setOpen(null)}
          onStatus={(s) => setMany([open], s)}
          onRegenerated={() => void reload()}
          onNav={(d) => {
            const idx = filtered.findIndex((n) => n.tokenId === open);
            const next = filtered[idx + d];
            if (next) setOpen(next.tokenId);
          }}
        />
      )}
    </>
  );
}

type Detail = {
  nft: Nft;
  metadata: Record<string, unknown>;
  layers: { categoryName: string; traitName: string; assetId?: string }[];
  problems: string[];
  record: { seed: string; attempt: number; configHash: string; dna: string };
};

function TokenDetail({
  tokenId,
  row,
  total,
  counts,
  onClose,
  onStatus,
  onRegenerated,
  onNav,
}: {
  tokenId: number;
  row?: Row;
  total: number;
  counts: Map<string, number>;
  onClose: () => void;
  onStatus: (s: NftStatus) => void;
  onRegenerated: () => void;
  onNav: (d: -1 | 1) => void;
}) {
  const { project, base } = useProject();
  const { data, reload } = useApi<Detail>(`${base}/nfts/${tokenId}?s=${row?.status}&d=${row?.dna}`);
  const [tab, setTab] = useState<"traits" | "metadata" | "record">("traits");
  const [busy, setBusy] = useState(false);
  const nft = data?.nft;
  return (
    <Modal open onClose={onClose} title={`${project.metadata.collectionName} #${tokenId}`} wide>
      <div className="grid gap-6 md:grid-cols-[1fr_380px]">
        <div>
          <div className="overflow-hidden rounded-2xl bg-panel-2 ring-1 ring-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${base}/nfts/${tokenId}/image?size=900&d=${row?.dna}`} alt="" className="aspect-square w-full object-cover" />
          </div>
          <div className="mt-3 flex justify-between">
            <Button size="sm" variant="ghost" onClick={() => onNav(-1)}>‹ Previous</Button>
            <Button size="sm" variant="ghost" onClick={() => onNav(1)}>Next ›</Button>
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {row && <TierBadge tier={row.tier} />}
            {row && <StatusBadge status={row.status} />}
            {row && <Badge>Rank {row.rank} / {total}</Badge>}
            {row && <Badge>Score {row.score}</Badge>}
          </div>
          {data && data.problems.length > 0 && (
            <div className="mt-3 rounded-xl border border-bad/30 bg-bad/10 p-3 text-[12px] text-rose-200">{data.problems.map((p) => <div key={p}>✕ {p}</div>)}</div>
          )}
          <div className="mt-4 flex gap-1">
            {(["traits", "metadata", "record"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx("rounded-lg px-3 py-1.5 text-[13px] capitalize", tab === t ? "bg-violet/20 text-ink" : "text-muted hover:bg-panel-2")}>
                {t}
              </button>
            ))}
          </div>
          <div className="mt-3 max-h-[46vh] overflow-auto">
            {!data ? (
              <Spinner />
            ) : tab === "traits" ? (
              <div className="space-y-1.5">
                {project.config.categories.map((c) => {
                  const tid = nft!.traits[c.id] ?? NONE;
                  const cnt = counts.get(`${c.id}/${tid}`) ?? 0;
                  return (
                    <div key={c.id} className="flex items-center justify-between rounded-xl border border-line bg-panel-2 px-3 py-2">
                      <div>
                        <div className="text-[11px] tracking-wide text-muted uppercase">{c.name}</div>
                        <div className="text-sm font-medium">{tid === NONE ? "None" : c.traits.find((t) => t.id === tid)?.name}</div>
                      </div>
                      <div className="text-right text-[12px] text-muted tabular-nums">
                        {total ? ((cnt / total) * 100).toFixed(1) : 0}%
                        <div className="text-[11px] text-dim">{cnt} have this</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : tab === "metadata" ? (
              <pre className="rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-cyan-100">{JSON.stringify(data.metadata, null, 2)}</pre>
            ) : (
              <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
                <dt className="text-muted">DNA</dt><dd className="font-mono">{data.record.dna}</dd>
                <dt className="text-muted">Seed</dt><dd className="font-mono">{data.record.seed}</dd>
                <dt className="text-muted">Attempt</dt><dd>{data.record.attempt}</dd>
                <dt className="text-muted">Config hash</dt><dd className="font-mono">{data.record.configHash}</dd>
                <dt className="text-muted">Layers</dt>
                <dd>{data.layers.map((l) => <div key={l.categoryName} className={l.assetId ? "" : "text-amber-300"}>{l.categoryName}: {l.traitName}{l.assetId ? "" : " (no art)"}</div>)}</dd>
              </dl>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {nft?.status === "draft" && <Button variant="good" onClick={() => onStatus("approved")}>✓ Approve</Button>}
            {nft?.status === "approved" && <Button onClick={() => onStatus("locked")}>🔒 Lock</Button>}
            {nft?.status === "approved" && <Button variant="ghost" onClick={() => onStatus("draft")}>Back to draft</Button>}
            {nft?.status === "draft" && (
              <Button
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`${base}/nfts/${tokenId}`, { method: "POST" });
                    toast.ok(`#${tokenId} regenerated`);
                    onRegenerated();
                    await reload();
                  } catch (e) {
                    toast.err((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ↻ Regenerate
              </Button>
            )}
            {nft?.status === "locked" && <span className="text-[12px] text-muted">Locked tokens are final and survive every regeneration.</span>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
