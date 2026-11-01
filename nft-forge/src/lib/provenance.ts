import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Nft } from "./engine/types";
import { existingRender } from "./render";
import { HttpError, type Project } from "./store";

const g = globalThis as unknown as { __forgeProv?: Map<string, { hash: string; images: string[] }> };
const cache = (g.__forgeProv ??= new Map());

/**
 * Provenance hash: SHA-256 over the concatenated SHA-256 (hex) of every token's
 * image, in token-ID order. Committed on-chain before minting, it proves the
 * artwork and its order were fixed in advance. Anyone can recompute it from the
 * exported images. Cached per (token, DNA) set because renders are content-addressed.
 */
export async function computeProvenance(project: Project, nfts: Nft[]): Promise<{ hash: `0x${string}`; images: string[] }> {
  const sorted = [...nfts].sort((a, b) => a.tokenId - b.tokenId);
  const key = createHash("sha256")
    .update(`${project.id}|${project.canvas.format}|${sorted.map((n) => `${n.tokenId}:${n.dna}`).join(",")}`)
    .digest("hex");
  const hit = cache.get(key);
  if (hit) return { hash: `0x${hit.hash}`, images: hit.images };
  const images: string[] = [];
  for (const n of sorted) {
    const file = await existingRender(project, n);
    if (!file) throw new HttpError(409, `Token #${n.tokenId} is not rendered; provenance needs every final image.`);
    images.push(createHash("sha256").update(await fs.readFile(file)).digest("hex"));
  }
  const hash = createHash("sha256").update(images.join("")).digest("hex");
  cache.set(key, { hash, images });
  return { hash: `0x${hash}`, images };
}
