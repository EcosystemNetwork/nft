"use client";

import { useEffect, useRef, useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Button, Card, Field, Input, PageHeader, Select, Textarea, toast, useApi } from "@/components/ui";
import { nudgeAttention, snapDim } from "@/lib/sd/prompt";
import type { Asset, AssetGeneration } from "@/lib/store";

type Tab = "txt2img" | "img2img" | "inpaint" | "upscale" | "pnginfo";
type SdStyle = { name: string; prompt: string; negativePrompt: string };
type SdStatus = {
  ok: boolean;
  origin: string;
  error?: string;
  model?: string;
  models: { title: string; name: string }[];
  samplers: string[];
  loras: string[];
  upscalers: string[];
};
type GenImage = { pngBase64: string; seed: number; infotext: string; width: number; height: number; grid?: boolean };
type Progress = { progress: number; etaRelative: number; step: number; steps: number };
type Info = {
  prompt: string;
  negativePrompt: string;
  steps?: number;
  sampler?: string;
  cfg?: number;
  seed?: number;
  width?: number;
  height?: number;
  denoising?: number;
  model?: string;
  infotext: string;
};

const FALLBACK_SAMPLERS = ["Euler a", "Euler", "LMS", "Heun", "DPM2 a", "DPM++ 2M Karras", "DPM++ SDE Karras", "DDIM", "UniPC"];
const ASPECTS: [string, number, number][] = [
  ["1:1", 1, 1],
  ["2:3", 2, 3],
  ["3:2", 3, 2],
  ["3:4", 3, 4],
  ["4:3", 4, 3],
  ["9:16", 9, 16],
  ["16:9", 16, 9],
];

