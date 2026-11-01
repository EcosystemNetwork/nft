"use client";

import { useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, CardHeader, Field, fmt, Input, PageHeader, Progress, Stat, toast, useApi } from "@/components/ui";
import type { Job } from "@/lib/jobs";
import type { GenerationRun } from "@/lib/store";

type Col = { nfts: { status: string; rendered: boolean }[]; history: GenerationRun[]; configHash: string | null; currentConfigHash: string };

export default function Generator() {
  const { project, base, save, validation, reload: reloadProject } = useProject();
  const { data: col, reload } = useApi<Col>(`${base}/collection`);
  const { data: jobs, reload: reloadJobs } = useApi<Job[]>(`${base}/jobs`, { poll: 1000 });
  const [supply, setSupply] = useState(project.config.supply);
  const [seed, setSeed] = useState(project.config.seed);
  const [busy, setBusy] = useState(false);
  const render = jobs?.find((j) => j.type === "render");
  const active = render && (render.status === "running" || render.status === "paused");
  const nfts = col?.nfts ?? [];
  const kept = nfts.filter((n) => n.status !== "draft").length;
  const rendered = nfts.filter((n) => n.rendered).length;
  const stale = col?.configHash && col.configHash !== col.currentConfigHash;
  const last = col?.history[0];

  // Refresh render counts when a job finishes.
  const [lastStatus, setLastStatus] = useState<string | undefined>();
  if (render?.status !== lastStatus) {
    setLastStatus(render?.status);
    if (lastStatus === "running") void reload();
  }

  async function generate() {
    if (supply !== project.config.supply) {
      const p = await save({ config: { supply } });
      if (!p) return;
    }
    setBusy(true);
    try {
      const r = await api<{ run: GenerationRun; count: number }>(`${base}/generate`, { method: "POST", json: { seed } });
      await Promise.all([reload(), reloadProject()]);
      if (r.run.errors.length) toast.err(`${r.run.errors.length} token(s) failed:\n${r.run.errors.slice(0, 3).join("\n")}`);
      else toast.ok(`Generated ${fmt.n(r.run.generated)} tokens in ${r.run.durationMs} ms${r.run.preserved ? ` · ${r.run.preserved} approved/locked kept` : ""}`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startRender(tokenIds?: number[]) {
    try {
      await api(`${base}/jobs`, { method: "POST", json: { type: "render", tokenIds } });
      await reloadJobs();
    } catch (e) {
      toast.err((e as Error).message);
    }
  }
  const control = async (action: "pause" | "resume" | "cancel") => {
    if (!render) return;
    await api(`/api/jobs/${render.id}`, { method: "POST", json: { action } });
    await reloadJobs();
  };
  const remaining = render && render.msPerItem ? ((render.total - render.done) * render.msPerItem) / 1000 : null;

  return (
    <>
      <PageHeader title="Collection Generator" sub="Seed-based, deterministic generation. The same seed and configuration always produce the same collection." />
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Tokens" value={fmt.n(nfts.length)} sub={`target ${fmt.n(project.config.supply)}`} />
        <Stat label="Approved / locked" value={fmt.n(kept)} sub="preserved on regenerate" accent="#22c55e" />
        <Stat label="Rendered" value={fmt.n(rendered)} sub={nfts.length ? fmt.pct(rendered / nfts.length, 0) : "—"} accent="#22d3ee" />
        <Stat label="Last run" value={last ? `${last.durationMs} ms` : "—"} sub={last ? `${fmt.n(last.retries)} retries · ${fmt.ago(last.at)}` : undefined} accent="#f59e0b" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card glow className="p-6">
          <h3 className="text-lg font-semibold">1 · Generate</h3>
          <p className="mt-1 text-[13px] text-muted">Draft tokens are re-rolled. Approved and locked tokens never change.</p>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <Field label="Supply">
              <Input type="number" min={1} max={100000} value={supply} onChange={(e) => setSupply(Number(e.target.value))} />
            </Field>
            <Field label="Seed">
              <div className="flex gap-2">
                <Input value={seed} onChange={(e) => setSeed(e.target.value)} className="font-mono" />
                <Button onClick={() => setSeed(Math.random().toString(36).slice(2, 10))} title="Random seed">
                  ⚄
                </Button>
              </div>
            </Field>
          </div>
          {validation.errors.length > 0 && (
            <div className="mt-4 rounded-xl border border-bad/30 bg-bad/10 p-3 text-[13px] text-rose-200">
              {validation.errors.slice(0, 3).map((e) => <div key={e}>✕ {e}</div>)}
            </div>
          )}
          {stale && <div className="mt-4 rounded-xl border border-amber/30 bg-amber/5 p-3 text-[13px] text-amber-200">The trait configuration changed since the last generation. Regenerate to apply it to draft tokens.</div>}
          <Button variant="primary" className="mt-5 w-full" busy={busy} disabled={validation.errors.length > 0 || !!active} onClick={generate}>
            ⚡ {nfts.length ? "Regenerate drafts" : `Generate ${fmt.n(supply)} tokens`}
          </Button>
          {active && <p className="mt-2 text-center text-[12px] text-dim">Pause or cancel the running render before regenerating.</p>}
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">2 · Render queue</h3>
              <p className="mt-1 text-[13px] text-muted">Batch-composites every token. Interrupted runs resume where they stopped.</p>
            </div>
            {render && <Badge tone={render.status === "done" ? "good" : render.status === "failed" ? "bad" : render.status === "paused" || render.status === "interrupted" ? "amber" : "violet"}>{render.status.toUpperCase()}</Badge>}
          </div>
          {render ? (
            <div className="mt-5 space-y-3">
              <Progress value={render.done} max={render.total || 1} tone={render.status === "failed" ? "bad" : "violet"} />
              <div className="flex justify-between text-[13px] text-muted tabular-nums">
                <span>
                  {fmt.n(render.done)} / {fmt.n(render.total)} · {render.skipped ? `${fmt.n(render.skipped)} already current · ` : ""}
                  {render.failed.length} failed
                </span>
                <span>{render.msPerItem ? `${render.msPerItem} ms/token` : ""}{active && remaining ? ` · ~${Math.ceil(remaining)}s left` : ""}</span>
              </div>
              <div className="text-[13px]">{render.message}</div>
              {render.failed.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-xl border border-bad/25 bg-bad/5 p-3 text-[12px] text-rose-200">
                  {render.failed.slice(0, 30).map((f) => (
                    <div key={f.tokenId}>
                      #{f.tokenId}: {f.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-5 text-sm text-dim">No render has run in this server session.</p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {!active && (
              <Button variant="primary" disabled={!nfts.length} onClick={() => startRender()}>
                ▶ Render {rendered < nfts.length ? `${fmt.n(nfts.length - rendered)} remaining` : "all"}
              </Button>
            )}
            {render?.status === "running" && <Button onClick={() => control("pause")}>❚❚ Pause</Button>}
            {render?.status === "paused" && <Button variant="primary" onClick={() => control("resume")}>▶ Resume</Button>}
            {active && <Button variant="danger" onClick={() => control("cancel")}>Cancel</Button>}
            {!active && render && render.failed.length > 0 && (
              <Button onClick={() => startRender(render.failed.map((f) => f.tokenId))}>Retry {render.failed.length} failed</Button>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Generation history" sub="Each run records seed, configuration hash and asset versions for reproducibility." />
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Seed</th>
                <th className="py-2 pr-4 font-medium">Config</th>
                <th className="py-2 pr-4 font-medium">Supply</th>
                <th className="py-2 pr-4 font-medium">New</th>
                <th className="py-2 pr-4 font-medium">Kept</th>
                <th className="py-2 pr-4 font-medium">Retries</th>
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {(col?.history ?? []).map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="py-2.5 pr-4 text-muted">{new Date(r.at).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 font-mono text-violet-2">{r.seed}</td>
                  <td className="py-2.5 pr-4 font-mono text-dim">{r.configHash}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmt.n(r.supply)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmt.n(r.generated)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmt.n(r.preserved)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmt.n(r.retries)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{r.durationMs} ms</td>
                  <td className="py-2.5">
                    {r.errors.length ? <Badge tone="bad" className="cursor-help">{r.errors.length} errors</Badge> : <Badge tone="good">OK</Badge>}
                    {r.warnings.length > 0 && <Badge tone="amber" className="ml-1">{r.warnings.length} warn</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!col?.history.length && <p className="py-6 text-center text-sm text-dim">No runs yet.</p>}
        </div>
      </Card>
    </>
  );
}
