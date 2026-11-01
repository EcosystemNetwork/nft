import { promises as fs } from "node:fs";
import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { artworkIsPublic } from "@/lib/public-art";
import { existingRender, LayerRenderer, thumbnail } from "@/lib/render";
import { getCollection, getProject, HttpError } from "@/lib/store";

/**
 * Serves a token image. Renders on demand if the batch render hasn't reached it
 * yet (preview mode). ?size=N returns a cached WebP thumbnail.
 */
export const GET = route<{ id: string; tokenId: string }>(async (req, { id, tokenId }) => {
  if (!(await artworkIsPublic(id))) await requireUser(req);
  const project = await getProject(id);
  const nft = (await getCollection(id))?.nfts.find((n) => n.tokenId === Number(tokenId));
  if (!nft) throw new HttpError(404, "Token not found");
  let file = await existingRender(project, nft);
  if (!file) {
    try {
      file = await (await new LayerRenderer(project).init()).renderToDisk(nft);
    } catch (e) {
      throw new HttpError(422, (e as Error).message);
    }
  }
  const size = Number(new URL(req.url).searchParams.get("size")) || 0;
  const buf = size > 0 ? await thumbnail(project, nft, file, Math.min(size, 1024)) : await fs.readFile(file);
  const type = size > 0 ? "image/webp" : project.canvas.format === "jpeg" ? "image/jpeg" : "image/png";
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": type, "cache-control": "private, max-age=3600", etag: `"${nft.dna}-${size}"` },
  });
}, { auth: "public" });
