import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import sharp from "sharp";

process.env.NFT_FORGE_DATA = mkdtempSync(path.join(os.tmpdir(), "forge-rh-test-"));

type Mods = {
  store: typeof import("../src/lib/store");
  collection: typeof import("../src/lib/collection");
  assets: typeof import("../src/lib/assets");
  render: typeof import("../src/lib/render");
  evm: typeof import("../src/lib/evm-deployments");
};
let M: Mods;
let pid: string;
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const ORIGIN = "http://localhost:3000";

before(async () => {
  M = {
    store: await import("../src/lib/store"),
    collection: await import("../src/lib/collection"),
    assets: await import("../src/lib/assets"),
    render: await import("../src/lib/render"),
    evm: await import("../src/lib/evm-deployments"),
  };
  const p = await M.store.createProject({ name: "RH Test", concept: "", supply: 12, style: "", chain: "robinhood", mode: "2d" });
  pid = p.id;
  // Tiny real artwork so renders (and therefore the provenance hash) exist.
  const png = (r: number, g: number, b: number, a = 1) =>
    sharp({ create: { width: 64, height: 64, channels: 4, background: { r, g, b, alpha: a } } }).png().toBuffer();
  const bg = await Promise.all([0, 1, 2, 3].map(async (i) => (await M.assets.ingestAsset(pid, await png(i * 60, 20, 90), `bg${i}.png`)).asset.id));
  // Semi-transparent overlays, so every combination renders a distinct image.
  const fg = await Promise.all([0, 1, 2, 3].map(async (i) => (await M.assets.ingestAsset(pid, await png(255, i * 60, 0, 0.5), `fg${i}.png`)).asset.id));
  await M.store.updateProject(pid, (x) => {
    x.canvas = { width: 64, height: 64, format: "png" };
    x.config.categories = [
      { id: "bg", name: "Background", required: true, noneWeight: 0, layer: 0, traits: bg.map((a, i) => ({ id: `bg${i}`, name: `Bg ${i}`, weight: 1, assetId: a })) },
      { id: "fg", name: "Thing", required: true, noneWeight: 0, layer: 1, traits: fg.map((a, i) => ({ id: `fg${i}`, name: `Thing ${i}`, weight: 1, assetId: a })) },
    ];
  });
  await M.collection.generateForProject(pid);
  const project = await M.store.getProject(pid);
  const r = await new M.render.LayerRenderer(project).init();
  for (const n of (await M.store.getCollection(pid))!.nfts) await r.renderToDisk(n);
});

test("testnet deployment: provenance from real renders, preview metadata, sane params", async () => {
  await assert.rejects(M.evm.createEvmDeployment(pid, { mode: "test", wallet: "0xnope" }, ORIGIN), /wallet/i);
  const d = await M.evm.createEvmDeployment(pid, { mode: "test", wallet: WALLET, testCount: 5 }, ORIGIN);
  assert.equal(d.network, "robinhood-testnet");
  assert.equal(d.mintTarget, 5);
  assert.equal(d.params.maxSupply, 12);
  assert.equal(d.params.startTokenId, 1);
  assert.equal(d.params.baseURI, `${ORIGIN}/api/projects/${pid}/metadata/`);
  assert.equal(d.params.owner, WALLET);
  assert.equal(d.params.royaltyReceiver, WALLET);
  // Recompute the provenance independently from the files on disk.
  const project = await M.store.getProject(pid);
  const nfts = (await M.store.getCollection(pid))!.nfts.sort((a, b) => a.tokenId - b.tokenId);
  const hashes: string[] = [];
  for (const n of nfts) hashes.push(createHash("sha256").update(readFileSync((await M.render.existingRender(project, n))!)).digest("hex"));
  assert.equal(d.params.provenanceHash, `0x${createHash("sha256").update(hashes.join("")).digest("hex")}`);
});

