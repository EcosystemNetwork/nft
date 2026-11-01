import { route } from "@/lib/api";
import { configHash } from "@/lib/engine/generator";
import { computeRarity, cooccurrence, expectedDistribution } from "@/lib/engine/rarity";
import { getCollection, getProject } from "@/lib/store";

const g = globalThis as unknown as { __forgeExpected?: Map<string, Map<string, number>> };
const expectedCache = (g.__forgeExpected ??= new Map());

/** ?a=<categoryId>&b=<categoryId> adds a co-occurrence heatmap. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const project = await getProject(id);
  const c = await getCollection(id);
  const nfts = c?.nfts ?? [];
  const hash = configHash(project.config);
  let expected = expectedCache.get(hash);
  if (!expected) {
    expected = expectedDistribution(project.config);
    expectedCache.set(hash, expected);
  }
  const report = computeRarity(project.config, nfts, expected);
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  return {
    ...report,
    // Full token ranking is large; the gallery has per-token ranks. Send the top 100.
    tokens: report.tokens.slice(0, 100),
    heatmap: a && b ? cooccurrence(project.config, nfts, a, b) : null,
  };
});
