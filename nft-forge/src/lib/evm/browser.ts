// Browser-only Robinhood Chain deployment runner (viem + the user's wallet).
// Loaded with dynamic import from the Deployment page.
//
// On-chain state is the source of truth for resuming: the next batch always
// starts at `totalMinted()`, and pending transactions recorded by the server are
// awaited first, so a resumed run can't double-mint or overshoot its target.

import { createPublicClient, createWalletClient, custom, encodeDeployData, formatEther, http, numberToHex, type Abi, type Hex } from "viem";
import type { Eip1193Provider } from "@/components/evm-wallet";
import { EVM_CHAINS, type EvmNetwork } from "./chains";
import artifact from "./ForgeCollection.artifact.json";
import type { EvmDeployment, EvmEvent } from "./types";

const ABI = artifact.abi as Abi;
type Dep = EvmDeployment & { constructorArgs: (string | number)[] };

/** Constructor args come from the server as JSON; restore the uint256 fields. */
function ctorArgs(d: Dep) {
  const a = d.constructorArgs;
  return [a[0], a[1], a[2], a[3], BigInt(a[4]), BigInt(a[5]), a[6], BigInt(a[7]), a[8], a[9]] as const;
}

export async function ensureChain(provider: Eip1193Provider, network: EvmNetwork) {
  const chain = EVM_CHAINS[network];
  const hexId = numberToHex(chain.id);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test((e as Error).message ?? "")) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http,
          blockExplorerUrls: [chain.blockExplorers!.default.url],
        },
      ],
    });
  }
}

/** Real cost estimate from the chain (deployment simulated with the exact constructor args). */
export async function estimateEvm(d: Dep) {
  const pub = createPublicClient({ chain: EVM_CHAINS[d.network], transport: http() });
  const data = encodeDeployData({ abi: ABI, bytecode: artifact.bytecode as Hex, args: ctorArgs(d) });
  const [deployGas, gasPrice, balance] = await Promise.all([
    d.contract ? Promise.resolve(0n) : pub.estimateGas({ account: d.wallet, data }),
    pub.getGasPrice(),
    pub.getBalance({ address: d.wallet }),
  ]);
  // Measured on Robinhood Chain: ~25.5k gas per token inside a 250-token batch (incl. L1 data fee).
  const remaining = BigInt(d.mintTarget);
  const mintGas = remaining * 25_500n + BigInt(Math.ceil(d.mintTarget / d.batchSize)) * 60_000n;
  const total = (deployGas + mintGas) * gasPrice;
  return {
    deployEth: formatEther(deployGas * gasPrice),
    mintEth: formatEther(mintGas * gasPrice),
    totalEth: formatEther(total),
    gasPriceGwei: Number(gasPrice) / 1e9,
    balanceEth: formatEther(balance),
    enough: balance >= (total * 3n) / 2n,
    txs: (d.contract ? 0 : 1) + Math.ceil(d.mintTarget / d.batchSize),
  };
}

export async function evmDiagnostics(network: EvmNetwork) {
  const chain = EVM_CHAINS[network];
  const pub = createPublicClient({ chain, transport: http() });
  const out: { check: string; ok: boolean; detail: string }[] = [];
  const t0 = performance.now();
  try {
    const id = await pub.getChainId();
    out.push({ check: "RPC", ok: id === chain.id, detail: `${chain.rpcUrls.default.http[0]} · chain ${id} · ${Math.round(performance.now() - t0)} ms` });
    const [block, gas] = await Promise.all([pub.getBlockNumber(), pub.getGasPrice()]);
    out.push({ check: "Network", ok: true, detail: `block ${block.toLocaleString()} · gas ${(Number(gas) / 1e9).toFixed(4)} gwei` });
    const from = "0x000000000000000000000000000000000000f0F0" as const;
    const data = encodeDeployData({
      abi: ABI,
      bytecode: artifact.bytecode as Hex,
      args: ["Diag", "DIAG", "ipfs://x/", "ipfs://x/c.json", 3333n, 1n, from, 500n, `0x${"11".repeat(32)}`, from],
    });
    const res = await pub.call({ account: from, data });
    out.push({ check: "Contract simulation", ok: res.data === artifact.deployedBytecode, detail: `ForgeCollection deploys on ${chain.name} (${((res.data!.length - 2) / 2).toLocaleString()} bytes)` });
  } catch (e) {
    out.push({ check: "RPC / simulation", ok: false, detail: (e as Error).message.slice(0, 200) });
  }
  return out;
}

