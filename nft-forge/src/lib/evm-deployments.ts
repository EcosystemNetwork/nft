import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createPublicClient, encodeAbiParameters, http, keccak256, type Abi, type Hex } from "viem";
import { contentFingerprint } from "./deployments";
import { artworkIdFor, buildCollectionMetadata, buildRevealedTokenMetadata, buildTokenMetadata, joinUri } from "./engine/metadata";
import { EVM_CHAINS, explorerApi, type EvmNetwork } from "./evm/chains";
import artifact from "./evm/ForgeCollection.artifact.json";
import {
  isEvmAddress,
  isTxHash,
  toInitParams,
  ZERO_HASH,
  type ContractParams,
  type EvmApproval,
  type EvmDeployment,
  type EvmEvent,
  type OnchainSale,
} from "./evm/types";
import { computeProvenance } from "./provenance";
import { getPublication } from "./publish";
import { runQa } from "./qa";
import { getSale, saleProblems } from "./sale";
import { getCollection, getProject, HttpError, newId, paths, withProjectLock } from "./store";

// ---------------------------------------------------------------------------
// Robinhood Chain deployments (server side). The creator's wallet deploys and
// mints from the browser; the server never holds keys. It gates production,
// records public results, and independently verifies the contract on-chain.
// ---------------------------------------------------------------------------

