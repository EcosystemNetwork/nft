/** Prompt tools that match Automatic1111: attention weights, styles, and the prompt-matrix script. */

const WORD_DELIM = " \n\t,";

export function snapDim(n: number, min = 64, max = 2048): number {
  if (!Number.isFinite(n)) return 512;
  const clamped = Math.min(max, Math.max(min, Math.round(n)));
  return Math.max(min, Math.round(clamped / 8) * 8);
}

/** Automatic1111 styles: `{prompt}` is replaced, otherwise the style is appended with a comma. */
export function applyStyles(prompt: string, styles: string[]): string {
  let out = prompt;
  for (const style of styles) {
    if (style == null || style === "") continue;
    if (style.includes("{prompt}")) out = style.replaceAll("{prompt}", out);
    else {
      const parts = [out.trim(), style.trim()].filter(Boolean);
      out = parts.join(", ");
    }
  }
  return out;
}

/**
 * Prompt matrix, same combination order as `scripts/prompt_matrix.py`.
 * The first `|` piece is always included. Each later piece is on or off, so
 * `base | hat | cape` makes 4 prompts. `atStart` puts the variants before the base.
 */
export function expandPromptMatrix(prompt: string, opts: { atStart?: boolean; delimiter?: ", " | " " } = {}): string[] {
  const parts = prompt.split("|");
  if (parts.length < 2) return [prompt];
  const delim = opts.delimiter ?? ", ";
  const count = 2 ** (parts.length - 1);
  const out: string[] = [];
  for (let n = 0; n < count; n++) {
    const selected = parts
      .slice(1)
      .filter((_, i) => n & (1 << i))
      .map((text) => text.trim().replace(/^,|,$/g, "").trim());
    const ordered = opts.atStart ? [...selected, parts[0]] : [parts[0], ...selected];
    out.push(ordered.join(delim));
  }
  return out;
}

export interface AttentionEdit {
  text: string;
  start: number;
  end: number;
}

/**
 * Ctrl+Up / Ctrl+Down from `javascript/edit-attention.js`.
 * A bare selection becomes `(text:1.1)`. An existing `(text:1.2)` moves by `delta`.
 * Weight 1.0 drops the parentheses.
 */
export function nudgeAttention(text: string, start: number, end: number, delta: number): AttentionEdit {
  if (start === end) {
    while (start > 0 && !WORD_DELIM.includes(text[start - 1] ?? "")) start--;
    while (end < text.length && !WORD_DELIM.includes(text[end] ?? "")) end++;
    while (start < end && text[start] === " ") start++;
    while (end > start && text[end - 1] === " ") end--;
  }
  if (start >= end) return { text, start, end };

  const before = start > 0 ? text[start - 1] : "";
  if (before === "(" && text[end] === ":") {
    const close = text.indexOf(")", end);
    if (close > end) {
      const current = Number.parseFloat(text.slice(end + 1, close));
      let weight = (Number.isFinite(current) ? current : 1) + delta;
      weight = Math.round(weight * 10) / 10;
      if (weight === 1) {
        return {
          text: text.slice(0, start - 1) + text.slice(start, end) + text.slice(close + 1),
          start: start - 1,
          end: end - 1,
        };
      }
      const shown = Number.isInteger(weight) ? weight.toFixed(1) : String(weight);
      return { text: text.slice(0, end + 1) + shown + text.slice(close), start, end };
    }
  }

  let weight = Math.round((1 + delta) * 10) / 10;
  if (weight === 1) weight = delta > 0 ? 1.1 : 0.9;
  const inner = text.slice(start, end);
  return {
    text: text.slice(0, start) + "(" + inner + ":" + weight.toFixed(1) + ")" + text.slice(end),
    start: start + 1,
    end: start + 1 + inner.length,
  };
}

export function insertLora(prompt: string, name: string, weight: number): string {
  const clean = name.trim();
  if (!clean) return prompt;
  const w = Math.round(Math.min(2, Math.max(-2, weight)) * 100) / 100;
  const tag = `<lora:${clean}:${w}>`;
  return prompt.trim() ? `${prompt.trimEnd()} ${tag}` : tag;
}

export interface ParsedInfotext {
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
  clipSkip?: number;
  params: Record<string, string>;
}

/** Reads an Automatic1111 parameters block (the PNG `parameters` text). */
export function parseInfotext(raw: string): ParsedInfotext {
  const text = raw.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
  let prompt = text;
  let negativePrompt = "";
  let rest = "";
  const negAt = text.indexOf("\nNegative prompt:");
  const stepsAt = text.search(/\nSteps:/);
  if (negAt >= 0) {
    prompt = text.slice(0, negAt);
    const after = text.slice(negAt + "\nNegative prompt:".length);
    const stepsInNeg = after.search(/\nSteps:/);
    if (stepsInNeg >= 0) {
      negativePrompt = after.slice(0, stepsInNeg).trim();
      rest = after.slice(stepsInNeg + 1);
    } else negativePrompt = after.trim();
  } else if (stepsAt >= 0) {
    prompt = text.slice(0, stepsAt);
    rest = text.slice(stepsAt + 1);
  }
  const params: Record<string, string> = {};
  if (rest) {
    for (const part of rest.split(/,\s+(?=[A-Za-z][A-Za-z0-9 +]{0,40}:)/)) {
      const i = part.indexOf(":");
      if (i <= 0) continue;
      params[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
  }
  const size = /^(\d+)\s*x\s*(\d+)$/i.exec(params.Size ?? "");
  const num = (key: string) => {
    const n = Number(params[key]);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    prompt: prompt.trim(),
    negativePrompt,
    steps: num("Steps"),
    sampler: params.Sampler,
    cfg: num("CFG scale"),
    seed: num("Seed"),
    width: size ? Number(size[1]) : undefined,
    height: size ? Number(size[2]) : undefined,
    denoising: num("Denoising strength"),
    model: params.Model,
    clipSkip: num("Clip skip"),
    params,
  };
}

export function buildInfotext(input: {
  prompt: string;
  negativePrompt: string;
  steps: number;
  sampler: string;
  cfg: number;
  seed: number;
  width: number;
  height: number;
  model?: string;
  denoising?: number;
}): string {
  const bits = [
    `Steps: ${input.steps}`,
    `Sampler: ${input.sampler}`,
    `CFG scale: ${input.cfg}`,
    `Seed: ${input.seed}`,
    `Size: ${input.width}x${input.height}`,
  ];
  if (input.model) bits.push(`Model: ${input.model}`);
  if (input.denoising != null) bits.push(`Denoising strength: ${input.denoising}`);
  const neg = input.negativePrompt.trim() ? `\nNegative prompt: ${input.negativePrompt.trim()}` : "";
  return `${input.prompt.trim()}${neg}\n${bits.join(", ")}`;
}
