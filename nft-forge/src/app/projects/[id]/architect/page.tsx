"use client";

import Link from "next/link";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, CardHeader, Empty, PageHeader, Select, Toggle, toast, useApi } from "@/components/ui";

export default function Architect() {
  const { project, base, reload, save } = useProject();
  const { data: caps } = useApi<{ claudeAvailable: boolean }>(`${base}/blueprint`);
  const [provider, setProvider] = useState<string>("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const bp = project.blueprint;

  async function run(action: "generate" | "apply") {
    setBusy(action);
    try {
      await api(`${base}/blueprint`, { method: "POST", json: { action, provider: provider === "auto" ? undefined : provider } });
      await reload();
      toast.ok(action === "generate" ? "Blueprint generated" : "Trait categories created. Assign artwork in the Trait Engine.");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="AI Project Architect"
        sub="Turn the concept into lore, an art bible, archetypes and a trait plan."
        right={
          <>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-56">
              <option value="auto">Provider: auto {caps ? (caps.claudeAvailable ? "(Claude)" : "(offline)") : ""}</option>
              <option value="claude">Claude Opus 5.5</option>
              <option value="offline">Offline template</option>
            </Select>
            <Button variant="primary" busy={busy === "generate"} disabled={project.artBibleLocked} onClick={() => run("generate")}>
              ✦ {bp ? "Regenerate" : "Generate blueprint"}
            </Button>
          </>
        }
      />
      {caps && !caps.claudeAvailable && (
        <div className="mb-5 rounded-xl border border-amber/25 bg-amber/5 px-4 py-3 text-[13px] text-amber-200">
          No Anthropic credentials found, so the offline template generator is used. Set <code>ANTHROPIC_API_KEY</code> (or run <code>ant auth login</code>) and restart to generate full blueprints with Claude.
        </div>
      )}

      <Card glow className="mb-6 p-5">
        <div className="text-[12px] font-medium tracking-wide text-muted uppercase">Concept</div>
        <p className="mt-1 text-[15px]">{project.concept || "—"}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Badge>Style: {project.style || "—"}</Badge>
          <Badge>Supply: {project.config.supply.toLocaleString()}</Badge>
          <Badge>{project.chain}</Badge>
          <Badge>{project.mode}</Badge>
        </div>
      </Card>

      {!bp ? (
        <Empty title="No blueprint yet">Generate one to get lore, an art bible and a recommended trait structure.</Empty>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader title={bp.title} sub={bp.logline} right={<Badge tone="violet">{bp.provider}</Badge>} />
              <div className="space-y-3 px-5 pb-5 text-[14px] leading-relaxed text-ink/90">
                {bp.lore.split("\n").filter(Boolean).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Recommended trait plan"
                sub={bp.estimates.notes}
                right={
                  <Button size="sm" variant="primary" busy={busy === "apply"} disabled={project.config.categories.length > 0} onClick={() => run("apply")}>
                    Apply to Trait Engine
                  </Button>
                }
              />
              <div className="divide-y divide-line px-5 pb-3">
                {bp.traitPlan.map((t) => (
                  <div key={t.category} className="flex flex-wrap items-center gap-2 py-3">
                    <span className="w-32 shrink-0 text-sm font-medium">{t.category}</span>
                    {t.required ? <Badge tone="violet">required</Badge> : <Badge>optional</Badge>}
                    <span className="flex flex-1 flex-wrap gap-1.5">
                      {t.examples.map((e) => (
                        <span key={e} className="rounded-md bg-panel-3 px-2 py-0.5 text-[12px] text-muted">
                          {e}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              {project.config.categories.length > 0 && (
                <p className="px-5 pb-4 text-[12px] text-dim">
                  The Trait Engine already has categories. <Link className="text-violet-2" href={`/projects/${project.id}/traits`}>Open it</Link>.
                </p>
              )}
            </Card>
            <Card>
              <CardHeader title="Production plan" sub={`Estimated ${bp.estimates.assetCount} layer assets`} />
              <ol className="list-decimal space-y-1.5 px-10 pb-5 text-[14px] text-ink/90">
                {bp.productionPlan.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Art bible"
                sub="Locked guidelines can't be overwritten by regeneration."
                right={<Toggle checked={project.artBibleLocked} onChange={(v) => save({ artBibleLocked: v }, v ? "Art bible locked" : "Art bible unlocked")} label={project.artBibleLocked ? "Locked" : "Unlocked"} />}
              />
              <div className="space-y-4 px-5 pb-5 text-[13px]">
                <div className="flex gap-2">
                  {bp.artBible.palette.map((c) => (
                    <div key={c} className="flex-1">
                      <div className="h-10 rounded-lg ring-1 ring-white/10" style={{ background: c }} />
                      <div className="mt-1 text-center font-mono text-[10px] text-dim">{c}</div>
                    </div>
                  ))}
                </div>
                {(
                  [
                    ["Style", bp.artBible.style],
                    ["Proportions", bp.artBible.proportions],
                    ["Rendering", bp.artBible.rendering],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">{k}</div>
                    <div className="mt-0.5 text-ink/90">{v}</div>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-green-300 uppercase">Do</div>
                    <ul className="mt-1 space-y-1 text-muted">{bp.artBible.doList.map((d) => <li key={d}>✓ {d}</li>)}</ul>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-rose-300 uppercase">Don&apos;t</div>
                    <ul className="mt-1 space-y-1 text-muted">{bp.artBible.dontList.map((d) => <li key={d}>✕ {d}</li>)}</ul>
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Archetypes & factions" />
              <div className="space-y-3 px-5 pb-5">
                {[...bp.archetypes, ...bp.factions].map((a) => (
                  <div key={a.name} className="rounded-xl border border-line bg-panel-2 px-3 py-2.5">
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-[12px] text-muted">{a.description}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
