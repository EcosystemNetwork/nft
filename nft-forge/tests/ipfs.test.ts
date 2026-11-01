import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { directoryCid, fileCid, packDirectory } from "../src/lib/ipfs";

const enc = (s: string) => new TextEncoder().encode(s);

test("file CID matches the canonical IPFS CID for known content", async () => {
  // `ipfs add --cid-version=1 --raw-leaves` of "hello world" (no newline).
  assert.equal(await fileCid(enc("hello world")), "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
});

test("directory CIDs are deterministic and content-sensitive", async () => {
  const a = [{ name: "1.json", bytes: enc('{"a":1}') }, { name: "2.json", bytes: enc('{"a":2}') }];
  const b = [{ name: "1.json", bytes: enc('{"a":1}') }, { name: "2.json", bytes: enc('{"a":3}') }];
  assert.equal(await directoryCid(a), await directoryCid(a));
  assert.notEqual(await directoryCid(a), await directoryCid(b));
  assert.match(await directoryCid(a), /^bafy/);
});

test("CAR file declares the root, contains every block, and round-trips file bytes", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "forge-car-"));
  // 1,200 entries forces a HAMT-sharded directory, like a 3,333-token collection.
  const entries = Array.from({ length: 1200 }, (_, i) => ({ name: `${i + 1}.json`, bytes: enc(JSON.stringify({ name: `Token #${i + 1}` })) }));
  const out = path.join(dir, "meta.car");
  const { root, blocks } = await packDirectory(entries, out);
  const { CarReader } = await import("@ipld/car");
  const reader = await CarReader.fromBytes(readFileSync(out));
  const roots = await reader.getRoots();
  assert.equal(String(roots[0]), root);
  let count = 0;
  const cids = new Set<string>();
  for await (const b of reader.blocks()) {
    count++;
    cids.add(String(b.cid));
  }
  assert.equal(count, blocks);
  // Every file's own CID (raw leaf for small files) is present in the archive.
  for (const i of [0, 599, 1199]) assert.ok(cids.has(await fileCid(entries[i].bytes)), `block for ${entries[i].name}`);
  assert.ok(cids.has(root));
});
