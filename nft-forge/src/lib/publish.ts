import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { contentFingerprint } from "./deployments";
import { artworkIdFor, buildCollectionMetadata, buildRevealedTokenMetadata, buildTokenMetadata, imageFileName } from "./engine/metadata";
import { gatewayCheck, packDirectory, type GatewayResult, type PackEntry } from "./ipfs";
import { startTaskJob } from "./jobs";
import { existingRender } from "./render";
import { getSale, unrevealedImage, unrevealedMetadata } from "./sale";
import { getCollection, getProject, HttpError, newId, paths, updateProject, withProjectLock } from "./store";

// ---------------------------------------------------------------------------
// IPFS publishing: images CAR → image CID baked into metadata → metadata CAR.
// The resulting base URI (ipfs://<metadataCID>/) is final before any upload.
// ---------------------------------------------------------------------------

export interface Publication {
  id: string;
  createdAt: string;
  tokenCount: number;
  imagesCid: string;
  metadataCid: string;
  imageBaseUri: string;
  baseURI: string;
  contractURI: string;
  /** Content fingerprint the published metadata corresponds to. Changes make it stale. */
  fingerprint: string;
  cars: Record<"images" | "metadata", { file: string; bytes: number; blocks: number }>;
  uploads: { provider: string; at: string; ok: boolean; message: string }[];
  availability?: { at: string; ok: boolean; inconclusive: boolean; results: GatewayResult[] };
  /** Delayed-reveal placeholder (ipfs://<metadataCID>/unrevealed.json), when the sale uses one. */
  unrevealedURI?: string;
  /** Revealed metadata per deployment: token N.json describes artwork artworkId(N). */
  reveals?: Record<string, { offset: number; cid: string; baseURI: string; car: { file: string; bytes: number; blocks: number }; createdAt: string; uploaded?: boolean }>;
}

const recordFile = (id: string) => path.join(paths.project(id), "ipfs.json");
const carDir = (id: string) => path.join(paths.project(id), "ipfs");

export async function getPublication(projectId: string): Promise<Publication | null> {
  try {
    return JSON.parse(await fs.readFile(recordFile(projectId), "utf8")) as Publication;
  } catch {
    return null;
  }
}

async function savePublication(projectId: string, p: Publication) {
  const f = recordFile(projectId);
  await fs.writeFile(`${f}.tmp`, JSON.stringify(p, null, 1));
  await fs.rename(`${f}.tmp`, f);
}

async function mutatePublication(projectId: string, fn: (p: Publication) => void) {
  return withProjectLock(`${projectId}:ipfs`, async () => {
    const p = await getPublication(projectId);
    if (!p) throw new HttpError(404, "Nothing published yet");
    fn(p);
    await savePublication(projectId, p);
    return p;
  });
}

export async function publicationStatus(projectId: string) {
  const project = await getProject(projectId);
  const nfts = (await getCollection(projectId))?.nfts ?? [];
  const publication = await getPublication(projectId);
  return {
    publication,
    stale: publication ? publication.fingerprint !== contentFingerprint(project, nfts) : false,
    filebaseConfigured: Boolean(process.env.FILEBASE_ACCESS_KEY && process.env.FILEBASE_SECRET_KEY && process.env.FILEBASE_BUCKET),
  };
}

