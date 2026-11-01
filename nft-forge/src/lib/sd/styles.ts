import { promises as fs } from "node:fs";
import path from "node:path";
import { HttpError, paths, withProjectLock } from "../store";

export interface SdStyle {
  name: string;
  prompt: string;
  negativePrompt: string;
}

function file(projectId: string): string {
  return path.join(paths.project(projectId), "sd-styles.json");
}

export async function listStyles(projectId: string): Promise<SdStyle[]> {
  try {
    const raw = JSON.parse(await fs.readFile(file(projectId), "utf8")) as SdStyle[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function clean(input: { name?: string; prompt?: string; negativePrompt?: string }): SdStyle {
  const name = (input.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "Style name is required");
  if (/[\r\n]/.test(name)) throw new HttpError(400, "Style name cannot contain a line break");
  return {
    name,
    prompt: (input.prompt ?? "").slice(0, 2000),
    negativePrompt: (input.negativePrompt ?? "").slice(0, 2000),
  };
}

export async function saveStyle(projectId: string, input: { name?: string; prompt?: string; negativePrompt?: string }): Promise<SdStyle[]> {
  const style = clean(input);
  return withProjectLock(`${projectId}:sd-styles`, async () => {
    const all = await listStyles(projectId);
    const i = all.findIndex((s) => s.name.toLowerCase() === style.name.toLowerCase());
    if (i >= 0) all[i] = style;
    else {
      if (all.length >= 100) throw new HttpError(400, "This project already has 100 styles");
      all.push(style);
    }
    await fs.mkdir(path.dirname(file(projectId)), { recursive: true });
    await fs.writeFile(file(projectId), JSON.stringify(all, null, 1));
    return all;
  });
}

export async function deleteStyle(projectId: string, name: string): Promise<SdStyle[]> {
  return withProjectLock(`${projectId}:sd-styles`, async () => {
    const all = (await listStyles(projectId)).filter((s) => s.name.toLowerCase() !== name.trim().toLowerCase());
    await fs.mkdir(path.dirname(file(projectId)), { recursive: true });
    await fs.writeFile(file(projectId), JSON.stringify(all, null, 1));
    return all;
  });
}

export function promptsFor(styles: SdStyle[], names: string[]): { positive: string[]; negative: string[] } {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const name of names) {
    const s = styles.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) continue;
    if (s.prompt) positive.push(s.prompt);
    if (s.negativePrompt) negative.push(s.negativePrompt);
  }
  return { positive, negative };
}
