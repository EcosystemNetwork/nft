import { createWriteStream, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { ZipArchive } from "archiver";
import { configHash } from "./engine/generator";
import { buildCollectionMetadata, buildTokenMetadata, imageFileName } from "./engine/metadata";
import { computeRarity } from "./engine/rarity";
import { NONE, type Nft } from "./engine/types";
import { runQa } from "./qa";
import { existingRender, LayerRenderer } from "./render";
import { getCollection, getProject, listAssets, newId, paths } from "./store";

// ---------------------------------------------------------------------------
// In-process background jobs with progress, pause/resume, cancel and retry.
// Render progress is derived from files on disk (renders/<id>-<dna>.png), so
// a crashed or cancelled job resumes exactly where it stopped.
// ---------------------------------------------------------------------------

export type JobType = "render" | "export" | "ipfs" | "filebase";
export type JobStatus = "running" | "paused" | "done" | "failed" | "cancelled" | "interrupted";

export interface Job {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  total: number;
  done: number;
  skipped: number;
  failed: { tokenId: number; error: string }[];
  message: string;
  startedAt: string;
  finishedAt?: string;
  msPerItem?: number;
  result?: { file: string; bytes: number; name: string };
}

interface Control {
  paused: boolean;
  cancelled: boolean;
  resume?: () => void;
}

const g = globalThis as unknown as {
  __forgeJobs?: Map<string, Job>;
  __forgeCtl?: Map<string, Control>;
  __forgeJobsLoaded?: Set<string>;
  __forgeJobsSaved?: Map<string, number>;
};
const jobs = (g.__forgeJobs ??= new Map());
const controls = (g.__forgeCtl ??= new Map());
const loaded = (g.__forgeJobsLoaded ??= new Set());
const lastSaved = (g.__forgeJobsSaved ??= new Map());

// --- persistence: job history survives restarts ------------------------------
const jobsFile = (projectId: string) => path.join(paths.project(projectId), "jobs.json");

async function persist(projectId: string, force = false) {
  const now = Date.now();
  if (!force && now - (lastSaved.get(projectId) ?? 0) < 2000) return;
  lastSaved.set(projectId, now);
  const list = [...jobs.values()]
    .filter((j) => j.projectId === projectId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 30)
    .map((j) => ({ ...j, failed: j.failed.slice(0, 200) }));
  const f = jobsFile(projectId);
  const tmp = `${f}.${now}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(list));
    await fs.rename(tmp, f);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Load persisted history once per process. Jobs that were mid-flight when the server stopped become "interrupted". */
async function ensureLoaded(projectId: string) {
  if (loaded.has(projectId)) return;
  loaded.add(projectId);
  try {
    const list = JSON.parse(await fs.readFile(jobsFile(projectId), "utf8")) as Job[];
    for (const j of list) {
      if (jobs.has(j.id)) continue;
      if (j.status === "running" || j.status === "paused") {
        j.status = "interrupted";
        j.message = `Server stopped at ${j.done}/${j.total}. Start again to resume; finished work is kept.`;
      }
      jobs.set(j.id, j);
    }
  } catch {
    /* no history yet */
  }
}

export function getJob(id: string) {
  return jobs.get(id);
}

export async function listJobs(projectId: string): Promise<Job[]> {
  await ensureLoaded(projectId);
  return [...jobs.values()].filter((j) => j.projectId === projectId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function controlJob(id: string, action: "pause" | "resume" | "cancel"): Job | undefined {
  const job = jobs.get(id);
  const ctl = controls.get(id);
  if (!job || !ctl) return job;
  if (action === "pause" && job.status === "running") {
    ctl.paused = true;
    job.status = "paused";
  } else if (action === "resume" && job.status === "paused") {
    ctl.paused = false;
    job.status = "running";
    ctl.resume?.();
  } else if (action === "cancel" && (job.status === "running" || job.status === "paused")) {
    ctl.cancelled = true;
    ctl.paused = false;
    ctl.resume?.();
  }
  void persist(job.projectId, true);
  return job;
}

async function gate(ctl: Control) {
  while (ctl.paused && !ctl.cancelled) await new Promise<void>((r) => (ctl.resume = r));
}

function activeJob(projectId: string, type: JobType) {
  return [...jobs.values()].find((j) => j.projectId === projectId && j.type === type && (j.status === "running" || j.status === "paused"));
}

function newJob(projectId: string, type: JobType): [Job, Control] {
  const job: Job = {
    id: newId("job"),
    projectId,
    type,
    status: "running",
    total: 0,
    done: 0,
    skipped: 0,
    failed: [],
    message: "Starting…",
    startedAt: new Date().toISOString(),
  };
  const ctl: Control = { paused: false, cancelled: false };
  jobs.set(job.id, job);
  void persist(projectId, true);
  controls.set(job.id, ctl);
  return [job, ctl];
}

function finish(job: Job, ctl: Control, status?: JobStatus, message?: string) {
  job.status = status ?? (ctl.cancelled ? "cancelled" : job.failed.length ? "failed" : "done");
  job.message = message ?? job.message;
  job.finishedAt = new Date().toISOString();
  controls.delete(job.id);
  void persist(job.projectId, true);
}

const CONCURRENCY = Math.max(2, Math.min(8, Number(process.env.NFT_FORGE_RENDER_CONCURRENCY) || 4));

/** Render every token lacking a current render. `tokenIds` limits to specific tokens. */
export async function startRenderJob(projectId: string, opts: { tokenIds?: number[] } = {}): Promise<Job> {
  const existing = activeJob(projectId, "render");
  if (existing) return existing;
  const [job, ctl] = newJob(projectId, "render");
  void (async () => {
    try {
      const project = await getProject(projectId);
      const collection = await getCollection(projectId);
      if (!collection?.nfts.length) return finish(job, ctl, "failed", "Generate the collection first.");
      const filter = opts.tokenIds ? new Set(opts.tokenIds) : null;
      const targets = collection.nfts.filter((n) => !filter || filter.has(n.tokenId));
      job.total = targets.length;
      const renderer = await new LayerRenderer(project).init();
      const queue = [...targets];
      const started = Date.now();
      let rendered = 0;
      job.message = "Rendering…";
      const worker = async () => {
        for (;;) {
          await gate(ctl);
          if (ctl.cancelled) return;
          const nft = queue.shift();
          if (!nft) return;
          try {
            if (await existingRender(project, nft)) job.skipped++;
            else {
              await renderer.renderToDisk(nft);
              rendered++;
              job.msPerItem = Math.round((Date.now() - started) / rendered);
            }
          } catch (e) {
            job.failed.push({ tokenId: nft.tokenId, error: (e as Error).message });
          }
          job.done++;
          void persist(job.projectId);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      finish(
        job,
        ctl,
        undefined,
        ctl.cancelled
          ? `Cancelled after ${job.done}/${job.total}. Run again to resume.`
          : `Rendered ${rendered}, already current ${job.skipped}, failed ${job.failed.length}.`,
      );
    } catch (e) {
      finish(job, ctl, "failed", (e as Error).message);
    }
  })();
  return job;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * Package images, metadata, reports and a SHA-256 manifest into a ZIP.
 * Refuses to export when QA has hard failures (unless `force`).
 */
export async function startExportJob(projectId: string, opts: { force?: boolean } = {}): Promise<Job> {
  const existing = activeJob(projectId, "export");
  if (existing) return existing;
  const [job, ctl] = newJob(projectId, "export");
  void (async () => {
    try {
      job.message = "Running QA…";
      const qa = await runQa(projectId, { visualDuplicates: false });
      if (!qa.passed && !opts.force)
        return finish(job, ctl, "failed", "QA has failing checks. Fix them (see QA & Review) or export with force.");

      const project = await getProject(projectId);
      const collection = (await getCollection(projectId))!;
      const nfts: Nft[] = [...collection.nfts].sort((a, b) => a.tokenId - b.tokenId);
      const assets = await listAssets(projectId);
      const renderer = await new LayerRenderer(project).init();
      job.total = nfts.length;

      await fs.mkdir(paths.exportsDir(projectId), { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${project.id}-${stamp}.zip`;
      const file = path.join(paths.exportsDir(projectId), name);
      const out = createWriteStream(file);
      const zip = new ZipArchive({ zlib: { level: 6 } });
      const closed = new Promise<void>((resolve, reject) => {
        out.on("close", resolve);
        zip.on("error", reject);
      });
      zip.pipe(out);
      const manifest: { path: string; sha256: string; bytes: number }[] = [];
      const add = (p: string, data: Buffer | string, store = false) => {
        const buf = typeof data === "string" ? Buffer.from(data) : data;
        manifest.push({ path: p, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length });
        // Images are already compressed; storing them avoids burning CPU for ~0% gain.
        zip.append(buf, { name: p, store });
      };

      job.message = "Packaging artwork and metadata…";
      for (const n of nfts) {
        await gate(ctl);
        if (ctl.cancelled) break;
        try {
          const src = (await existingRender(project, n)) ?? (await renderer.renderToDisk(n));
          add(`images/${imageFileName(n.tokenId, project.canvas)}`, await fs.readFile(src), true);
          const meta = buildTokenMetadata(project.metadata, project.config.categories, project.canvas, n);
          add(`metadata/${n.tokenId}.json`, JSON.stringify(meta, null, 2));
        } catch (e) {
          job.failed.push({ tokenId: n.tokenId, error: (e as Error).message });
        }
        job.done++;
        void persist(job.projectId);
      }
      if (ctl.cancelled) {
        zip.abort();
        await fs.rm(file, { force: true });
        return finish(job, ctl, "cancelled", "Export cancelled.");
      }

      const cats = project.config.categories;
      const rarity = computeRarity(project.config, nfts);
      const rankOf = new Map(rarity.tokens.map((t) => [t.tokenId, t]));
      const traitName = (cid: string, tid: string) =>
        tid === NONE ? "None" : (cats.find((c) => c.id === cid)?.traits.find((t) => t.id === tid)?.name ?? tid);

      add("collection.json", JSON.stringify(buildCollectionMetadata(project.metadata, nfts.length), null, 2));
      // Provenance: SHA-256 over every image's SHA-256 in token order. The same value is
      // committed on-chain by the Robinhood Chain contract (provenanceHash).
      const imageHashes = manifest.filter((m) => m.path.startsWith("images/")).map((m) => m.sha256);
      add(
        "provenance.json",
        JSON.stringify(
          {
            algorithm: "sha256(concat(sha256_hex(image) for image in token-id order))",
            provenanceHash: `0x${createHash("sha256").update(imageHashes.join("")).digest("hex")}`,
            tokens: nfts.map((n, i) => ({ tokenId: n.tokenId, imageSha256: imageHashes[i] })),
          },
          null,
          1,
        ),
      );
      add(
        "reports/traits.csv",
        [
          ["token_id", "dna", "status", ...cats.map((c) => c.name), "rarity_score", "rarity_rank", "rarity_tier"]
            .map(csvCell)
            .join(","),
          ...nfts.map((n) => {
            const r = rankOf.get(n.tokenId)!;
            return [n.tokenId, n.dna, n.status, ...cats.map((c) => traitName(c.id, n.traits[c.id] ?? NONE)), r.score, r.rank, r.tier]
              .map(csvCell)
              .join(",");
          }),
        ].join("\n"),
      );
      add(
        "reports/trait-rarity.csv",
        [
          "category,trait,count,actual_pct",
          ...rarity.categories.flatMap((c) =>
            c.traits.map((t) => [c.name, t.name, t.count, (t.actual * 100).toFixed(3)].map(csvCell).join(",")),
          ),
        ].join("\n"),
      );
      add("reports/qa-report.json", JSON.stringify(qa, null, 2));
      add(
        "generation-record.json",
        JSON.stringify(
          {
            project: { id: project.id, name: project.name },
            seed: project.config.seed,
            configHash: configHash(project.config),
            config: project.config,
            canvas: project.canvas,
            metadataTemplate: project.metadata,
            assets: assets.map((a) => ({ id: a.id, name: a.name, version: a.version, sha256: a.sha256, source: a.source })),
            tokens: nfts.map((n) => ({ tokenId: n.tokenId, dna: n.dna, attempt: n.attempt, configHash: n.configHash, status: n.status })),
            history: collection.history,
            exportedAt: new Date().toISOString(),
          },
          null,
          1,
        ),
      );
      // The manifest lists every other file; it can't contain its own hash.
      zip.append(JSON.stringify({ algorithm: "sha256", files: manifest }, null, 1), { name: "manifest.json" });
      await zip.finalize();
      await closed;
      const { size } = await fs.stat(file);
      job.result = { file, bytes: size, name };
      finish(
        job,
        ctl,
        job.failed.length ? "failed" : "done",
        job.failed.length ? `Exported with ${job.failed.length} failed token(s).` : `Exported ${nfts.length} tokens.`,
      );
    } catch (e) {
      finish(job, ctl, "failed", (e as Error).message);
    }
  })();
  return job;
}

/**
 * Run an arbitrary background task with the standard job lifecycle (progress,
 * cancel, persisted history). `task` updates `job.total`/`job.done`/`job.message`
 * and should call `checkpoint()` between units of work so cancel takes effect.
 */
export function startTaskJob(
  projectId: string,
  type: JobType,
  task: (job: Job, checkpoint: () => Promise<void>) => Promise<{ message: string; result?: Job["result"] }>,
): Job {
  const existing = activeJob(projectId, type);
  if (existing) return existing;
  const [job, ctl] = newJob(projectId, type);
  const checkpoint = async () => {
    await gate(ctl);
    if (ctl.cancelled) throw new Error("__cancelled__");
    void persist(projectId);
  };
  void (async () => {
    try {
      const r = await task(job, checkpoint);
      job.result = r.result;
      finish(job, ctl, "done", r.message);
    } catch (e) {
      const msg = (e as Error).message;
      finish(job, ctl, msg === "__cancelled__" ? "cancelled" : "failed", msg === "__cancelled__" ? "Cancelled." : msg.slice(0, 500));
    }
  })();
  return job;
}
