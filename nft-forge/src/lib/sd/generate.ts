import { promises as fs } from "node:fs";
import sharp from "sharp";
import { ingestAsset } from "../assets";
import { HttpError, listAssets, paths, type AssetGeneration } from "../store";
import { readImageInfo, sdJson, type A1111Images } from "./client";
import { extraBody, img2imgBody, parseGenRequest, plotValues, txt2imgBody, type GenRequest, type PlotAxis } from "./payload";
import { applyStyles, buildInfotext, expandPromptMatrix } from "./prompt";
import { promptsFor, listStyles } from "./styles";

export interface GeneratedImage {
  pngBase64: string;
  seed: number;
  infotext: string;
  width: number;
  height: number;
  grid?: boolean;
}

export interface SdCaller {
  txt2img(body: Record<string, unknown>): Promise<A1111Images>;
  img2img(body: Record<string, unknown>): Promise<A1111Images>;
  extra(body: Record<string, unknown>): Promise<A1111Images>;
  readAsset(projectId: string, assetId: string): Promise<Buffer>;
}

const MAX_B64 = 18_000_000;
const MAX_IMAGES = 16;

function stripDataUrl(s: string): string {
  const i = s.indexOf(",");
  return s.startsWith("data:") && i >= 0 ? s.slice(i + 1) : s;
}

function decodeImage(b64: string, label: string): Buffer {
  const raw = stripDataUrl(b64).trim();
  if (!raw || raw.length > MAX_B64) throw new HttpError(413, `${label} is missing or too large`);
  return Buffer.from(raw, "base64");
}

async function toPngB64(buf: Buffer): Promise<{ b64: string; width: number; height: number }> {
  const png = await sharp(buf, { limitInputPixels: 8192 * 8192 }).ensureAlpha().png().toBuffer();
  const meta = await sharp(png).metadata();
  return { b64: png.toString("base64"), width: meta.width ?? 0, height: meta.height ?? 0 };
}

function imagesFrom(res: A1111Images, fallback: { prompt: string; negative: string; seed: number; req: GenRequest }): GeneratedImage[] {
  const list = res.images ?? (res.image ? [res.image] : []);
  const info = readImageInfo(res.info);
  return list.map((pngBase64, i) => {
    const seed = info.seeds[i] ?? info.seeds[0] ?? fallback.seed;
    const infotext = info.infotexts[i] ?? info.infotexts[0] ?? buildInfotext({
      prompt: fallback.prompt,
      negativePrompt: fallback.negative,
      steps: fallback.req.steps,
      sampler: fallback.req.sampler,
      cfg: fallback.req.cfg,
      seed: seed < 0 ? 0 : seed,
      width: fallback.req.width,
      height: fallback.req.height,
      denoising: fallback.req.mode === "txt2img" ? undefined : fallback.req.denoising,
    });
    return { pngBase64: stripDataUrl(pngBase64), seed, infotext, width: fallback.req.width, height: fallback.req.height };
  });
}

