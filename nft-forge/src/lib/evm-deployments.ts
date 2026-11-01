import { promises as fs } from "node:fs";
import path from "node:path";
import { createPublicClient, encodeAbiParameters, http, type Abi, type Hex } from "viem";
import { contentFingerprint } from "./deployments";
import { buildCollectionMetadata, buildTokenMetadata, joinUri } from "./engine/metadata";
import { EVM_CHAINS, explorerApi, type EvmNetwork } from "./evm/chains";
import artifact from "./evm/ForgeCollection.artifact.json";
import { isEvmAddress, isTxHash, type ContractParams, type EvmApproval, type EvmDeployment, type EvmEvent } from "./evm/types";
import { computeProvenance } from "./provenance";
import { runQa } from "./qa";
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
  const test = [...s.deployments].reverse().find((d) => d.mode === "test" && d.status === "verified" && d.fingerprint === fingerprint);
  const locked = nfts.filter((n) => n.status === "locked").length;
  const checks = [
    { id: "chain", label: "Robinhood Chain project using ERC-721 metadata", ok: project.chain === "robinhood" && project.metadata.standard === "erc721", detail: `${project.chain} / ${project.metadata.standard}` },
    { id: "supply", label: "Full supply generated", ok: nfts.length > 0 && nfts.length === project.config.supply, detail: `${nfts.length} / ${project.config.supply}` },
    { id: "qa", label: "QA passes", ok: qa.passed, detail: qa.passed ? "No failing checks" : `${qa.checks.filter((c) => c.status === "fail").length} failing check(s)` },
    { id: "rendered", label: "All artwork rendered (needed for the provenance hash)", ok: nfts.length > 0 && qa.rendered === nfts.length, detail: `${qa.rendered} / ${nfts.length}` },
    { id: "locked", label: "Every token is locked", ok: nfts.length > 0 && locked === nfts.length, detail: `${locked} / ${nfts.length} locked` },
    { id: "test", label: "Verified testnet deployment of this exact content", ok: Boolean(test), detail: test ? `${test.id} · ${test.mintTarget} tokens verified` : "Run a testnet deployment, then verify it" },
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

  let network: EvmNetwork = "robinhood-testnet";
  let mintTarget = nfts.length;
  let baseURI = input.baseURI?.trim() ?? "";
  let contractURI = input.contractURI?.trim() ?? "";
  if (input.mode === "test") {
    mintTarget = Math.min(Math.max(1, Math.floor(input.testCount ?? 25)), nfts.length);
    // Without hosted metadata, a testnet run points at this NFT Forge server's preview metadata.
    if (!baseURI) {
      baseURI = `${origin}/api/projects/${projectId}/metadata/`;
      contractURI = `${baseURI}collection.json`;
    }
    if (!anyUri(baseURI) || (contractURI && !anyUri(contractURI))) throw new HttpError(400, "Invalid metadata URI.");
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
  }

  const params: ContractParams = {
    name: project.metadata.collectionName + (input.mode === "test" ? " (Testnet)" : ""),
    symbol: project.metadata.symbol,
    baseURI,
    contractURI,
    maxSupply: nfts.length,
    startTokenId: nfts[0].tokenId,
    royaltyReceiver: input.wallet as `0x${string}`,
    royaltyBps: project.metadata.sellerFeeBasisPoints,
    provenanceHash,
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
      log: [{ at: now, level: "info", msg: `Created ${input.mode} deployment on ${EVM_CHAINS[network].name}: mint ${mintTarget} of ${nfts.length}.` }],
    };
    if (input.mode === "production") s.approvals.find((x) => x.id === input.approvalId)!.consumedBy = d.id;
    s.deployments.push(d);
    await save(projectId, s);
    return d;
  });
}

