// Robinhood Chain networks (Arbitrum Orbit L2, ETH gas). Values match
// https://docs.robinhood.com/chain/connecting and viem's built-in definitions; the
// RPC is pinned to Robinhood's official endpoints (overridable for production use,
// since the public RPC is rate-limited).
import { defineChain, type Chain } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";

export type EvmNetwork = "robinhood-testnet" | "robinhood";

const withRpc = (c: Chain, url: string | undefined, fallback: string) =>
  defineChain({ ...c, rpcUrls: { default: { http: [url || fallback] } } });

export const EVM_CHAINS: Record<EvmNetwork, Chain> = {
  "robinhood-testnet": withRpc(robinhoodTestnet, process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC, "https://rpc.testnet.chain.robinhood.com"),
  robinhood: withRpc(robinhood, process.env.NEXT_PUBLIC_ROBINHOOD_RPC, "https://rpc.mainnet.chain.robinhood.com"),
};

export const NETWORK_LABEL: Record<EvmNetwork, string> = {
  "robinhood-testnet": "Robinhood Chain Testnet",
  robinhood: "Robinhood Chain",
};

export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";
export const BRIDGE_URL = "https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum";

export function evmExplorer(network: EvmNetwork, kind: "address" | "tx" | "token", value: string) {
  return `${EVM_CHAINS[network].blockExplorers!.default.url}/${kind}/${value}`;
}

export function explorerApi(network: EvmNetwork) {
  return EVM_CHAINS[network].blockExplorers!.default.apiUrl!;
}