test("constructor arguments line up with the compiled contract's ABI", async () => {
  const artifact = JSON.parse(readFileSync("src/lib/evm/ForgeCollection.artifact.json", "utf8")) as {
    abi: { type: string; inputs: { name: string; type: string; components?: { name: string }[] }[] }[];
  };
  const ctor = artifact.abi.find((x) => x.type === "constructor")!;
  assert.equal(ctor.inputs.length, 1);
  const d = await M.evm.createEvmDeployment(pid, { mode: "test", wallet: WALLET, testCount: 1 }, ORIGIN);
  const [init] = M.evm.constructorArgs(d.params);
  assert.deepEqual(Object.keys(init), ctor.inputs[0].components!.map((c) => c.name), "InitParams fields in ABI order");
  assert.equal(typeof init.maxSupply, "bigint");
  assert.equal(init.provenanceHash, d.params.provenanceHash);
  // No public sale configured: the creator mints the whole supply.
  assert.equal(d.params.reserved, d.params.maxSupply);
  assert.equal(d.params.unrevealedURI, "");
  assert.equal(d.params.payout, WALLET);
});

test("mainnet is gated: readiness, permanent hosting, typed name, single-use approval", async () => {
  await assert.rejects(M.evm.createEvmDeployment(pid, { mode: "production", wallet: WALLET }, ORIGIN), /readiness/);
  await assert.rejects(M.evm.approveEvmProduction(pid, { wallet: WALLET, confirmName: "nope", baseURI: "ipfs://x/", contractURI: "ipfs://x/c.json" }), /Type the collection name/);
  await assert.rejects(
    M.evm.approveEvmProduction(pid, { wallet: WALLET, confirmName: "RH Test", baseURI: "http://localhost:3000/meta/", contractURI: "ipfs://x/c.json" }),
    /permanently hosted/,
  );
  await assert.rejects(M.evm.approveEvmProduction(pid, { wallet: WALLET, confirmName: "RH Test", baseURI: "ipfs://x/", contractURI: "ipfs://x/c.json" }), /Not ready/);
  const r = await M.evm.evmReadiness(pid);
  const ok = Object.fromEntries(r.checks.map((c) => [c.id, c.ok]));
  assert.equal(ok.chain, true);
  assert.equal(ok.rendered, true);
  assert.equal(ok.locked, false);
  assert.equal(ok.test, false);
});

test("deployment events are validated and recorded", async () => {
  const d = await M.evm.createEvmDeployment(pid, { mode: "test", wallet: WALLET, testCount: 5, batchSize: 2 }, ORIGIN);
  await assert.rejects(M.evm.applyEvmEvent(pid, d.id, { type: "deployed", address: "0x123" as `0x${string}`, tx: TX(1) }), /Invalid/);
  await assert.rejects(M.evm.applyEvmEvent(pid, d.id, { type: "mint-sent", tx: TX(2), firstTokenId: 1, quantity: 6 }), /outside/); // 6 > reserve target 5
  await assert.rejects(M.evm.applyEvmEvent(pid, d.id, { type: "mint-sent", tx: TX(2), firstTokenId: 12, quantity: 2 }), /outside/); // #13 > supply 12
  await assert.rejects(M.evm.applyEvmEvent(pid, d.id, { type: "mint-confirmed", tx: TX(99) }), /Unknown mint/);
  await M.evm.applyEvmEvent(pid, d.id, { type: "deploy-sent", tx: TX(1) });
  let rec = await M.evm.applyEvmEvent(pid, d.id, { type: "deployed", address: OTHER, tx: TX(1) });
  assert.equal(rec.contract, OTHER);
  await M.evm.applyEvmEvent(pid, d.id, { type: "mint-sent", tx: TX(3), firstTokenId: 1, quantity: 2 });
  await M.evm.applyEvmEvent(pid, d.id, { type: "mint-sent", tx: TX(3), firstTokenId: 1, quantity: 2 }); // idempotent
  rec = await M.evm.applyEvmEvent(pid, d.id, { type: "mint-confirmed", tx: TX(3) });
  assert.equal(rec.mints.length, 1);
  assert.equal(rec.mints[0].status, "confirmed");
  await assert.rejects(M.evm.applyEvmEvent(pid, d.id, { type: "status", status: "verified" as never }), /Invalid status/);
});

test("non-Robinhood projects are refused", async () => {
  await M.store.updateProject(pid, (p) => void (p.chain = "solana"));
  await assert.rejects(M.evm.createEvmDeployment(pid, { mode: "test", wallet: WALLET }, ORIGIN), /Robinhood Chain/);
  await M.store.updateProject(pid, (p) => void (p.chain = "robinhood"));
});