/** Constructor arguments in ABI order (shared by the browser deploy and source verification). */
export function constructorArgs(p: ContractParams) {
  return [p.name, p.symbol, p.baseURI, p.contractURI, BigInt(p.maxSupply), BigInt(p.startTokenId), p.royaltyReceiver, BigInt(p.royaltyBps), p.provenanceHash, p.owner] as const;
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
        if (!(q >= 1 && q <= 400) || first < d.params.startTokenId || first + q - 1 > d.params.startTokenId + d.mintTarget - 1)
          throw new HttpError(400, "Mint range outside this deployment");
        if (!d.mints.some((m) => m.tx === e.tx)) d.mints.push({ tx: e.tx, firstTokenId: first, quantity: q, status: "pending", at });
        break;
      }
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
    const [owner, name, symbol, maxSupply, start, prov, minted, base, royalty, frozen] = await Promise.all([
      read<string>("owner"),
      read<string>("name"),
      read<string>("symbol"),
      read<bigint>("maxSupply"),
      read<bigint>("startTokenId"),
      read<Hex>("provenanceHash"),
      read<bigint>("totalMinted"),
      read<string>("baseURI"),
      read<[string, bigint]>("royaltyInfo", [BigInt(p.startTokenId), 10_000n]),
      read<boolean>("metadataFrozen"),
    ]);
    add("Owner is the creator wallet", owner.toLowerCase() === d.wallet.toLowerCase(), owner);
    add("Name, symbol, supply and first token ID", name === p.name && symbol === p.symbol && Number(maxSupply) === p.maxSupply && Number(start) === p.startTokenId, `${name} (${symbol}), ${maxSupply} max, starts at #${start}`);
    add("Provenance hash matches the rendered artwork", prov.toLowerCase() === p.provenanceHash.toLowerCase(), prov);
    add("Royalties (ERC-2981)", royalty[0].toLowerCase() === p.royaltyReceiver.toLowerCase() && Number(royalty[1]) === p.royaltyBps, `${Number(royalty[1]) / 100}% to ${royalty[0]}`);
    add("Base URI", base === p.baseURI, `${base}${frozen ? " (frozen)" : ""}`);
    add("Minted supply", Number(minted) === d.mintTarget, `${minted} / ${d.mintTarget}`);

    // Owner + tokenURI on a deterministic sample (first, last, and evenly spaced).
    const last = p.startTokenId + Number(minted) - 1;
    const sample = Number(minted) ? [...new Set([p.startTokenId, last, ...Array.from({ length: 10 }, (_, i) => p.startTokenId + Math.floor(((i + 1) * Number(minted)) / 11))])] : [];
    const owners = await Promise.all(sample.map((t) => read<string>("ownerOf", [BigInt(t)]).catch(() => "missing")));
    const uris = await Promise.all(sample.map((t) => read<string>("tokenURI", [BigInt(t)]).catch(() => "")));
    const badOwner = sample.filter((_, i) => owners[i].toLowerCase() !== d.wallet.toLowerCase());
    add(`Owners of ${sample.length} sampled tokens`, sample.length > 0 && badOwner.length === 0, badOwner.length ? `wrong owner for #${badOwner.join(", #")}` : "all held by creator wallet");
    const badUri = sample.filter((t, i) => uris[i] !== `${p.baseURI}${t}.json`);
    add("Token URIs", sample.length > 0 && badUri.length === 0, badUri.length ? `unexpected for #${badUri.join(", #")}` : `${uris[0]} …`);

    // Hosted metadata must be *this* collection's metadata (catches uploading the wrong folder).
    const metaSample = sample.slice(0, 3);
    const contentProblems: string[] = [];
    let reachable = 0;
    for (const t of metaSample) {
      try {
        const res = await fetch(toHttp(`${p.baseURI}${t}.json`), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const got = (await res.json()) as { name?: string; attributes?: unknown };
        reachable++;
        const want = buildTokenMetadata(project.metadata, project.config.categories, project.canvas, nfts.get(t)!);
        if (got.name !== want.name || JSON.stringify(got.attributes) !== JSON.stringify(want.attributes)) contentProblems.push(`#${t} metadata differs from NFT Forge's`);
      } catch (e) {
        contentProblems.push(`#${t}: ${(e as Error).message.slice(0, 80)}`);
      }
    }
    add("Hosted metadata matches the collection", reachable > 0 && contentProblems.length === 0, contentProblems.length ? contentProblems.join("; ") : `${reachable} sampled files match`);
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

export async function collectionMetadataFor(projectId: string) {
  const project = await getProject(projectId);
  return buildCollectionMetadata(project.metadata, project.config.supply);
}
