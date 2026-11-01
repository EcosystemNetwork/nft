import { HttpError } from "../store";

/** Operator-configured Automatic1111. The browser never picks the host. */
export function sdOrigin(): string {
  const raw = process.env.NFT_FORGE_SD_URL?.trim() || "http://127.0.0.1:7860";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(500, "NFT_FORGE_SD_URL is not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(500, "NFT_FORGE_SD_URL must be http or https");
  }
  return url.origin;
}

export class SdOffline extends HttpError {
  constructor(detail?: string) {
    const where = (() => {
      try {
        return sdOrigin();
      } catch {
        return "the configured WebUI";
      }
    })();
    super(503, detail ?? `Stable Diffusion web UI is not running at ${where}. Start it with ./webui.sh --api`);
  }
}

export async function sdJson<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const origin = sdOrigin();
  let res: Response;
  try {
    res = await fetch(`${origin}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      signal: AbortSignal.timeout(init.timeoutMs ?? 8_000),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new HttpError(504, "Stable Diffusion web UI timed out");
    throw new SdOffline();
  }
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown; error?: string }).error
      ?? (typeof (data as { detail?: unknown }).detail === "string" ? (data as { detail: string }).detail : JSON.stringify((data as { detail?: unknown }).detail ?? ""));
    throw new HttpError(res.status === 404 ? 502 : 502, `WebUI ${res.status}: ${detail || res.statusText}`.slice(0, 400));
  }
  return data as T;
}

export interface A1111Images {
  images?: string[];
  image?: string;
  info?: string | Record<string, unknown>;
}

export function readImageInfo(info: A1111Images["info"]): { seeds: number[]; infotexts: string[] } {
  let parsed: unknown = info;
  if (typeof info === "string") {
    try {
      parsed = JSON.parse(info);
    } catch {
      return { seeds: [], infotexts: info ? [info] : [] };
    }
  }
  const o = (parsed ?? {}) as { all_seeds?: number[]; infotexts?: string[]; seed?: number };
  return {
    seeds: Array.isArray(o.all_seeds) ? o.all_seeds : o.seed != null ? [o.seed] : [],
    infotexts: Array.isArray(o.infotexts) ? o.infotexts : [],
  };
}

export interface SdStatus {
  ok: boolean;
  origin: string;
  error?: string;
  model?: string;
  models: { title: string; name: string; hash?: string }[];
  samplers: string[];
  loras: string[];
  upscalers: string[];
  progress?: { progress: number; etaRelative: number; step: number; steps: number };
}

export async function probeSd(): Promise<SdStatus> {
  const origin = sdOrigin();
  const empty: SdStatus = { ok: false, origin, models: [], samplers: [], loras: [], upscalers: [] };
  try {
    const [models, samplers, loras, upscalers, options] = await Promise.all([
      sdJson<{ title: string; model_name: string; hash?: string }[]>("/sdapi/v1/sd-models", { timeoutMs: 4000 }),
      sdJson<{ name: string }[]>("/sdapi/v1/samplers", { timeoutMs: 4000 }),
      sdJson<{ name: string }[]>("/sdapi/v1/loras", { timeoutMs: 4000 }).catch(() => []),
      sdJson<{ name: string }[]>("/sdapi/v1/upscalers", { timeoutMs: 4000 }).catch(() => []),
      sdJson<{ sd_model_checkpoint?: string }>("/sdapi/v1/options", { timeoutMs: 4000 }),
    ]);
    return {
      ok: true,
      origin,
      model: options.sd_model_checkpoint,
      models: models.map((m) => ({ title: m.title, name: m.model_name, hash: m.hash })),
      samplers: samplers.map((s) => s.name),
      loras: loras.map((l) => l.name),
      upscalers: upscalers.map((u) => u.name).filter((n) => n && n !== "None"),
    };
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
}

export async function sdProgress(): Promise<{ progress: number; etaRelative: number; step: number; steps: number }> {
  const p = await sdJson<{
    progress?: number;
    eta_relative?: number;
    state?: { sampling_step?: number; sampling_steps?: number };
  }>("/sdapi/v1/progress?skip_current_image=true", { timeoutMs: 3000 });
  return {
    progress: p.progress ?? 0,
    etaRelative: p.eta_relative ?? 0,
    step: p.state?.sampling_step ?? 0,
    steps: p.state?.sampling_steps ?? 0,
  };
}
