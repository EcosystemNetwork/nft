import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

// Isolated data directory; must be set before the store module is loaded.
process.env.NFT_FORGE_DATA = mkdtempSync(path.join(os.tmpdir(), "forge-deploy-test-"));

type Lib = {
  store: typeof import("../src/lib/store");
  collection: typeof import("../src/lib/collection");
  dep: typeof import("../src/lib/deployments");
};
let L: Lib;
let projectId: string;
const WALLET = "6PgAkewTsANKDF47Sfv2ifHZm8n7JuMC6iRPx7ScXdmw";
const OTHER = "8gszm7ktTitNjoWcDfhu4rdzusNNNWarBqjvNoMFMfi7";
const ASSET = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const SIG = "5".repeat(88);

before(async () => {
  L = {
    store: await import("../src/lib/store"),
    collection: await import("../src/lib/collection"),
    dep: await import("../src/lib/deployments"),
  };
  const p = await L.store.createProject({ name: "Deploy Test", concept: "", supply: 20, style: "", chain: "solana", mode: "2d" });
  projectId = p.id;
  await L.store.updateProject(projectId, (x) => {
    x.config.categories = [
      { id: "bg", name: "Background", required: true, noneWeight: 0, layer: 0, traits: Array.from({ length: 5 }, (_, i) => ({ id: `bg${i}`, name: `Bg ${i}`, weight: 1 })) },
      { id: "hat", name: "Hat", required: true, noneWeight: 0, layer: 1, traits: Array.from({ length: 5 }, (_, i) => ({ id: `h${i}`, name: `Hat ${i}`, weight: 1 })) },
    ];
  });
  await L.collection.generateForProject(projectId);
});

const base = { uriMode: "base" as const, metadataBaseUri: "https://example.com/meta/", collectionMetadataUri: "https://example.com/collection.json" };

test("test deployments require a valid wallet and hosted URIs", async () => {
  await assert.rejects(L.dep.createDeployment(projectId, { mode: "test", wallet: "nope", ...base }), /wallet/i);
  await assert.rejects(L.dep.createDeployment(projectId, { mode: "test", wallet: WALLET, uriMode: "base", metadataBaseUri: "ftp://x" }), /URI/);
  const d = await L.dep.createDeployment(projectId, { mode: "test", wallet: WALLET, testCount: 5, ...base });
  assert.equal(d.network, "devnet");
  assert.equal(d.items.length, 5);
  assert.equal(d.items[0].metadataUri, `https://example.com/meta/${d.items[0].tokenId}.json`);
  assert.ok(d.items.every((i) => i.state === "uploaded"));
});

test("production is refused without readiness and approval", async () => {
  await assert.rejects(L.dep.createDeployment(projectId, { mode: "production", wallet: WALLET, ...base }), /readiness/);
  await assert.rejects(L.dep.approveProduction(projectId, { wallet: WALLET, confirmName: "wrong" }), /Type the collection name/);
  await assert.rejects(L.dep.approveProduction(projectId, { wallet: WALLET, confirmName: "Deploy Test" }), /Not ready/);
  const r = await L.dep.readiness(projectId);
  assert.equal(r.ready, false);
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.ok]));
  assert.equal(byId.chain, true);
  assert.equal(byId.supply, true);
  assert.equal(byId.locked, false);
  assert.equal(byId.test, false);
});

test("locking tokens after a test does not invalidate it (fingerprint ignores review status)", async () => {
  const before = (await L.dep.readiness(projectId)).fingerprint;
  const ids = (await L.store.getCollection(projectId))!.nfts.map((n) => n.tokenId);
  await L.collection.setStatus(projectId, ids, "approved");
  await L.collection.setStatus(projectId, ids, "locked");
  const after = await L.dep.readiness(projectId);
  assert.equal(after.fingerprint, before);
  assert.equal(after.checks.find((c) => c.id === "locked")!.ok, true);
});

test("plan reflects recorded progress and refuses changed content", async () => {
  const d = await L.dep.createDeployment(projectId, { mode: "test", wallet: WALLET, testCount: 3, ...base });
  const plan = await L.dep.buildPlan(projectId, d.id);
  assert.equal(plan.tokens.length, 3);
  assert.equal(plan.collection.uri, base.collectionMetadataUri);
  assert.match(plan.tokens[0].name, /^Deploy Test #/);
  // Changing the metadata template changes the fingerprint → old deployment can't run.
  await L.store.updateProject(projectId, (p) => void (p.metadata.description = "changed"));
  await assert.rejects(L.dep.buildPlan(projectId, d.id), /changed/);
  await L.store.updateProject(projectId, (p) => void (p.metadata.description = "Deploy Test — a generative collection made with NFT Forge."));
});

test("progress events are validated and recorded", async () => {
  const d = await L.dep.createDeployment(projectId, { mode: "test", wallet: WALLET, testCount: 3, ...base });
  const t = d.items.map((i) => i.tokenId);
  await assert.rejects(L.dep.applyEvent(projectId, d.id, { type: "collection", address: "bad", uri: "https://x.y/z", signature: SIG }), /Invalid/);
  await assert.rejects(L.dep.applyEvent(projectId, d.id, { type: "uploaded", items: [{ tokenId: t[0], metadataUri: "javascript:alert(1)" }] }), /Invalid URI/);
  await assert.rejects(L.dep.applyEvent(projectId, d.id, { type: "minting", items: [{ tokenId: 99999, asset: ASSET }] }), /not part/);
  await assert.rejects(L.dep.applyEvent(projectId, d.id, { type: "status", status: "verified" as never }), /Invalid status/);

  await L.dep.applyEvent(projectId, d.id, { type: "collection", address: OTHER, uri: "https://example.com/collection.json", signature: SIG });
  await L.dep.applyEvent(projectId, d.id, { type: "minting", items: t.map((tokenId) => ({ tokenId, asset: ASSET })) });
  let rec = await L.dep.applyEvent(projectId, d.id, { type: "minted", items: t.slice(0, 2).map((tokenId) => ({ tokenId, asset: ASSET, signature: SIG })) });
  assert.equal(rec.collection.address, OTHER);
  assert.deepEqual(rec.items.map((i) => i.state), ["minted", "minted", "minting"]);
  assert.deepEqual(rec.txs.find((x) => x.kind === "mint")!.tokens, t.slice(0, 2));
  rec = await L.dep.applyEvent(projectId, d.id, { type: "failed", items: [{ tokenId: t[2], error: "blockhash expired" }] });
  assert.equal(rec.items[2].state, "failed");
  // A resumed plan only contains what's left to do.
  const plan = await L.dep.buildPlan(projectId, d.id);
  assert.equal(plan.collection.address, OTHER);
  assert.deepEqual(plan.tokens.map((x) => x.state), ["minted", "minted", "failed"]);
});
