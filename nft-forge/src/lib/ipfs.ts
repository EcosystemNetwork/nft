import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { Readable, Writable } from "node:stream";
// ipfs-car and its deps are ESM-only: load lazily so CommonJS contexts (tsx scripts, tests) work too.
const car = () => import("ipfs-car");

// ---------------------------------------------------------------------------
// Content addressing. NFT Forge computes IPFS CIDs locally (UnixFS, CIDv1, raw
// leaves, 1 MiB chunks, HAMT-sharded above 1,000 entries) and writes CAR files.
// Because the CIDs are known before anything is uploaded, metadata can reference
// `ipfs://<imagesCID>/<id>.png` up front, and any pinning service that imports
// the CAR serves exactly these bytes under exactly these CIDs.
// ---------------------------------------------------------------------------

export interface PackEntry {
  name: string;
  /** Either a file on disk or in-memory bytes. */
  path?: string;
  bytes?: Uint8Array;
}

function fileLike(e: PackEntry) {
  return {
    name: e.name,
    stream: () =>
      e.path
        ? (Readable.toWeb(createReadStream(e.path)) as unknown as ReadableStream<Uint8Array>)
        : new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(e.bytes!);
              c.close();
            },
          }),
  };
}

/** Root CID of a directory, without writing anything (pass 1). */
export async function directoryCid(entries: PackEntry[]): Promise<string> {
  const { createDirectoryEncoderStream } = await car();
  let root: { toString(): string } | null = null;
  await createDirectoryEncoderStream(entries.map(fileLike)).pipeTo(
    new WritableStream({
      write(block) {
        root = block.cid;
      },
    }),
  );
  if (!root) throw new Error("Empty directory");
  return String(root);
}

/** CID of a single file's bytes. */
export async function fileCid(bytes: Uint8Array): Promise<string> {
  const { createFileEncoderStream } = await car();
  let root: { toString(): string } | null = null;
  await createFileEncoderStream(new Blob([bytes as BlobPart])).pipeTo(
    new WritableStream({
      write(block) {
        root = block.cid;
      },
    }),
  );
  return String(root);
}

/**
 * Pack a directory into a CAR file whose header names the root CID. Two passes
 * (CID first, then CAR) keep memory flat even for hundreds of MB of images.
 * The second pass re-derives the root and must agree, which guards against
 * nondeterminism or files changing mid-pack.
 */
export async function packDirectory(entries: PackEntry[], outFile: string): Promise<{ root: string; bytes: number; blocks: number }> {
  const root = await directoryCid(entries);
  const { CID } = await import("multiformats/cid");
  const { createDirectoryEncoderStream, CAREncoderStream } = await car();
  let last = "";
  let blocks = 0;
  await createDirectoryEncoderStream(entries.map(fileLike))
    .pipeThrough(
      new TransformStream({
        transform(block, c) {
          last = String(block.cid);
          blocks++;
          c.enqueue(block);
        },
      }),
    )
    .pipeThrough(new CAREncoderStream([CID.parse(root)]))
    .pipeTo(Writable.toWeb(createWriteStream(outFile)) as WritableStream<Uint8Array>);
  if (last !== root) {
    await fs.rm(outFile, { force: true });
    throw new Error(`CAR root mismatch (${last} ≠ ${root}); files changed while packing?`);
  }
  return { root, bytes: (await fs.stat(outFile)).size, blocks };
}

export const GATEWAYS = ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];

export interface GatewayResult {
  path: string;
  gateway: string;
  ok: boolean;
  /** Rate limiting or gateway errors say nothing about whether the content exists. */
  inconclusive: boolean;
  detail: string;
}

/**
 * Check whether content is retrievable from public IPFS gateways. Requests are
 * sequential (public gateways rate-limit bursts), and 429/5xx responses are
 * reported as inconclusive rather than "missing".
 */
export async function gatewayCheck(paths: string[], timeoutMs = 20000): Promise<GatewayResult[]> {
  const results: GatewayResult[] = [];
  for (const p of paths)
    for (const g of GATEWAYS) {
      try {
        const res = await fetch(g + p, { headers: { range: "bytes=0-1023" }, signal: AbortSignal.timeout(timeoutMs) });
        await res.body?.cancel().catch(() => undefined);
        const ok = res.ok || res.status === 206;
        const inconclusive = res.status === 429 || res.status >= 500;
        results.push({ path: p, gateway: g, ok, inconclusive, detail: res.status === 429 ? "rate-limited (HTTP 429)" : `HTTP ${res.status}` });
      } catch (e) {
        const timeout = (e as Error).name === "TimeoutError";
        // A timeout usually means the gateway is still searching the network: not found (yet).
        results.push({ path: p, gateway: g, ok: false, inconclusive: false, detail: timeout ? "timed out (not found yet)" : (e as Error).message.slice(0, 80) });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  return results;
}
