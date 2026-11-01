import { HttpError } from "../store";
import { snapDim } from "./prompt";

export type SdMode = "txt2img" | "img2img" | "inpaint" | "upscale";
export type PlotAxis = "Seed" | "Steps" | "CFG scale" | "Sampler";

export interface HiresFix {
  scale: number;
  upscaler: string;
  steps: number;
  denoising: number;
}

export interface MatrixOpts {
  atStart: boolean;
  differentSeeds: boolean;
  delimiter: "comma" | "space";
  target: "positive" | "negative";
}

export interface PlotOpts {
  xAxis: PlotAxis;
  xValues: string;
  yAxis: PlotAxis;
  yValues: string;
}

export interface GenRequest {
  mode: SdMode;
  prompt: string;
  negativePrompt: string;
  seed: number;
  subseed: number;
  subseedStrength: number;
  sampler: string;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  batchCount: number;
  batchSize: number;
  tiling: boolean;
  restoreFaces: boolean;
  clipSkip: number;
  hires: HiresFix | null;
  denoising: number;
  maskBlur: number;
  loopback: number;
  styleNames: string[];
  matrix: MatrixOpts | null;
  plot: PlotOpts | null;
  initAssetId?: string;
  initImage?: string;
  mask?: string;
  upscaler: string;
  upscaleBy: number;
  gfpgan: number;
  codeformer: number;
  codeformerWeight: number;
}

const AXES = new Set<PlotAxis>(["Seed", "Steps", "CFG scale", "Sampler"]);

function obj(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Invalid generation body");
  return raw as Record<string, unknown>;
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\u0000/g, "").slice(0, max);
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(v, fallback, min, max));
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

function samplerName(v: unknown): string {
  const s = str(v, 80).trim();
  if (!s || !/^[\w .+-]+$/.test(s)) return "Euler a";
  return s;
}

function hires(raw: unknown): HiresFix | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  if (h.enabled === false) return null;
  const upscaler = str(h.upscaler, 80).trim() || "Latent";
  return {
    scale: num(h.scale, 2, 1, 4),
    upscaler: /^[\w .+-]+$/.test(upscaler) ? upscaler : "Latent",
    steps: int(h.steps, 0, 0, 150),
    denoising: num(h.denoising, 0.7, 0, 1),
  };
}

function matrix(raw: unknown): MatrixOpts | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (!bool(m.enabled)) return null;
  return {
    atStart: bool(m.atStart),
    differentSeeds: bool(m.differentSeeds),
    delimiter: m.delimiter === "space" ? "space" : "comma",
    target: m.target === "negative" ? "negative" : "positive",
  };
}

function plot(raw: unknown): PlotOpts | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!bool(p.enabled)) return null;
  const xAxis = str(p.xAxis, 20) as PlotAxis;
  const yAxis = str(p.yAxis, 20) as PlotAxis;
  if (!AXES.has(xAxis) || !AXES.has(yAxis)) throw new HttpError(400, "X/Y axis must be Seed, Steps, CFG scale, or Sampler");
  if (xAxis === yAxis) throw new HttpError(400, "X and Y need different axes");
  return { xAxis, xValues: str(p.xValues, 200), yAxis, yValues: str(p.yValues, 200) };
}

