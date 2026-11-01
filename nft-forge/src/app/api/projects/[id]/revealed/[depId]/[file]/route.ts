import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { artworkIdFor, buildCollectionMetadata, buildRevealedTokenMetadata } from "@/lib/engine/metadata";
import { getEvmDeployment } from "@/lib/evm-deployments";
import { getCollection, getProject, HttpError } from "@/lib/store";

/**
 * Revealed preview metadata for a testnet delayed-reveal deployment: token N.json
 * describes artwork artworkId(N) under token N's name. Mainnet reveals use IPFS.
 */
export const GET = route<{ id: string; depId: string; file: string }>(async (req, { id, depId, file }) => {
  const d = await getEvmDeployment(id, depId);
  if (d.mode !== "test" || !d.reveal) throw new HttpError(404, "Not revealed");
  const project = await getProject(id);
  const origin = new URL(req.url).origin;
  const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" };
  if (file === "collection.json") return NextResponse.json(buildCollectionMetadata(project.metadata, d.params.maxSupply), { headers });
  const m = /^(\d+)\.json$/.exec(file);
  const t = m ? Number(m[1]) : NaN;
  if (!(t >= d.params.startTokenId && t < d.params.startTokenId + d.params.maxSupply)) throw new HttpError(404, "Token not found");
  const art = (await getCollection(id))?.nfts.find((n) => n.tokenId === artworkIdFor(t, d.params.startTokenId, d.params.maxSupply, d.reveal!.offset));
  if (!art) throw new HttpError(404, "Artwork not found");
  const meta = buildRevealedTokenMetadata(project.metadata, project.config.categories, project.canvas, art, t);
  return NextResponse.json({ ...meta, image: project.metadata.imageBaseUri ? meta.image : `${origin}/api/projects/${id}/nfts/${art.tokenId}/image` }, { headers });
}, { auth: "public" });
