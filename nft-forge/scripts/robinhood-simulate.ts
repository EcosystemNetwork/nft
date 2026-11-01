/**
 * Tests the ForgeCollection contract on the *live* Robinhood Chain networks
 * without spending anything. A probe contract's constructor deploys the
 * collection, mints, exercises the access controls and freeze, then returns the
 * results; `eth_call` executes it on the real Nitro EVM, and `eth_estimateGas`
 * prices deployment and minting, including the L1 data fee.
 *
 *   npx tsx scripts/robinhood-simulate.ts [testnet|mainnet|both]
 */
import { readFileSync } from "node:fs";
import { createPublicClient, decodeAbiParameters, encodeDeployData, formatEther, http, keccak256, toHex, zeroAddress, type Hex } from "viem";
import { EVM_CHAINS, type EvmNetwork } from "../src/lib/evm/chains";
import artifact from "../src/lib/evm/ForgeCollection.artifact.json";

const probe = JSON.parse(readFileSync("tests/ForgeCollectionProbe.artifact.json", "utf8")) as { abi: unknown[]; bytecode: Hex };
const which = process.argv[2] ?? "both";
const networks: EvmNetwork[] = which === "testnet" ? ["robinhood-testnet"] : which === "mainnet" ? ["robinhood"] : ["robinhood-testnet", "robinhood"];
const SUPPLY = 3333n;
const BATCH = 250n;
// Any address works for eth_call/estimateGas: nothing is signed or sent.
const FROM = "0x000000000000000000000000000000000000f0F0" as const;

const RESULT = [
  {
    type: "tuple",
    components: [
      { name: "totalSupply", type: "uint256" },
      { name: "firstTokenURI", type: "string" },
      { name: "lastTokenURI", type: "string" },
      { name: "lastOwner", type: "address" },
      { name: "holderBalance", type: "uint256" },
      { name: "royaltyReceiver", type: "address" },
      { name: "royaltyAmount", type: "uint256" },
      { name: "interfaces", type: "bool" },
      { name: "overMintReverted", type: "bool" },
      { name: "nonOwnerReverted", type: "bool" },
      { name: "frozenReverted", type: "bool" },
      { name: "contractURI", type: "string" },
      { name: "provenanceOk", type: "bool" },
    ],
  },
] as const;

const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

async function run(network: EvmNetwork) {
  const chain = EVM_CHAINS[network];
  const client = createPublicClient({ chain, transport: http() });
  console.log(`\n${chain.name} (chain ${chain.id}) via ${chain.rpcUrls.default.http[0]}`);
  const chainId = await client.getChainId();
  check(chainId === chain.id, "RPC reports the expected chain ID", String(chainId));

  // 1. The real deployment's creation code returns exactly our runtime bytecode.
  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: ["Space Pirates", "SPIRATE", "ipfs://bafy/", "ipfs://bafy/collection.json", SUPPLY, 1n, FROM, 500n, keccak256(toHex("p")), FROM],
  });
  const created = await client.call({ account: FROM, data: deployData });
  check(created.data === artifact.deployedBytecode, "Contract deploys (creation returns the compiled runtime bytecode)", `${((created.data!.length - 2) / 2).toLocaleString()} bytes`);

  // 2. Behaviour: deploy + mint a full batch + access control + freeze, on the live EVM.
  const probeData = (mint: bigint) => encodeDeployData({ abi: probe.abi, bytecode: probe.bytecode, args: [mint, SUPPLY] });
  const res = await client.call({ account: FROM, data: probeData(BATCH), gas: 30_000_000n });
  const [r] = decodeAbiParameters(RESULT, res.data!);
  check(r.totalSupply === BATCH, `mintBatch(${BATCH}) mints sequential IDs`, `totalSupply ${r.totalSupply}`);
  check(r.firstTokenURI === "ipfs://bafyprobe/1.json" && r.lastTokenURI === `ipfs://bafyprobe/${BATCH}.json`, "tokenURI = base + id + .json", `${r.firstTokenURI} … ${r.lastTokenURI}`);
  check(r.lastOwner.toLowerCase() === "0x000000000000000000000000000000000000beef" && r.holderBalance === BATCH, "Recipient owns every minted token");
  check(r.royaltyReceiver.toLowerCase() === "0x0000000000000000000000000000000000c0ffee" && r.royaltyAmount === 500n, "ERC-2981 royalty 5% to creator");
  check(r.interfaces, "Supports ERC-721, ERC-2981 and ERC-4906 interfaces");
  check(r.overMintReverted, "Minting past max supply reverts");
  check(r.nonOwnerReverted, "Non-owner cannot mint");
  check(r.frozenReverted, "Frozen metadata cannot be changed");
  check(r.contractURI === "ipfs://bafyprobe/collection.json" && r.provenanceOk, "contractURI and provenance hash stored");

  // 3. Real costs on this chain (L2 execution + L1 data fee via eth_estimateGas).
  const [deployGas, probe0, probeN, gasPrice] = await Promise.all([
    client.estimateGas({ account: FROM, data: deployData }),
    client.estimateGas({ account: FROM, data: probeData(0n) }),
    client.estimateGas({ account: FROM, data: probeData(BATCH) }),
    client.getGasPrice(),
  ]);
  const batchGas = probeN - probe0;
  const batches = (SUPPLY + BATCH - 1n) / BATCH;
  const totalGas = deployGas + batchGas * batches;
  console.log(`  gas: deploy ${deployGas.toLocaleString()}, ${BATCH}-token batch ≈ ${batchGas.toLocaleString()} (${(batchGas / BATCH).toLocaleString()}/token)`);
  console.log(
    `  cost at current gas price ${(Number(gasPrice) / 1e9).toFixed(4)} gwei: deploy ${formatEther(deployGas * gasPrice)} ETH, full ${SUPPLY} mint in ${batches} txs ≈ ${formatEther(totalGas * gasPrice)} ETH`,
  );
  void zeroAddress;
}

(async () => {
  for (const n of networks) await run(n);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
