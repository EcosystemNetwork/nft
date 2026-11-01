// Isomorphic Solana deployment engine (Metaplex Core). The browser runs it with
// the creator's wallet as the Umi identity; scripts run it with a keypair. Keys
// never reach the NFT Forge server: the engine only reports public results
// (URIs, addresses, signatures) through `report`.
//
// Every phase is resumable. It skips what the plan says is already done, and
// records asset addresses *before* sending so an interrupted run can be reconciled
// against the chain.

import { createCollection, create, fetchCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import { setComputeUnitPrice, transferSol } from "@metaplex-foundation/mpl-toolbox";
import {
  createGenericFile,
  createGenericFileFromJson,
  generateSigner,
  lamports,
  publicKey,
  signAllTransactions,
  sol,
  transactionBuilder,
  type Signer,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import type { DeployEvent, DeployPlan } from "./types";

export interface EngineDeps {
  /** Identity = creator wallet. Signs the collection and every mint batch. */
  umi: Umi;
  /** For Irys mode: a Umi whose payer signs uploads (a session key or the same keypair). */
  uploadUmi?: Umi;
  fetchImage: (path: string) => Promise<Uint8Array>;
  report: (e: DeployEvent) => Promise<void>;
  onProgress?: (p: { phase: "upload" | "collection" | "mint"; done: number; total: number }) => void;
  shouldStop?: () => boolean;
  /** Tokens per wallet approval. Each approval covers several packed transactions. */
  batchSize?: number;
  uploadChunk?: number;
  priorityMicroLamports?: number;
}

const sig58 = (s: Uint8Array) => base58.deserialize(s)[0];

class Stopped extends Error {
  constructor() {
    super("Stopped by user");
  }
}

export async function runDeployment(plan: DeployPlan, deps: EngineDeps) {
  const { umi, report } = deps;
  const stop = () => {
    if (deps.shouldStop?.()) throw new Stopped();
  };
  const log = (msg: string) => report({ type: "log", msg });
  const tokens = plan.tokens.map((t) => ({ ...t }));

  try {
    // ---------------------------------------------------------------- upload
    if (plan.uriMode === "irys") {
      const up = deps.uploadUmi ?? umi;
      const todo = tokens.filter((t) => !t.metadataUri);
      if (todo.length || !plan.collection.uri) {
        await report({ type: "status", status: "uploading" });
        const chunk = deps.uploadChunk ?? 20;
        let done = tokens.length - todo.length;
        deps.onProgress?.({ phase: "upload", done, total: tokens.length });
        for (let i = 0; i < todo.length; i += chunk) {
          stop();
          const part = todo.slice(i, i + chunk);
          const images = await Promise.all(
            part.map(async (t) =>
              t.imageUri ? null : createGenericFile(await deps.fetchImage(t.imagePath), `${t.tokenId}.png`, { contentType: "image/png" }),
            ),
          );
          const toUpload = images.filter((x) => x !== null);
          const imageUris = toUpload.length ? await up.uploader.upload(toUpload) : [];
          let k = 0;
          for (const [j, t] of part.entries()) if (images[j]) t.imageUri = imageUris[k++];
          const jsons = part.map((t) => {
            const meta = JSON.parse(JSON.stringify(t.metadata)) as Record<string, unknown> & { properties?: { files?: { uri: string }[] } };
            meta.image = t.imageUri;
            if (meta.properties?.files) meta.properties.files = meta.properties.files.map((f) => ({ ...f, uri: t.imageUri! }));
            return createGenericFileFromJson(meta, `${t.tokenId}.json`);
          });
          const metaUris = await up.uploader.upload(jsons);
          part.forEach((t, j) => (t.metadataUri = metaUris[j]));
          await report({ type: "uploaded", items: part.map((t) => ({ tokenId: t.tokenId, imageUri: t.imageUri, metadataUri: t.metadataUri! })) });
          done += part.length;
          deps.onProgress?.({ phase: "upload", done, total: tokens.length });
        }
        if (!plan.collection.uri) {
          stop();
          const cover = tokens.find((t) => t.tokenId === plan.collection.imageTokenId) ?? tokens[0];
          plan.collection.uri = await up.uploader.uploadJson({ ...plan.collection.metadata, image: cover?.imageUri });
          await log(`Uploaded collection metadata: ${plan.collection.uri}`);
        }
      }
    }

    // ------------------------------------------------------------ collection
    if (!plan.collection.address) {
      stop();
      deps.onProgress?.({ phase: "collection", done: 0, total: 1 });
      if (!plan.collection.uri) throw new Error("Collection metadata URI is missing.");
      const collection = generateSigner(umi);
      const res = await createCollection(umi, {
        collection,
        name: plan.collection.name,
        uri: plan.collection.uri,
        plugins: [
          {
            type: "Royalties",
            basisPoints: plan.collection.royaltyBps,
            creators: [{ address: umi.identity.publicKey, percentage: 100 }],
            ruleSet: ruleSet("None"),
          },
        ],
      }).sendAndConfirm(umi);
      plan.collection.address = collection.publicKey.toString();
      await report({ type: "collection", address: plan.collection.address, uri: plan.collection.uri, signature: sig58(res.signature) });
      deps.onProgress?.({ phase: "collection", done: 1, total: 1 });
    }

    // ------------------------------------------------------------------ mint
    const collection = await fetchCollection(umi, publicKey(plan.collection.address));

    // Reconcile tokens whose mint was sent but never confirmed back to the server.
    const inFlight = tokens.filter((t) => t.state === "minting" && t.asset);
    if (inFlight.length) {
      const exists = await Promise.all(inFlight.map((t) => umi.rpc.accountExists(publicKey(t.asset!))));
      const landed = inFlight.filter((_, i) => exists[i]);
      if (landed.length) {
        await report({ type: "minted", items: landed.map((t) => ({ tokenId: t.tokenId, asset: t.asset!, signature: "" })) });
        await log(`Reconciled ${landed.length} mint(s) found on-chain from an earlier run.`);
      }
      for (const t of landed) t.state = "minted";
    }

    const toMint = tokens.filter((t) => t.state !== "minted" && t.state !== "verified");
    if (toMint.length) await report({ type: "status", status: "minting" });
    const batch = deps.batchSize ?? 48;
    let minted = tokens.length - toMint.length;
    deps.onProgress?.({ phase: "mint", done: minted, total: tokens.length });

    for (let i = 0; i < toMint.length; i += batch) {
      stop();
      const part = toMint.slice(i, i + batch).filter((t) => t.metadataUri);
      if (!part.length) continue;
      const signers = part.map(() => generateSigner(umi));
      await report({ type: "minting", items: part.map((t, j) => ({ tokenId: t.tokenId, asset: signers[j].publicKey.toString() })) });

      const groups = packMints(
        umi,
        collection,
        part.map((t, j) => ({ asset: signers[j], name: t.name, uri: t.metadataUri! })),
        deps.priorityMicroLamports,
      );

      const blockhash = await umi.rpc.getLatestBlockhash();
      const built = groups.map((g) => ({
        transaction: g.builder.setBlockhash(blockhash).build(umi),
        signers: g.builder.getSigners(umi) as Signer[],
      }));
      // One wallet approval for the whole batch.
      const signed = await signAllTransactions(built);
      const results = await Promise.all(
        signed.map(async (tx, gi) => {
          const items = groups[gi].idx.map((j) => ({ token: part[j], asset: signers[j].publicKey.toString() }));
          try {
            const sig = await umi.rpc.sendTransaction(tx);
            const conf = await umi.rpc.confirmTransaction(sig, { strategy: { type: "blockhash", ...blockhash } });
            if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));
            return { ok: true as const, items, signature: sig58(sig) };
          } catch (e) {
            return { ok: false as const, items, error: (e as Error).message.slice(0, 300) };
          }
        }),
      );
      const ok = results.flatMap((r) => (r.ok ? r.items.map((x) => ({ tokenId: x.token.tokenId, asset: x.asset, signature: r.signature })) : []));
      const bad = results.flatMap((r) => (r.ok ? [] : r.items.map((x) => ({ tokenId: x.token.tokenId, error: r.error }))));
      if (ok.length) await report({ type: "minted", items: ok });
      if (bad.length) await report({ type: "failed", items: bad });
      minted += ok.length;
      deps.onProgress?.({ phase: "mint", done: minted, total: tokens.length });
    }

    const failed = tokens.length - minted;
    await report(
      failed
        ? { type: "status", status: "failed", error: `${failed} token(s) failed to mint. Resume to retry them.` }
        : { type: "status", status: "minted" },
    );
    return { minted, failed };
  } catch (e) {
    if (e instanceof Stopped) {
      await report({ type: "status", status: "cancelled", error: "Paused by user. Resume to continue." });
      return { minted: 0, failed: 0, stopped: true };
    }
    await report({ type: "status", status: "failed", error: (e as Error).message.slice(0, 500) });
    throw e;
  }
}

