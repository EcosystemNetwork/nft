import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchAsset, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { isBase58Address, isBase58Signature, RPC, type Approval, type DeployEvent, type Deployment, type DeploymentMode, type DeployPlan, type Network, type ReadinessCheck, type UriMode } from "./chain/types";
import { configHash } from "./engine/generator";
import { buildCollectionMetadata, buildTokenMetadata, joinUri } from "./engine/metadata";
import { sha256, stableStringify } from "./engine/rng";
import { runQa } from "./qa";
import { existingRender } from "./render";
import { getCollection, getProject, HttpError, newId, paths, withProjectLock, type Project } from "./store";
import type { Nft } from "./engine/types";

// ---------------------------------------------------------------------------
// Module J — Deployment Studio (server side). The server never holds keys. It:
//  - decides whether a deployment may run (test vs production gate),
//  - hands the client a plan, records the public results the client reports,
//  - independently verifies everything on-chain.
// ---------------------------------------------------------------------------

const file = (projectId: string) => path.join(paths.project(projectId), "deployments.json");
interface DeployStore {
  deployments: Deployment[];
  approvals: Approval[];
}

async function load(projectId: string): Promise<DeployStore> {
  try {
    return JSON.parse(await fs.readFile(file(projectId), "utf8")) as DeployStore;
  } catch {
    return { deployments: [], approvals: [] };
  }
}
async function save(projectId: string, s: DeployStore) {
  const f = file(projectId);
  const tmp = `${f}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 1));
  await fs.rename(tmp, f);
}
const lockKey = (id: string) => `${id}:deploy`;

export async function listDeployments(projectId: string) {
  const s = await load(projectId);
  return { deployments: [...s.deployments].reverse(), approvals: [...s.approvals].reverse() };
}

export async function getDeployment(projectId: string, depId: string) {
  const d = (await load(projectId)).deployments.find((x) => x.id === depId);
  if (!d) throw new HttpError(404, "Deployment not found");
  return d;
}

/** Everything that defines what would land on-chain. A test only counts for production if this matches. */
export function contentFingerprint(project: Project, nfts: Nft[]) {
  return sha256(
    stableStringify({
      config: configHash(project.config),
      template: project.metadata,
      canvas: project.canvas,
      tokens: nfts.map((n) => [n.tokenId, n.dna]),
    }),
  ).slice(0, 16);
}

// ---------------------------------------------------------------------- gate

export async function readiness(projectId: string): Promise<{ checks: ReadinessCheck[]; ready: boolean; fingerprint: string; testDeploymentId?: string }> {
  const project = await getProject(projectId);
  const nfts = (await getCollection(projectId))?.nfts ?? [];
  const fingerprint = contentFingerprint(project, nfts);
  const qa = await runQa(projectId, { visualDuplicates: false });
  const store = await load(projectId);
  const test = [...store.deployments]
    .reverse()
    .find((d) => d.mode === "test" && d.network === "devnet" && d.status === "verified" && d.fingerprint === fingerprint);
  const locked = nfts.filter((n) => n.status === "locked").length;
  const checks: ReadinessCheck[] = [
    { id: "chain", label: "Solana project using the Metaplex standard", ok: project.chain === "solana" && project.metadata.standard === "metaplex", detail: `${project.chain} / ${project.metadata.standard}` },
    { id: "supply", label: "Full supply generated", ok: nfts.length === project.config.supply && nfts.length > 0, detail: `${nfts.length} / ${project.config.supply}` },
    { id: "qa", label: "QA passes", ok: qa.passed, detail: qa.passed ? "No failing checks" : `${qa.checks.filter((c) => c.status === "fail").length} failing check(s)` },
    { id: "locked", label: "Every token is locked", ok: nfts.length > 0 && locked === nfts.length, detail: `${locked} / ${nfts.length} locked` },
    { id: "rendered", label: "All artwork rendered", ok: qa.rendered === nfts.length && nfts.length > 0, detail: `${qa.rendered} / ${nfts.length}` },
    {
      id: "test",
      label: "Verified devnet test of this exact content",
      ok: Boolean(test),
      detail: test ? `${test.id} · ${test.items.length} tokens verified` : "Run a test deployment on devnet, then verify it",
    },
  ];
  return { checks, ready: checks.every((c) => c.ok), fingerprint, testDeploymentId: test?.id };
}

/** Production approval: a separate, explicit, recorded step. */
export async function approveProduction(projectId: string, input: { wallet: string; confirmName: string }) {
  if (!isBase58Address(input.wallet)) throw new HttpError(400, "Connect a wallet first");
  const project = await getProject(projectId);
  if (input.confirmName !== project.metadata.collectionName)
    throw new HttpError(400, `Type the collection name exactly ("${project.metadata.collectionName}") to approve.`);
  const r = await readiness(projectId);
  if (!r.ready) throw new HttpError(409, `Not ready for production: ${r.checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}`);
  return withProjectLock(lockKey(projectId), async () => {
    const s = await load(projectId);
    const approval: Approval = {
      id: newId("appr"),
      at: new Date().toISOString(),
      wallet: input.wallet,
      fingerprint: r.fingerprint,
      testDeploymentId: r.testDeploymentId!,
      checklist: r.checks,
    };
    s.approvals.push(approval);
    await save(projectId, s);
    return approval;
  });
}

// ---------------------------------------------------------------- creation

export async function createDeployment(
  projectId: string,
  input: {
    mode: DeploymentMode;
    wallet: string;
    uriMode: UriMode;
    testCount?: number;
    metadataBaseUri?: string;
    collectionMetadataUri?: string;
    approvalId?: string;
  },
): Promise<Deployment> {
  if (!isBase58Address(input.wallet)) throw new HttpError(400, "Connect a wallet first");
  const project = await getProject(projectId);
  if (project.chain !== "solana") throw new HttpError(409, "Deployment Studio currently supports Solana (Metaplex Core) projects.");
  const nfts = [...((await getCollection(projectId))?.nfts ?? [])].sort((a, b) => a.tokenId - b.tokenId);
  if (!nfts.length) throw new HttpError(409, "Generate the collection first.");
  if (input.uriMode === "base" && (!/^(https?|ipfs|ar):\/\//.test(input.metadataBaseUri ?? "") || !/^(https?|ipfs|ar):\/\//.test(input.collectionMetadataUri ?? "")))
    throw new HttpError(400, "Provide both the metadata folder URI and the collection metadata URI (https://, ipfs:// or ar://).");
  const fingerprint = contentFingerprint(project, nfts);

  let network: Network = "devnet";
  let tokens = nfts;
  if (input.mode === "test") {
    const n = Math.min(Math.max(1, Math.floor(input.testCount ?? 10)), 100, nfts.length);
    tokens = nfts.slice(0, n);
  } else {
    network = "mainnet-beta";
    const r = await readiness(projectId);
    if (!r.ready) throw new HttpError(409, "Production deployment requires every readiness check to pass.");
    const s = await load(projectId);
    const approval = s.approvals.find((a) => a.id === input.approvalId);
    if (!approval) throw new HttpError(403, "Production deployment requires an approval.");
    if (approval.consumedBy) throw new HttpError(409, "This approval was already used.");
    if (approval.fingerprint !== fingerprint) throw new HttpError(409, "The collection changed since it was approved. Approve again.");
    if (approval.wallet !== input.wallet) throw new HttpError(403, "Approval was granted for a different wallet.");
  }

  return withProjectLock(lockKey(projectId), async () => {
    const s = await load(projectId);
    const now = new Date().toISOString();
    const base = input.uriMode === "base" ? input.metadataBaseUri! : undefined;
    const d: Deployment = {
      id: newId("dep"),
      projectId,
      mode: input.mode,
      network,
      uriMode: input.uriMode,
      metadataBaseUri: base,
      collectionMetadataUri: input.uriMode === "base" ? input.collectionMetadataUri : undefined,
      wallet: input.wallet,
      status: "created",
      createdAt: now,
      updatedAt: now,
      fingerprint,
      approvalId: input.mode === "production" ? input.approvalId : undefined,
      collection: {
        name: project.metadata.collectionName + (input.mode === "test" ? " (Devnet Test)" : ""),
        symbol: project.metadata.symbol,
        royaltyBps: project.metadata.sellerFeeBasisPoints,
        uri: input.uriMode === "base" ? input.collectionMetadataUri : undefined,
      },
      items: tokens.map((n) =>
        base
          ? { tokenId: n.tokenId, state: "uploaded" as const, metadataUri: joinUri(base, `${n.tokenId}.json`) }
          : { tokenId: n.tokenId, state: "pending" as const },
      ),
      txs: [],
      log: [{ at: now, level: "info", msg: `Created ${input.mode} deployment of ${tokens.length} token(s) on ${network}.` }],
    };
    if (input.mode === "production") {
      const a = s.approvals.find((x) => x.id === input.approvalId)!;
      a.consumedBy = d.id;
    }
    s.deployments.push(d);
    await save(projectId, s);
    return d;
  });
}

export async function buildPlan(projectId: string, depId: string): Promise<DeployPlan> {
  const project = await getProject(projectId);
  const d = await getDeployment(projectId, depId);
  const nfts = new Map(((await getCollection(projectId))?.nfts ?? []).map((n) => [n.tokenId, n]));
  const current = contentFingerprint(project, [...nfts.values()].sort((a, b) => a.tokenId - b.tokenId));
  if (current !== d.fingerprint) throw new HttpError(409, "The collection changed after this deployment was created. Start a new deployment.");
  const tokens = [];
  for (const it of d.items) {
    const n = nfts.get(it.tokenId)!;
    const file = await existingRender(project, n);
    if (!file && d.uriMode === "irys") throw new HttpError(409, `Token #${n.tokenId} is not rendered. Render the collection first.`);
    const meta = buildTokenMetadata(project.metadata, project.config.categories, project.canvas, n);
    tokens.push({
      tokenId: n.tokenId,
      name: meta.name,
      metadata: meta,
      imagePath: `/api/projects/${projectId}/nfts/${n.tokenId}/image`,
      imageBytes: file ? (await fs.stat(file)).size : 0,
      state: it.state,
      imageUri: it.imageUri,
      metadataUri: it.metadataUri,
      asset: it.asset,
    });
  }
  const collectionMeta = buildCollectionMetadata(project.metadata, project.config.supply);
  return {
    deploymentId: d.id,
    network: d.network,
    uriMode: d.uriMode,
    wallet: d.wallet,
    collection: {
      name: d.collection.name,
      symbol: d.collection.symbol,
      royaltyBps: d.collection.royaltyBps,
      uri: d.collection.uri,
      address: d.collection.address,
      metadata: { ...collectionMeta, name: d.collection.name },
      imageTokenId: d.items[0]?.tokenId ?? 0,
    },
    tokens,
  };
}

