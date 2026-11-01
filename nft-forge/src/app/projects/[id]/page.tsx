"use client";

import Link from "next/link";
import { useProject } from "@/components/project-context";
import { Badge, Card, CardHeader, cx, fmt, PageHeader, Stat, TIER_COLORS, useApi } from "@/components/ui";
import type { Nft } from "@/lib/engine/types";
import type { Asset, GenerationRun } from "@/lib/store";

type Gallery = {
  nfts: (Nft & { rendered: boolean; tier: string })[];
  history: GenerationRun[];
  configHash: string | null;
  currentConfigHash: string;
};

export default function Overview() {
  const { project, validation, base } = useProject();
  const { data: col } = useApi<Gallery>(`${base}/collection`);
  const { data: assets } = useApi<Asset[]>(`${base}/assets`);
  const nfts = col?.nfts ?? [];
  const rendered = nfts.filter((n) => n.rendered).length;
  const reviewed = nfts.filter((n) => n.status !== "draft").length;
  const traits = project.config.categories.reduce((s, c) => s + c.traits.length, 0);
  const withArt = project.config.categories.reduce((s, c) => s + c.traits.filter((t) => t.assetId).length, 0);
  const tiers = Object.keys(TIER_COLORS).map((t) => nfts.filter((n) => n.tier === t).length);
  const b = `/projects/${project.id}`;

  const steps = [
    { label: "Project blueprint", done: Boolean(project.blueprint), href: `${b}/architect`, detail: project.blueprint ? `by ${project.blueprint.provider}` : "Generate with the AI Architect" },
    { label: "Layer assets", done: (assets?.length ?? 0) > 0, href: `${b}/assets`, detail: `${assets?.length ?? 0} assets imported` },
    { label: "Traits & rules", done: traits > 0 && withArt === traits && !validation.errors.length, href: `${b}/traits`, detail: `${withArt}/${traits} traits have artwork · ${project.config.rules.length} rules` },
    { label: "Generate collection", done: nfts.length === project.config.supply, href: `${b}/generate`, detail: `${fmt.n(nfts.length)} / ${fmt.n(project.config.supply)} tokens` },
    { label: "Render artwork", done: nfts.length > 0 && rendered === nfts.length, href: `${b}/generate`, detail: `${fmt.n(rendered)} rendered` },
    { label: "Review & approve", done: nfts.length > 0 && reviewed === nfts.length, href: `${b}/gallery`, detail: `${fmt.n(reviewed)} approved or locked` },
    { label: "QA & export", done: false, href: `${b}/qa`, detail: "Run checks, then package" },
  ];

  return (
    <>
      <PageHeader title={project.name} sub={project.blueprint?.logline ?? project.concept} />
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Generated" value={`${fmt.n(nfts.length)}`} sub={`of ${fmt.n(project.config.supply)} supply`} accent="#8b5cf6" spark={tiers} />
        <Stat label="Rendered" value={fmt.n(rendered)} sub={nfts.length ? fmt.pct(rendered / nfts.length, 0) : "—"} accent="#22d3ee" />
        <Stat label="Reviewed" value={fmt.n(reviewed)} sub="approved or locked" accent="#22c55e" />
        <Stat label="Trait library" value={`${traits}`} sub={`${project.config.categories.length} categories · ${assets?.length ?? 0} assets`} accent="#f59e0b" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Production pipeline" sub="Each step links to its module." />
          <ol className="px-3 pb-3">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-panel-2">
                  <span
                    className={cx(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                      s.done ? "bg-good/15 text-green-300 ring-1 ring-good/30" : "bg-panel-3 text-muted ring-1 ring-line-2",
                    )}
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-[12px] text-muted">{s.detail}</span>
                  </span>
                  <span className="text-dim">›</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          {nfts.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Collection preview" right={<Link href={`${b}/gallery`} className="text-[13px] text-violet-2 hover:underline">Open gallery</Link>} />
              <div className="grid grid-cols-4 gap-1.5 px-5 pb-5">
                {nfts.slice(0, 8).map((n) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={n.tokenId} src={`${base}/nfts/${n.tokenId}/image?size=200`} alt={`#${n.tokenId}`} className="aspect-square w-full rounded-lg object-cover" />
                ))}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Recent generation runs" />
            <div className="px-5 pb-5">
              {!col?.history.length ? (
                <p className="text-sm text-muted">No runs yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {col.history.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2.5 text-[13px]">
                      <span>
                        <span className="font-mono text-violet-2">{r.seed}</span>
                        <span className="ml-2 text-muted">
                          {fmt.n(r.generated)} new · {fmt.n(r.preserved)} kept · {r.durationMs} ms
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {r.errors.length > 0 && <Badge tone="bad">{r.errors.length} errors</Badge>}
                        <span className="text-dim">{fmt.ago(r.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <Card>
              <CardHeader title="Configuration checks" />
              <ul className="space-y-1.5 px-5 pb-5 text-[13px]">
                {validation.errors.map((e) => (
                  <li key={e} className="text-rose-300">✕ {e}</li>
                ))}
                {validation.warnings.map((e) => (
                  <li key={e} className="text-amber-300">! {e}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
