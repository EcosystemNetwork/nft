import { route } from "@/lib/api";
import { configHash } from "@/lib/engine/generator";
import { computeRarity } from "@/lib/engine/rarity";
import { renderedSet } from "@/lib/render";
import { getCollection, getProject } from "@/lib/store";

/** Gallery payload: every token with render state and rarity rank. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const project = await getProject(id);
  const c = await getCollection(id);
  if (!c) return { nfts: [], history: [], configHash: null, currentConfigHash: configHash(project.config) };
  const files = await renderedSet(project);
  const ext = project.canvas.format === "jpeg" ? "jpg" : "png";
  const rarity = computeRarity(project.config, c.nfts);
  const byToken = new Map(rarity.tokens.map((t) => [t.tokenId, t]));
  return {
    configHash: c.configHash,
    currentConfigHash: configHash(project.config),
    seed: c.seed,
    generatedAt: c.generatedAt,
    history: c.history,
    nfts: c.nfts.map((n) => {
      const r = byToken.get(n.tokenId);
      return {
        ...n,
        rendered: files.has(`${n.tokenId}-${n.dna}.${ext}`),
        rank: r?.rank ?? 0,
        score: r?.score ?? 0,
        tier: r?.tier ?? "",
      };
    }),
  };
});
