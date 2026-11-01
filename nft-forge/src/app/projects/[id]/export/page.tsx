"use client";

import { useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, CardHeader, fmt, PageHeader, Progress, Toggle, toast, useApi } from "@/components/ui";
import type { Job } from "@/lib/jobs";

const CONTENTS = [
  ["images/", "One image per token, named {tokenId}.png"],
  ["metadata/", "One JSON per token in the selected metadata standard"],
  ["collection.json", "Collection-level metadata"],
  ["reports/traits.csv", "Every token's traits, status, rarity score, rank and tier"],
  ["reports/trait-rarity.csv", "Count and share of every trait"],
  ["reports/qa-report.json", "The QA report the export passed"],
  ["generation-record.json", "Seed, config, asset versions and per-token attempts for exact reproduction"],
  ["manifest.json", "SHA-256 of every file for integrity checks"],
];

export default function Export() {
  const { project, base } = useProject();
  const { data: jobs, reload } = useApi<Job[]>(`${base}/jobs`, { poll: 1000 });
  const { data: files, reload: reloadFiles } = useApi<{ name: string; bytes: number; at: string }[]>(`${base}/exports`);
  const [force, setForce] = useState(false);
  const job = jobs?.find((j) => j.type === "export");
  const active = job && (job.status === "running" || job.status === "paused");
  const [seen, setSeen] = useState<string | undefined>();
  if (job?.status !== seen) {
    setSeen(job?.status);
    if (job?.status === "done") void reloadFiles();
  }

  async function start() {
    try {
      await api(`${base}/jobs`, { method: "POST", json: { type: "export", force } });
      await reload();
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Metadata & Export" sub={`Standard: ${project.metadata.standard === "metaplex" ? "Metaplex (Solana)" : "ERC-721 (EVM)"} · change it in Settings.`} />
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card glow className="p-6">
          <h3 className="text-lg font-semibold">Build collection package</h3>
          <p className="mt-1 text-[13px] text-muted">Runs QA first. Missing renders are rendered during packaging.</p>
          <div className="mt-5 space-y-2">
            {CONTENTS.map(([p, d]) => (
              <div key={p} className="flex gap-3 text-[13px]">
                <code className="w-44 shrink-0 text-violet-2">{p}</code>
                <span className="text-muted">{d}</span>
              </div>
            ))}
          </div>
          {job && (
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between text-[13px]">
                <span>{job.message}</span>
                <Badge tone={job.status === "done" ? "good" : job.status === "failed" ? "bad" : "violet"}>{job.status.toUpperCase()}</Badge>
              </div>
              <Progress value={job.done} max={job.total || 1} tone={job.status === "failed" ? "bad" : "violet"} />
              {job.result && job.status !== "running" && (
                <a href={`${base}/exports/${job.result.name}`} className="inline-block text-[13px] text-violet-2 hover:underline">
                  ⬇ {job.result.name} ({fmt.bytes(job.result.bytes)})
                </a>
              )}
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button variant="primary" busy={!!active} onClick={start}>⬇ Export ZIP</Button>
            {active && <Button variant="danger" onClick={() => api(`/api/jobs/${job!.id}`, { method: "POST", json: { action: "cancel" } })}>Cancel</Button>}
            <Toggle checked={force} onChange={setForce} label="Export even if QA fails" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Previous exports" />
          <div className="px-5 pb-5">
            {!files?.length ? (
              <p className="text-sm text-dim">None yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <a href={`${base}/exports/${f.name}`} className="truncate text-violet-2 hover:underline">{f.name}</a>
                    <span className="shrink-0 text-dim">{fmt.bytes(f.bytes)} · {fmt.ago(f.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
