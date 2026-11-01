/**
 * End-to-end devnet deployment test, without a browser wallet.
 *
 *   npx tsx scripts/devnet-test-deploy.ts [projectId] [tokenCount]
 *
 * Uses a devnet-only test key (gitignored .devnet-test-keypair.json; fund it once at
 * https://faucet.solana.com), then runs the same deployment engine the browser uses:
 * Irys upload, Core collection with royalties, packed mints, then independent
 * on-chain verification. Results are recorded in the project's deployment history.
 */
import { promises as fs } from "node:fs";
import { mplCore } from "@metaplex-foundation/mpl-core";
import path from "node:path";
import { createSignerFromKeypair, keypairIdentity, sol } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { estimateCost, runDeployment } from "../src/lib/chain/engine";
import { explorerUrl, RPC } from "../src/lib/chain/types";
import { applyEvent, buildPlan, createDeployment, verifyDeployment } from "../src/lib/deployments";
import { existingRender } from "../src/lib/render";
import { getCollection, getProject } from "../src/lib/store";

const projectId = process.argv[2] ?? "space-pirates-genesis";
const count = Number(process.argv[3] ?? 3);

// Devnet-only test key, kept in a gitignored file so it can be funded once from
// the web faucet. Devnet SOL has no value; this script refuses to touch mainnet.
const KEY_FILE = path.join(process.cwd(), ".devnet-test-keypair.json");

async function loadKey(umi: ReturnType<typeof createUmi>) {
  try {
    const secret = new Uint8Array(JSON.parse(await fs.readFile(KEY_FILE, "utf8")) as number[]);
    return umi.eddsa.createKeypairFromSecretKey(secret);
  } catch {
    const kp = umi.eddsa.generateKeypair();
    await fs.writeFile(KEY_FILE, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
}

async function main() {
  const umi = createUmi(RPC.devnet).use(mplCore());
  if (!RPC.devnet.includes("devnet")) throw new Error("Refusing to run: RPC is not a devnet endpoint.");
  const kp = createSignerFromKeypair(umi, await loadKey(umi));
  umi.use(keypairIdentity(kp)).use(irysUploader());
  console.log(`Devnet test wallet: ${kp.publicKey}`);

  let balance = Number((await umi.rpc.getBalance(kp.publicKey)).basisPoints) / 1e9;
  if (balance < 0.05) {
    try {
      await umi.rpc.airdrop(kp.publicKey, sol(1));
      balance = Number((await umi.rpc.getBalance(kp.publicKey)).basisPoints) / 1e9;
    } catch (e) {
      console.log(`  RPC airdrop unavailable: ${(e as Error).message.slice(0, 90)}`);
    }
  }
  if (balance < 0.05) {
    console.log(`\nFund this devnet address with ~1 SOL at https://faucet.solana.com (network: Devnet), then re-run:\n\n  ${kp.publicKey}\n`);
    process.exit(2);
  }
  const startBalance = balance;
  console.log(`  balance: ${balance} SOL`);

  const dep = await createDeployment(projectId, { mode: "test", wallet: kp.publicKey.toString(), uriMode: "irys", testCount: count });
  console.log(`Deployment ${dep.id}: ${dep.items.length} tokens`);
  const plan = await buildPlan(projectId, dep.id);
  const project = await getProject(projectId);
  const nfts = new Map((await getCollection(projectId))!.nfts.map((n) => [n.tokenId, n]));

  const est = await estimateCost(plan, umi, async (bytes) => {
    const up = umi.uploader as unknown as { getUploadPriceFromBytes: (b: number) => Promise<{ basisPoints: bigint }> };
    return Number((await up.getUploadPriceFromBytes(bytes)).basisPoints) / 1e9;
  });
  console.log(`Estimated cost: ${est.total.toFixed(5)} SOL (upload ${est.upload.toFixed(5)}, rent ${(est.assetRent + est.collectionRent).toFixed(5)})`);

  const t0 = Date.now();
  const res = await runDeployment(plan, {
    umi,
    uploadUmi: umi,
    batchSize: 48,
    fetchImage: async (p) => {
      const tokenId = Number(p.split("/").at(-2));
      return new Uint8Array(await fs.readFile((await existingRender(project, nfts.get(tokenId)!))!));
    },
    report: async (e) => {
      await applyEvent(projectId, dep.id, e);
      if (e.type === "log") console.log(`  · ${e.msg}`);
      if (e.type === "status") console.log(`  status → ${e.status}${e.error ? ` (${e.error})` : ""}`);
      if (e.type === "collection") console.log(`  collection ${e.address}`);
      if (e.type === "minted") console.log(`  minted ${e.items.length} in tx ${e.items[0]?.signature.slice(0, 16)}…`);
    },
    onProgress: (p) => process.stdout.write(`  ${p.phase}: ${p.done}/${p.total}\n`),
  });
  console.log(`Engine finished in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, res);

  // Give the RPC a moment so freshly confirmed accounts are readable.
  await new Promise((r) => setTimeout(r, 2000));
  const v = await verifyDeployment(projectId, dep.id);
  console.log(`Verification: ${v.verification?.ok}/${v.verification?.checked} verified, status ${v.status}`);
  for (const p of v.verification?.problems ?? []) console.log(`  ! ${p}`);
  console.log(`Collection: ${explorerUrl("devnet", "address", v.collection.address!)}`);
  for (const it of v.items) console.log(`  #${it.tokenId} ${it.state} ${it.asset} ${it.metadataUri}`);
  const left = Number((await umi.rpc.getBalance(kp.publicKey)).basisPoints) / 1e9;
  console.log(`Spent ${(startBalance - left).toFixed(5)} SOL of devnet funds (estimate was ${est.total.toFixed(5)}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