/** Build both CARs and the publication record (background job). */
export function startPack(projectId: string) {
  return startTaskJob(projectId, "ipfs", async (job, checkpoint) => {
    const project = await getProject(projectId);
    const nfts = [...((await getCollection(projectId))?.nfts ?? [])].sort((a, b) => a.tokenId - b.tokenId);
    if (!nfts.length) throw new Error("Generate the collection first.");
    job.total = 3;
    job.message = "Checking renders…";
    const images: PackEntry[] = [];
    for (const n of nfts) {
      const file = await existingRender(project, n);
      if (!file) throw new Error(`Token #${n.tokenId} is not rendered. Render the collection first.`);
      images.push({ name: imageFileName(n.tokenId, project.canvas), path: file });
    }
    const sale = await getSale(projectId);
    const delayed = sale.enabled && sale.delayedReveal;
    if (delayed) images.push({ name: "unrevealed.png", bytes: await unrevealedImage(project) });
    await fs.mkdir(carDir(projectId), { recursive: true });
    await checkpoint();

    job.message = `Packing ${nfts.length} images (computing CIDs)…`;
    const imagesCar = path.join(carDir(projectId), "images.car");
    const img = await packDirectory(images, imagesCar);
    job.done = 1;
    await checkpoint();

    // Metadata now points at the content-addressed images.
    job.message = "Packing metadata…";
    const imageBaseUri = `ipfs://${img.root}/`;
    const template = { ...project.metadata, imageBaseUri };
    const metaEntries: PackEntry[] = nfts.map((n) => ({
      name: `${n.tokenId}.json`,
      bytes: new TextEncoder().encode(JSON.stringify(buildTokenMetadata(template, project.config.categories, project.canvas, n), null, 2)),
    }));
    metaEntries.push({
      name: "collection.json",
      bytes: new TextEncoder().encode(
        JSON.stringify({ ...buildCollectionMetadata(template, nfts.length), image: `${imageBaseUri}${imageFileName(nfts[0].tokenId, project.canvas)}` }, null, 2),
      ),
    });
    if (delayed) metaEntries.push({ name: "unrevealed.json", bytes: new TextEncoder().encode(JSON.stringify(unrevealedMetadata(sale, `${imageBaseUri}unrevealed.png`), null, 2)) });
    const metaCar = path.join(carDir(projectId), "metadata.car");
    const meta = await packDirectory(metaEntries, metaCar);
    job.done = 2;

    const updated = await updateProject(projectId, (p) => void (p.metadata.imageBaseUri = imageBaseUri));
    const publication: Publication = {
      id: newId("pub"),
      createdAt: new Date().toISOString(),
      tokenCount: nfts.length,
      imagesCid: img.root,
      metadataCid: meta.root,
      imageBaseUri,
      baseURI: `ipfs://${meta.root}/`,
      contractURI: `ipfs://${meta.root}/collection.json`,
      fingerprint: contentFingerprint(updated, nfts),
      cars: {
        images: { file: "images.car", bytes: img.bytes, blocks: img.blocks },
        metadata: { file: "metadata.car", bytes: meta.bytes, blocks: meta.blocks },
      },
      uploads: [],
      unrevealedURI: delayed ? `ipfs://${meta.root}/unrevealed.json` : undefined,
    };
    await savePublication(projectId, publication);
    job.done = 3;
    return { message: `Images ${img.root} · metadata ${meta.root}` };
  });
}

export function carPath(projectId: string, name: string) {
  if (name !== "images.car" && name !== "metadata.car" && !/^revealed-[\w-]{1,40}\.car$/.test(name)) throw new HttpError(404, "Not found");
  return path.join(carDir(projectId), name);
}

/**
 * Delayed reveal (mainnet): pack the revealed metadata for one deployment and offset.
 * Images are unchanged (same images CID); only metadata is remapped so that token N.json
 * carries artwork artworkId(N) under token N's name.
 */
export function startRevealPack(projectId: string, depId: string, offset: number, supply: number, startTokenId: number) {
  return startTaskJob(projectId, "ipfs", async (job) => {
    const pub = await getPublication(projectId);
    if (!pub) throw new Error("Pack the collection first.");
    const project = await getProject(projectId);
    const nfts = new Map(((await getCollection(projectId))?.nfts ?? []).map((n) => [n.tokenId, n]));
    if (nfts.size !== supply) throw new Error("The collection changed since deployment.");
    job.total = 1;
    job.message = `Packing revealed metadata (offset ${offset})…`;
    const template = { ...project.metadata, imageBaseUri: pub.imageBaseUri };
    const entries: PackEntry[] = [];
    for (let t = startTokenId; t < startTokenId + supply; t++) {
      const art = nfts.get(artworkIdFor(t, startTokenId, supply, offset))!;
      entries.push({ name: `${t}.json`, bytes: new TextEncoder().encode(JSON.stringify(buildRevealedTokenMetadata(template, project.config.categories, project.canvas, art, t), null, 2)) });
    }
    entries.push({
      name: "collection.json",
      bytes: new TextEncoder().encode(JSON.stringify({ ...buildCollectionMetadata(template, supply), image: `${pub.imageBaseUri}${imageFileName(startTokenId, project.canvas)}` }, null, 2)),
    });
    const file = `revealed-${depId}.car`;
    const r = await packDirectory(entries, path.join(carDir(projectId), file));
    await mutatePublication(projectId, (p) => {
      p.reveals ??= {};
      p.reveals[depId] = { offset, cid: r.root, baseURI: `ipfs://${r.root}/`, car: { file, bytes: r.bytes, blocks: r.blocks }, createdAt: new Date().toISOString() };
    });
    job.done = 1;
    return { message: `Revealed metadata ${r.root} (offset ${offset}). Pin it, then reveal.` };
  });
}

