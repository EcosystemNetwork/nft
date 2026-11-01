import { generateCollection, regenerateToken } from "./engine/generator";
import type { NftStatus } from "./engine/types";
import {
  getCollection,
  getProject,
  HttpError,
  listAssets,
  newId,
  saveCollection,
  saveProject,
  withProjectLock,
  type CollectionFile,
  type GenerationRun,
} from "./store";

/**
 * Generate (or regenerate) the whole collection. Approved and locked tokens are
 * carried over unchanged; drafts are re-rolled from the seed.
 */
export async function generateForProject(projectId: string, opts: { seed?: string } = {}) {
  return withProjectLock(projectId, async () => {
    const project = await getProject(projectId);
    const config = { ...project.config, seed: opts.seed?.trim() || project.config.seed };
    const previous = await getCollection(projectId);
    const result = generateCollection(config, {
      startTokenId: project.metadata.startTokenId,
      previous: previous?.nfts,
    });
    const assets = await listAssets(projectId);
    const run: GenerationRun = {
      id: newId("run"),
      at: new Date().toISOString(),
      seed: config.seed,
      configHash: result.configHash,
      supply: config.supply,
      generated: result.stats.generated,
      preserved: result.stats.preserved,
      retries: result.stats.retries,
      durationMs: result.stats.durationMs,
      errors: result.errors,
      warnings: result.warnings,
      assetVersions: Object.fromEntries(assets.map((a) => [a.id, a.version])),
    };
    // A configuration that can't produce anything must not wipe an existing collection.
    if (result.nfts.length === 0 && previous?.nfts.length) {
      previous.history = [run, ...previous.history].slice(0, 50);
      await saveCollection(projectId, previous);
      return { run, collection: previous };
    }
    const collection: CollectionFile = {
      configHash: result.configHash,
      seed: config.seed,
      generatedAt: run.at,
      nfts: result.nfts,
      history: [run, ...(previous?.history ?? [])].slice(0, 50),
    };
    await saveCollection(projectId, collection);
    if (config.seed !== project.config.seed) {
      project.config.seed = config.seed;
      await saveProject(project);
    }
    return { run, collection };
  });
}

/** Valid transitions: draft <-> approved -> locked. Locked tokens are final. */
export async function setStatus(projectId: string, tokenIds: number[], status: NftStatus) {
  return withProjectLock(projectId, async () => {
    const c = await getCollection(projectId);
    if (!c) throw new HttpError(404, "No collection generated yet");
    const ids = new Set(tokenIds);
    let changed = 0;
    const skipped: number[] = [];
    for (const n of c.nfts) {
      if (!ids.has(n.tokenId) || n.status === status) continue;
      if (n.status === "locked" || (status === "locked" && n.status !== "approved")) {
        skipped.push(n.tokenId);
        continue;
      }
      n.status = status;
      changed++;
    }
    await saveCollection(projectId, c);
    return { changed, skipped };
  });
}

export async function regenerateOne(projectId: string, tokenId: number) {
  return withProjectLock(projectId, async () => {
    const project = await getProject(projectId);
    const c = await getCollection(projectId);
    if (!c) throw new HttpError(404, "No collection generated yet");
    let next;
    try {
      next = regenerateToken(project.config, c.nfts, tokenId);
    } catch (e) {
      throw new HttpError(409, (e as Error).message);
    }
    if (!next) throw new HttpError(409, "No alternative unique combination found for this token.");
    c.nfts = c.nfts.map((n) => (n.tokenId === tokenId ? next : n));
    await saveCollection(projectId, c);
    return next;
  });
}
