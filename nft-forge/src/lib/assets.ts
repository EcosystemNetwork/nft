import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import {
  HttpError,
  listAssets,
  newId,
  saveAssets,
  withProjectLock,
  writeAssetFile,
  type Asset,
} from "./store";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 8192 * 8192;
const ACCEPTED = new Set(["png", "jpeg", "webp", "svg", "gif", "tiff", "avif"]);

export interface IngestResult {
  asset: Asset;
  duplicateOf?: string;
  replaced?: boolean;
}

/**
 * Validates an uploaded image by actually decoding it (extension and MIME are
 * not trusted), normalizes it to PNG, and records transparency + resolution.
 * Re-uploading to an existing asset id creates a new version.
 */
export async function ingestAsset(
  projectId: string,
  data: Buffer,
  fileName: string,
  opts: { categoryHint?: string; source?: Asset["source"]; replaceAssetId?: string; tags?: string[] } = {},
): Promise<IngestResult> {
  if (data.length > MAX_BYTES) throw new HttpError(413, `${fileName}: larger than 25 MB`);
  let meta: Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new HttpError(415, `${fileName}: not a readable image`);
  }
  if (!meta.format || !ACCEPTED.has(meta.format))
    throw new HttpError(415, `${fileName}: unsupported format ${meta.format ?? "unknown"} (PSD: export layers as PNG)`);

  const png = await sharp(data, { limitInputPixels: MAX_PIXELS }).ensureAlpha().png({ compressionLevel: 8 }).toBuffer();
  const stats = await sharp(png).stats();
  const alpha = stats.channels[3];
  const hasTransparency = alpha ? alpha.min < 255 : false;
  const sha256 = createHash("sha256").update(png).digest("hex");
  const info = await sharp(png).metadata();
  const name = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const now = new Date().toISOString();

  return withProjectLock(`${projectId}:assets`, async () => {
    const assets = await listAssets(projectId);
    if (opts.replaceAssetId) {
      const a = assets.find((x) => x.id === opts.replaceAssetId);
      if (!a) throw new HttpError(404, "Asset not found");
      if (a.sha256 === sha256) return { asset: a, duplicateOf: a.id };
      const version = a.version + 1;
      await writeAssetFile(projectId, a.id, version, png);
      Object.assign(a, {
        version,
        sha256,
        bytes: png.length,
        width: info.width!,
        height: info.height!,
        hasAlpha: Boolean(meta.hasAlpha),
        hasTransparency,
        fileName,
      });
      a.versions.push({ version, sha256, bytes: png.length, width: info.width!, height: info.height!, at: now });
      await saveAssets(projectId, assets);
      return { asset: a, replaced: true };
    }
    const dup = assets.find((x) => x.sha256 === sha256);
    if (dup) return { asset: dup, duplicateOf: dup.id };
    const asset: Asset = {
      id: newId("a"),
      name,
      fileName,
      categoryHint: opts.categoryHint,
      source: opts.source ?? "upload",
      tags: opts.tags ?? [],
      mime: "image/png",
      width: info.width!,
      height: info.height!,
      hasAlpha: Boolean(meta.hasAlpha),
      hasTransparency,
      sha256,
      bytes: png.length,
      version: 1,
      versions: [{ version: 1, sha256, bytes: png.length, width: info.width!, height: info.height!, at: now }],
      createdAt: now,
    };
    await writeAssetFile(projectId, asset.id, 1, png);
    assets.push(asset);
    await saveAssets(projectId, assets);
    return { asset };
  });
}