async function gridOf(images: GeneratedImage[]): Promise<GeneratedImage | null> {
  if (images.length < 2 || images.length > MAX_IMAGES) return null;
  const pngs = images.map((im) => Buffer.from(im.pngBase64, "base64"));
  const meta = await sharp(pngs[0]).metadata();
  const w = meta.width ?? images[0].width;
  const h = meta.height ?? images[0].height;
  if (!w || !h) return null;
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const composite = pngs.map((input, i) => ({ input, left: (i % columns) * w, top: Math.floor(i / columns) * h }));
  const png = await sharp({
    create: { width: columns * w, height: rows * h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composite)
    .png()
    .toBuffer();
  return {
    pngBase64: png.toString("base64"),
    seed: images[0].seed,
    infotext: images[0].infotext,
    width: columns * w,
    height: rows * h,
    grid: true,
  };
}

function applyAxis(req: GenRequest, axis: PlotAxis, value: string): GenRequest {
  const next = { ...req, hires: req.hires ? { ...req.hires } : null };
  if (axis === "Seed") next.seed = Math.max(-1, Math.round(Number(value)));
  else if (axis === "Steps") next.steps = Math.min(150, Math.max(1, Math.round(Number(value))));
  else if (axis === "CFG scale") next.cfg = Math.min(30, Math.max(1, Number(value)));
  else next.sampler = value;
  return next;
}

const defaultCaller: SdCaller = {
  txt2img: (body) => sdJson<A1111Images>("/sdapi/v1/txt2img", { body, timeoutMs: 600_000 }),
  img2img: (body) => sdJson<A1111Images>("/sdapi/v1/img2img", { body, timeoutMs: 600_000 }),
  extra: (body) => sdJson<A1111Images>("/sdapi/v1/extra-single-image", { body, timeoutMs: 600_000 }),
  async readAsset(projectId, assetId) {
    const asset = (await listAssets(projectId)).find((a) => a.id === assetId);
    if (!asset) throw new HttpError(404, "Asset not found");
    return fs.readFile(paths.assetFile(projectId, assetId, asset.version));
  },
};

async function styled(projectId: string, req: GenRequest): Promise<{ prompt: string; negative: string }> {
  const styles = await listStyles(projectId);
  const picked = promptsFor(styles, req.styleNames);
  return {
    prompt: applyStyles(req.prompt, picked.positive),
    negative: applyStyles(req.negativePrompt, picked.negative),
  };
}

async function initImage(projectId: string, req: GenRequest, caller: SdCaller): Promise<string> {
  if (req.initAssetId) {
    const buf = await caller.readAsset(projectId, req.initAssetId);
    return (await toPngB64(buf)).b64;
  }
  if (req.initImage) return (await toPngB64(decodeImage(req.initImage, "Init image"))).b64;
  throw new HttpError(400, "img2img needs an init image or a layer from the library");
}

async function oneCall(
  projectId: string,
  req: GenRequest,
  prompt: string,
  negative: string,
  seed: number,
  caller: SdCaller,
  init?: string,
): Promise<GeneratedImage[]> {
  const single = { ...req, batchCount: 1, batchSize: 1 };
  if (req.mode === "txt2img") {
    const res = await caller.txt2img(txt2imgBody(req, prompt, negative, seed));
    return imagesFrom(res, { prompt, negative, seed, req });
  }
  const image = init ?? (await initImage(projectId, req, caller));
  const mask = req.mode === "inpaint" ? (req.mask ? (await toPngB64(decodeImage(req.mask, "Mask"))).b64 : undefined) : undefined;
  if (req.mode === "inpaint" && !mask) throw new HttpError(400, "Inpaint needs a mask. Paint the area to replace.");
  let current = image;
  let last: GeneratedImage[] = [];
  const passes = req.mode === "img2img" ? req.loopback : 1;
  for (let pass = 0; pass < passes; pass++) {
    const res = await caller.img2img(img2imgBody(pass === 0 ? req : single, prompt, negative, seed, current, mask));
    last = imagesFrom(res, { prompt, negative, seed, req });
    if (!last.length) throw new HttpError(502, "WebUI returned no image");
    current = last[0].pngBase64;
  }
  return last;
}

export async function runGenerate(projectId: string, raw: unknown, caller: SdCaller = defaultCaller): Promise<{ images: GeneratedImage[] }> {
  const req = parseGenRequest(raw);
  if (req.mode === "upscale") {
    const image = await initImage(projectId, { ...req, prompt: req.prompt || "upscale" }, caller);
    const res = await caller.extra(extraBody(image, req));
    const images = imagesFrom(res, { prompt: req.prompt || "upscale", negative: req.negativePrompt, seed: req.seed, req });
    if (!images.length) throw new HttpError(502, "WebUI returned no image");
    return { images };
  }

  const { prompt, negative } = await styled(projectId, req);

  if (req.plot) {
    const xs = plotValues(req.plot.xAxis, req.plot.xValues);
    const ys = plotValues(req.plot.yAxis, req.plot.yValues);
    if (xs.length * ys.length > 9) throw new HttpError(400, "X/Y plot is capped at 9 images");
    const images: GeneratedImage[] = [];
    const baseSeed = req.seed;
    for (const y of ys) {
      for (const x of xs) {
        let cell = applyAxis(applyAxis({ ...req, batchCount: 1, batchSize: 1, matrix: null, plot: null }, req.plot.xAxis, x), req.plot.yAxis, y);
        if (cell.seed < 0) cell = { ...cell, seed: baseSeed < 0 ? -1 : baseSeed };
        const made = await oneCall(projectId, cell, prompt, negative, cell.seed, caller);
        if (made[0]) images.push(made[0]);
      }
    }
    const grid = await gridOf(images);
    return { images: grid ? [grid, ...images] : images };
  }

  if (req.matrix) {
    const source = req.matrix.target === "negative" ? negative : prompt;
    const expanded = expandPromptMatrix(source, {
      atStart: req.matrix.atStart,
      delimiter: req.matrix.delimiter === "space" ? " " : ", ",
    });
    if (expanded.length > MAX_IMAGES) throw new HttpError(400, `Prompt matrix would make ${expanded.length} images. Keep it to ${MAX_IMAGES}.`);
    const images: GeneratedImage[] = [];
    let seed = req.seed;
    for (let i = 0; i < expanded.length; i++) {
      const cellSeed = req.matrix.differentSeeds && seed >= 0 ? seed + i : seed;
      const cellPrompt = req.matrix.target === "negative" ? prompt : expanded[i];
      const cellNeg = req.matrix.target === "negative" ? expanded[i] : negative;
      const made = await oneCall(projectId, { ...req, batchCount: 1, batchSize: 1 }, cellPrompt, cellNeg, cellSeed, caller);
      if (made[0]) {
        images.push(made[0]);
        if (seed < 0 && made[0].seed >= 0) seed = made[0].seed;
      }
    }
    const grid = await gridOf(images);
    return { images: grid ? [grid, ...images] : images };
  }

  const images = await oneCall(projectId, req, prompt, negative, req.seed, caller);
  if (!images.length) throw new HttpError(502, "WebUI returned no image");
  const grid = images.length > 1 ? await gridOf(images) : null;
  return { images: grid ? [grid, ...images] : images };
}

export async function keepGenerated(
  projectId: string,
  input: { pngBase64?: string; name?: string; category?: string; generation?: AssetGeneration },
): Promise<{ assetId: string; duplicateOf?: string }> {
  if (!input.pngBase64) throw new HttpError(400, "No image to keep");
  const buf = decodeImage(input.pngBase64, "Image");
  const name = (input.name ?? "").trim().slice(0, 80) || "diffusion";
  const generation = input.generation;
  const result = await ingestAsset(projectId, buf, `${name}.png`, {
    categoryHint: input.category?.trim() || undefined,
    source: "ai",
    parametersText: generation?.infotext,
    generation,
    tags: ["diffusion"],
  });
  return { assetId: result.asset.id, duplicateOf: result.duplicateOf };
}