export default function DiffusionPage() {
  const { project, base } = useProject();
  const statusApi = useApi<SdStatus>("/api/sd/status");
  const stylesApi = useApi<SdStyle[]>(`${base}/sd/styles`);
  const assetsApi = useApi<Asset[]>(`${base}/assets`);
  const status = statusApi.data;
  const [tab, setTab] = useState<Tab>("txt2img");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("blurry, low quality, watermark, text");
  const [sampler, setSampler] = useState("Euler a");
  const [steps, setSteps] = useState("20");
  const [cfg, setCfg] = useState("7");
  const [seed, setSeed] = useState("-1");
  const [subseed, setSubseed] = useState("0");
  const [width, setWidth] = useState("512");
  const [height, setHeight] = useState("512");
  const [batchCount, setBatchCount] = useState("1");
  const [batchSize, setBatchSize] = useState("1");
  const [clipSkip, setClipSkip] = useState("1");
  const [tiling, setTiling] = useState(false);
  const [faces, setFaces] = useState(false);
  const [hiresOn, setHiresOn] = useState(false);
  const [hrScale, setHrScale] = useState("2");
  const [hrSteps, setHrSteps] = useState("0");
  const [hrDenoise, setHrDenoise] = useState("0.7");
  const [hrUpscaler, setHrUpscaler] = useState("Latent");
  const [denoising, setDenoising] = useState("0.75");
  const [loopback, setLoopback] = useState("1");
  const [maskBlur, setMaskBlur] = useState("4");
  const [matrixOn, setMatrixOn] = useState(false);
  const [matrixStart, setMatrixStart] = useState(false);
  const [matrixSeeds, setMatrixSeeds] = useState(false);
  const [matrixDelim, setMatrixDelim] = useState<"comma" | "space">("comma");
  const [matrixTarget, setMatrixTarget] = useState<"positive" | "negative">("positive");
  const [plotOn, setPlotOn] = useState(false);
  const [xAxis, setXAxis] = useState("Steps");
  const [yAxis, setYAxis] = useState("CFG scale");
  const [xValues, setXValues] = useState("15, 25, 35");
  const [yValues, setYValues] = useState("5, 7, 9");
  const [styleOn, setStyleOn] = useState<string[]>([]);
  const [styleName, setStyleName] = useState("");
  const [lora, setLora] = useState("");
  const [loraWeight, setLoraWeight] = useState("0.8");
  const [upscaler, setUpscaler] = useState("");
  const [upscaleBy, setUpscaleBy] = useState("2");
  const [gfpgan, setGfpgan] = useState("0");
  const [codeformer, setCodeformer] = useState("0");
  const [codeformerWeight, setCodeformerWeight] = useState("0.5");
  const [initAssetId, setInitAssetId] = useState("");
  const [initImage, setInitImage] = useState("");
  const [initSrc, setInitSrc] = useState("");
  const [mask, setMask] = useState("");
  const [category, setCategory] = useState(project.config.categories[0]?.name ?? "");
  const [infoText, setInfoText] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [images, setImages] = useState<GenImage[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sel = useRef({ start: 0, end: 0 });

  const samplers = status?.samplers?.length ? status.samplers : FALLBACK_SAMPLERS;
  const upscalers = status?.upscalers?.length ? status.upscalers : ["Latent", "None"];

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      void api<Progress>("/api/sd/progress")
        .then(setProgress)
        .catch(() => undefined);
    }, 800);
    return () => clearInterval(t);
  }, [busy]);

  function rememberSel() {
    const el = promptRef.current;
    if (!el) return;
    sel.current = { start: el.selectionStart, end: el.selectionEnd };
  }

  function bump(delta: number) {
    const next = nudgeAttention(prompt, sel.current.start, sel.current.end, delta);
    setPrompt(next.text);
    sel.current = { start: next.start, end: next.end };
  }

  function onPromptKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey) || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const el = e.currentTarget;
    const next = nudgeAttention(el.value, el.selectionStart, el.selectionEnd, e.key === "ArrowUp" ? 0.1 : -0.1);
    setPrompt(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  function applyAspect(w: number, h: number) {
    const short = 512;
    if (w >= h) {
      setWidth(String(snapDim(Math.round((short * w) / h))));
      setHeight(String(snapDim(short)));
    } else {
      setWidth(String(snapDim(short)));
      setHeight(String(snapDim(Math.round((short * h) / w))));
    }
  }

  function useInfo(info: Info) {
    if (info.prompt) setPrompt(info.prompt);
    setNegative(info.negativePrompt ?? "");
    if (info.steps) setSteps(String(info.steps));
    if (info.sampler) setSampler(info.sampler);
    if (info.cfg) setCfg(String(info.cfg));
    if (info.seed != null) setSeed(String(info.seed));
    if (info.width) setWidth(String(info.width));
    if (info.height) setHeight(String(info.height));
    if (info.denoising != null) setDenoising(String(info.denoising));
    setTab(info.denoising != null ? "img2img" : "txt2img");
    toast.ok("Parameters loaded");
  }

  async function generate() {
    setBusy(true);
    setProgress(null);
    try {
      const mode = tab === "pnginfo" ? "txt2img" : tab;
      const out = await api<{ images: GenImage[] }>(`${base}/sd/generate`, {
        method: "POST",
        json: {
          mode,
          prompt,
          negativePrompt: negative,
          seed: Number(seed),
          subseed: -1,
          subseedStrength: Number(subseed) || 0,
          sampler,
          steps: Number(steps),
          cfg: Number(cfg),
          width: Number(width),
          height: Number(height),
          batchCount: Number(batchCount),
          batchSize: Number(batchSize),
          tiling,
          restoreFaces: faces,
          clipSkip: Number(clipSkip),
          hires: mode === "txt2img" && hiresOn ? { scale: Number(hrScale), upscaler: hrUpscaler, steps: Number(hrSteps), denoising: Number(hrDenoise) } : null,
          denoising: Number(denoising),
          maskBlur: Number(maskBlur),
          loopback: mode === "img2img" ? Number(loopback) : 1,
          styleNames: styleOn,
          matrix: matrixOn && (mode === "txt2img" || mode === "img2img")
            ? { enabled: true, atStart: matrixStart, differentSeeds: matrixSeeds, delimiter: matrixDelim, target: matrixTarget }
            : null,
          plot: plotOn && mode === "txt2img" ? { enabled: true, xAxis, yAxis, xValues, yValues } : null,
          initAssetId: initAssetId || undefined,
          initImage: !initAssetId && initImage ? initImage : undefined,
          mask: mode === "inpaint" ? mask : undefined,
          upscaler: upscaler || upscalers[0],
          upscaleBy: Number(upscaleBy),
          gfpgan: Number(gfpgan),
          codeformer: Number(codeformer),
          codeformerWeight: Number(codeformerWeight),
        },
      });
      setImages(out.images);
      if (!out.images.length) toast.err("WebUI returned no image");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function keep(im: GenImage) {
    const generation: AssetGeneration = {
      backend: "a1111",
      mode: tab === "upscale" ? "upscale" : tab === "pnginfo" ? "txt2img" : tab,
      prompt,
      negativePrompt: negative,
      seed: im.seed,
      sampler,
      steps: Number(steps) || 20,
      cfg: Number(cfg) || 7,
      width: im.width,
      height: im.height,
      denoising: tab === "txt2img" ? undefined : Number(denoising),
      model: status?.model,
      infotext: im.infotext,
    };
    try {
      await api(`${base}/sd/keep`, {
        method: "POST",
        json: { pngBase64: im.pngBase64, name: prompt.split("\n")[0].slice(0, 60) || "diffusion", category, generation },
      });
      await assetsApi.reload();
      toast.ok(im.grid ? "Grid saved to Asset Studio" : "Layer saved to Asset Studio");
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  function sendToImg(im: GenImage) {
    setInitAssetId("");
    setInitImage(im.pngBase64);
    setInitSrc(`data:image/png;base64,${im.pngBase64}`);
    setSeed(String(im.seed));
    setTab("img2img");
  }

  const needsInit = tab === "img2img" || tab === "inpaint" || tab === "upscale";

  return (
    <>
      <PageHeader
        title="Diffusion"
        sub="txt2img, img2img, inpaint, hires fix, prompt matrix, styles, and PNG info. Generation runs on a local Automatic1111 web UI."
      />

      {status && !status.ok && (
        <Card className="mb-4 border-amber-500/30 p-4 text-[13px] text-muted">
          <div className="font-medium text-ink">WebUI is not answering at {status.origin}</div>
          <p className="mt-1">
            Start Automatic1111 with <code>./webui.sh --api</code>. The API stays on localhost. If it uses another port, set <code>NFT_FORGE_SD_URL</code> and restart the studio.
          </p>
          {status.error && <p className="mt-1 text-dim">{status.error}</p>}
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["txt2img", "txt2img"],
            ["img2img", "img2img"],
            ["inpaint", "Inpaint"],
            ["upscale", "Extras"],
            ["pnginfo", "PNG info"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <Button key={id} size="sm" variant={tab === id ? "primary" : "ghost"} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
        {status?.ok && status.models.length > 0 && (
          <Select
            className="ml-auto w-64"
            value={status.model ?? ""}
            disabled={switching}
            onChange={async (e) => {
              setSwitching(true);
              try {
                await api("/api/sd/model", { method: "POST", json: { checkpoint: e.target.value } });
                await statusApi.reload();
                toast.ok("Checkpoint loaded");
              } catch (err) {
                toast.err((err as Error).message);
              } finally {
                setSwitching(false);
              }
            }}
          >
            {status.models.map((m) => (
              <option key={m.title} value={m.title}>
                {m.name || m.title}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card className="space-y-4 p-4">
          {tab !== "pnginfo" && tab !== "upscale" && (
            <>
              <Field label="Prompt" hint="Ctrl+Up / Ctrl+Down changes attention. Use | for a prompt matrix.">
                <textarea
                  ref={promptRef}
                  rows={5}
                  value={prompt}
                  placeholder="pirate coat, flat color, transparent background"
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={onPromptKey}
                  onSelect={rememberSel}
                  onKeyUp={rememberSel}
                  onClick={rememberSel}
                  className="w-full rounded-xl border border-line-2 bg-panel-2 px-3 py-2.5 text-sm text-ink placeholder:text-dim outline-none transition focus:border-violet/60 focus:ring-2 focus:ring-violet/20"
                />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" type="button" onClick={() => bump(0.1)}>
                  Attention +
                </Button>
                <Button size="sm" type="button" onClick={() => bump(-0.1)}>
                  Attention −
                </Button>
              </div>
              <Field label="Negative prompt">
                <Textarea rows={3} value={negative} onChange={(e) => setNegative(e.target.value)} />
              </Field>
            </>
          )}

          {tab === "pnginfo" && (
            <Field label="Parameters" hint="Paste an Automatic1111 parameters block, or drop a PNG that has one.">
              <Textarea rows={8} value={infoText} onChange={(e) => setInfoText(e.target.value)} />
              <input
                type="file"
                accept="image/png"
                className="mt-2 block text-[12px]"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = async () => {
                    try {
                      const info = await api<Info>(`${base}/sd/png-info`, {
                        method: "POST",
                        json: { imageBase64: String(reader.result) },
                      });
                      setInfoText(info.infotext);
                      useInfo(info);
                    } catch (err) {
                      toast.err((err as Error).message);
                    }
                  };
                  reader.readAsDataURL(f);
                }}
              />
              <Button
                className="mt-2"
                onClick={async () => {
                  try {
                    useInfo(await api<Info>(`${base}/sd/png-info`, { method: "POST", json: { text: infoText } }));
                  } catch (err) {
                    toast.err((err as Error).message);
                  }
                }}
              >
                Load into txt2img
              </Button>
            </Field>
          )}

          {needsInit && (
            <Field label="Init image">
              <Select
                value={initAssetId}
                onChange={(e) => {
                  setInitAssetId(e.target.value);
                  setInitImage("");
                  setInitSrc(e.target.value ? `${base}/assets/${e.target.value}` : "");
                  setMask("");
                }}
              >
                <option value="">From a result, or pick a layer</option>
                {(assetsApi.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              {initSrc && tab !== "inpaint" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={initSrc} alt="" className="mt-2 max-h-40 rounded-lg object-contain" />
              )}
            </Field>
          )}

          {tab === "inpaint" && initSrc && <MaskPad src={initSrc} onMask={setMask} />}

          {tab !== "pnginfo" && tab !== "upscale" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sampler">
                  <Select value={sampler} onChange={(e) => setSampler(e.target.value)}>
                    {samplers.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Steps">
                  <Input value={steps} onChange={(e) => setSteps(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="CFG">
                  <Input value={cfg} onChange={(e) => setCfg(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Seed" hint="-1 is random">
                  <Input value={seed} onChange={(e) => setSeed(e.target.value)} />
                </Field>
                <Field label="Variation" hint="Subseed strength, 0 to 1">
                  <Input value={subseed} onChange={(e) => setSubseed(e.target.value)} />
                </Field>
                <Field label="Clip skip">
                  <Input value={clipSkip} onChange={(e) => setClipSkip(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-1">
                {ASPECTS.map(([label, w, h]) => (
                  <Button key={label} size="sm" type="button" onClick={() => applyAspect(w, h)}>
                    {label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Width">
                  <Input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Height">
                  <Input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Batch count">
                  <Input value={batchCount} onChange={(e) => setBatchCount(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Batch size">
                  <Input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <input type="checkbox" checked={tiling} onChange={(e) => setTiling(e.target.checked)} /> Tiling
              </label>
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <input type="checkbox" checked={faces} onChange={(e) => setFaces(e.target.checked)} /> Restore faces
              </label>
            </>
          )}

          {(tab === "img2img" || tab === "inpaint") && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Denoising">
                <Input value={denoising} onChange={(e) => setDenoising(e.target.value)} />
              </Field>
              {tab === "img2img" ? (
                <Field label="Loopback" hint="img2img passes, max 4">
                  <Input value={loopback} onChange={(e) => setLoopback(e.target.value)} />
                </Field>
              ) : (
                <Field label="Mask blur">
                  <Input value={maskBlur} onChange={(e) => setMaskBlur(e.target.value)} />
                </Field>
              )}
            </div>
          )}

          {tab === "upscale" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Upscaler">
                <Select value={upscaler || upscalers[0]} onChange={(e) => setUpscaler(e.target.value)}>
                  {upscalers.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Scale">
                <Input value={upscaleBy} onChange={(e) => setUpscaleBy(e.target.value)} />
              </Field>
              <Field label="GFPGAN" hint="0 to 1">
                <Input value={gfpgan} onChange={(e) => setGfpgan(e.target.value)} />
              </Field>
              <Field label="CodeFormer" hint="0 to 1">
                <Input value={codeformer} onChange={(e) => setCodeformer(e.target.value)} />
              </Field>
              <Field label="CodeFormer weight">
                <Input value={codeformerWeight} onChange={(e) => setCodeformerWeight(e.target.value)} />
              </Field>
            </div>
          )}

          {tab === "txt2img" && (
            <details className="rounded-xl border border-line-2 p-3 text-[13px]">
              <summary className="cursor-pointer text-muted">Hires fix</summary>
              <label className="mt-3 flex items-center gap-2 text-muted">
                <input type="checkbox" checked={hiresOn} onChange={(e) => setHiresOn(e.target.checked)} /> Enable
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Scale">
                  <Input value={hrScale} onChange={(e) => setHrScale(e.target.value)} />
                </Field>
                <Field label="Second-pass steps">
                  <Input value={hrSteps} onChange={(e) => setHrSteps(e.target.value)} />
                </Field>
                <Field label="Denoising">
                  <Input value={hrDenoise} onChange={(e) => setHrDenoise(e.target.value)} />
                </Field>
                <Field label="Upscaler">
                  <Select value={hrUpscaler} onChange={(e) => setHrUpscaler(e.target.value)}>
                    <option>Latent</option>
                    {upscalers.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </details>
          )}

          {(tab === "txt2img" || tab === "img2img") && (
            <details className="rounded-xl border border-line-2 p-3 text-[13px]">
              <summary className="cursor-pointer text-muted">Prompt matrix</summary>
              <label className="mt-3 flex items-center gap-2 text-muted">
                <input type="checkbox" checked={matrixOn} onChange={(e) => setMatrixOn(e.target.checked)} /> Split the prompt on |
              </label>
              <label className="mt-2 flex items-center gap-2 text-muted">
                <input type="checkbox" checked={matrixStart} onChange={(e) => setMatrixStart(e.target.checked)} /> Put variable parts at the start
              </label>
              <label className="mt-2 flex items-center gap-2 text-muted">
                <input type="checkbox" checked={matrixSeeds} onChange={(e) => setMatrixSeeds(e.target.checked)} /> Different seed for each picture
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Join">
                  <Select value={matrixDelim} onChange={(e) => setMatrixDelim(e.target.value as "comma" | "space")}>
                    <option value="comma">comma</option>
                    <option value="space">space</option>
                  </Select>
                </Field>
                <Field label="Prompt">
                  <Select value={matrixTarget} onChange={(e) => setMatrixTarget(e.target.value as "positive" | "negative")}>
                    <option value="positive">positive</option>
                    <option value="negative">negative</option>
                  </Select>
                </Field>
              </div>
            </details>
          )}

          {tab === "txt2img" && (
            <details className="rounded-xl border border-line-2 p-3 text-[13px]">
              <summary className="cursor-pointer text-muted">X/Y plot</summary>
              <label className="mt-3 flex items-center gap-2 text-muted">
                <input type="checkbox" checked={plotOn} onChange={(e) => setPlotOn(e.target.checked)} /> Seed, steps, CFG, or sampler. Max 9 images.
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="X axis">
                  <Select value={xAxis} onChange={(e) => setXAxis(e.target.value)}>
                    {["Seed", "Steps", "CFG scale", "Sampler"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="X values">
                  <Input value={xValues} onChange={(e) => setXValues(e.target.value)} />
                </Field>
                <Field label="Y axis">
                  <Select value={yAxis} onChange={(e) => setYAxis(e.target.value)}>
                    {["Seed", "Steps", "CFG scale", "Sampler"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Y values">
                  <Input value={yValues} onChange={(e) => setYValues(e.target.value)} />
                </Field>
              </div>
            </details>
          )}

          {!!status?.loras?.length && tab !== "pnginfo" && tab !== "upscale" && (
            <div className="flex gap-2">
              <Select value={lora} onChange={(e) => setLora(e.target.value)} className="flex-1">
                <option value="">LoRA</option>
                {status.loras.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </Select>
              <Input className="w-20" value={loraWeight} onChange={(e) => setLoraWeight(e.target.value)} />
              <Button
                type="button"
                onClick={() => {
                  if (!lora) return;
                  const w = Number(loraWeight) || 0.8;
                  setPrompt((p: string) => (p.trim() ? `${p.trimEnd()} <lora:${lora}:${w}>` : `<lora:${lora}:${w}>`));
                }}
              >
                Add
              </Button>
            </div>
          )}

          {!!stylesApi.data?.length && tab !== "pnginfo" && (
            <Field label="Styles">
              <div className="flex flex-wrap gap-2">
                {stylesApi.data.map((s) => (
                  <label key={s.name} className="flex items-center gap-1 text-[12px] text-muted">
                    <input
                      type="checkbox"
                      checked={styleOn.includes(s.name)}
                      onChange={(e) => setStyleOn((cur) => (e.target.checked ? [...cur, s.name] : cur.filter((n) => n !== s.name)))}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </Field>
          )}

          {tab !== "pnginfo" && tab !== "upscale" && (
            <div className="flex gap-2">
              <Input placeholder="Style name" value={styleName} onChange={(e) => setStyleName(e.target.value)} />
              <Button
                type="button"
                onClick={async () => {
                  try {
                    await api(`${base}/sd/styles`, { method: "POST", json: { name: styleName, prompt, negativePrompt: negative } });
                    await stylesApi.reload();
                    toast.ok("Style saved");
                  } catch (err) {
                    toast.err((err as Error).message);
                  }
                }}
              >
                Save style
              </Button>
            </div>
          )}

          {tab !== "pnginfo" && (
            <div className="flex gap-2">
              <Button variant="primary" busy={busy} onClick={() => void generate()}>
                {busy ? "Generating" : "Generate"}
              </Button>
              {busy && (
                <Button
                  variant="danger"
                  onClick={() => {
                    void api("/api/sd/interrupt", { method: "POST" }).catch((err) => toast.err((err as Error).message));
                  }}
                >
                  Interrupt
                </Button>
              )}
            </div>
          )}
          {busy && progress && (
            <div className="text-[12px] text-dim">
              <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-violet-500" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
              </div>
              {progress.steps ? `Step ${progress.step} / ${progress.steps}` : "Waiting on the WebUI"}
              {progress.etaRelative > 0 ? ` · ${Math.ceil(progress.etaRelative)}s left` : ""}
            </div>
          )}
        </Card>

        <div>
          {images.length === 0 ? (
            <Card className="grid min-h-64 place-items-center p-6 text-center text-sm text-muted">
              Results land here. Keep the ones you want as layers. The seed and prompt stay on the asset.
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {images.map((im, i) => (
                <Card key={`${im.seed}-${i}`} className="overflow-hidden">
                  <div className="checker">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:image/png;base64,${im.pngBase64}`} alt="" className="max-h-80 w-full object-contain" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 p-3 text-[12px] text-dim">
                    <span>{im.grid ? "Grid" : `Seed ${im.seed}`}</span>
                    <span>
                      {im.width}×{im.height}
                    </span>
                    <Select className="ml-auto h-8 w-36 text-[12px]" value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">No category</option>
                      {project.config.categories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" onClick={() => void keep(im)}>
                      Keep
                    </Button>
                    {!im.grid && (
                      <Button size="sm" onClick={() => sendToImg(im)}>
                        img2img
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MaskPad({ src, onMask }: { src: string; onMask: (b64: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(28);

  useEffect(() => {
    const canvas = ref.current;
    const img = new Image();
    img.onload = () => {
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
    img.src = src;
  }, [src]);

  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.buttons !== 1) return;
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(x, y, brush, 0, Math.PI * 2);
    ctx.fill();
    onMask(canvas.toDataURL("image/png"));
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
        <span>Mask brush</span>
        <input type="range" min={4} max={80} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
        <Button
          size="sm"
          type="button"
          onClick={() => {
            const canvas = ref.current;
            if (!canvas) return;
            canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
            onMask("");
          }}
        >
          Clear
        </Button>
      </div>
      <div className="relative overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="max-h-52 w-full object-contain" />
        <canvas ref={ref} onPointerDown={paint} onPointerMove={paint} className="absolute inset-0 h-full w-full cursor-crosshair" />
      </div>
      <p className="mt-1 text-[12px] text-dim">Paint white over the area that gets replaced.</p>
    </div>
  );
}
