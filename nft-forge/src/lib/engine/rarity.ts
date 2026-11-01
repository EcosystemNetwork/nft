import { buildRuleIndex, selectTraits } from "./generator";
import { NONE, type CollectionConfig, type Nft, type RarityTier } from "./types";

export interface TraitStat {
  traitId: string;
  name: string;
  count: number;
  /** Share of the actual generated collection (0..1). */
  actual: number;
  /** Probability under the configured weights and rules, from simulation (0..1). */
  expected: number;
  /** Rarity tier of the trait itself, based on its actual share. */
  tier: string;
}

export interface CategoryStat {
  categoryId: string;
  name: string;
  traits: TraitStat[];
}

export interface TokenRarity {
  tokenId: number;
  /** Information-content score: sum of -log2(trait frequency). Higher = rarer. */
  score: number;
  rank: number;
  tier: string;
}

export interface RarityReport {
  supply: number;
  categories: CategoryStat[];
  tokens: TokenRarity[];
  tierCounts: Record<string, number>;
  uniqueCombinations: number;
  generatedAt: string;
}

/** Fixed trait-share thresholds for trait-level tiers (independent of token tiers). */
function traitTier(share: number): string {
  if (share <= 0.01) return "Mythic";
  if (share <= 0.03) return "Legendary";
  if (share <= 0.08) return "Epic";
  if (share <= 0.15) return "Rare";
  if (share <= 0.3) return "Uncommon";
  return "Common";
}

/**
 * Monte-Carlo estimate of each trait's probability under the configured weights,
 * conditional weight rules and compatibility rules. Pure weight normalization would
 * be wrong as soon as rules exist, so the configuration itself is simulated.
 */
export function expectedDistribution(
  config: Pick<CollectionConfig, "categories" | "rules" | "seed">,
  samples = 20000,
): Map<string, number> {
  const index = buildRuleIndex(config);
  const counts = new Map<string, number>();
  let ok = 0;
  for (let i = 0; i < samples; i++) {
    let traits: Record<string, string> | null = null;
    for (let a = 0; a < 20 && !traits; a++) traits = selectTraits(config, index, -1 - i, a);
    if (!traits) continue;
    ok++;
    for (const c of config.categories) {
      const key = `${c.id}/${traits[c.id] ?? NONE}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const out = new Map<string, number>();
  for (const [k, v] of counts) out.set(k, ok ? v / ok : 0);
  return out;
}

export function assignTier(rank: number, supply: number, tiers: RarityTier[]): string {
  const pct = rank / supply;
  const sorted = [...tiers].sort((a, b) => a.maxPercentile - b.maxPercentile);
  return (sorted.find((t) => pct <= t.maxPercentile) ?? sorted[sorted.length - 1])?.name ?? "Common";
}

/** All scores come from the actual generated tokens, not from the configured weights. */
export function computeRarity(
  config: Pick<CollectionConfig, "categories" | "rules" | "seed" | "tiers">,
  nfts: Nft[],
  expected?: Map<string, number>,
): RarityReport {
  const supply = nfts.length;
  const counts = new Map<string, number>();
  for (const n of nfts)
    for (const c of config.categories) {
      const key = `${c.id}/${n.traits[c.id] ?? NONE}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

  const categories: CategoryStat[] = config.categories.map((c) => {
    const ids = [...c.traits.map((t) => t.id), ...(c.required ? [] : [NONE])];
    return {
      categoryId: c.id,
      name: c.name,
      traits: ids.map((id) => {
        const count = counts.get(`${c.id}/${id}`) ?? 0;
        const actual = supply ? count / supply : 0;
        return {
          traitId: id,
          name: id === NONE ? "None" : (c.traits.find((t) => t.id === id)?.name ?? id),
          count,
          actual,
          expected: expected?.get(`${c.id}/${id}`) ?? 0,
          tier: traitTier(actual),
        };
      }),
    };
  });

  const scored = nfts.map((n) => {
    let score = 0;
    for (const c of config.categories) {
      const count = counts.get(`${c.id}/${n.traits[c.id] ?? NONE}`) ?? 1;
      score += -Math.log2(count / supply);
    }
    return { tokenId: n.tokenId, score: Math.round(score * 1000) / 1000 };
  });
  // Ties share a rank (standard competition ranking) so rank is reproducible.
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.tokenId - b.tokenId);
  const tokens: TokenRarity[] = [];
  let lastScore = Number.NaN;
  let lastRank = 0;
  sorted.forEach((s, i) => {
    const rank = s.score === lastScore ? lastRank : i + 1;
    lastScore = s.score;
    lastRank = rank;
    tokens.push({ ...s, rank, tier: assignTier(rank, supply, config.tiers) });
  });
  const tierCounts: Record<string, number> = {};
  for (const t of tokens) tierCounts[t.tier] = (tierCounts[t.tier] ?? 0) + 1;

  return {
    supply,
    categories,
    tokens,
    tierCounts,
    uniqueCombinations: new Set(nfts.map((n) => n.dna)).size,
    generatedAt: new Date().toISOString(),
  };
}

/** Co-occurrence matrix between two categories, used for rarity heatmaps. */
export function cooccurrence(
  config: Pick<CollectionConfig, "categories">,
  nfts: Nft[],
  categoryA: string,
  categoryB: string,
): { rows: { id: string; name: string }[]; cols: { id: string; name: string }[]; matrix: number[][] } {
  const opts = (catId: string) => {
    const c = config.categories.find((x) => x.id === catId);
    if (!c) return [];
    return [...c.traits.map((t) => ({ id: t.id, name: t.name })), ...(c.required ? [] : [{ id: NONE, name: "None" }])];
  };
  const rows = opts(categoryA);
  const cols = opts(categoryB);
  const ri = new Map(rows.map((r, i) => [r.id, i]));
  const ci = new Map(cols.map((c, i) => [c.id, i]));
  const matrix = rows.map(() => cols.map(() => 0));
  for (const n of nfts) {
    const r = ri.get(n.traits[categoryA] ?? NONE);
    const c = ci.get(n.traits[categoryB] ?? NONE);
    if (r !== undefined && c !== undefined) matrix[r][c]++;
  }
  return { rows, cols, matrix };
}