/**
 * Greedily pack Core `create` instructions into as few transactions as fit
 * (several mints per transaction, so far fewer signatures and fees).
 * `idx` maps each transaction back to positions in `items`.
 */
export function packMints(
  umi: Umi,
  collection: Parameters<typeof create>[1]["collection"],
  items: { asset: Signer; name: string; uri: string }[],
  priorityMicroLamports?: number,
  prefix?: TransactionBuilder,
): { builder: TransactionBuilder; idx: number[] }[] {
  const base = () =>
    priorityMicroLamports ? setComputeUnitPrice(umi, { microLamports: priorityMicroLamports }) : transactionBuilder();
  const groups: { builder: TransactionBuilder; idx: number[] }[] = [];
  // `prefix` (e.g. creating the collection itself) only goes in the first transaction.
  let cur = { builder: base().add(prefix ?? transactionBuilder()), idx: [] as number[] };
  items.forEach((it, j) => {
    const ix = create(umi, { asset: it.asset, collection, name: it.name, uri: it.uri });
    const next = cur.builder.add(ix);
    if (cur.idx.length && !next.fitsInOneTransaction(umi)) {
      groups.push(cur);
      cur = { builder: base().add(ix), idx: [j] };
    } else {
      cur = { builder: next, idx: [...cur.idx, j] };
    }
  });
  if (cur.idx.length) groups.push(cur);
  return groups;
}

