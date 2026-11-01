/**
 * Validates the deployment engine's transactions against the real Metaplex Core
 * program on devnet, without needing any SOL: transactions are built by the
 * engine's own code, then run through `simulateTransaction` with signature
 * verification off, using an existing funded devnet account as fee payer and
 * authority. Nothing is sent.
 *
 *   npx tsx scripts/devnet-simulate.ts [projectId]
 */
import { createCollection, mplCore, ruleSet, type CollectionV1 } from "@metaplex-foundation/mpl-core";
import { createNoopSigner, generateSigner, publicKey, signerIdentity } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { packMints } from "../src/lib/chain/engine";
import { RPC } from "../src/lib/chain/types";
import { buildTokenMetadata } from "../src/lib/engine/metadata";
import { getCollection, getProject } from "../src/lib/store";

const projectId = process.argv[2] ?? "space-pirates-genesis";

async function richDevnetAccount(): Promise<string> {
  const r = await fetch(RPC.devnet, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getVoteAccounts" }),
  });
  const j = (await r.json()) as { result: { current: { nodePubkey: string }[] } };
  return j.result.current[0].nodePubkey; // validator identity: always holds SOL for vote fees
}

async function main() {
  const project = await getProject(projectId);
  const nfts = (await getCollection(projectId))!.nfts.slice(0, 48);
  const umi = createUmi(RPC.devnet).use(mplCore());
  const payer = await richDevnetAccount();
  umi.use(signerIdentity(createNoopSigner(publicKey(payer))));
  const bal = Number((await umi.rpc.getBalance(publicKey(payer))).basisPoints) / 1e9;
  console.log(`Simulating as funded devnet account ${payer} (${bal.toFixed(2)} SOL); signatures not verified, nothing sent.\n`);

  // Arweave URIs are 43-char ids on the gateway: use a realistic length so tx packing is accurate.
  const fakeUri = (i: number) => `https://gateway.irys.xyz/${String(i).padStart(43, "x")}`;
  const collectionSigner = generateSigner(umi);
  const createColl = createCollection(umi, {
    collection: collectionSigner,
    name: `${project.metadata.collectionName} (Devnet Test)`,
    uri: fakeUri(0),
    plugins: [{ type: "Royalties", basisPoints: project.metadata.sellerFeeBasisPoints, creators: [{ address: umi.identity.publicKey, percentage: 100 }], ruleSet: ruleSet("None") }],
  });
  const collection = { publicKey: collectionSigner.publicKey, oracles: undefined, lifecycleHooks: undefined } as unknown as CollectionV1;
  const items = nfts.map((n, i) => ({
    asset: generateSigner(umi),
    name: buildTokenMetadata(project.metadata, project.config.categories, project.canvas, n).name,
    uri: fakeUri(i + 1),
  }));

  for (const priority of [0, 50_000]) {
    // The collection is created in the first transaction so the mints into it can be simulated together.
    const groups = packMints(umi, collection, items, priority || undefined, createColl);
    console.log(`Priority fee ${priority} µLamports/CU: ${items.length} mints packed into ${groups.length} transactions → [${groups.map((g) => g.idx.length).join(", ")}] per tx`);
    const bh = await umi.rpc.getLatestBlockhash();
    const g0 = groups[0];
    const tx = g0.builder.setBlockhash(bh).build(umi);
    const size = g0.builder.getTransactionSize(umi);
    const sim = await umi.rpc.simulateTransaction(tx, { verifySignatures: false });
    console.log(`  tx #1 (collection + ${g0.idx.length} mints): ${size} bytes, ${sim.unitsConsumed} CU, ${sim.err ? `ERROR ${JSON.stringify(sim.err)}` : "simulation OK"}`);
    if (sim.err) console.log((sim.logs ?? []).slice(-8).join("\n"));
    const created = (sim.logs ?? []).filter((l) => l.includes("Instruction: Create")).length;
    console.log(`  Core program logged ${created} Create instruction(s)\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
