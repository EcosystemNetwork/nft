import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_TIERS,
  type CanvasConfig,
  type CollectionConfig,
  type MetadataTemplate,
  type Nft,
  type ProductionMode,
} from "./engine/types";

// ---------------------------------------------------------------------------
// Persistence: a local, file-based store under ./data. Every write is atomic
// (write temp file, then rename) and serialized per project, so a render job
// and a gallery edit can't interleave a read-modify-write. The layout maps
// one-to-one onto the PRD's data model and can be swapped for Postgres + S3.
// ---------------------------------------------------------------------------

export const DATA_DIR = process.env.NFT_FORGE_DATA ?? path.join(process.cwd(), "data");

export type Chain = "robinhood" | "solana" | "ethereum" | "base" | "sui";

export interface Blueprint {
  provider: string;
  createdAt: string;
  title: string;
  logline: string;
  lore: string;
  artBible: {
    style: string;
    palette: string[];
    proportions: string;
    rendering: string;
    doList: string[];
    dontList: string[];
  };
  archetypes: { name: string; description: string }[];
  factions: { name: string; description: string }[];
  traitPlan: { category: string; required: boolean; examples: string[] }[];
  productionPlan: string[];
  estimates: { assetCount: number; notes: string };
}

export interface Project {
  id: string;
  name: string;
  concept: string;
  style: string;
  chain: Chain;
  mode: ProductionMode;
  createdAt: string;
  updatedAt: string;
  blueprint?: Blueprint;
  /** Locked art direction: once locked, AI blueprint regeneration is refused. */
  artBibleLocked: boolean;
  config: Omit<CollectionConfig, "supply"> & { supply: number };
  canvas: CanvasConfig;
  metadata: MetadataTemplate;
}

export interface AssetVersion {
  version: number;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  at: string;
}

export interface Asset {
  id: string;
  name: string;
  fileName: string;
  /** Category this asset was imported for (from folder name or user choice). */
  categoryHint?: string;
  source: "upload" | "ai" | "procedural";
  tags: string[];
  mime: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  /** True if the alpha channel actually contains transparency (not just present). */
  hasTransparency: boolean;
  sha256: string;
  bytes: number;
  version: number;
  versions: AssetVersion[];
  createdAt: string;
}

export interface GenerationRun {
  id: string;
  at: string;
  seed: string;
  configHash: string;
  supply: number;
  generated: number;
  preserved: number;
  retries: number;
  durationMs: number;
  errors: string[];
  warnings: string[];
  /** Asset versions in effect for this run, for reproducibility. */
  assetVersions: Record<string, number>;
}

export interface CollectionFile {
  configHash: string;
  seed: string;
  generatedAt: string;
  nfts: Nft[];
  history: GenerationRun[];
}

export function defaultMetadata(name: string, chain: Chain): MetadataTemplate {
  return {
    standard: chain === "solana" ? "metaplex" : "erc721",
    collectionName: name,
    symbol: name.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase() || "NFT",
    namePattern: "{collection} #{id}",
    description: `${name} — a generative collection made with NFT Forge.`,
    imageBaseUri: "",
    externalUrl: "",
    sellerFeeBasisPoints: 500,
    startTokenId: chain === "solana" ? 0 : 1,
  };
}

// --- paths ------------------------------------------------------------------

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
export function assertId(id: string): string {
  if (!SAFE_ID.test(id)) throw new HttpError(400, "Invalid id");
  return id;
}

export const paths = {
  project: (id: string) => path.join(DATA_DIR, "projects", assertId(id)),
  projectFile: (id: string) => path.join(paths.project(id), "project.json"),
  assetsFile: (id: string) => path.join(paths.project(id), "assets.json"),
  assetFile: (id: string, assetId: string, version: number) =>
    path.join(paths.project(id), "assets", assertId(assetId), `v${version}.png`),
  collectionFile: (id: string) => path.join(paths.project(id), "collection.json"),
  rendersDir: (id: string) => path.join(paths.project(id), "renders"),
  render: (id: string, tokenId: number, dna: string, ext: string) =>
    path.join(paths.rendersDir(id), `${tokenId}-${dna}.${ext}`),
  thumbsDir: (id: string) => path.join(paths.project(id), "thumbs"),
  exportsDir: (id: string) => path.join(paths.project(id), "exports"),
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// --- low-level IO ------------------------------------------------------------

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1));
  // OneDrive / antivirus can briefly hold the target open on Windows; retry the rename.
  for (let i = 0; ; i++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i < 8 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }
}

const g = globalThis as unknown as { __forgeLocks?: Map<string, Promise<unknown>> };
const locks = (g.__forgeLocks ??= new Map());

/** Serialize read-modify-write operations per project. */
export async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(
    projectId,
    next.catch(() => undefined),
  );
  return next;
}

// --- projects ----------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const dir = path.join(DATA_DIR, "projects");
  let ids: string[] = [];
  try {
    ids = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Project[] = [];
  for (const id of ids) {
    if (!SAFE_ID.test(id)) continue;
    const p = await readJson<Project>(paths.projectFile(id));
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<Project> {
  const p = await readJson<Project>(paths.projectFile(id));
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

export async function saveProject(p: Project): Promise<Project> {
  p.updatedAt = new Date().toISOString();
  await writeJsonAtomic(paths.projectFile(p.id), p);
  return p;
}

export async function createProject(input: {
  name: string;
  concept: string;
  supply: number;
  style: string;
  chain: Chain;
  mode: ProductionMode;
  id?: string;
}): Promise<Project> {
  const now = new Date().toISOString();
  const id =
    input.id ??
    `${input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)}-${randomUUID().slice(0, 6)}`;
  const project: Project = {
    id: assertId(id),
    name: input.name,
    concept: input.concept,
    style: input.style,
    chain: input.chain,
    mode: input.mode,
    createdAt: now,
    updatedAt: now,
    artBibleLocked: false,
    config: {
      supply: input.supply,
      seed: randomUUID().slice(0, 8),
      categories: [],
      rules: [],
      tiers: DEFAULT_TIERS,
      maxAttemptsPerToken: 200,
    },
    canvas: { width: 1024, height: 1024, format: "png" },
    metadata: defaultMetadata(input.name, input.chain),
  };
  await saveProject(project);
  return project;
}

export async function updateProject(id: string, mutate: (p: Project) => void | Promise<void>): Promise<Project> {
  return withProjectLock(id, async () => {
    const p = await getProject(id);
    await mutate(p);
    return saveProject(p);
  });
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(paths.project(id), { recursive: true, force: true });
}

// --- assets ------------------------------------------------------------------

export async function listAssets(projectId: string): Promise<Asset[]> {
  return (await readJson<Asset[]>(paths.assetsFile(projectId))) ?? [];
}

export async function saveAssets(projectId: string, assets: Asset[]): Promise<void> {
  await writeJsonAtomic(paths.assetsFile(projectId), assets);
}

export async function writeAssetFile(projectId: string, assetId: string, version: number, png: Buffer) {
  const file = paths.assetFile(projectId, assetId, version);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, png);
}

// --- collection --------------------------------------------------------------

export async function getCollection(projectId: string): Promise<CollectionFile | null> {
  return readJson<CollectionFile>(paths.collectionFile(projectId));
}

export async function saveCollection(projectId: string, c: CollectionFile): Promise<void> {
  await writeJsonAtomic(paths.collectionFile(projectId), c);
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