const ABI = artifact.abi as Abi;
const file = (projectId: string) => path.join(paths.project(projectId), "evm-deployments.json");
interface Store {
  deployments: EvmDeployment[];
  approvals: EvmApproval[];
}
async function load(projectId: string): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(file(projectId), "utf8")) as Store;
  } catch {
    return { deployments: [], approvals: [] };
  }
}
async function save(projectId: string, s: Store) {
  const f = file(projectId);
  const tmp = `${f}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 1));
  await fs.rename(tmp, f);
}
const lock = (id: string) => `${id}:evm`;

// Reveal secrets live in their own file so no listing or deployment response can leak them.
const secretsFile = (projectId: string) => path.join(paths.project(projectId), "evm-secrets.json");
async function loadSecrets(projectId: string): Promise<Record<string, Hex>> {
  try {
    return JSON.parse(await fs.readFile(secretsFile(projectId), "utf8"));
  } catch {
    return {};
  }
}
async function storeSecret(projectId: string, depId: string, secret: Hex) {
  const all = await loadSecrets(projectId);
  all[depId] = secret;
  const f = secretsFile(projectId);
  await fs.writeFile(`${f}.tmp`, JSON.stringify(all), { mode: 0o600 });
  await fs.rename(`${f}.tmp`, f);
}
export const revealCommitmentOf = (secret: Hex) => keccak256(encodeAbiParameters([{ type: "bytes32" }], [secret]));
export function revealOffsetOf(secret: Hex, entropy: Hex, maxSupply: number) {
  return Number(BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [secret, entropy]))) % BigInt(maxSupply));
}
/** Delayed-reveal deployments: the contract starts unrevealed. */
export const isDelayed = (d: { params: ContractParams }) => d.params.unrevealedURI !== "";
/** Public-sale deployments: part of the supply is not reserved for the owner. */
export const hasSale = (d: { params: ContractParams }) => d.params.reserved < d.params.maxSupply;
const client = (network: EvmNetwork) => createPublicClient({ chain: EVM_CHAINS[network], transport: http() });

export async function listEvmDeployments(projectId: string) {
  const s = await load(projectId);
  return { deployments: [...s.deployments].reverse(), approvals: [...s.approvals].reverse() };
}

export async function getEvmDeployment(projectId: string, id: string) {
  const d = (await load(projectId)).deployments.find((x) => x.id === id);
  if (!d) throw new HttpError(404, "Deployment not found");
  return d;
}

/** Permanent hosting for mainnet: IPFS, Arweave, or HTTPS (never localhost/plain HTTP). */
function permanentUri(u: string) {
  return /^(ipfs|ar):\/\/\S+/.test(u) || (/^https:\/\/\S+/.test(u) && !/^https:\/\/(localhost|127\.|10\.|192\.168\.)/.test(u));
}
function anyUri(u: string) {
  return /^(ipfs|ar|https?):\/\/\S+/.test(u);
}

// ---------------------------------------------------------------------- gate

export async function evmReadiness(projectId: string) {
  const project = await getProject(projectId);
  const nfts = (await getCollection(projectId))?.nfts ?? [];
  const fingerprint = contentFingerprint(project, nfts);
  const qa = await runQa(projectId, { visualDuplicates: false });
  const s = await load(projectId);
  const sale = await getSale(projectId);
  const delayed = sale.enabled && sale.delayedReveal;
  // The testnet run must exercise the same contract mode (public sale / delayed reveal) as mainnet.
  const test = [...s.deployments]
    .reverse()
    .find((d) => d.mode === "test" && d.status === "verified" && d.fingerprint === fingerprint && hasSale(d) === sale.enabled && isDelayed(d) === delayed);
  const locked = nfts.filter((n) => n.status === "locked").length;
  const problems = saleProblems(sale, project.config.supply);
  const pub = delayed ? await getPublication(projectId) : null;
  const checks = [
    { id: "chain", label: "Robinhood Chain project using ERC-721 metadata", ok: project.chain === "robinhood" && project.metadata.standard === "erc721", detail: `${project.chain} / ${project.metadata.standard}` },
    { id: "supply", label: "Full supply generated", ok: nfts.length > 0 && nfts.length === project.config.supply, detail: `${nfts.length} / ${project.config.supply}` },
    { id: "qa", label: "QA passes", ok: qa.passed, detail: qa.passed ? "No failing checks" : `${qa.checks.filter((c) => c.status === "fail").length} failing check(s)` },
    { id: "rendered", label: "All artwork rendered (needed for the provenance hash)", ok: nfts.length > 0 && qa.rendered === nfts.length, detail: `${qa.rendered} / ${nfts.length}` },
    { id: "locked", label: "Every token is locked", ok: nfts.length > 0 && locked === nfts.length, detail: `${locked} / ${nfts.length} locked` },
    {
      id: "sale",
      label: sale.enabled ? "Public sale configured" : "Mint mode: creator mints the whole supply",
      ok: problems.length === 0,
      detail: problems.length ? problems.join("; ") : sale.enabled ? `${sale.phases.length} phase(s), ${sale.reserved} reserved${delayed ? ", delayed reveal" : ""}` : "No public sale",
    },
    ...(delayed
      ? [{ id: "unrevealed", label: "Unrevealed placeholder published to IPFS", ok: Boolean(pub?.unrevealedURI), detail: pub?.unrevealedURI ?? "Pack the collection on IPFS Publishing (it includes the placeholder)" }]
      : []),
    {
      id: "test",
      label: `Verified testnet deployment of this exact content${sale.enabled ? " and sale mode" : ""}`,
      ok: Boolean(test),
      detail: test ? `${test.id} · ${test.mintTarget} reserve tokens verified` : "Run a testnet deployment, then verify it",
    },
  ];
  return { checks, ready: checks.every((c) => c.ok), fingerprint, testDeploymentId: test?.id };
}

export async function approveEvmProduction(projectId: string, input: { wallet: string; confirmName: string; baseURI: string; contractURI: string }) {
  if (!isEvmAddress(input.wallet)) throw new HttpError(400, "Connect a wallet first");
  const project = await getProject(projectId);
  if (input.confirmName !== project.metadata.collectionName) throw new HttpError(400, `Type the collection name exactly ("${project.metadata.collectionName}") to approve.`);
  if (!permanentUri(input.baseURI) || !permanentUri(input.contractURI))
    throw new HttpError(400, "Mainnet metadata must be permanently hosted (ipfs://, ar:// or public https://).");
  const r = await evmReadiness(projectId);
  if (!r.ready) throw new HttpError(409, `Not ready for mainnet: ${r.checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}`);
  return withProjectLock(lock(projectId), async () => {
    const s = await load(projectId);
    const a: EvmApproval = {
      id: newId("appr"),
      at: new Date().toISOString(),
      wallet: input.wallet as `0x${string}`,
      fingerprint: r.fingerprint,
      testDeploymentId: r.testDeploymentId!,
      baseURI: input.baseURI,
      checklist: r.checks,
    };
    s.approvals.push(a);
    await save(projectId, s);
    return a;
  });
}

// ---------------------------------------------------------------- creation

export async function createEvmDeployment(
  projectId: string,
  input: { mode: "test" | "production"; wallet: string; testCount?: number; baseURI?: string; contractURI?: string; approvalId?: string; batchSize?: number },
  origin: string,
): Promise<EvmDeployment> {
  if (!isEvmAddress(input.wallet)) throw new HttpError(400, "Connect a wallet first");
  const project = await getProject(projectId);
  if (project.chain !== "robinhood") throw new HttpError(409, "This project doesn't target Robinhood Chain. Change the chain in Settings.");
  const nfts = [...((await getCollection(projectId))?.nfts ?? [])].sort((a, b) => a.tokenId - b.tokenId);
  if (!nfts.length) throw new HttpError(409, "Generate the collection first.");
  const fingerprint = contentFingerprint(project, nfts);
  const { hash: provenanceHash } = await computeProvenance(project, nfts);
  const sale = await getSale(projectId);
  const problems = saleProblems(sale, nfts.length);
  if (problems.length) throw new HttpError(409, `Fix the sale configuration first: ${problems.join("; ")}`);
  const reserved = sale.enabled ? sale.reserved : nfts.length;
  const delayed = sale.enabled && sale.delayedReveal;

  let network: EvmNetwork = "robinhood-testnet";
  let mintTarget = reserved;
  let baseURI = input.baseURI?.trim() ?? "";
  let contractURI = input.contractURI?.trim() ?? "";
  let unrevealedURI = "";
  if (input.mode === "test") {
    mintTarget = Math.min(Math.max(sale.enabled ? 0 : 1, Math.floor(input.testCount ?? 25)), reserved);
    // Without hosted metadata, a testnet run points at this NFT Forge server's preview metadata.
    if (!baseURI) {
      baseURI = `${origin}/api/projects/${projectId}/metadata/`;
      contractURI = `${baseURI}collection.json`;
    }
    if (!anyUri(baseURI) || (contractURI && !anyUri(contractURI))) throw new HttpError(400, "Invalid metadata URI.");
    if (delayed) unrevealedURI = joinUri(baseURI, "unrevealed.json");
  } else {
    network = "robinhood";
    const r = await evmReadiness(projectId);
    if (!r.ready) throw new HttpError(409, "Mainnet deployment requires every readiness check to pass.");
    const s = await load(projectId);
    const a = s.approvals.find((x) => x.id === input.approvalId);
    if (!a) throw new HttpError(403, "Mainnet deployment requires an approval.");
    if (a.consumedBy) throw new HttpError(409, "This approval was already used.");
    if (a.fingerprint !== fingerprint) throw new HttpError(409, "The collection changed since it was approved. Approve again.");
    if (a.wallet.toLowerCase() !== input.wallet.toLowerCase()) throw new HttpError(403, "Approval was granted for a different wallet.");
    baseURI = a.baseURI;
    contractURI = input.contractURI?.trim() || joinUri(baseURI, "collection.json");
    if (!permanentUri(contractURI)) throw new HttpError(400, "Mainnet contract metadata must be permanently hosted.");
    if (delayed) {
      const pub = await getPublication(projectId);
      if (!pub?.unrevealedURI || pub.baseURI !== baseURI) throw new HttpError(409, "Publish the collection (with its unrevealed placeholder) to IPFS and approve that publication.");
      unrevealedURI = pub.unrevealedURI;
    }
  }
  // Delayed reveal: the revealed metadata (token N → artwork N + offset) is only built at reveal time.
  if (delayed) baseURI = "";
  const secret = delayed ? (`0x${randomBytes(32).toString("hex")}` as Hex) : null;

  const params: ContractParams = {
    name: project.metadata.collectionName + (input.mode === "test" ? " (Testnet)" : ""),
    symbol: project.metadata.symbol,
    baseURI,
    contractURI,
    unrevealedURI,
    maxSupply: nfts.length,
    startTokenId: nfts[0].tokenId,
    reserved,
    royaltyReceiver: input.wallet as `0x${string}`,
    royaltyBps: project.metadata.sellerFeeBasisPoints,
    provenanceHash,
    revealCommitment: secret ? revealCommitmentOf(secret) : ZERO_HASH,
    payout: sale.payout ?? (input.wallet as `0x${string}`),
    owner: input.wallet as `0x${string}`,
  };
  if (nfts.some((n, i) => n.tokenId !== params.startTokenId + i)) throw new HttpError(409, "Token IDs must be sequential to deploy.");

  return withProjectLock(lock(projectId), async () => {
    const s = await load(projectId);
    const now = new Date().toISOString();
    const d: EvmDeployment = {
      id: newId("rh"),
      projectId,
      mode: input.mode,
      network,
      wallet: input.wallet as `0x${string}`,
      status: "created",
      createdAt: now,
      updatedAt: now,
      fingerprint,
      approvalId: input.mode === "production" ? input.approvalId : undefined,
      params,
      mintTarget,
      batchSize: Math.min(Math.max(1, Math.floor(input.batchSize ?? 250)), 400),
      mints: [],
      log: [
        {
          at: now,
          level: "info",
          msg: sale.enabled
            ? `Created ${input.mode} deployment on ${EVM_CHAINS[network].name}: public sale of ${nfts.length - reserved}, reserve ${reserved} (minting ${mintTarget} now)${delayed ? ", delayed reveal" : ""}.`
            : `Created ${input.mode} deployment on ${EVM_CHAINS[network].name}: mint ${mintTarget} of ${nfts.length}.`,
        },
      ],
    };
    if (secret) await storeSecret(projectId, d.id, secret);
    if (input.mode === "production") s.approvals.find((x) => x.id === input.approvalId)!.consumedBy = d.id;
    s.deployments.push(d);
    await save(projectId, s);
    return d;
  });
}

/** Constructor arguments in ABI order (shared by the browser deploy and source verification). */
export function constructorArgs(p: ContractParams) {
  return [toInitParams(p)] as const;
}

// --------------------------------------------------------------- reporting

export async function applyEvmEvent(projectId: string, id: string, e: EvmEvent) {
  return withProjectLock(lock(projectId), async () => {
    const s = await load(projectId);
    const d = s.deployments.find((x) => x.id === id);
    if (!d) throw new HttpError(404, "Deployment not found");
    const at = new Date().toISOString();
    const log = (msg: string, level: "info" | "error" = "info") => d.log.push({ at, level, msg: msg.slice(0, 500) });
    switch (e.type) {
      case "log":
        log(String(e.msg), e.level === "error" ? "error" : "info");
        break;
      case "status":
        if (!["deploying", "minting", "minted", "failed", "cancelled"].includes(e.status)) throw new HttpError(400, "Invalid status");
        d.status = e.status;
        d.error = e.error?.slice(0, 500);
        log(`Status → ${e.status}${e.error ? `: ${e.error}` : ""}`, e.status === "failed" ? "error" : "info");
        break;
      case "deploy-sent":
        if (!isTxHash(e.tx)) throw new HttpError(400, "Invalid tx hash");
        d.deployTx = e.tx;
        log(`Deployment transaction sent: ${e.tx}`);
        break;
      case "deployed":
        if (!isEvmAddress(e.address) || !isTxHash(e.tx)) throw new HttpError(400, "Invalid deployment result");
        d.contract = e.address;
        d.deployTx = e.tx;
        log(`Contract deployed at ${e.address}`);
        break;
      case "mint-sent": {
        if (!isTxHash(e.tx)) throw new HttpError(400, "Invalid tx hash");
        const q = Math.floor(e.quantity);
        const first = Math.floor(e.firstTokenId);
        // Reserve mints can interleave with public mints, so bound the IDs by supply and the total by the reserve target.
        const known = d.mints.some((m) => m.tx === e.tx);
        const reserveSoFar = d.mints.filter((m) => m.status !== "failed").reduce((sum, m) => sum + m.quantity, 0);
        if (!(q >= 1 && q <= 400) || first < d.params.startTokenId || first + q - 1 > d.params.startTokenId + d.params.maxSupply - 1 || (!known && reserveSoFar + q > d.mintTarget))
          throw new HttpError(400, "Mint range outside this deployment");
        if (!known) d.mints.push({ tx: e.tx, firstTokenId: first, quantity: q, status: "pending", at });
        break;
      }
      case "reveal-sent":
        if (!isTxHash(e.tx)) throw new HttpError(400, "Invalid tx hash");
        if (!d.reveal) throw new HttpError(409, "Prepare the reveal first");
        d.reveal.tx = e.tx;
        log(`Reveal transaction sent: ${e.tx}`);
        break;
      case "mint-confirmed":
      case "mint-failed": {
        const m = d.mints.find((x) => x.tx === e.tx);
        if (!m) throw new HttpError(400, "Unknown mint transaction");
        m.status = e.type === "mint-confirmed" ? "confirmed" : "failed";
        if (e.type === "mint-failed") m.error = String(e.error).slice(0, 300);
        log(`Mint #${m.firstTokenId}–#${m.firstTokenId + m.quantity - 1} ${m.status}`, m.status === "failed" ? "error" : "info");
        break;
      }
      default:
        throw new HttpError(400, "Unknown event");
    }
    d.updatedAt = at;
    if (d.log.length > 400) d.log = d.log.slice(-400);
    await save(projectId, s);
    return d;
  });
}

