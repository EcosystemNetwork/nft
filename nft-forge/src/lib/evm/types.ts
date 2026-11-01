// Shared (client + server) types for Robinhood Chain (EVM) deployments.
import type { EvmNetwork } from "./chains";

export type EvmDeploymentStatus = "created" | "deploying" | "minting" | "minted" | "verified" | "failed" | "cancelled";

export interface EvmMintTx {
  tx: `0x${string}`;
  firstTokenId: number;
  quantity: number;
  status: "pending" | "confirmed" | "failed";
  error?: string;
  at: string;
}

export interface ContractParams {
  name: string;
  symbol: string;
  baseURI: string;
  contractURI: string;
  maxSupply: number;
  startTokenId: number;
  royaltyReceiver: `0x${string}`;
  royaltyBps: number;
  provenanceHash: `0x${string}`;
  owner: `0x${string}`;
}

export interface EvmDeployment {
  id: string;
  projectId: string;
  mode: "test" | "production";
  network: EvmNetwork;
  wallet: `0x${string}`;
  status: EvmDeploymentStatus;
  createdAt: string;
  updatedAt: string;
  fingerprint: string;
  approvalId?: string;
  params: ContractParams;
  /** How many tokens this deployment mints (test: first N; production: full supply). */
  mintTarget: number;
  /** Tokens minted per transaction (one wallet approval each). */
  batchSize: number;
  deployTx?: `0x${string}`;
  contract?: `0x${string}`;
  mints: EvmMintTx[];
  sourceVerification?: { status: "submitted" | "verified" | "failed"; message: string; guid?: string; at: string };
  verification?: { at: string; ok: boolean; checks: { label: string; ok: boolean; detail: string }[] };
  log: { at: string; level: "info" | "error"; msg: string }[];
  error?: string;
}

export interface EvmApproval {
  id: string;
  at: string;
  wallet: `0x${string}`;
  fingerprint: string;
  testDeploymentId: string;
  baseURI: string;
  checklist: { id: string; label: string; ok: boolean; detail: string }[];
  consumedBy?: string;
}

export type EvmEvent =
  | { type: "log"; level?: "info" | "error"; msg: string }
  | { type: "status"; status: "deploying" | "minting" | "minted" | "failed" | "cancelled"; error?: string }
  | { type: "deploy-sent"; tx: `0x${string}` }
  | { type: "deployed"; address: `0x${string}`; tx: `0x${string}` }
  | { type: "mint-sent"; tx: `0x${string}`; firstTokenId: number; quantity: number }
  | { type: "mint-confirmed"; tx: `0x${string}` }
  | { type: "mint-failed"; tx: `0x${string}`; error: string };

export const isEvmAddress = (s: unknown): s is `0x${string}` => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
export const isTxHash = (s: unknown): s is `0x${string}` => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);
