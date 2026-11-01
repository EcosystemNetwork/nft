"use client";

import { useState } from "react";
import { useProject } from "@/components/project-context";
import { Card, CardHeader, cx, Empty, fmt, PageHeader, Select, Spinner, Stat, TIER_COLORS, TierBadge, useApi } from "@/components/ui";
import type { RarityReport } from "@/lib/engine/rarity";

type Heat = { rows: { id: string; name: string }[]; cols: { id: string; name: string }[]; matrix: number[][] };
type Resp = RarityReport & { heatmap: Heat | null };

const TIERS = ["Mythic", "Legendary", "Epic", "Rare", "Uncommon", "Common"];

export default function Rarity() {
  const { project, base } = useProject();
  const cats = project.config.categories;
  const [a, setA] = useState(cats[1]?.id ?? cats[0]?.id ?? "");
  const [b, setB] = useState(cats[5]?.id ?? cats[cats.length - 1]?.id ?? "");
  const { data } = useApi<Resp>(a && b ? `${base}/rarity?a=${a}&b=${b}` : `${base}/rarity`);

  if (!data) return <div className="grid place-items-center py-24"><Spinner className="h-6 w-6" /></div>;
  if (!data.supply) return (<><PageHeader title="Rarity Analytics" /><Empty title="Generate the collection to see rarity">All rarity numbers are computed from the actual generated tokens.</Empty></>);

  const maxTier = Math.max(...TIERS.map((t) => data.tierCounts[t] ?? 0), 1);
  const worst = data.categories
    .flatMap((c) => c.traits.map((t) => ({ c: c.name, ...t, dev: t.actual - t.expected })))
    .sort((x, y) => Math.abs(y.dev) - Math.abs(x.dev))[0];
  const rarestTrait = data.categories.flatMap((c) => c.traits.map((t) => ({ c: c.name, ...t }))).filter((t) => t.count > 0).sort((x, y) => x.count - y.count)[0];

  return (
    <>
      <PageHeader title="Rarity Analytics" sub="Scores, ranks and tiers come from the actual generated collection, not from configured weights." />
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Unique combinations" value={fmt.n(data.uniqueCombinations)} sub={`of ${fmt.n(data.supply)} tokens`} />
        <Stat label="Rarest trait" value={rarestTrait ? `${rarestTrait.count}×` : "—"} sub={rarestTrait ? `${rarestTrait.c} / ${rarestTrait.name}` : ""} accent="#22d3ee" />
        <Stat label="Largest drift from plan" value={worst ? `${(worst.dev * 100).toFixed(1)} pts` : "—"} sub={worst ? `${worst.c} / ${worst.name}` : ""} accent="#f59e0b" />
        <Stat label="Top score" value={data.tokens[0]?.score.toFixed(2) ?? "—"} sub={data.tokens[0] ? `#${data.tokens[0].tokenId} · rank 1` : ""} accent="#22c55e" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Token tiers" sub="Percentile of rarity rank (information-content score)." />
          <div className="space-y-2.5 px-5 pb-5">
            {TIERS.map((t) => {
              const n = data.tierCounts[t] ?? 0;
              return (
                <div key={t} className="grid grid-cols-[92px_1fr_88px] items-center gap-3 text-[13px]" title={`${t}: ${n} tokens (${fmt.pct(n / data.supply)})`}>
                  <span className="text-muted">{t}</span>
                  <div className="h-5 rounded-r bg-panel-2">
                    <div className="h-full rounded-r transition-all" style={{ width: `${(n / maxTier) * 100}%`, background: TIER_COLORS[t] }} />
                  </div>
                  <span className="text-right tabular-nums">{fmt.n(n)} <span className="text-dim">{fmt.pct(n / data.supply, 0)}</span></span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHeader title="Rarest tokens" sub="Top 12 by rarity score." />
          <div className="grid grid-cols-4 gap-2 px-5 pb-5 sm:grid-cols-6">
            {data.tokens.slice(0, 12).map((t) => (
              <div key={t.tokenId} className="group relative" title={`#${t.tokenId} · rank ${t.rank} · score ${t.score}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${base}/nfts/${t.tokenId}/image?size=200`} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-line" />
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="font-semibold">#{t.tokenId}</span>
                  <span className="text-dim">{t.rank}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Trait distribution: actual vs expected"
          sub="Bar = actual share of the collection. Tick = expected share, simulated from weights and rules. Hover a row for exact values."
        />
        <div className="grid gap-x-10 gap-y-6 px-5 pb-6 lg:grid-cols-2">
          {data.categories.map((c) => {
            const max = Math.max(...c.traits.map((t) => Math.max(t.actual, t.expected)), 0.01);
            return (
              <div key={c.categoryId}>
                <div className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">{c.name}</div>
                <div className="space-y-1">
                  {c.traits.map((t) => {
                    const dev = t.actual - t.expected;
                    return (
                      <div
                        key={t.traitId}
                        className="group grid grid-cols-[130px_1fr_110px] items-center gap-3 rounded-md px-1 py-0.5 text-[12px] hover:bg-panel-2"
                        title={`${t.name}: ${t.count} tokens · actual ${fmt.pct(t.actual, 2)} · expected ${fmt.pct(t.expected, 2)} · ${t.tier}`}
                      >
                        <span className="truncate">{t.name}</span>
                        <div className="relative h-3.5">
                          <div className="absolute inset-y-0 left-0 rounded-r bg-violet/80 group-hover:bg-violet" style={{ width: `${(t.actual / max) * 100}%` }} />
                          <div className="absolute -inset-y-0.5 w-0.5 rounded bg-ink" style={{ left: `calc(${(t.expected / max) * 100}% - 1px)` }} />
                        </div>
                        <span className="text-right tabular-nums">
                          {fmt.pct(t.actual)}{" "}
                          <span className={cx(Math.abs(dev) > 0.02 ? "text-amber-300" : "text-dim")}>
                            {dev >= 0 ? "+" : ""}
                            {(dev * 100).toFixed(1)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Combination heatmap"
          sub="How often two categories' traits appear together. Empty cells are combinations your rules forbid or that never occurred."
          right={
            <div className="flex gap-2">
              <Select value={a} onChange={(e) => setA(e.target.value)} className="h-9 w-40 text-[13px]">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <span className="self-center text-dim">×</span>
              <Select value={b} onChange={(e) => setB(e.target.value)} className="h-9 w-40 text-[13px]">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          }
        />
        {data.heatmap && <Heatmap h={data.heatmap} />}
      </Card>

      <Card>
        <CardHeader title="Rarity ranking" sub="Top 100. Score = Σ −log₂(trait frequency). Ties share a rank." />
        <div className="max-h-[480px] overflow-auto px-5 pb-5">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-panel text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line"><th className="py-2 font-medium">Rank</th><th className="py-2 font-medium">Token</th><th className="py-2 font-medium">Score</th><th className="py-2 font-medium">Tier</th></tr>
            </thead>
            <tbody>
              {data.tokens.map((t) => (
                <tr key={t.tokenId} className="border-b border-line/50">
                  <td className="py-2 tabular-nums">{t.rank}</td>
                  <td className="py-2 font-medium">#{t.tokenId}</td>
                  <td className="py-2 tabular-nums">{t.score.toFixed(3)}</td>
                  <td className="py-2"><TierBadge tier={t.tier} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Heatmap({ h }: { h: Heat }) {
  const max = Math.max(...h.matrix.flat(), 1);
  return (
    <div className="overflow-x-auto px-5 pb-5">
      <table className="border-separate border-spacing-[2px] text-[11px]">
        <thead>
          <tr>
            <th />
            {h.cols.map((c) => (
              <th key={c.id} className="h-24 w-12 align-bottom font-medium text-muted">
                <div className="mx-auto w-4 [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{c.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {h.rows.map((r, i) => (
            <tr key={r.id}>
              <th className="pr-3 text-right font-medium whitespace-nowrap text-muted">{r.name}</th>
              {h.matrix[i].map((v, j) => {
                const k = v / max;
                return (
                  <td
                    key={j}
                    title={`${r.name} × ${h.cols[j].name}: ${v} tokens`}
                    className={cx("h-9 w-12 rounded text-center tabular-nums transition hover:ring-2 hover:ring-white/60", v === 0 && "ring-1 ring-line ring-inset")}
                    style={{ background: v ? `color-mix(in oklab, #8065e8 ${Math.round(18 + k * 82)}%, #141425)` : "transparent", color: k > 0.55 ? "#0b0b14" : "#ececf6" }}
                  >
                    {v || ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
