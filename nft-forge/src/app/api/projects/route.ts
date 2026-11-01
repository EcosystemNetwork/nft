import { body, route } from "@/lib/api";
import type { ProductionMode } from "@/lib/engine/types";
import { createProject, getCollection, HttpError, listAssets, listProjects, type Chain } from "@/lib/store";

export const GET = route(async () => {
  const projects = await listProjects();
  return Promise.all(
    projects.map(async (p) => {
      const c = await getCollection(p.id);
      return {
        ...p,
        stats: {
          assets: (await listAssets(p.id)).length,
          categories: p.config.categories.length,
          traits: p.config.categories.reduce((s, c) => s + c.traits.length, 0),
          generated: c?.nfts.length ?? 0,
          approved: c?.nfts.filter((n) => n.status !== "draft").length ?? 0,
        },
      };
    }),
  );
});

export const POST = route(async (req) => {
  const b = await body<{
    name?: string;
    concept?: string;
    supply?: number;
    style?: string;
    chain?: Chain;
    mode?: ProductionMode;
  }>(req);
  if (!b.name?.trim()) throw new HttpError(400, "Project name is required");
  const supply = Number(b.supply ?? 1000);
  if (!Number.isInteger(supply) || supply < 1 || supply > 100000) throw new HttpError(400, "Supply must be 1–100,000");
  return createProject({
    name: b.name.trim(),
    concept: b.concept?.trim() ?? "",
    supply,
    style: b.style?.trim() ?? "",
    chain: (["robinhood", "solana", "ethereum", "base", "sui"] as const).includes(b.chain as Chain) ? (b.chain as Chain) : "robinhood",
    mode: (["2d", "3d", "hybrid"] as const).includes(b.mode as ProductionMode) ? (b.mode as ProductionMode) : "2d",
  });
});
