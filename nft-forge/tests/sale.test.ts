// Public sale + delayed reveal: server configuration, proofs and reveal math checked
// against the real ForgeCollection bytecode on an in-process EVM.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import sharp from "sharp";
import { createPublicClient, createWalletClient, custom, getAddress, parseEther, type Abi, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";
import artifact from "../src/lib/evm/ForgeCollection.artifact.json";

process.env.NFT_FORGE_DATA = mkdtempSync(path.join(os.tmpdir(), "forge-sale-test-"));

type Mods = {
  store: typeof import("../src/lib/store");
  collection: typeof import("../src/lib/collection");
  assets: typeof import("../src/lib/assets");
  render: typeof import("../src/lib/render");
  evm: typeof import("../src/lib/evm-deployments");
  sale: typeof import("../src/lib/sale");
  types: typeof import("../src/lib/evm/types");
  meta: typeof import("../src/lib/engine/metadata");
};
let M: Mods;
let pid: string;
const ABI = artifact.abi as Abi;
const ORIGIN = "http://localhost:3000";
type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
let provider: Provider;
let pub: ReturnType<typeof createPublicClient>;
let OWNER: Address, ALICE: Address, BOB: Address, CAROL: Address;

before(async () => {
  M = {
    store: await import("../src/lib/store"),
    collection: await import("../src/lib/collection"),
    assets: await import("../src/lib/assets"),
    render: await import("../src/lib/render"),
    evm: await import("../src/lib/evm-deployments"),
    sale: await import("../src/lib/sale"),
    types: await import("../src/lib/evm/types"),
    meta: await import("../src/lib/engine/metadata"),
  };
  const { network } = await import("hardhat");
  provider = (await network.connect()).provider as unknown as Provider;
  pub = createPublicClient({ chain: hardhat, transport: custom(provider) });
  [OWNER, ALICE, BOB, CAROL] = ((await provider.request({ method: "eth_accounts" })) as string[]).map((a) => getAddress(a));

  const p = await M.store.createProject({ name: "Sale Test", concept: "", supply: 12, style: "", chain: "robinhood", mode: "2d" });
  pid = p.id;
  const png = (r: number, g: number, b: number, a = 1) => sharp({ create: { width: 64, height: 64, channels: 4, background: { r, g, b, alpha: a } } }).png().toBuffer();
  const bg = await Promise.all([0, 1, 2, 3].map(async (i) => (await M.assets.ingestAsset(pid, await png(i * 60, 20, 90), `bg${i}.png`)).asset.id));
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

const iso = (secondsFromEpoch: number) => new Date(secondsFromEpoch * 1000).toISOString();

test("sale configuration is validated", async () => {
  await assert.rejects(M.sale.updateSale(pid, { enabled: true, reserved: 2, phases: [] }), /at least one sale phase/);
  await assert.rejects(M.sale.updateSale(pid, { enabled: true, reserved: 13, phases: [] }), /Reserve must be 0–12/);
  const phase = { id: "", name: "Public", start: iso(0), end: iso(0), priceWei: "1", maxPerWallet: 0, cap: 0, allowlist: null };
  await assert.rejects(M.sale.updateSale(pid, { enabled: true, reserved: 2, phases: [phase] }), /end must be after start/);
  await assert.rejects(M.sale.updateSale(pid, { enabled: true, reserved: 2, phases: [{ ...phase, end: null, priceWei: "0.1" }] }), /invalid price/);
  await assert.rejects(M.sale.updateSale(pid, { enabled: true, reserved: 12, phases: [{ ...phase, end: null }] }), /nothing is left to sell/);
  // Failed updates don't persist anything.
  assert.equal((await M.sale.getSale(pid)).enabled, false);
});

test("allowlist + public phases, delayed reveal: server and contract agree end to end", async () => {
  const list = (await import("../src/lib/evm/allowlist")).parseAllowlist(`${ALICE},2\n${BOB}`);
  const sale = await M.sale.updateSale(pid, {
    enabled: true,
    reserved: 2,
    delayedReveal: true,
    phases: [
      { id: "", name: "Allowlist", start: iso(0), end: null, priceWei: parseEther("0.01").toString(), maxPerWallet: 0, cap: 0, allowlist: list.entries },
      { id: "", name: "Public", start: iso(0), end: null, priceWei: parseEther("0.02").toString(), maxPerWallet: 3, cap: 0, allowlist: null },
    ],
  });
  assert.equal(sale.phases.length, 2);
  assert.match(sale.phases[0].id, /^ph_/);

  const d = await M.evm.createEvmDeployment(pid, { mode: "test", wallet: OWNER, testCount: 25 }, ORIGIN);
  assert.equal(d.params.reserved, 2);
  assert.equal(d.mintTarget, 2, "test mints are capped at the reserve");
  assert.equal(d.params.baseURI, "", "no revealed metadata until reveal");
  assert.equal(d.params.unrevealedURI, `${ORIGIN}/api/projects/${pid}/metadata/unrevealed.json`);
  const secret = (await M.evm.revealSecret(pid, d.id)) as Hex;
  assert.equal(d.params.revealCommitment, M.evm.revealCommitmentOf(secret));
  // The secret never appears in listings or the deployment record.
  assert.ok(!JSON.stringify(await M.evm.listEvmDeployments(pid)).includes(secret.slice(2)));

  // Deploy exactly what the browser would deploy.
  const w = (a: Address) => createWalletClient({ account: a, chain: hardhat, transport: custom(provider) });
  const hash = await w(OWNER).deployContract({ abi: ABI, bytecode: artifact.bytecode as Hex, args: M.evm.constructorArgs(d.params) });
  const c = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  const write = async (from: Address, fn: string, args: unknown[], value = 0n) => {
    const h = await w(from).writeContract({ address: c, abi: ABI, functionName: fn, args, value, chain: hardhat });
    assert.equal((await pub.waitForTransactionReceipt({ hash: h })).status, "success");
  };
  const read = <T>(fn: string, args: unknown[] = []) => pub.readContract({ address: c, abi: ABI, functionName: fn, args }) as Promise<T>;

  // Phases as the server encodes them.
  for (const [i, p] of sale.phases.entries()) await write(OWNER, "setPhase", [BigInt(i), M.sale.phaseOnChain(p)]);
  const a = M.sale.phaseProof(sale.phases[0], ALICE)!;
  assert.equal(a.allowance, 2);
  assert.equal(M.sale.phaseProof(sale.phases[0], CAROL), null);
  await write(ALICE, "mint", [0n, 2n, BigInt(a.allowance), a.proof], parseEther("0.02"));
  const b = M.sale.phaseProof(sale.phases[0], BOB.toLowerCase())!; // lookups are case-insensitive
  await write(BOB, "mint", [0n, 1n, BigInt(b.allowance), b.proof], parseEther("0.01"));
  await write(CAROL, "mint", [1n, 3n, 0n, []], parseEther("0.06"));
  await write(OWNER, "mintBatch", [OWNER, 2n]);
  assert.equal(await read("totalMinted"), 8n);
  assert.equal(await read("tokenURI", [1n]), d.params.unrevealedURI);

  // Reveal with the server's offset math; the contract must accept it.
  const entropy = await read<Hex>("revealEntropy");
  const offset = M.evm.revealOffsetOf(secret, entropy, 12);
  const base = `${ORIGIN}/api/projects/${pid}/revealed/${d.id}/`;
  await write(OWNER, "reveal", [secret, base, BigInt(offset)]);
  assert.equal(Number(await read<bigint>("revealOffset")), offset);
  for (let t = 1; t <= 12; t++) assert.equal(Number(await read<bigint>("artworkId", [BigInt(t)])), M.meta.artworkIdFor(t, 1, 12, offset));

  // Revealed metadata: token N carries artwork artworkId(N) under its own name.
  const project = await M.store.getProject(pid);
  const nfts = (await M.store.getCollection(pid))!.nfts;
  const art = nfts.find((n) => n.tokenId === M.meta.artworkIdFor(3, 1, 12, offset))!;
  const meta = M.meta.buildRevealedTokenMetadata(project.metadata, project.config.categories, project.canvas, art, 3);
  assert.equal(meta.name, "Sale Test #3");
  assert.deepEqual(meta.attributes, M.meta.buildTokenMetadata(project.metadata, project.config.categories, project.canvas, art).attributes);
});

test("readiness requires the testnet run to match the sale mode", async () => {
  const r = await M.evm.evmReadiness(pid);
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(byId.sale.ok, true);
  assert.equal(byId.unrevealed.ok, false, "placeholder not packed on IPFS yet");
  assert.equal(byId.test.ok, false);
});

test("public views never include allowlist contents", async () => {
  const s = await M.sale.getSale(pid);
  const view = JSON.stringify(M.sale.publicPhases(s));
  assert.ok(!view.toLowerCase().includes(ALICE.slice(2).toLowerCase()));
  assert.match(view, /"allowlistSize":2/);
});
