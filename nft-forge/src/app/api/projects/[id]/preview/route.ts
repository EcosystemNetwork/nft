import sharp from "sharp";
import { body, route } from "@/lib/api";
import { buildRuleIndex, computeDna, selectTraits, validateConfig } from "@/lib/engine/generator";
import type { TraitCategory, TraitRule } from "@/lib/engine/types";
import { LayerRenderer } from "@/lib/render";
import { getProject, HttpError } from "@/lib/store";

/**
 * Quick preview: sample N combinations from a (possibly unsaved) trait config and
 * return small renders as data URLs. Nothing is persisted.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = await body<{ count?: number; seed?: string; categories?: TraitCategory[]; rules?: TraitRule[] }>(req);
  const project = await getProject(id);
  const config = {
    ...project.config,
    categories: b.categories ?? project.config.categories,
    rules: b.rules ?? project.config.rules,
    seed: b.seed ?? Math.random().toString(36).slice(2, 10),
  };
  const v = validateConfig({ ...config, supply: 1 });
  if (v.errors.length) throw new HttpError(422, v.errors.join("\n"));
  const renderer = await new LayerRenderer({ ...project, config }).init();
  const index = buildRuleIndex(config);
  const count = Math.min(Math.max(1, b.count ?? 12), 24);
  const out = [];
  for (let i = 0; i < count; i++) {
    let traits: Record<string, string> | null = null;
    for (let a = 0; a < 50 && !traits; a++) traits = selectTraits(config, index, i, a);
    if (!traits) continue;
    const nft = { tokenId: i, dna: computeDna(config.categories, traits), traits, status: "draft" as const, attempt: 0, configHash: "" };
    try {
      const png = await sharp(await renderer.render(nft)).resize(256, 256).webp({ quality: 80 }).toBuffer();
      out.push({ traits, image: `data:image/webp;base64,${png.toString("base64")}` });
    } catch (e) {
      out.push({ traits, error: (e as Error).message });
    }
  }
  return { seed: config.seed, previews: out };
});
