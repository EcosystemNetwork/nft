// ForgeCollection contract tests on an in-process EVM (Hardhat EDR, Cancun).
// Contracts are compiled by `npm run compile:contracts`; this file deploys the
// committed artifacts, so it tests the exact bytecode the app deploys.
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeErrorResult,
  encodeAbiParameters,
  encodeDeployData,
  getAddress,
  keccak256,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { hardhat } from "viem/chains";
import artifact from "../src/lib/evm/ForgeCollection.artifact.json";
import attackerArtifact from "./ReentrantMinter.artifact.json";
import { allowlistProof, allowlistRoot, parseAllowlist, type AllowlistEntry } from "../src/lib/evm/allowlist";

const ABI = artifact.abi as Abi;
type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
let provider: Provider;
let accounts: Address[];
let pub: ReturnType<typeof createPublicClient>;
let OWNER: Address, ALICE: Address, BOB: Address, CAROL: Address, PAYOUT: Address;

const wallet = (account: Address) => createWalletClient({ account, chain: hardhat, transport: custom(provider) });
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const SECRET = `0x${"ab".repeat(32)}` as Hex;
const commitment = (s: Hex) => keccak256(encodeAbiParameters([{ type: "bytes32" }], [s]));

interface Init {
  maxSupply?: number;
  startTokenId?: number;
  reserved?: number;
  unrevealedURI?: string;
  revealCommitment?: Hex;
}
function initArgs(o: Init) {
  const maxSupply = o.maxSupply ?? 100;
  return [
      {
        name: "Test",
        symbol: "TST",
        baseURI: "ipfs://base/",
        contractURI: "ipfs://base/collection.json",
        unrevealedURI: o.unrevealedURI ?? "",
        maxSupply: BigInt(maxSupply),
        startTokenId: BigInt(o.startTokenId ?? 1),
        reserved: BigInt(o.reserved ?? 10),
        royaltyReceiver: OWNER,
        royaltyBps: 500n,
        provenanceHash: keccak256("0x01"),
        revealCommitment: o.revealCommitment ?? ZERO32,
        payout: PAYOUT,
        owner: OWNER,
      },
    ] as const;
}
async function deploy(o: Init = {}) {
  const hash = await wallet(OWNER).deployContract({ abi: ABI, bytecode: artifact.bytecode as Hex, args: initArgs(o) });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress!;
}
/** Constructor reverts aren't decoded by deployContract; simulate and decode the custom error. */
async function deployReverts(o: Init, errorName: string) {
  const data = encodeDeployData({ abi: ABI, bytecode: artifact.bytecode as Hex, args: initArgs(o) });
  const raw = (await provider
    .request({ method: "eth_call", params: [{ from: OWNER, data }, "latest"] })
    .then(() => null, (e: { data?: Hex | { data?: Hex } }) => (typeof e.data === "string" ? e.data : e.data?.data))) as Hex | null;
  assert.ok(raw, `expected constructor to revert with ${errorName}`);
  assert.equal(decodeErrorResult({ abi: ABI, data: raw }).errorName, errorName);
}

const read = <T>(address: Address, functionName: string, args: unknown[] = []) =>
  pub.readContract({ address, abi: ABI, functionName, args }) as Promise<T>;
async function write(from: Address, address: Address, functionName: string, args: unknown[] = [], value = 0n) {
  const hash = await wallet(from).writeContract({ address, abi: ABI, functionName, args, value, chain: hardhat });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success");
  return r;
}
async function reverts(p: Promise<unknown>, errorName: string) {
  await assert.rejects(p, (e: Error) => {
    assert.match(e.message, new RegExp(errorName), `expected ${errorName}, got: ${e.message.slice(0, 300)}`);
    return true;
  });
}
const now = async () => Number((await pub.getBlock()).timestamp);
async function warp(to: number) {
  await provider.request({ method: "evm_setNextBlockTimestamp", params: [to] });
  await provider.request({ method: "evm_mine", params: [] });
}
const phase = (p: Partial<{ start: number; end: number; price: bigint; maxPerWallet: number; cap: number; merkleRoot: Hex }>) => ({
  start: BigInt(p.start ?? 0),
  end: BigInt(p.end ?? 0),
  price: p.price ?? 0n,
  maxPerWallet: p.maxPerWallet ?? 0,
  cap: p.cap ?? 0,
  merkleRoot: p.merkleRoot ?? ZERO32,
});
const mint = (from: Address, c: Address, phaseId: number, qty: number, value = 0n, allowance = 0, proof: Hex[] = []) =>
  write(from, c, "mint", [BigInt(phaseId), BigInt(qty), BigInt(allowance), proof], value);