// --------------------------------------------------------------- reporting

/** Apply a progress event from the client. Only public data is accepted, and every field is validated. */
export async function applyEvent(projectId: string, depId: string, e: DeployEvent) {
  return withProjectLock(lockKey(projectId), async () => {
    const s = await load(projectId);
    const d = s.deployments.find((x) => x.id === depId);
    if (!d) throw new HttpError(404, "Deployment not found");
    const at = new Date().toISOString();
    const byToken = new Map(d.items.map((i) => [i.tokenId, i]));
    const item = (id: number) => {
      const it = byToken.get(Number(id));
      if (!it) throw new HttpError(400, `Token #${id} is not part of this deployment`);
      return it;
    };
    const uri = (u: unknown) => {
      if (typeof u !== "string" || !/^(https?|ipfs|ar):\/\/\S{3,300}$/.test(u)) throw new HttpError(400, "Invalid URI");
      return u;
    };
    switch (e.type) {
      case "log":
        d.log.push({ at, level: e.level === "error" ? "error" : "info", msg: String(e.msg).slice(0, 500) });
        break;
      case "status":
        if (!["uploading", "minting", "minted", "failed", "cancelled"].includes(e.status)) throw new HttpError(400, "Invalid status");
        d.status = e.status;
        d.error = e.error?.slice(0, 500);
        d.log.push({ at, level: e.status === "failed" ? "error" : "info", msg: `Status → ${e.status}${e.error ? `: ${e.error}` : ""}` });
        break;
      case "uploaded":
        for (const x of e.items) {
          const it = item(x.tokenId);
          if (x.imageUri) it.imageUri = uri(x.imageUri);
          it.metadataUri = uri(x.metadataUri);
          if (it.state === "pending") it.state = "uploaded";
        }
        break;
      case "collection":
        if (!isBase58Address(e.address) || !isBase58Signature(e.signature)) throw new HttpError(400, "Invalid address or signature");
        d.collection.address = e.address;
        d.collection.uri = uri(e.uri);
        d.collection.signature = e.signature;
        d.txs.push({ kind: "collection", signature: e.signature, at });
        d.log.push({ at, level: "info", msg: `Collection created: ${e.address}` });
        break;
      case "minting":
        for (const x of e.items) {
          if (!isBase58Address(x.asset)) throw new HttpError(400, "Invalid asset address");
          const it = item(x.tokenId);
          if (it.state === "minted" || it.state === "verified") continue;
          it.asset = x.asset;
          it.state = "minting";
          it.error = undefined;
        }
        break;
      case "minted": {
        const sigs = new Map<string, number[]>();
        for (const x of e.items) {
          if (!isBase58Address(x.asset) || (x.signature && !isBase58Signature(x.signature))) throw new HttpError(400, "Invalid mint result");
          const it = item(x.tokenId);
          it.asset = x.asset;
          it.signature = x.signature || it.signature;
          if (it.state !== "verified") it.state = "minted";
          if (x.signature) sigs.set(x.signature, [...(sigs.get(x.signature) ?? []), x.tokenId]);
        }
        for (const [signature, tokens] of sigs) d.txs.push({ kind: "mint", signature, at, tokens });
        break;
      }
      case "failed":
        for (const x of e.items) {
          const it = item(x.tokenId);
          it.state = "failed";
          it.error = String(x.error).slice(0, 300);
        }
        break;
      case "tx":
        if (!isBase58Signature(e.signature) || !["fund", "sweep"].includes(e.kind)) throw new HttpError(400, "Invalid transaction");
        d.txs.push({ kind: e.kind, signature: e.signature, at });
        break;
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

/**
 * Independently check the chain: the collection exists with the right update
 * authority, royalties and URI, and every asset exists in that collection with
 * the recorded name and metadata URI. Also reconciles "minting" items that landed.
 */
export async function verifyDeployment(projectId: string, depId: string) {
  const d = await getDeployment(projectId, depId);
  if (!d.collection.address) throw new HttpError(409, "Nothing on-chain yet.");
  const umi = createUmi(RPC[d.network]).use(mplCore());
  const problems: string[] = [];
  try {
    const c = await fetchCollection(umi, publicKey(d.collection.address));
    if (c.updateAuthority.toString() !== d.wallet) problems.push(`Collection update authority is ${c.updateAuthority}, expected ${d.wallet}`);
    if (c.uri !== d.collection.uri) problems.push("Collection URI does not match the recorded URI");
    if (c.royalties?.basisPoints !== d.collection.royaltyBps) problems.push(`Collection royalties are ${c.royalties?.basisPoints ?? "missing"} bps, expected ${d.collection.royaltyBps}`);
  } catch (e) {
    problems.push(`Collection not found on ${d.network}: ${(e as Error).message.slice(0, 120)}`);
  }

  const project = await getProject(projectId);
  const nfts = new Map(((await getCollection(projectId))?.nfts ?? []).map((n) => [n.tokenId, n]));
  const results = new Map<number, { ok: boolean; problem?: string }>();
  const candidates = d.items.filter((i) => i.asset);
  for (let i = 0; i < candidates.length; i += 8) {
    await Promise.all(
      candidates.slice(i, i + 8).map(async (it) => {
        try {
          const a = await fetchAsset(umi, publicKey(it.asset!));
          const expectedName = buildTokenMetadata(project.metadata, project.config.categories, project.canvas, nfts.get(it.tokenId)!).name;
          const inCollection = a.updateAuthority.type === "Collection" && a.updateAuthority.address?.toString() === d.collection.address;
          const p = !inCollection
            ? "not in the collection"
            : a.uri !== it.metadataUri
              ? "metadata URI mismatch"
              : a.name !== expectedName
                ? `name "${a.name}" ≠ "${expectedName}"`
                : a.owner.toString() !== d.wallet
                  ? `owned by ${a.owner}`
                  : undefined;
          results.set(it.tokenId, { ok: !p, problem: p });
        } catch {
          results.set(it.tokenId, { ok: false, problem: it.state === "minting" ? "mint never landed" : "asset not found" });
        }
      }),
    );
  }

  return withProjectLock(lockKey(projectId), async () => {
    const s = await load(projectId);
    const dep = s.deployments.find((x) => x.id === depId)!;
    let ok = 0;
    for (const it of dep.items) {
      const r = results.get(it.tokenId);
      if (!r) {
        if (it.state !== "failed") problems.push(`#${it.tokenId}: not minted`);
        continue;
      }
      if (r.ok) {
        it.state = "verified";
        it.error = undefined;
        ok++;
      } else {
        if (it.state === "minting") it.state = "failed";
        it.error = r.problem;
        problems.push(`#${it.tokenId}: ${r.problem}`);
      }
    }
    dep.verification = { at: new Date().toISOString(), checked: dep.items.length, ok, problems: problems.slice(0, 100) };
    if (ok === dep.items.length && !problems.length) dep.status = "verified";
    dep.log.push({ at: dep.verification.at, level: problems.length ? "error" : "info", msg: `Verification: ${ok}/${dep.items.length} assets verified${problems.length ? `, ${problems.length} problem(s)` : ""}` });
    dep.updatedAt = dep.verification.at;
    await save(projectId, s);
    return dep;
  });
}