export interface EvmRunOptions {
  provider: Eip1193Provider;
  account: `0x${string}`;
  report: (e: EvmEvent) => Promise<void>;
  onProgress: (p: { phase: "deploy" | "mint"; done: number; total: number }) => void;
  shouldStop: () => boolean;
}

export async function runEvmDeployment(d: Dep, o: EvmRunOptions) {
  if (o.account.toLowerCase() !== d.wallet.toLowerCase()) throw new Error("Connect the wallet that created this deployment.");
  const chain = EVM_CHAINS[d.network];
  await ensureChain(o.provider, d.network);
  const wallet = createWalletClient({ account: o.account, chain, transport: custom(o.provider) });
  const pub = createPublicClient({ chain, transport: http() });
  const confirmed = async (hash: Hex) => pub.waitForTransactionReceipt({ hash, timeout: 180_000 });

  try {
    // 1. Contract.
    let address = d.contract;
    if (!address && d.deployTx) {
      const r = await confirmed(d.deployTx);
      if (r.status === "success" && r.contractAddress) {
        address = r.contractAddress;
        await o.report({ type: "deployed", address, tx: d.deployTx });
      }
    }
    if (!address) {
      await o.report({ type: "status", status: "deploying" });
      o.onProgress({ phase: "deploy", done: 0, total: 1 });
      const hash = await wallet.deployContract({ abi: ABI, bytecode: artifact.bytecode as Hex, args: ctorArgs(d) });
      await o.report({ type: "deploy-sent", tx: hash });
      const r = await confirmed(hash);
      if (r.status !== "success" || !r.contractAddress) throw new Error("Contract deployment reverted.");
      address = r.contractAddress;
      await o.report({ type: "deployed", address, tx: hash });
      o.onProgress({ phase: "deploy", done: 1, total: 1 });
    }

    // 2. Settle mints sent by an earlier run before reading on-chain supply.
    for (const m of d.mints.filter((x) => x.status === "pending")) {
      try {
        const r = await confirmed(m.tx);
        await o.report(r.status === "success" ? { type: "mint-confirmed", tx: m.tx } : { type: "mint-failed", tx: m.tx, error: "reverted" });
      } catch {
        await o.report({ type: "mint-failed", tx: m.tx, error: "not found / dropped" });
      }
    }

    // 3. Mint in batches until the target is reached (on-chain totalMinted is the truth).
    await o.report({ type: "status", status: "minting" });
    for (;;) {
      const minted = Number(await pub.readContract({ address, abi: ABI, functionName: "totalMinted" }));
      o.onProgress({ phase: "mint", done: minted, total: d.mintTarget });
      const remaining = d.mintTarget - minted;
      if (remaining <= 0) break;
      if (o.shouldStop()) {
        await o.report({ type: "status", status: "cancelled", error: "Paused by user. Resume to continue." });
        return { stopped: true, address };
      }
      const qty = Math.min(d.batchSize, remaining);
      const hash = await wallet.writeContract({ address, abi: ABI, functionName: "mintBatch", args: [o.account, BigInt(qty)] });
      await o.report({ type: "mint-sent", tx: hash, firstTokenId: d.params.startTokenId + minted, quantity: qty });
      const r = await confirmed(hash);
      if (r.status !== "success") {
        await o.report({ type: "mint-failed", tx: hash, error: "reverted" });
        throw new Error(`Mint of #${d.params.startTokenId + minted}… reverted.`);
      }
      await o.report({ type: "mint-confirmed", tx: hash });
    }
    await o.report({ type: "status", status: "minted" });
    return { stopped: false, address };
  } catch (e) {
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    await o.report({ type: "status", status: /reject|denied/i.test(msg) ? "cancelled" : "failed", error: msg.slice(0, 400) });
    throw e;
  }
}