before(async () => {
  // Dynamic import: Hardhat is ESM with top-level await; this package compiles tests as CJS.
  const { network } = await import("hardhat");
  provider = (await network.connect()).provider as unknown as Provider;
  pub = createPublicClient({ chain: hardhat, transport: custom(provider) });
  accounts = ((await provider.request({ method: "eth_accounts" })) as string[]).map((a) => getAddress(a));
  [OWNER, ALICE, BOB, CAROL, PAYOUT] = accounts;
});

describe("construction", () => {
  test("rejects invalid configs", async () => {
    await deployReverts({ maxSupply: 0 }, "InvalidConfig");
    await deployReverts({ maxSupply: 5, reserved: 6 }, "InvalidConfig");
    // Delayed reveal needs both a placeholder and a commitment.
    await deployReverts({ unrevealedURI: "ipfs://hidden.json" }, "InvalidConfig");
    await deployReverts({ revealCommitment: commitment(SECRET) }, "InvalidConfig");
    await deploy(); // sanity: the default config deploys
  });

  test("interfaces: ERC-721, ERC-2981, ERC-4906", async () => {
    const c = await deploy();
    for (const id of ["0x80ac58cd", "0x2a55205a", "0x49064906", "0x5b5e139f"]) assert.equal(await read(c, "supportsInterface", [id]), true, id);
  });
});

describe("owner minting (team reserve)", () => {
  test("reserve = full supply reproduces the creator-mints-everything flow", async () => {
    const c = await deploy({ maxSupply: 30, reserved: 30 });
    await write(OWNER, c, "mintBatch", [OWNER, 25n]);
    await write(OWNER, c, "airdrop", [[ALICE, BOB, CAROL, ALICE, BOB]]);
    assert.equal(await read(c, "totalSupply"), 30n);
    assert.equal(await read(c, "ownerOf", [26n]), ALICE);
    assert.equal(await read(c, "tokenURI", [30n]), "ipfs://base/30.json");
    await reverts(write(OWNER, c, "mintBatch", [OWNER, 1n]), "ReserveExceeded");
  });

  test("reserve caps owner mints; only the owner can mint it", async () => {
    const c = await deploy({ reserved: 5 });
    await reverts(write(ALICE, c, "mintBatch", [ALICE, 1n]), "OwnableUnauthorizedAccount");
    await reverts(write(OWNER, c, "mintBatch", [OWNER, 6n]), "ReserveExceeded");
    await reverts(write(OWNER, c, "mintBatch", [OWNER, 0n]), "ZeroQuantity");
    await write(OWNER, c, "mintBatch", [OWNER, 5n]);
    assert.equal(await read(c, "reserveMinted"), 5n);
  });

  test("reserve can only shrink, never below what was minted", async () => {
    const c = await deploy({ maxSupply: 20, reserved: 10 });
    await write(OWNER, c, "mintBatch", [OWNER, 4n]);
    await reverts(write(OWNER, c, "reduceReserve", [11n]), "InvalidConfig");
    await reverts(write(OWNER, c, "reduceReserve", [3n]), "InvalidConfig");
    assert.equal(await read(c, "publicRemaining"), 10n);
    await write(OWNER, c, "reduceReserve", [4n]);
    assert.equal(await read(c, "publicRemaining"), 16n);
  });
});

