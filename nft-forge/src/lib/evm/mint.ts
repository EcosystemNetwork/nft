// Browser-only: collector minting on the public mint page.
import { createPublicClient, createWalletClient, custom, decodeEventLog, http, type Abi } from "viem";
import type { Eip1193Provider } from "@/components/evm-wallet";
import { ensureChain } from "./browser";
import { EVM_CHAINS, type EvmNetwork } from "./chains";
import artifact from "./ForgeCollection.artifact.json";

const ABI = artifact.abi as Abi;
const pub = (network: EvmNetwork) => createPublicClient({ chain: EVM_CHAINS[network], transport: http() });

export async function walletMinted(network: EvmNetwork, contract: `0x${string}`, phase: number, account: `0x${string}`) {
  return Number(await pub(network).readContract({ address: contract, abi: ABI, functionName: "mintedInPhase", args: [BigInt(phase), account] }));
}

export async function walletBalance(network: EvmNetwork, account: `0x${string}`) {
  return pub(network).getBalance({ address: account });
}

/** Simulate, send and confirm mint(phase, quantity, allowance, proof); returns the minted token IDs. */
export async function collectorMint(o: {
  provider: Eip1193Provider;
  account: `0x${string}`;
  network: EvmNetwork;
  contract: `0x${string}`;
  phase: number;
  quantity: number;
  priceWei: bigint;
  allowance: number;
  proof: `0x${string}`[];
  onSent?: (tx: `0x${string}`) => void;
}) {
  await ensureChain(o.provider, o.network);
  const chain = EVM_CHAINS[o.network];
  const client = pub(o.network);
  const args = [BigInt(o.phase), BigInt(o.quantity), BigInt(o.allowance), o.proof] as const;
  const value = o.priceWei * BigInt(o.quantity);
  // Simulating first turns contract errors (sold out, wallet limit, not allowlisted…) into readable messages before the wallet prompt.
  await client.simulateContract({ account: o.account, address: o.contract, abi: ABI, functionName: "mint", args, value });
  const wallet = createWalletClient({ account: o.account, chain, transport: custom(o.provider) });
  const tx = await wallet.writeContract({ address: o.contract, abi: ABI, functionName: "mint", args, value });
  o.onSent?.(tx);
  const r = await client.waitForTransactionReceipt({ hash: tx, timeout: 180_000 });
  if (r.status !== "success") throw new Error("The mint transaction reverted.");
  const ids: number[] = [];
  for (const log of r.logs) {
    if (log.address.toLowerCase() !== o.contract.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "Minted") {
        const a = ev.args as unknown as { firstTokenId: bigint; quantity: bigint };
        for (let i = 0n; i < a.quantity; i++) ids.push(Number(a.firstTokenId + i));
      }
    } catch {
      /* other events */
    }
  }
  return { tx, ids };
}

/** Human-readable reason for a failed mint (custom errors → plain language). */
export function mintError(e: unknown): string {
  const msg = `${(e as { shortMessage?: string }).shortMessage ?? ""} ${(e as Error).message ?? ""}`;
  const map: [RegExp, string][] = [
    [/User rejected|denied/i, "You cancelled the transaction in your wallet."],
    [/SalePaused/, "The sale is paused right now."],
    [/PhaseNotActive/, "This phase isn't open right now."],
    [/NotAllowlisted/, "This wallet isn't on the allowlist for this phase."],
    [/WalletLimitExceeded/, "That's more than this wallet can mint in this phase."],
    [/PhaseCapExceeded/, "Not enough tokens left in this phase."],
    [/MaxSupplyExceeded/, "Not enough tokens left. The collection may be sold out."],
    [/TooManyPerTx/, "Too many in one transaction (max 50)."],
    [/WrongPayment/, "The price changed. Refresh and try again."],
    [/insufficient funds|exceeds the balance/i, "Not enough ETH in this wallet for the price plus gas."],
  ];
  for (const [re, text] of map) if (re.test(msg)) return text;
  return msg.trim().slice(0, 240) || "Mint failed.";
}