/**
 * Upload both CARs to Filebase (S3-compatible API with CAR import) and confirm
 * that Filebase reports the same root CIDs we computed.
 */
export function startFilebaseUpload(projectId: string) {
  const { FILEBASE_ACCESS_KEY: key, FILEBASE_SECRET_KEY: secret, FILEBASE_BUCKET: bucket } = process.env;
  if (!key || !secret || !bucket) throw new HttpError(400, "Set FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY and FILEBASE_BUCKET to enable uploads.");
  return startTaskJob(projectId, "filebase", async (job, checkpoint) => {
    const pub = await getPublication(projectId);
    if (!pub) throw new Error("Pack the collection first.");
    const { S3Client, PutObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ endpoint: "https://s3.filebase.com", region: "us-east-1", credentials: { accessKeyId: key, secretAccessKey: secret } });
    const cars: { kind: string; file: string; cid: string; bytes: number; revealDep?: string }[] = [
      { kind: "images", file: "images.car", cid: pub.imagesCid, bytes: pub.cars.images.bytes },
      { kind: "metadata", file: "metadata.car", cid: pub.metadataCid, bytes: pub.cars.metadata.bytes },
      ...Object.entries(pub.reveals ?? {}).map(([dep, r]) => ({ kind: `revealed metadata (${dep})`, file: r.car.file, cid: r.cid, bytes: r.car.bytes, revealDep: dep })),
    ];
    job.total = cars.length;
    const results: string[] = [];
    for (const car of cars) {
      await checkpoint();
      const Key = `${projectId}/${car.file.replace(/\.car$/, "")}-${car.cid}.car`;
      job.message = `Uploading ${car.kind} CAR (${(car.bytes / 1e6).toFixed(1)} MB)…`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: createReadStream(carPath(projectId, car.file)), ContentLength: car.bytes, Metadata: { import: "car" } }));
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key }));
      const got = head.Metadata?.cid;
      if (got !== car.cid) throw new Error(`Filebase reported CID ${got ?? "none"} for ${car.kind}, expected ${car.cid}.`);
      results.push(`${car.kind} ✓`);
      job.done++;
    }
    await mutatePublication(projectId, (p) => {
      p.uploads.push({ provider: "filebase", at: new Date().toISOString(), ok: true, message: `${cars.length} CAR(s) imported; root CIDs match` });
      for (const c of cars) if (c.revealDep && p.reveals?.[c.revealDep]) p.reveals[c.revealDep].uploaded = true;
    });
    return { message: `Uploaded to Filebase: ${results.join(", ")}` };
  });
}

/** Confirm the published content is retrievable from public gateways. */
export async function checkAvailability(projectId: string) {
  const pub = await getPublication(projectId);
  if (!pub) throw new HttpError(404, "Pack the collection first.");
  const project = await getProject(projectId);
  const first = (await getCollection(projectId))!.nfts.reduce((m, n) => Math.min(m, n.tokenId), Infinity);
  const results = await gatewayCheck([`${pub.metadataCid}/collection.json`, `${pub.metadataCid}/${first}.json`, `${pub.imagesCid}/${imageFileName(first, project.canvas)}`]);
  // A path counts as available if any gateway served it.
  const paths = [...new Set(results.map((r) => r.path))];
  const served = (p: string) => results.some((r) => r.path === p && r.ok);
  const ok = paths.every(served);
  const inconclusive = !ok && paths.filter((p) => !served(p)).every((p) => results.filter((r) => r.path === p).every((r) => r.inconclusive));
  return mutatePublication(projectId, (p) => void (p.availability = { at: new Date().toISOString(), ok, inconclusive, results }));
}
