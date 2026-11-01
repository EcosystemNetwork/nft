import { route } from "@/lib/api";
import { regenerateOne } from "@/lib/collection";
import { buildRuleIndex, validateCombination } from "@/lib/engine/generator";
import { buildTokenMetadata, validateTokenMetadata } from "@/lib/engine/metadata";
import { LayerRenderer } from "@/lib/render";
import { getCollection, getProject, HttpError } from "@/lib/store";

/** Token detail: generation record, metadata, layers and validation. */
export const GET = route<{ id: string; tokenId: string }>(async (_req, { id, tokenId }) => {
  const project = await getProject(id);
  const nft = (await getCollection(id))?.nfts.find((n) => n.tokenId === Number(tokenId));
  if (!nft) throw new HttpError(404, "Token not found");
  const metadata = buildTokenMetadata(project.metadata, project.config.categories, project.canvas, nft);
  const renderer = await new LayerRenderer(project).init();
  return {
    nft,
    metadata,
    layers: renderer.layersFor(nft),
    problems: [
      ...validateCombination(project.config, nft.traits, buildRuleIndex(project.config)),
      ...validateTokenMetadata(metadata, project.metadata).map((p) => `Metadata: ${p}`),
    ],
    record: { seed: project.config.seed, attempt: nft.attempt, configHash: nft.configHash, dna: nft.dna },
  };
});

/** POST = regenerate this draft token. */
export const POST = route<{ id: string; tokenId: string }>(async (_req, { id, tokenId }) => regenerateOne(id, Number(tokenId)));