// ----------------------------------------------------------- verification

const toHttp = (u: string) =>
  u.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${u.slice(7)}` : u.startsWith("ar://") ? `https://arweave.net/${u.slice(5)}` : u;

/**
 * Independently verify the deployment on-chain: exact bytecode, owner, parameters,
 * royalties, provenance and supply, owners and token URIs for a token sample, and
 * that the hosted metadata really is this collection's metadata.
 */
export async function verifyEvmDeployment(projectId: string, id: string) {
  const d = await getEvmDeployment(projectId, id);
  if (!d.contract) throw new HttpError(409, "No contract deployed yet.");
  const project = await getProject(projectId);
  const nfts = new Map(((await getCollection(projectId))?.nfts ?? []).map((n) => [n.tokenId, n]));
  const c = client(d.network);
  const read = <T>(functionName: string, args: unknown[] = []) => c.readContract({ address: d.contract!, abi: ABI, functionName, args }) as Promise<T>;
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });
  const p = d.params;
  try {
    const code = await c.getCode({ address: d.contract });
    add("Bytecode matches the audited NFT Forge contract", code === artifact.deployedBytecode, code ? `${(code.length - 2) / 2} bytes` : "no code at address");
    const [owner, name, symbol, maxSupply, start, prov, minted, reserveMinted, reservedOnChain, base, unrevealed, commitmentOnChain, payout, royalty, frozen, revealed, offset] = await Promise.all([
      read<string>("owner"),
      read<string>("name"),
      read<string>("symbol"),
      read<bigint>("maxSupply"),
      read<bigint>("startTokenId"),
      read<Hex>("provenanceHash"),
      read<bigint>("totalMinted"),
      read<bigint>("reserveMinted"),
      read<bigint>("reserved"),
      read<string>("baseURI"),
      read<string>("unrevealedURI"),
      read<Hex>("revealCommitment"),
      read<string>("payoutAddress"),
      read<[string, bigint]>("royaltyInfo", [BigInt(p.startTokenId), 10_000n]),
      read<boolean>("metadataFrozen"),
      read<boolean>("revealed"),
      read<bigint>("revealOffset"),
    ]);
    const sale = hasSale(d);
    add("Owner is the creator wallet", owner.toLowerCase() === d.wallet.toLowerCase(), owner);
    add("Name, symbol, supply and first token ID", name === p.name && symbol === p.symbol && Number(maxSupply) === p.maxSupply && Number(start) === p.startTokenId, `${name} (${symbol}), ${maxSupply} max, starts at #${start}`);
    add("Provenance hash matches the rendered artwork", prov.toLowerCase() === p.provenanceHash.toLowerCase(), prov);
    add("Royalties (ERC-2981)", royalty[0].toLowerCase() === p.royaltyReceiver.toLowerCase() && Number(royalty[1]) === p.royaltyBps, `${Number(royalty[1]) / 100}% to ${royalty[0]}`);
    // The reserve can legitimately shrink (reduceReserve) after deployment, never grow.
    add("Team reserve and payout address", Number(reservedOnChain) <= p.reserved && payout.toLowerCase() === p.payout.toLowerCase(), `${reservedOnChain} reserved · proceeds to ${payout}`);
    add(
      "Reveal configuration",
      unrevealed === p.unrevealedURI && commitmentOnChain.toLowerCase() === p.revealCommitment.toLowerCase(),
      isDelayed(d) ? `delayed reveal · ${revealed ? `revealed (offset ${offset})` : "not revealed yet"}` : "revealed from the start",
    );
    const expectedBase = revealed && isDelayed(d) ? (d.reveal?.baseURI ?? "") : p.baseURI;
    add("Base URI", base === expectedBase, `${base || "(none until reveal)"}${frozen ? " (frozen)" : ""}`);
    add("Reserve minted", Number(reserveMinted) === d.mintTarget, `${reserveMinted} / ${d.mintTarget}${sale ? ` · ${Number(minted) - Number(reserveMinted)} sold publicly` : ""}`);

    // Owner + tokenURI on a deterministic sample (first, last, and evenly spaced).
    const count = Number(minted);
    const last = p.startTokenId + count - 1;
    const sample = count ? [...new Set([p.startTokenId, last, ...Array.from({ length: 10 }, (_, i) => p.startTokenId + Math.floor(((i + 1) * count) / 11))])] : [];
    const owners = await Promise.all(sample.map((t) => read<string>("ownerOf", [BigInt(t)]).catch(() => "missing")));
    const uris = await Promise.all(sample.map((t) => read<string>("tokenURI", [BigInt(t)]).catch(() => "")));
    if (sale) {
      const missing = sample.filter((_, i) => owners[i] === "missing");
      add(`Owners of ${sample.length} sampled tokens`, missing.length === 0, missing.length ? `no owner for #${missing.join(", #")}` : sample.length ? "all minted tokens have owners" : "nothing minted yet");
    } else {
      const badOwner = sample.filter((_, i) => owners[i].toLowerCase() !== d.wallet.toLowerCase());
      add(`Owners of ${sample.length} sampled tokens`, sample.length > 0 && badOwner.length === 0, badOwner.length ? `wrong owner for #${badOwner.join(", #")}` : "all held by creator wallet");
    }
    const wantUri = (t: number) => (revealed ? `${base}${t}.json` : p.unrevealedURI);
    const badUri = sample.filter((t, i) => uris[i] !== wantUri(t));
    add("Token URIs", badUri.length === 0, badUri.length ? `unexpected for #${badUri.join(", #")}` : sample.length ? `${uris[0]} …` : "nothing minted yet");

    // Hosted metadata must be *this* collection's metadata (catches uploading the wrong folder).
    const contentProblems: string[] = [];
    let reachable = 0;
    if (revealed) {
      // After a delayed reveal, token N's file describes artwork artworkId(N).
      const off = isDelayed(d) ? Number(offset) : 0;
      const probe = sample.length ? sample.slice(0, 3) : [p.startTokenId];
      for (const t of probe) {
        try {
          const res = await fetch(toHttp(`${base}${t}.json`), { signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const got = (await res.json()) as { name?: string; attributes?: unknown };
          reachable++;
          const art = nfts.get(artworkIdFor(t, p.startTokenId, p.maxSupply, off))!;
          const want = isDelayed(d)
            ? buildRevealedTokenMetadata(project.metadata, project.config.categories, project.canvas, art, t)
            : buildTokenMetadata(project.metadata, project.config.categories, project.canvas, art);
          if (got.name !== want.name || JSON.stringify(got.attributes) !== JSON.stringify(want.attributes)) contentProblems.push(`#${t} metadata differs from NFT Forge's`);
        } catch (e) {
          contentProblems.push(`#${t}: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    } else {
      try {
        const res = await fetch(toHttp(p.unrevealedURI), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const got = (await res.json()) as { name?: string; image?: string };
        reachable++;
        if (!got.name || !got.image) contentProblems.push("placeholder metadata lacks a name or image");
      } catch (e) {
        contentProblems.push(`placeholder: ${(e as Error).message.slice(0, 80)}`);
      }
    }
    add(revealed ? "Hosted metadata matches the collection" : "Unrevealed placeholder is reachable", reachable > 0 && contentProblems.length === 0, contentProblems.length ? contentProblems.join("; ") : `${reachable} sampled file(s) OK`);
  } catch (e) {
    add("Read contract", false, (e as Error).message.slice(0, 200));
  }

  // Source verification status on Blockscout.
  const sv = await refreshSourceVerification(d).catch(() => d.sourceVerification);

  return withProjectLock(lock(projectId), async () => {
    const s = await load(projectId);
    const dep = s.deployments.find((x) => x.id === id)!;
    const ok = checks.every((x) => x.ok);
    dep.verification = { at: new Date().toISOString(), ok, checks };
    if (sv) dep.sourceVerification = sv;
    if (ok) dep.status = "verified";
    dep.log.push({ at: dep.verification.at, level: ok ? "info" : "error", msg: `On-chain verification: ${checks.filter((x) => x.ok).length}/${checks.length} checks passed` });
    dep.updatedAt = dep.verification.at;
    await save(projectId, s);
    return dep;
  });
}

// ----------------------------------------------------- Blockscout source code

/** Submit source to Blockscout's Etherscan-compatible API (no API key needed). */
export async function submitSourceVerification(projectId: string, id: string) {
  const d = await getEvmDeployment(projectId, id);
  if (!d.contract) throw new HttpError(409, "No contract deployed yet.");
  const input = await fs.readFile(path.join(process.cwd(), "src/lib/evm/ForgeCollection.verify.json"), "utf8");
  const ctor = (artifact.abi as { type: string; inputs?: { type: string; name: string }[] }[]).find((x) => x.type === "constructor")!;
  const args = encodeAbiParameters(ctor.inputs!, constructorArgs(d.params) as unknown as readonly unknown[]).slice(2);
  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    codeformat: "solidity-standard-json-input",
    contractaddress: d.contract,
    contractname: `${artifact.sourceName}:${artifact.contractName}`,
    compilerversion: artifact.compiler,
    constructorArguements: args,
    sourceCode: input,
  });
  let sv: NonNullable<EvmDeployment["sourceVerification"]>;
  try {
    const res = await fetch(explorerApi(d.network), { method: "POST", body, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let j: { status?: string; result?: string; message?: string } = {};
    try {
      j = JSON.parse(text);
    } catch {
      // The explorer may challenge automated clients (e.g. bot protection). Don't work around it:
      // hand the user the exact input to verify in the browser instead.
      const at = new Date().toISOString();
      return recordSource(projectId, id, {
        status: "failed",
        message: `The explorer didn't accept an automated request (HTTP ${res.status}). Download the verification input and verify on the explorer's contract page.`,
        at,
      });
    }
    sv =
      j.status === "1"
        ? { status: "submitted", guid: j.result, message: "Submitted to Blockscout", at: new Date().toISOString() }
        : /already verified/i.test(`${j.result} ${j.message}`)
          ? { status: "verified", message: "Already verified", at: new Date().toISOString() }
          : { status: "failed", message: `${j.message ?? res.status}: ${j.result ?? ""}`.slice(0, 300), at: new Date().toISOString() };
  } catch (e) {
    sv = { status: "failed", message: (e as Error).message.slice(0, 300), at: new Date().toISOString() };
  }
  return recordSource(projectId, id, sv);
}

async function recordSource(projectId: string, id: string, sv: NonNullable<EvmDeployment["sourceVerification"]>) {
  return withProjectLock(lock(projectId), async () => {
    const s = await load(projectId);
    const dep = s.deployments.find((x) => x.id === id)!;
    dep.sourceVerification = sv;
    dep.log.push({ at: sv.at, level: sv.status === "failed" ? "error" : "info", msg: `Source verification: ${sv.message}` });
    await save(projectId, s);
    return dep;
  });
}

/** Everything needed to verify the contract by hand (explorer UI or `forge verify-contract`). */
export async function verificationBundle(projectId: string, id: string) {
  const d = await getEvmDeployment(projectId, id);
  const ctor = (artifact.abi as { type: string; inputs?: { type: string; name: string }[] }[]).find((x) => x.type === "constructor")!;
  return {
    contractAddress: d.contract ?? null,
    network: d.network,
    chainId: EVM_CHAINS[d.network].id,
    contractName: `${artifact.sourceName}:${artifact.contractName}`,
    compilerVersion: artifact.compiler,
    evmVersion: artifact.evmVersion,
    optimizer: { enabled: true, runs: artifact.optimizerRuns },
    constructorArguments: encodeAbiParameters(ctor.inputs!, constructorArgs(d.params) as unknown as readonly unknown[]),
    explorerVerifyPage: d.contract ? `${EVM_CHAINS[d.network].blockExplorers!.default.url}/address/${d.contract}?tab=contract` : null,
    forgeCommand: d.contract
      ? `forge verify-contract ${d.contract} ${artifact.sourceName}:${artifact.contractName} --chain-id ${EVM_CHAINS[d.network].id} --verifier blockscout --verifier-url ${explorerApi(d.network)}/ --compiler-version ${artifact.compiler} --optimizer-runs ${artifact.optimizerRuns} --evm-version ${artifact.evmVersion} --constructor-args ${encodeAbiParameters(ctor.inputs!, constructorArgs(d.params) as unknown as readonly unknown[])}`
      : null,
    standardJsonInput: JSON.parse(await fs.readFile(path.join(process.cwd(), "src/lib/evm/ForgeCollection.verify.json"), "utf8")),
  };
}

async function refreshSourceVerification(d: EvmDeployment): Promise<EvmDeployment["sourceVerification"]> {
  if (!d.contract) return d.sourceVerification;
  const api = explorerApi(d.network);
  if (d.sourceVerification?.status === "submitted" && d.sourceVerification.guid) {
    const r = (await (await fetch(`${api}?module=contract&action=checkverifystatus&guid=${d.sourceVerification.guid}`, { signal: AbortSignal.timeout(10000) })).json()) as { result?: string };
    if (/pass|verified/i.test(r.result ?? "")) return { status: "verified", message: r.result ?? "Verified", at: new Date().toISOString() };
    if (/fail/i.test(r.result ?? "")) return { status: "failed", message: r.result ?? "Failed", at: new Date().toISOString() };
    return d.sourceVerification;
  }
  // Ask the explorer directly whether the source is published.
  const r = (await (await fetch(`${api}?module=contract&action=getsourcecode&address=${d.contract}`, { signal: AbortSignal.timeout(10000) })).json()) as { result?: { SourceCode?: string }[] };
  if (r.result?.[0]?.SourceCode) return { status: "verified", message: "Source published on Blockscout", at: new Date().toISOString() };
  return d.sourceVerification;
}

// ------------------------------------------------------------------ reveal

/**
 * Step 1 of a delayed reveal: read the on-chain entropy, compute the offset with the
 * committed secret, and decide where the revealed metadata lives. Testnet uses this
 * server's revealed-metadata endpoint; mainnet requires a pinned reveal publication.
 * Returns the secret to the creator's browser, which sends reveal(secret, baseURI, offset).
 */
export async function prepareReveal(projectId: string, id: string, origin: string) {
  const d = await getEvmDeployment(projectId, id);
  if (!d.contract) throw new HttpError(409, "No contract deployed yet.");
  if (!isDelayed(d)) throw new HttpError(409, "This deployment was revealed from the start.");
  const secret = (await loadSecrets(projectId))[id];
  if (!secret) throw new HttpError(500, "The reveal secret for this deployment is missing.");
  const c = client(d.network);
  const read = <T>(functionName: string) => c.readContract({ address: d.contract!, abi: ABI, functionName }) as Promise<T>;
  if (await read<boolean>("revealed")) throw new HttpError(409, "Already revealed.");
  const entropy = await read<Hex>("revealEntropy");
  const offset = revealOffsetOf(secret, entropy, d.params.maxSupply);
  let baseURI: string;
  if (d.mode === "test") {
    baseURI = `${origin}/api/projects/${projectId}/revealed/${id}/`;
  } else {
    const pub = await getPublication(projectId);
    const r = pub?.reveals?.[id];
    if (!r || r.offset !== offset) {
      return { needsPublish: true as const, offset, message: `Pack and pin the revealed metadata for offset ${offset} on IPFS Publishing, then reveal.` };
    }
    baseURI = r.baseURI;
  }
  const at = new Date().toISOString();
  await withProjectLock(lock(projectId), async () => {
    const s = await load(projectId);
    const dep = s.deployments.find((x) => x.id === id)!;
    dep.reveal = { offset, entropy, baseURI, preparedAt: at };
    dep.log.push({ at, level: "info", msg: `Reveal prepared: offset ${offset}, metadata ${baseURI}` });
    await save(projectId, s);
  });
  return { needsPublish: false as const, secret, offset, baseURI };
}

/** Offset a deployment will reveal with right now (for building mainnet reveal metadata). */
export async function currentRevealOffset(projectId: string, id: string) {
  const d = await getEvmDeployment(projectId, id);
  if (!d.contract || !isDelayed(d)) throw new HttpError(409, "Not a deployed delayed-reveal contract.");
  const secret = (await loadSecrets(projectId))[id];
  if (!secret) throw new HttpError(500, "The reveal secret for this deployment is missing.");
  const entropy = (await client(d.network).readContract({ address: d.contract, abi: ABI, functionName: "revealEntropy" })) as Hex;
  return { deployment: d, offset: revealOffsetOf(secret, entropy, d.params.maxSupply) };
}

/** Download of a deployment's reveal secret (creator backup). */
export async function revealSecret(projectId: string, id: string) {
  await getEvmDeployment(projectId, id);
  const secret = (await loadSecrets(projectId))[id];
  if (!secret) throw new HttpError(404, "No reveal secret for this deployment.");
  return secret;
}

// --------------------------------------------------------------- live sale

export async function readOnchainSale(network: EvmNetwork, address: `0x${string}`): Promise<OnchainSale> {
  const c = client(network);
  const read = <T>(functionName: string, args: unknown[] = []) => c.readContract({ address, abi: ABI, functionName, args }) as Promise<T>;
  const [totalMinted, reserveMinted, reserved, maxSupply, publicRemaining, paused, revealed, revealOffset, phaseCount, payout, balance] = await Promise.all([
    read<bigint>("totalMinted"),
    read<bigint>("reserveMinted"),
    read<bigint>("reserved"),
    read<bigint>("maxSupply"),
    read<bigint>("publicRemaining"),
    read<boolean>("paused"),
    read<boolean>("revealed"),
    read<bigint>("revealOffset"),
    read<bigint>("phaseCount"),
    read<`0x${string}`>("payoutAddress"),
    c.getBalance({ address }),
  ]);
  const phases = await Promise.all(
    Array.from({ length: Number(phaseCount) }, async (_, i) => {
      const [ph, minted] = await Promise.all([
        read<{ start: bigint; end: bigint; price: bigint; maxPerWallet: number; cap: number; merkleRoot: `0x${string}` }>("getPhase", [BigInt(i)]),
        read<bigint>("phaseMinted", [BigInt(i)]),
      ]);
      return { start: Number(ph.start), end: Number(ph.end), priceWei: ph.price.toString(), maxPerWallet: Number(ph.maxPerWallet), cap: Number(ph.cap), merkleRoot: ph.merkleRoot, minted: Number(minted) };
    }),
  );
  return {
    totalMinted: Number(totalMinted),
    reserveMinted: Number(reserveMinted),
    reserved: Number(reserved),
    maxSupply: Number(maxSupply),
    publicRemaining: Number(publicRemaining),
    paused,
    revealed,
    revealOffset: Number(revealOffset),
    balanceWei: balance.toString(),
    payout,
    phases,
    readAt: new Date().toISOString(),
  };
}

export async function collectionMetadataFor(projectId: string) {
  const project = await getProject(projectId);
  return buildCollectionMetadata(project.metadata, project.config.supply);
}
