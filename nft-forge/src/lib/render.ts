import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NONE, type Nft } from "./engine/types";
import { fileExists, listAssets, paths, type Asset, type Project } from "./store";

/**
 * 2D production engine: composites trait layers in `layer` order onto the
 * project canvas. Layers are normalized to the canvas size once and cached.
 */
export class LayerRenderer {
  private cache = new Map<string, Buffer>();
  private assets = new Map<string, Asset>();

  constructor(private project: Project) {}

  async init() {
    for (const a of await listAssets(this.project.id)) this.assets.set(a.id, a);
    return this;
  }

  /** Ordered list of asset ids this token needs (bottom layer first). */
  layersFor(nft: Nft): { categoryName: string; traitName: string; assetId?: string }[] {
    return [...this.project.config.categories]
      .sort((a, b) => a.layer - b.layer)
      .flatMap((c) => {
        const v = nft.traits[c.id] ?? NONE;
        if (v === NONE) return [];
        const t = c.traits.find((x) => x.id === v);
        return [{ categoryName: c.name, traitName: t?.name ?? v, assetId: t?.assetId }];
      });
  }

  private async layerBuffer(assetId: string): Promise<Buffer> {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Missing asset ${assetId}`);
    const key = `${assetId}:${asset.version}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const { width, height } = this.project.canvas;
    const buf = await sharp(paths.assetFile(this.project.id, assetId, asset.version))
      .ensureAlpha()
      .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    this.cache.set(key, buf);
    return buf;
  }

  async render(nft: Nft): Promise<Buffer> {
    const { width, height, format } = this.project.canvas;
    const layers = this.layersFor(nft);
    const missing = layers.filter((l) => !l.assetId || !this.assets.has(l.assetId));
    if (missing.length)
      throw new Error(`No artwork for: ${missing.map((m) => `${m.categoryName} / ${m.traitName}`).join(", ")}`);
    const inputs = await Promise.all(layers.map((l) => this.layerBuffer(l.assetId!)));
    const img = sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite(inputs.map((input) => ({ input, top: 0, left: 0 })));
    return format === "jpeg" ? img.flatten({ background: "#000" }).jpeg({ quality: 92 }).toBuffer() : img.png().toBuffer();
  }

  ext() {
    return this.project.canvas.format === "jpeg" ? "jpg" : "png";
  }

  renderPath(nft: Nft) {
    return paths.render(this.project.id, nft.tokenId, nft.dna, this.ext());
  }

  async renderToDisk(nft: Nft): Promise<string> {
    const file = this.renderPath(nft);
    const buf = await this.render(nft);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return file;
  }
}

/** A render is current if a file exists for this exact token + DNA (+ canvas format). */
export async function existingRender(project: Project, nft: Nft): Promise<string | null> {
  const ext = project.canvas.format === "jpeg" ? "jpg" : "png";
  const file = paths.render(project.id, nft.tokenId, nft.dna, ext);
  return (await fileExists(file)) ? file : null;
}

export async function renderedSet(project: Project): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(paths.rendersDir(project.id)));
  } catch {
    return new Set();
  }
}

export async function thumbnail(project: Project, nft: Nft, source: string, size: number): Promise<Buffer> {
  const file = path.join(paths.thumbsDir(project.id), `${nft.tokenId}-${nft.dna}-${size}.webp`);
  try {
    return await fs.readFile(file);
  } catch {
    const buf = await sharp(source).resize(size, size, { fit: "inside" }).webp({ quality: 82 }).toBuffer();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}