describe("public sale", () => {
  test("price, window, wallet limit, per-tx limit, phase cap, pause", async () => {
    const c = await deploy({ maxSupply: 200, reserved: 10 });
    const t = await now();
    const price = parseEther("0.01");
    await reverts(write(ALICE, c, "setPhase", [0n, phase({ start: t })]), "OwnableUnauthorizedAccount");
    await reverts(write(OWNER, c, "setPhase", [1n, phase({ start: t })]), "InvalidPhase");
    await reverts(write(OWNER, c, "setPhase", [0n, phase({ start: t + 10, end: t + 10 })]), "InvalidConfig");
    await write(OWNER, c, "setPhase", [0n, phase({ start: t + 100, end: t + 1000, price, maxPerWallet: 60, cap: 70 })]);

    await reverts(mint(ALICE, c, 0, 1, price), "PhaseNotActive");
    await warp(t + 100);
    await reverts(mint(ALICE, c, 0, 1, 0n), "WrongPayment");
    await reverts(mint(ALICE, c, 0, 1, price * 2n), "WrongPayment"); // no silent overpay
    await reverts(mint(ALICE, c, 0, 0, 0n), "ZeroQuantity");
    await reverts(mint(ALICE, c, 0, 51, price * 51n), "TooManyPerTx");
    await reverts(mint(ALICE, c, 1, 1, price), "InvalidPhase");

    const r = await mint(ALICE, c, 0, 50, price * 50n);
    assert.ok(r.gasUsed < 3_000_000n, `50-token mint used ${r.gasUsed} gas`);
    await reverts(mint(ALICE, c, 0, 11, price * 11n), "WalletLimitExceeded");
    await mint(ALICE, c, 0, 10, price * 10n);
    await reverts(mint(BOB, c, 0, 11, price * 11n), "PhaseCapExceeded");

    await write(OWNER, c, "setPaused", [true]);
    await reverts(mint(BOB, c, 0, 1, price), "SalePaused");
    await write(OWNER, c, "setPaused", [false]);
    await mint(BOB, c, 0, 10, price * 10n);
    assert.equal(await read(c, "phaseMinted", [0n]), 70n);
    assert.equal(await read(c, "mintedInPhase", [0n, ALICE]), 60n);
    // Public mints start after nothing was reserved-minted: token IDs are sequential from 1.
    assert.equal(await read(c, "ownerOf", [1n]), ALICE);
    assert.equal(await read(c, "ownerOf", [70n]), BOB);
    assert.equal(await pub.getBalance({ address: c }), price * 70n);

    await warp(t + 1000);
    await reverts(mint(CAROL, c, 0, 1, price), "PhaseNotActive");
  });

  test("public sale can never eat into the unminted reserve", async () => {
    const c = await deploy({ maxSupply: 20, reserved: 5 });
    await write(OWNER, c, "setPhase", [0n, phase({ start: 0 })]);
    await mint(ALICE, c, 0, 15);
    await reverts(mint(BOB, c, 0, 1), "MaxSupplyExceeded");
    await write(OWNER, c, "mintBatch", [OWNER, 5n]);
    assert.equal(await read(c, "totalSupply"), 20n);
  });

  test("allowlist phase: proofs, allowances, wrong claims", async () => {
    const c = await deploy({ maxSupply: 100, reserved: 0 });
    const { entries, errors } = parseAllowlist(`address,allowance\n${ALICE},3\n${BOB.toLowerCase()}\n${ALICE},2\nnot-an-address,1`);
    assert.equal(errors.length, 1);
    assert.deepEqual(
      entries.map((e) => e.allowance),
      [3, 1],
      "duplicate keeps the larger allowance, default allowance 1",
    );
    const root = allowlistRoot(entries);
    await write(OWNER, c, "setPhase", [0n, phase({ start: 0, price: 1000n, merkleRoot: root })]);

    const a = allowlistProof(entries, ALICE)!;
    const b = allowlistProof(entries, BOB)!;
    assert.equal(allowlistProof(entries, CAROL), null);
    await reverts(mint(CAROL, c, 0, 1, 1000n, 1, a.proof), "NotAllowlisted");
    await reverts(mint(ALICE, c, 0, 1, 1000n, 5, a.proof), "NotAllowlisted"); // claiming a bigger allowance
    await reverts(mint(BOB, c, 0, 1, 1000n, a.allowance, a.proof), "NotAllowlisted"); // someone else's proof
    await reverts(mint(ALICE, c, 0, 1, 1000n, 0, a.proof), "NotAllowlisted");
    await mint(ALICE, c, 0, 2, 2000n, a.allowance, a.proof);
    await reverts(mint(ALICE, c, 0, 2, 2000n, a.allowance, a.proof), "WalletLimitExceeded");
    await mint(ALICE, c, 0, 1, 1000n, a.allowance, a.proof);
    await mint(BOB, c, 0, 1, 1000n, b.allowance, b.proof);
    assert.equal(await read(c, "totalSupply"), 4n);
  });

  test("allowlist of many wallets", async () => {
    const entries: AllowlistEntry[] = Array.from({ length: 2000 }, (_, i) => ({
      address: `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
      allowance: (i % 3) + 1,
    }));
    entries.push({ address: CAROL, allowance: 2 });
    const c = await deploy({ reserved: 0 });
    await write(OWNER, c, "setPhase", [0n, phase({ start: 0, merkleRoot: allowlistRoot(entries) })]);
    const p = allowlistProof(entries, CAROL)!;
    assert.equal(p.allowance, 2);
    await mint(CAROL, c, 0, 2, 0n, 2, p.proof);
  });

  test("withdraw sends proceeds to the payout address only", async () => {
    const c = await deploy({ reserved: 0 });
    await write(OWNER, c, "setPhase", [0n, phase({ start: 0, price: parseEther("1") })]);
    await reverts(write(OWNER, c, "withdraw"), "NothingToWithdraw");
    await mint(ALICE, c, 0, 3, parseEther("3"));
    await reverts(write(ALICE, c, "withdraw"), "OwnableUnauthorizedAccount");
    const before = await pub.getBalance({ address: PAYOUT });
    await write(OWNER, c, "withdraw");
    assert.equal((await pub.getBalance({ address: PAYOUT })) - before, parseEther("3"));
    assert.equal(await pub.getBalance({ address: c }), 0n);
    await reverts(write(OWNER, c, "setPayoutAddress", ["0x0000000000000000000000000000000000000000"]), "InvalidConfig");
  });

  test("re-entering mint from the receive hook is blocked", async () => {
    const c = await deploy({ reserved: 0 });
    await write(OWNER, c, "setPhase", [0n, phase({ start: 0, maxPerWallet: 1 })]);
    const hash = await wallet(OWNER).deployContract({ abi: attackerArtifact.abi as Abi, bytecode: attackerArtifact.bytecode as Hex, args: [c] });
    const attacker = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
    const tx = await wallet(OWNER).writeContract({ address: attacker, abi: attackerArtifact.abi as Abi, functionName: "attack", args: [0n], chain: hardhat });
    assert.equal((await pub.waitForTransactionReceipt({ hash: tx })).status, "success");
    const r = (fn: string) => pub.readContract({ address: attacker, abi: attackerArtifact.abi as Abi, functionName: fn }) as Promise<boolean>;
    assert.equal(await r("attempted"), true);
    assert.equal(await r("reentered"), false);
    assert.equal(await read(c, "balanceOf", [attacker]), 1n);
  });
});

describe("delayed reveal", () => {
  const offsetFor = async (c: Address, secret: Hex, n: number) =>
    Number(BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [secret, await read<Hex>(c, "revealEntropy")]))) % BigInt(n));

  test("placeholder until reveal; offset checked; artwork mapping is a bijection; freeze only after reveal", async () => {
    const N = 37;
    const c = await deploy({ maxSupply: N, startTokenId: 1, reserved: 2, unrevealedURI: "ipfs://hidden/hidden.json", revealCommitment: commitment(SECRET) });
    await write(OWNER, c, "setPhase", [0n, phase({ start: 0 })]);
    await write(OWNER, c, "mintBatch", [OWNER, 2n]);
    await mint(ALICE, c, 0, 20);
    await mint(BOB, c, 0, 15);
    assert.equal(await read(c, "tokenURI", [5n]), "ipfs://hidden/hidden.json");
    await reverts(write(OWNER, c, "freezeMetadata"), "InvalidConfig");
    await reverts(write(OWNER, c, "reveal", [`0x${"cd".repeat(32)}`, "ipfs://revealed/", 0n]), "BadRevealSecret");
    await reverts(write(ALICE, c, "reveal", [SECRET, "ipfs://revealed/", 0n]), "OwnableUnauthorizedAccount");

    // The creator computes the offset off-chain (to build the revealed metadata) before revealing.
    const offset = await offsetFor(c, SECRET, N);
    await reverts(write(OWNER, c, "reveal", [SECRET, "ipfs://revealed/", BigInt((offset + 1) % N)]), "OffsetMismatch");
    const r = await write(OWNER, c, "reveal", [SECRET, "ipfs://revealed/", BigInt(offset)]);
    assert.ok(r.logs.length >= 2, "Revealed + BatchMetadataUpdate");
    await reverts(write(OWNER, c, "reveal", [SECRET, "ipfs://revealed/", BigInt(offset)]), "AlreadyRevealed");
    assert.equal(Number(await read<bigint>(c, "revealOffset")), offset);

    const seen = new Set<number>();
    for (let id = 1; id <= N; id++) {
      const art = Number(await read<bigint>(c, "artworkId", [BigInt(id)]));
      assert.equal(art, 1 + ((id - 1 + offset) % N));
      seen.add(art);
    }
    assert.equal(seen.size, N, "every artwork used exactly once");
    assert.equal(await read(c, "tokenURI", [5n]), "ipfs://revealed/5.json");
    await write(OWNER, c, "freezeMetadata");
    await reverts(write(OWNER, c, "setBaseURI", ["ipfs://other/"]), "MetadataIsFrozen");
  });

  test("a mint between computing the offset and revealing makes the reveal revert", async () => {
    const c = await deploy({ maxSupply: 1000, reserved: 0, unrevealedURI: "ipfs://h.json", revealCommitment: commitment(SECRET) });
    await write(OWNER, c, "setPhase", [0n, phase({ start: 0 })]);
    await mint(ALICE, c, 0, 3);
    const stale = await offsetFor(c, SECRET, 1000);
    await mint(BOB, c, 0, 1);
    const fresh = await offsetFor(c, SECRET, 1000);
    if (stale !== fresh) await reverts(write(OWNER, c, "reveal", [SECRET, "ipfs://r/", BigInt(stale)]), "OffsetMismatch");
    await write(OWNER, c, "reveal", [SECRET, "ipfs://r/", BigInt(fresh)]);
  });

  test("offset depends on mint history, not only on the secret", async () => {
    const offsets = new Set<number>();
    for (let i = 0; i < 4; i++) {
      const c = await deploy({ maxSupply: 1000, reserved: 0, unrevealedURI: "ipfs://h.json", revealCommitment: commitment(SECRET) });
      await write(OWNER, c, "setPhase", [0n, phase({ start: 0 })]);
      await mint(accounts[5 + i], c, 0, 1 + i);
      const o = await offsetFor(c, SECRET, 1000);
      await write(OWNER, c, "reveal", [SECRET, "ipfs://r/", BigInt(o)]);
      offsets.add(o);
    }
    assert.ok(offsets.size >= 3, `offsets: ${[...offsets]}`);
  });
});

test("randomized invariants across mixed owner/public activity", async () => {
  // Deterministic PRNG so failures reproduce.
  let s = 0x9e3779b9;
  const rnd = (n: number) => ((s = (s * 1664525 + 1013904223) >>> 0) % n);
  const max = 120;
  const reserve = 20;
  const c = await deploy({ maxSupply: max, reserved: reserve });
  const price = 7n;
  await write(OWNER, c, "setPhase", [0n, phase({ start: 0, price, maxPerWallet: 40 })]);
  await write(OWNER, c, "setPhase", [1n, phase({ start: 0, price: 0n, cap: 15 })]);
  const buyers = accounts.slice(1, 8);
  let paid = 0n;
  let expected = 0;
  for (let step = 0; step < 80; step++) {
    const kind = rnd(4);
    const qty = 1 + rnd(12);
    try {
      if (kind === 0) {
        await write(OWNER, c, "mintBatch", [OWNER, BigInt(qty)]);
      } else {
        const ph = kind === 3 ? 1 : 0;
        const v = ph === 0 ? price * BigInt(qty) : 0n;
        await mint(buyers[rnd(buyers.length)], c, ph, qty, v);
        paid += v;
      }
      expected += qty;
    } catch (e) {
      assert.match((e as Error).message, /ReserveExceeded|MaxSupplyExceeded|WalletLimitExceeded|PhaseCapExceeded/);
    }
    const [total, rm, p0, p1, pubLeft] = await Promise.all([
      read<bigint>(c, "totalMinted"),
      read<bigint>(c, "reserveMinted"),
      read<bigint>(c, "phaseMinted", [0n]),
      read<bigint>(c, "phaseMinted", [1n]),
      read<bigint>(c, "publicRemaining"),
    ]);
    assert.equal(Number(total), expected);
    assert.equal(total, rm + p0 + p1, "every token is accounted to the reserve or a phase");
    assert.ok(rm <= BigInt(reserve) && p1 <= 15n && total <= BigInt(max));
    assert.equal(pubLeft, BigInt(max) - total - (BigInt(reserve) - rm));
    assert.equal(await pub.getBalance({ address: c }), paid);
  }
  assert.ok(expected > 60, `exercised ${expected} mints`);
});
