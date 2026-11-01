"use client";

import Link from "next/link";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Button, Card, cx, fmt, PageHeader, Spinner, Stat, Toggle, useApi } from "@/components/ui";
import type { QaReport } from "@/lib/qa";

const ICON = { pass: "✓", warn: "!", fail: "✕" } as const;

export default function QA() {
  const { project, base } = useProject();
  const [visual, setVisual] = useState(true);
  const { data, loading, reload } = useApi<QaReport>(`${base}/qa?visual=${visual ? 1 : 0}`);
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const c of data?.checks ?? []) counts[c.status]++;

  return (
    <>
      <PageHeader
        title="Quality Assurance"
        sub="The final gate before export: integrity, compatibility, artwork, metadata and rarity reconciliation."
        right={
          <>
            <Toggle checked={visual} onChange={setVisual} label="Visual duplicate scan" />
            <Button variant="primary" busy={loading} onClick={() => reload()}>Re-run checks</Button>
          </>
        }
      />
      {!data ? (
        <div className="grid place-items-center py-24 text-muted"><Spinner className="h-6 w-6" /><p className="mt-3 text-sm">Running checks{visual ? " (visual scan reads every render)" : ""}…</p></div>
      ) : (
        <>
          <Card glow className={cx("mb-6 flex flex-wrap items-center gap-6 p-6", !data.passed && "ring-1 ring-bad/40")}>
            <div className={cx("grid h-16 w-16 place-items-center rounded-2xl text-3xl", data.passed ? "bg-good/15 text-green-300" : "bg-bad/15 text-rose-300")}>{data.passed ? "✓" : "✕"}</div>
            <div className="flex-1">
              <div className="text-xl font-semibold">{data.passed ? "Collection passes QA" : "Collection has blocking issues"}</div>
              <div className="text-sm text-muted">
                {counts.pass} passed · {counts.warn} warnings · {counts.fail} failed · checked {fmt.ago(data.generatedAt)}
              </div>
            </div>
            {data.passed && (
              <Link href={`/projects/${project.id}/export`}>
                <Button variant="primary">Continue to export →</Button>
              </Link>
            )}
          </Card>
          <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Tokens" value={fmt.n(data.supply)} sub={`supply ${fmt.n(project.config.supply)}`} />
            <Stat label="Rendered" value={fmt.n(data.rendered)} accent="#22d3ee" />
            <Stat label="Approved" value={fmt.n(data.statusCounts.approved ?? 0)} accent="#22c55e" />
            <Stat label="Locked" value={fmt.n(data.statusCounts.locked ?? 0)} accent="#8b5cf6" />
          </div>
          <div className="space-y-2">
            {data.checks.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-start gap-4">
                  <span
                    className={cx(
                      "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm font-bold",
                      c.status === "pass" && "bg-good/15 text-green-300",
                      c.status === "warn" && "bg-amber/15 text-amber-300",
                      c.status === "fail" && "bg-bad/15 text-rose-300",
                    )}
                    aria-label={c.status}
                  >
                    {ICON[c.status]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.label}</span>
                      <Badge tone={c.status === "pass" ? "good" : c.status === "warn" ? "amber" : "bad"}>{c.status.toUpperCase()}</Badge>
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted">{c.detail}</div>
                    {c.items && c.items.length > 0 && (
                      <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto rounded-lg bg-black/25 p-2.5 font-mono text-[11.5px] text-ink/80">
                        {c.items.map((i) => <li key={i}>{i}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
