/**
 * End-to-end Robinhood Chain *Testnet* deployment from the command line, running the
 * exact browser runner (src/lib/evm/browser.ts) behind a small EIP-1193 shim in
 * place of a wallet extension.
 *
 *   npx tsx scripts/robinhood-testnet-deploy.ts [projectId] [tokenCount]
 *
 * Uses a testnet-only key in the gitignored .robinhood-testnet-key.json. Fund the
 * printed address once at https://faucet.testnet.chain.robinhood.com, then re-run.
 * Keep `npm start` running so the preview metadata URLs resolve during verification.
 * This script refuses to run against mainnet.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EVM_CHAINS, evmExplorer } from "../src/lib/evm/chains";
import { runEvmDeployment } from "../src/lib/evm/browser";
import type { Eip1193Provider } from "../src/components/evm-wallet";
import { applyEvmEvent, constructorArgs, createEvmDeployment, getEvmDeployment, submitSourceVerification, verifyEvmDeployment } from "../src/lib/evm-deployments";

const projectId = process.argv[2] ?? "space-pirates-genesis";
const count = Number(process.argv[3] ?? 25);
const KEY_FILE = path.join(process.cwd(), ".robinhood-testnet-key.json");
const chain = EVM_CHAINS["robinhood-testnet"];
if (chain.id !== 46630) throw new Error("Refusing to run: not Robinhood Chain Testnet.");

async function loadKey(): Promise<Hex> {
  try {
    return (JSON.parse(await fs.readFile(KEY_FILE, "utf8")) as { privateKey: Hex }).privateKey;
  } catch {
    const privateKey = generatePrivateKey();
    await fs.writeFile(KEY_FILE, JSON.stringify({ note: "Robinhood Chain TESTNET only. Never fund on mainnet.", privateKey }));
    return privateKey;
  }
}

/** Minimal EIP-1193 provider backed by a local testnet key (what a wallet extension would do). */
function shimProvider(privateKey: Hex): Eip1193Provider {
  const account = privateKeyToAccount(privateKey);
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });
  return {
    async request({ method, params }) {
      const p = params as Record<string, string>[] | undefined;
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [account.address];
        case "eth_chainId":
          return `0x${chain.id.toString(16)}`;
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          if (p?.[0]?.chainId && Number(p[0].chainId) !== chain.id) throw Object.assign(new Error("Testnet-only key"), { code: 4902 });
          return null;
        case "eth_sendTransaction": {
          const tx = p![0];
          return wallet.sendTransaction({
            to: (tx.to as Hex) || undefined,
            data: tx.data as Hex,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? (BigInt(tx.gas) * 12n) / 10n : undefined,
          });
        }
        default:
          return pub.request({ method: method as "eth_blockNumber", params: params as never });
      }
    },
  };
}

async function main() {
  const privateKey = await loadKey();
  const account = privateKeyToAccount(privateKey);
  const pub = createPublicClient({ chain, transport: http() });
  const balance = await pub.getBalance({ address: account.address });
  console.log(`Testnet wallet ${account.address}: ${formatEther(balance)} ETH`);
  if (balance < 200_000_000_000_000n) {
    console.log(`\nFund this Robinhood Chain Testnet address at https://faucet.testnet.chain.robinhood.com, then re-run:\n\n  ${account.address}\n`);
    process.exit(2);
  }

  const created = await createEvmDeployment(projectId, { mode: "test", wallet: account.address, testCount: count }, process.env.FORGE_ORIGIN ?? "http://localhost:3000");
  console.log(`Deployment ${created.id}: minting ${created.mintTarget} of ${created.params.maxSupply}, provenance ${created.params.provenanceHash}`);
  const dep = { ...(await getEvmDeployment(projectId, created.id)), constructorArgs: constructorArgs(created.params).map((a) => (typeof a === "bigint" ? a.toString() : a)) };

  const t0 = Date.now();
  const res = await runEvmDeployment(dep as never, {
    provider: shimProvider(privateKey),
    account: account.address,
    report: async (e) => {
      await applyEvmEvent(projectId, created.id, e);
      if (e.type === "deployed") console.log(`  contract ${e.address}  ${evmExplorer("robinhood-testnet", "address", e.address)}`);
      if (e.type === "mint-sent") console.log(`  mint #${e.firstTokenId}–#${e.firstTokenId + e.quantity - 1}  tx ${e.tx}`);
      if (e.type === "status") console.log(`  status → ${e.status}${e.error ? ` (${e.error})` : ""}`);
    },
    onProgress: () => undefined,
    shouldStop: () => false,
  });
  console.log(`Deployed and minted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const sv = await submitSourceVerification(projectId, created.id);
  console.log(`Source verification: ${sv.sourceVerification?.status} — ${sv.sourceVerification?.message}`);
  await new Promise((r) => setTimeout(r, 15000));
  const v = await verifyEvmDeployment(projectId, created.id);
  console.log(`\nOn-chain verification: ${v.verification?.ok ? "PASSED" : "FAILED"} · status ${v.status}`);
  for (const c of v.verification?.checks ?? []) console.log(`  ${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}`);
  console.log(`  source: ${v.sourceVerification?.status ?? "—"}`);
  const after = await pub.getBalance({ address: account.address });
  console.log(`\nSpent ${formatEther(balance - after)} test ETH. Contract: ${evmExplorer("robinhood-testnet", "address", res.address!)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