export function parseGenRequest(raw: unknown): GenRequest {
  const b = obj(raw);
  const mode = b.mode;
  if (mode !== "txt2img" && mode !== "img2img" && mode !== "inpaint" && mode !== "upscale") {
    throw new HttpError(400, "Mode must be txt2img, img2img, inpaint, or upscale");
  }
  const req: GenRequest = {
    mode,
    prompt: str(b.prompt, 4000),
    negativePrompt: str(b.negativePrompt, 2000),
    seed: int(b.seed, -1, -1, 2 ** 32 - 1),
    subseed: int(b.subseed, -1, -1, 2 ** 32 - 1),
    subseedStrength: num(b.subseedStrength, 0, 0, 1),
    sampler: samplerName(b.sampler),
    steps: int(b.steps, 20, 1, 150),
    cfg: num(b.cfg, 7, 1, 30),
    width: snapDim(num(b.width, 512, 64, 2048)),
    height: snapDim(num(b.height, 512, 64, 2048)),
    batchCount: int(b.batchCount, 1, 1, 8),
    batchSize: int(b.batchSize, 1, 1, 4),
    tiling: bool(b.tiling),
    restoreFaces: bool(b.restoreFaces),
    clipSkip: int(b.clipSkip, 1, 1, 12),
    hires: hires(b.hires),
    denoising: num(b.denoising, 0.75, 0, 1),
    maskBlur: int(b.maskBlur, 4, 0, 64),
    loopback: int(b.loopback, 1, 1, 4),
    styleNames: Array.isArray(b.styleNames) ? b.styleNames.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 12) : [],
    matrix: matrix(b.matrix),
    plot: plot(b.plot),
    upscaler: samplerName(b.upscaler) === "Euler a" && typeof b.upscaler !== "string" ? "None" : str(b.upscaler, 80).trim() || "None",
    upscaleBy: num(b.upscaleBy, 2, 1, 4),
    gfpgan: num(b.gfpgan, 0, 0, 1),
    codeformer: num(b.codeformer, 0, 0, 1),
    codeformerWeight: num(b.codeformerWeight, 0.5, 0, 1),
  };
  if (typeof b.initAssetId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(b.initAssetId)) req.initAssetId = b.initAssetId;
  if (typeof b.initImage === "string") req.initImage = b.initImage;
  if (typeof b.mask === "string") req.mask = b.mask;
  if (req.matrix && req.plot) throw new HttpError(400, "Use prompt matrix or an X/Y plot, not both at once");
  if ((req.matrix || req.plot) && req.loopback > 1) throw new HttpError(400, "Loopback runs on a single img2img pass");
  if (!req.prompt.trim() && req.mode !== "upscale") throw new HttpError(400, "Prompt is empty");
  return req;
}

export function plotValues(axis: PlotAxis, raw: string): string[] {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (!parts.length) throw new HttpError(400, `${axis} needs at least one value`);
  for (const p of parts) {
    if (axis === "Sampler") {
      if (!/^[\w .+-]+$/.test(p)) throw new HttpError(400, `Bad sampler "${p}"`);
    } else if (!Number.isFinite(Number(p))) throw new HttpError(400, `${axis} value "${p}" is not a number`);
  }
  return parts;
}

/** Body for POST /sdapi/v1/txt2img. The host is never taken from the request. */
export function txt2imgBody(g: GenRequest, prompt: string, negative: string, seed: number): Record<string, unknown> {
  return {
    prompt,
    negative_prompt: negative,
    seed,
    subseed: g.subseed,
    subseed_strength: g.subseedStrength,
    sampler_name: g.sampler,
    batch_size: g.batchSize,
    n_iter: g.batchCount,
    steps: g.steps,
    cfg_scale: g.cfg,
    width: g.width,
    height: g.height,
    restore_faces: g.restoreFaces,
    tiling: g.tiling,
    enable_hr: Boolean(g.hires),
    hr_scale: g.hires?.scale ?? 2,
    hr_upscaler: g.hires?.upscaler ?? "Latent",
    hr_second_pass_steps: g.hires?.steps ?? 0,
    denoising_strength: g.hires?.denoising ?? g.denoising,
    override_settings: { CLIP_stop_at_last_layers: g.clipSkip },
    override_settings_restore_afterwards: true,
    save_images: false,
    send_images: true,
    do_not_save_samples: true,
    do_not_save_grid: true,
  };
}

export function img2imgBody(
  g: GenRequest,
  prompt: string,
  negative: string,
  seed: number,
  init: string,
  mask?: string,
): Record<string, unknown> {
  return {
    ...txt2imgBody(g, prompt, negative, seed),
    init_images: [init],
    denoising_strength: g.denoising,
    resize_mode: 1,
    mask: mask || undefined,
    mask_blur: g.maskBlur,
    inpainting_fill: 1,
    inpaint_full_res: true,
    inpaint_full_res_padding: 32,
    inpainting_mask_invert: 0,
    image_cfg_scale: 1.5,
  };
}

export function extraBody(image: string, g: GenRequest): Record<string, unknown> {
  return {
    image,
    resize_mode: 0,
    show_extras_results: true,
    gfpgan_visibility: g.gfpgan,
    codeformer_visibility: g.codeformer,
    codeformer_weight: g.codeformerWeight,
    upscaling_resize: g.upscaleBy,
    upscaler_1: g.upscaler,
    upscale_first: false,
  };
}
