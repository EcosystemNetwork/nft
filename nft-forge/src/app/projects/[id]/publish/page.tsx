"use client";

import Link from "next/link";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, CardHeader, cx, fmt, PageHeader, Progress, Spinner, toast, useApi } from "@/components/ui";
import type { Job } from "@/lib/jobs";
import type { Publication } from "@/lib/publish";

type Status = { publication: Publication | null; stale: boolean; filebaseConfigured: boolean };

function Copy({ value }: { value: string }) {
  return (
    <button
      className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-muted ring-1 ring-line-2 hover:text-ink"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => toast.ok("Copied"));
      }}
    >
      Copy
    </button>
  );
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-line/60 py-2.5 text-[13px] last:border-0">
      <span className="w-40 shrink-0 text-muted">{label}</span>
      <span className={cx("min-w-0 flex-1 truncate", mono && "font-mono text-[12px]")} title={value}>{value}</span>
      <Copy value={value} />
    </div>
  );
}

export default function Publish() {
  const { project, base, reload: reloadProject } = useProject();
  const { data, reload } = useApi<Status>(`${base}/ipfs`);
  const { data: jobs, reload: reloadJobs } = useApi<Job[]>(`${base}/jobs`, { poll: 1500 });
  const [checking, setChecking] = useState(false);
  const pack = jobs?.find((j) => j.type === "ipfs");
  const upload = jobs?.find((j) => j.type === "filebase");
  const busy = [pack, upload].some((j) => j && (j.status === "running" || j.status === "paused"));
  const pub = data?.publication;

  const [seen, setSeen] = useState("");
  const sig = `${pack?.status}-${upload?.status}`;
  if (sig !== seen) {
    setSeen(sig);
    if (pack?.status === "done" || upload?.status === "done") {
      void reload();
      void reloadProject();
    }
  }

  async function act(action: "pack" | "filebase" | "check") {
    try {
      if (action === "check") setChecking(true);
      const r = await api<Publication | Job>(`${base}/ipfs`, { method: "POST", json: { action } });
      if (action === "check") {
        await reload();
        const p = r as Publication;
        if (p.availability?.ok) toast.ok("Live on public IPFS gateways");
        else if (p.availability?.inconclusive) toast.err("Gateways are rate-limiting right now; the check was inconclusive. Try again in a minute.");
        else toast.err("Not retrievable yet. Upload the CARs to a pinning service, then check again (propagation can take a few minutes).");
      } else await reloadJobs();
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <PageHeader
        title="IPFS Publishing"
        sub="Content-addressed hosting for images and metadata. CIDs are computed here, so the final ipfs:// URIs are known before anything is uploaded."
        right={
          <Button variant="primary" busy={pack?.status === "running"} disabled={busy} onClick={() => act("pack")}>
            {pub ? "Rebuild IPFS package" : "Build IPFS package"}
          </Button>
        }
      />

      {pack && (pack.status === "running" || pack.status === "failed") && (
        <Card className={cx("mb-6 p-5", pack.status === "failed" && "border-bad/40")}>
          <div className="mb-2 flex justify-between text-[13px]">
            <span>{pack.message}</span>
            <Badge tone={pack.status === "failed" ? "bad" : "violet"}>{pack.status}</Badge>
          </div>
          <Progress value={pack.done} max={pack.total || 1} tone={pack.status === "failed" ? "bad" : "violet"} />
        </Card>
      )}

      {!data ? (
        <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>
      ) : !pub ? (
        <Card glow className="p-8">
          <h2 className="text-xl font-semibold">How it works</h2>
          <ol className="mt-4 space-y-3 text-[14px] text-ink/90">
            <li><b>1. Images.</b> All {fmt.n(project.config.supply)} renders are packed into a CAR archive, and its root CID becomes the image base: <code className="text-violet-2">ipfs://&lt;imagesCID&gt;/1.png</code>.</li>
            <li><b>2. Metadata.</b> Every token&apos;s JSON (pointing at those image URIs) plus <code>collection.json</code> is packed into a second CAR, giving the contract&apos;s base URI <code className="text-violet-2">ipfs://&lt;metadataCID&gt;/</code>.</li>
            <li><b>3. Pin.</b> Upload both CARs to a pinning service (automatic with Filebase), then confirm they&apos;re live on public gateways.</li>
          </ol>
          <p className="mt-4 text-[13px] text-muted">Content addressing means no URI can drift: if a single byte differs, the CID differs.</p>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="space-y-6">
            {data.stale && (
              <div className="rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-[13px] text-amber-200">
                The collection or metadata template changed after this package was built. Rebuild it so the CIDs match what you&apos;ll deploy.
              </div>
            )}
            <Card>
              <CardHeader title="Content identifiers" sub={`Built ${fmt.ago(pub.createdAt)} · ${fmt.n(pub.tokenCount)} tokens`} right={!data.stale && <Badge tone="good">current</Badge>} />
              <div className="px-5 pb-4">
                <Row label="Contract base URI" value={pub.baseURI} />
                <Row label="Contract URI" value={pub.contractURI} />
                <Row label="Images CID" value={pub.imagesCid} />
                <Row label="Metadata CID" value={pub.metadataCid} />
                <Row label="Image base (in metadata)" value={pub.imageBaseUri} />
              </div>
            </Card>
            <Card>
              <CardHeader title="CAR archives" sub="Import these into any IPFS pinning service; CIDs are preserved exactly." />
              <div className="space-y-2 px-5 pb-5">
                {(["images", "metadata"] as const).map((k) => (
                  <div key={k} className="flex items-center justify-between rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13px]">
                    <div>
                      <div className="font-medium">{k}.car</div>
                      <div className="text-[12px] text-dim">{fmt.bytes(pub.cars[k].bytes)} · {fmt.n(pub.cars[k].blocks)} blocks</div>
                    </div>
                    <a href={`${base}/ipfs/car/${k}.car`}><Button size="sm">Download</Button></a>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card glow className="p-5">
              <h3 className="font-semibold">Pin the content</h3>
              {data.filebaseConfigured ? (
                <>
                  <p className="mt-1 text-[13px] text-muted">Uploads both CARs to your Filebase bucket and checks Filebase reports the same root CIDs.</p>
                  {upload && (upload.status === "running" || upload.status === "failed") && (
                    <div className="mt-3 space-y-1 text-[12px]">
                      <div className={upload.status === "failed" ? "text-rose-300" : "text-muted"}>{upload.message}</div>
                      <Progress value={upload.done} max={upload.total || 1} tone={upload.status === "failed" ? "bad" : "violet"} />
                    </div>
                  )}
                  <Button variant="primary" className="mt-4 w-full" disabled={busy} busy={upload?.status === "running"} onClick={() => act("filebase")}>
                    Upload to Filebase
                  </Button>
                </>
              ) : (
                <div className="mt-2 space-y-2 text-[13px] text-muted">
                  <p>Automatic upload: set <code>FILEBASE_ACCESS_KEY</code>, <code>FILEBASE_SECRET_KEY</code> and <code>FILEBASE_BUCKET</code> (an IPFS bucket) and restart.</p>
                  <p>Or upload the two CARs yourself to any service that imports CAR files, or with your own IPFS node:</p>
                  <pre className="overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-[11.5px] text-cyan-100">ipfs dag import images.car metadata.car</pre>
                </div>
              )}
              {pub.uploads.map((u, i) => (
                <div key={i} className="mt-3 text-[12px] text-green-300">✓ {u.provider}: {u.message} · {fmt.ago(u.at)}</div>
              ))}
            </Card>
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Availability</h3>
                  <p className="mt-1 text-[13px] text-muted">Fetches collection.json, a token&apos;s metadata and its image from public IPFS gateways.</p>
                </div>
                <Button size="sm" busy={checking} onClick={() => act("check")}>Check now</Button>
              </div>
              {pub.availability && (
                <div className="mt-4 space-y-1 text-[12px]">
                  <div className={pub.availability.ok ? "text-green-300" : "text-amber-300"}>
                    {pub.availability.ok ? "✓ Retrievable from public gateways" : pub.availability.inconclusive ? "Inconclusive: gateways are rate-limiting. Try again in a minute." : "Not found yet. Pin the CARs, then check again."} · {fmt.ago(pub.availability.at)}
                  </div>
                  {pub.availability.results.map((r) => (
                    <div key={r.gateway + r.path} className="flex gap-2 font-mono text-[11px]">
                      <span className={r.ok ? "text-green-300" : r.inconclusive ? "text-amber-300" : "text-rose-300"}>{r.ok ? "✓" : r.inconclusive ? "?" : "✕"}</span>
                      <span className="truncate text-muted" title={r.gateway + r.path}>{new URL(r.gateway).host}/…/{r.path.split("/").pop()}</span>
                      <span className="text-dim">{r.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-5 text-[13px]">
              <h3 className="font-semibold">Next</h3>
              <p className="mt-1 text-muted">
                The <Link className="text-violet-2 underline" href={`/projects/${project.id}/deploy`}>Deployment Studio</Link> pre-fills these URIs for the testnet run and the mainnet approval. Exports now also reference the IPFS image URIs.
              </p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
