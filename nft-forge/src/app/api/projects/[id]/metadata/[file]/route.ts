import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { buildCollectionMetadata, buildTokenMetadata } from "@/lib/engine/metadata";
import { artworkIsPublic } from "@/lib/public-art";
import { getSale, unrevealedImage, unrevealedMetadata } from "@/lib/sale";
import { getCollection, getProject, HttpError } from "@/lib/store";

/**
 * Preview metadata host: GET .../metadata/{tokenId}.json and .../metadata/collection.json.
 * Used as the base URI for testnet deployments before the collection is pinned to IPFS
 * or Arweave. Mainnet deployments must use permanent hosting instead.
 * Delayed-reveal placeholders: unrevealed.json and unrevealed.png.
 */
export const GET = route<{ id: string; file: string }>(async (req, { id, file }) => {
  const project = await getProject(id);
  const origin = new URL(req.url).origin;
  const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" };
  const placeholder = file === "unrevealed.json" || file === "unrevealed.png";
  if (!placeholder && !(await artworkIsPublic(id))) await requireUser(req);
  if (file === "collection.json") {
    const meta = buildCollectionMetadata(project.metadata, project.config.supply);
    const first = project.metadata.startTokenId;
    return NextResponse.json({ ...meta, image: `${origin}/api/projects/${id}/nfts/${first}/image` }, { headers });
  }
  if (file === "unrevealed.json") return NextResponse.json(unrevealedMetadata(await getSale(id), `${origin}/api/projects/${id}/metadata/unrevealed.png`), { headers });
  if (file === "unrevealed.png")
    return new NextResponse(new Uint8Array(await unrevealedImage(project)), { headers: { ...headers, "content-type": "image/png", "cache-control": "public, max-age=3600" } });
  const m = /^(\d+)\.json$/.exec(file);
  if (!m) throw new HttpError(404, "Not found");
  const nft = (await getCollection(id))?.nfts.find((n) => n.tokenId === Number(m[1]));
  if (!nft) throw new HttpError(404, "Token not found");
  const meta = buildTokenMetadata(project.metadata, project.config.categories, project.canvas, nft);
  return NextResponse.json({ ...meta, image: project.metadata.imageBaseUri ? meta.image : `${origin}/api/projects/${id}/nfts/${nft.tokenId}/image` }, { headers });
}, { auth: "public" });
