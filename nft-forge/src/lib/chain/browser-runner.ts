// Browser-only: wires the creator's wallet into the deployment engine.
// Loaded with dynamic import from the Deployment page so the Solana/Irys bundle
// is only downloaded when a deployment actually runs.

import { mplCore } from "@metaplex-foundation/mpl-core";
import { generateSigner, keypairIdentity, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { walletAdapterIdentity, type WalletAdapter } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { estimateCost, fundSessionKey, runDeployment, sweepSessionKey } from "./engine";
import { RPC, type DeployEvent, type DeployPlan } from "./types";

type IrysExtras = { getUploadPriceFromBytes: (bytes: number) => Promise<{ basisPoints: bigint }> };

export interface BrowserRunOptions {
  wallet: WalletAdapter;
  report: (e: DeployEvent) => Promise<void>;
  onProgress: (p: { phase: string; done: number; total: number }) => void;
  shouldStop: () => boolean;
  /** Ask the user to confirm funding the upload session key. */
  confirmFunding: (amountSol: number) => Promise<boolean>;
  priorityMicroLamports?: number;
  batchSize?: number;
}

function walletUmi(network: DeployPlan["network"], wallet: WalletAdapter) {
  return createUmi(RPC[network]).use(mplCore()).use(walletAdapterIdentity(wallet));
}

/** A throwaway in-memory key that signs Arweave uploads so the wallet isn't prompted per file. */
function sessionUmi(network: DeployPlan["network"]): Umi {
  const umi = createUmi(RPC[network]).use(mplCore());
  umi.use(keypairIdentity(generateSigner(umi))).use(irysUploader());
  return umi;
}

/**
 * Network diagnostics, no wallet needed: RPC reachability and latency, rent,
 * an Irys price quote, and building and serializing a real Core mint transaction in
 * this browser (catches missing polyfills before a user starts a deployment).
 */
export async function diagnostics(network: DeployPlan["network"]) {
  const out: { check: string; ok: boolean; detail: string }[] = [];
  const umi = sessionUmi(network);
  const t0 = performance.now();
  try {
    const bh = await umi.rpc.getLatestBlockhash();
    out.push({ check: "RPC", ok: true, detail: `${RPC[network]} · ${Math.round(performance.now() - t0)} ms · blockhash ${bh.blockhash.slice(0, 8)}…` });
    const rent = Number((await umi.rpc.getRent(200)).basisPoints) / 1e9;
    out.push({ check: "Rent", ok: true, detail: `${rent.toFixed(6)} SOL per Core asset account (approx.)` });
    const { packMints } = await import("./engine");
    const coll = generateSigner(umi);
    const groups = packMints(
      umi,
      { publicKey: coll.publicKey, oracles: undefined, lifecycleHooks: undefined } as never,
      Array.from({ length: 8 }, (_, i) => ({ asset: generateSigner(umi), name: `Test #${i}`, uri: `https://gateway.irys.xyz/${"x".repeat(43)}` })),
    );
    const tx = groups[0].builder.setBlockhash(bh).build(umi);
    const bytes = umi.transactions.serialize(tx).length;
    out.push({ check: "Transaction builder", ok: true, detail: `8 mints → ${groups.length} txs (${groups[0].idx.length}/tx), ${bytes} bytes serialized` });
  } catch (e) {
    out.push({ check: "RPC / builder", ok: false, detail: (e as Error).message.slice(0, 200) });
  }
  try {
    const price = Number((await (umi.uploader as unknown as IrysExtras).getUploadPriceFromBytes(1_000_000)).basisPoints) / 1e9;
    out.push({ check: "Arweave (Irys)", ok: true, detail: `${price.toFixed(6)} SOL per MB` });
  } catch (e) {
    out.push({ check: "Arweave (Irys)", ok: false, detail: (e as Error).message.slice(0, 200) });
  }
  return out;
}

export async function estimate(plan: DeployPlan, wallet: WalletAdapter) {
  const umi = walletUmi(plan.network, wallet);
  const up = plan.uriMode === "irys" ? sessionUmi(plan.network) : undefined;
  return estimateCost(plan, umi, up ? async (b) => Number((await (up.uploader as unknown as IrysExtras).getUploadPriceFromBytes(b)).basisPoints) / 1e9 : undefined);
}

export async function runInBrowser(plan: DeployPlan, o: BrowserRunOptions) {
  const umi = walletUmi(plan.network, o.wallet);
  const needsUpload = plan.uriMode === "irys" && (plan.tokens.some((t) => !t.metadataUri) || !plan.collection.uri);
  let uploadUmi: Umi | undefined;
  if (needsUpload) {
    uploadUmi = sessionUmi(plan.network);
    const bytes =
      plan.tokens.filter((t) => !t.metadataUri).reduce((s, t) => s + t.imageBytes + 2048 + JSON.stringify(t.metadata).length, 0) + 4096;
    const price = Number((await (uploadUmi.uploader as unknown as IrysExtras).getUploadPriceFromBytes(bytes)).basisPoints) / 1e9;
    // Buffer covers Irys's funding transaction fees; anything unspent is swept back.
    const amount = Math.ceil((price * 1.15 + 0.003) * 1e6) / 1e6;
    if (!(await o.confirmFunding(amount))) {
      await o.report({ type: "status", status: "cancelled", error: "Upload funding declined." });
      return { minted: 0, failed: 0, stopped: true };
    }
    const sig = await fundSessionKey(umi, uploadUmi.identity.publicKey.toString(), amount);
    await o.report({ type: "tx", kind: "fund", signature: sig });
    await o.report({ type: "log", msg: `Funded upload session key with ${amount} SOL` });
  }
  try {
    return await runDeployment(plan, {
      umi,
      uploadUmi,
      fetchImage: async (p) => new Uint8Array(await (await fetch(p)).arrayBuffer()),
      report: o.report,
      onProgress: o.onProgress,
      shouldStop: o.shouldStop,
      batchSize: o.batchSize,
      priorityMicroLamports: o.priorityMicroLamports,
    });
  } finally {
    if (uploadUmi) {
      try {
        const sig = await sweepSessionKey(uploadUmi, umi.identity.publicKey.toString());
        if (sig) await o.report({ type: "tx", kind: "sweep", signature: sig });
      } catch (e) {
        await o.report({ type: "log", level: "error", msg: `Could not sweep upload key: ${(e as Error).message.slice(0, 200)}` });
      }
    }
  }
}