/** Estimated SOL cost of running the plan (upload + rent + fees). */
export async function estimateCost(plan: DeployPlan, umi: Umi, uploadPricePerByte?: (bytes: number) => Promise<number>) {
  const remaining = plan.tokens.filter((t) => t.state !== "minted" && t.state !== "verified");
  const uploadBytes =
    plan.uriMode === "irys"
      ? plan.tokens.filter((t) => !t.metadataUri).reduce((s, t) => s + t.imageBytes + 2048 + JSON.stringify(t.metadata).length, 0) + 4096
      : 0;
  // Core asset account: header + owner + update authority + name + uri (+ padding).
  const avgUri = plan.uriMode === "irys" ? 64 : (plan.tokens[0]?.metadataUri?.length ?? 80);
  const assetRent = Number((await umi.rpc.getRent(1 + 32 + 33 + 4 + 32 + 4 + avgUri + 8)).basisPoints) / 1e9;
  const collectionRent = plan.collection.address ? 0 : Number((await umi.rpc.getRent(400)).basisPoints) / 1e9;
  const upload = uploadBytes && uploadPricePerByte ? await uploadPricePerByte(uploadBytes) : 0;
  const fees = remaining.length * 0.00001 + 0.00002;
  return { upload, assetRent: assetRent * remaining.length, collectionRent, fees, total: upload + assetRent * remaining.length + collectionRent + fees, uploadBytes };
}

/** Fund an ephemeral upload key from the wallet in a single approval. */
export async function fundSessionKey(umi: Umi, destination: string, amountSol: number) {
  const res = await transferSol(umi, { destination: publicKey(destination), amount: sol(amountSol) }).sendAndConfirm(umi);
  return sig58(res.signature);
}

/** Return whatever the session key has left to the wallet. */
export async function sweepSessionKey(uploadUmi: Umi, wallet: string) {
  const bal = await uploadUmi.rpc.getBalance(uploadUmi.payer.publicKey);
  const fee = 5000n;
  if (bal.basisPoints <= fee) return null;
  const res = await transferSol(uploadUmi, {
    source: uploadUmi.payer,
    destination: publicKey(wallet),
    amount: lamports(bal.basisPoints - fee),
  }).sendAndConfirm(uploadUmi);
  return sig58(res.signature);
}
