import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { buildCollectionMetadata, buildTokenMetadata } from "@/lib/engine/metadata";
import { getCollection, getProject, HttpError } from "@/lib/store";

/**
 * Preview metadata host: GET .../metadata/{tokenId}.json and .../metadata/collection.json.
 * Used as the base URI for testnet deployments before the collection is pinned to IPFS
 * or Arweave. Mainnet deployments must use permanent hosting instead.
 */
export const GET = route<{ id: string; file: string }>(async (req, { id, file }) => {
  const project = await getProject(id);
  const origin = new URL(req.url).origin;
  const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" };
  if (file === "collection.json") {
    const meta = buildCollectionMetadata(project.metadata, project.config.supply);
    const first = project.metadata.startTokenId;
    return NextResponse.json({ ...meta, image: `${origin}/api/projects/${id}/nfts/${first}/image` }, { headers });
  }
  const m = /^(\d+)\.json$/.exec(file);
  if (!m) throw new HttpError(404, "Not found");
  const nft = (await getCollection(id))?.nfts.find((n) => n.tokenId === Number(m[1]));
  if (!nft) throw new HttpError(404, "Token not found");
  const meta = buildTokenMetadata(project.metadata, project.config.categories, project.canvas, nft);
  return NextResponse.json({ ...meta, image: project.metadata.imageBaseUri ? meta.image : `${origin}/api/projects/${id}/nfts/${nft.tokenId}/image` }, { headers });
});
