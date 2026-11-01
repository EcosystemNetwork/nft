import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { body, route } from "@/lib/api";
import { HttpError, listAssets, paths, saveAssets, updateProject, withProjectLock } from "@/lib/store";

/** GET serves the image (optionally ?size=N thumbnail, ?v=N specific version). */
export const GET = route<{ id: string; assetId: string }>(async (req, { id, assetId }) => {
  const a = (await listAssets(id)).find((x) => x.id === assetId);
  if (!a) throw new HttpError(404, "Asset not found");
  const url = new URL(req.url);
  const version = Number(url.searchParams.get("v")) || a.version;
  const size = Number(url.searchParams.get("size")) || 0;
  let buf: Buffer = await fs.readFile(paths.assetFile(id, assetId, version));
  let type = "image/png";
  if (size > 0 && size < Math.max(a.width, a.height)) {
    buf = await sharp(buf).resize(size, size, { fit: "inside" }).webp().toBuffer();
    type = "image/webp";
  }
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": type, "cache-control": "private, max-age=31536000, immutable" },
  });
});

export const PATCH = route<{ id: string; assetId: string }>(async (req, { id, assetId }) => {
  const b = await body<{ name?: string; tags?: string[]; categoryHint?: string }>(req);
  return withProjectLock(`${id}:assets`, async () => {
    const assets = await listAssets(id);
    const a = assets.find((x) => x.id === assetId);
    if (!a) throw new HttpError(404, "Asset not found");
    if (b.name !== undefined) a.name = b.name;
    if (b.tags) a.tags = b.tags;
    if (b.categoryHint !== undefined) a.categoryHint = b.categoryHint;
    await saveAssets(id, assets);
    return a;
  });
});

export const DELETE = route<{ id: string; assetId: string }>(async (_req, { id, assetId }) => {
  await withProjectLock(`${id}:assets`, async () => {
    const assets = await listAssets(id);
    if (!assets.some((a) => a.id === assetId)) throw new HttpError(404, "Asset not found");
    await saveAssets(
      id,
      assets.filter((a) => a.id !== assetId),
    );
    await fs.rm(path.dirname(paths.assetFile(id, assetId, 1)), { recursive: true, force: true });
  });
  await updateProject(id, (p) => {
    for (const c of p.config.categories) for (const t of c.traits) if (t.assetId === assetId) delete t.assetId;
  });
  return { ok: true };
});
