// Independent check of NFT Forge's IPFS packages: resolve paths through the
// (HAMT-sharded) directory with ipfs-unixfs-exporter, a separate UnixFS
// implementation, and compare bytes with the files on disk.
//   node scripts/verify-ipfs-car.mjs <projectId>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CarReader } from "@ipld/car";
import { exporter } from "ipfs-unixfs-exporter";

const id = process.argv[2] ?? "space-pirates-genesis";
const dir = path.join("data/projects", id);
const pub = JSON.parse(readFileSync(path.join(dir, "ipfs.json"), "utf8"));
const coll = JSON.parse(readFileSync(path.join(dir, "collection.json"), "utf8"));

async function store(car) {
  const reader = await CarReader.fromBytes(readFileSync(path.join(dir, "ipfs", car)));
  const blocks = new Map();
  for await (const b of reader.blocks()) blocks.set(b.cid.toString(), b.bytes);
  // Blockstore adapter: current ipfs-unixfs-exporter reads blocks as an iterable of chunks.
  const get = (cid) => {
    const b = blocks.get(cid.toString());
    if (!b) throw new Error(`missing block ${cid}`);
    return [b];
  };
  return { root: (await reader.getRoots())[0].toString(), bs: { get }, blocks };
}
async function read(bs, p) {
  const entry = await exporter(p, bs);
  const parts = [];
  for await (const c of entry.content()) parts.push(c);
  return Buffer.concat(parts);
}
// CIDv1 raw sha2-256, computed by hand: multibase "b" + base32(0x01 0x55 0x12 0x20 + digest)
function rawCid(bytes) {
  const bin = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), createHash("sha256").update(bytes).digest()]);
  const A = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, val = 0, out = "b";
  for (const byte of bin) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

const img = await store("images.car");
const meta = await store("metadata.car");
console.log(`images root ${img.root === pub.imagesCid ? "✓" : "✗"} ${img.root}`);
console.log(`metadata root ${meta.root === pub.metadataCid ? "✓" : "✗"} ${meta.root}`);
const nfts = [...coll.nfts].sort((a, b) => a.tokenId - b.tokenId);
const sample = [nfts[0], nfts[1110], nfts[2222], nfts.at(-1)];
let ok = true;
for (const n of sample) {
  const disk = readFileSync(path.join(dir, "renders", `${n.tokenId}-${n.dna}.png`));
  const viaIpfs = await read(img.bs, `${img.root}/${n.tokenId}.png`);
  const same = Buffer.compare(disk, viaIpfs) === 0;
  const leaf = rawCid(disk);
  const m = JSON.parse((await read(meta.bs, `${meta.root}/${n.tokenId}.json`)).toString());
  const imgOk = m.image === `ipfs://${img.root}/${n.tokenId}.png`;
  ok &&= same && img.blocks.has(leaf) && imgOk;
  console.log(`#${n.tokenId}: image bytes ${same ? "✓ identical" : "✗ differ"} · leaf CID ${img.blocks.has(leaf) ? "✓" : "✗"} ${leaf.slice(0, 20)}… · metadata "${m.name}" → image ${imgOk ? "✓" : "✗"}`);
}
const c = JSON.parse((await read(meta.bs, `${meta.root}/collection.json`)).toString());
console.log(`collection.json: ${c.name} (${c.symbol}) image ${c.image.startsWith(`ipfs://${img.root}/`) ? "✓" : "✗"}`);
console.log(ok ? "ALL CHECKS PASSED" : "CHECKS FAILED");
process.exit(ok ? 0 : 1);
