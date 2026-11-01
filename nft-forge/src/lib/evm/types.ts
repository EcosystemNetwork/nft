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

/** ForgeCollection.InitParams (constructor argument). */
export interface ContractParams {
  name: string;
  symbol: string;
  /** Empty for delayed-reveal collections until the reveal sets it. */
  baseURI: string;
  contractURI: string;
  /** Empty = revealed from the start. */
  unrevealedURI: string;
  maxSupply: number;
  startTokenId: number;
  /** Team reserve the owner mints; maxSupply = owner mints everything (no public sale). */
  reserved: number;
  royaltyReceiver: `0x${string}`;
  royaltyBps: number;
  provenanceHash: `0x${string}`;
  /** keccak256(abi.encode(secret)), or zero when not using delayed reveal. */
  revealCommitment: `0x${string}`;
  payout: `0x${string}`;
  owner: `0x${string}`;
}

export const ZERO_HASH = `0x${"0".repeat(64)}` as `0x${string}`;

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
  /** How many tokens the owner mints from the reserve (test: first N; production: the reserve). */
  mintTarget: number;
  /** Tokens minted per transaction (one wallet approval each). */
  batchSize: number;
  deployTx?: `0x${string}`;
  contract?: `0x${string}`;
  mints: EvmMintTx[];
  sourceVerification?: { status: "submitted" | "verified" | "failed"; message: string; guid?: string; at: string };
  verification?: { at: string; ok: boolean; checks: { label: string; ok: boolean; detail: string }[] };
  /** Prepared/applied delayed reveal. The secret itself is stored separately and never listed. */
  reveal?: { offset: number; entropy: `0x${string}`; baseURI: string; preparedAt: string; tx?: `0x${string}`; revealedAt?: string };
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
  | { type: "mint-failed"; tx: `0x${string}`; error: string }
  | { type: "reveal-sent"; tx: `0x${string}` };

export const isEvmAddress = (s: unknown): s is `0x${string}` => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
export const isTxHash = (s: unknown): s is `0x${string}` => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);

/** ContractParams → the constructor's InitParams tuple (uint fields as bigint). Shared by browser and server. */
export function toInitParams(p: ContractParams) {
  return {
    name: p.name,
    symbol: p.symbol,
    baseURI: p.baseURI,
    contractURI: p.contractURI,
    unrevealedURI: p.unrevealedURI,
    maxSupply: BigInt(p.maxSupply),
    startTokenId: BigInt(p.startTokenId),
    reserved: BigInt(p.reserved),
    royaltyReceiver: p.royaltyReceiver,
    royaltyBps: BigInt(p.royaltyBps),
    provenanceHash: p.provenanceHash,
    revealCommitment: p.revealCommitment,
    payout: p.payout,
    owner: p.owner,
  };
}

export interface OnchainPhase {
  start: number;
  end: number;
  priceWei: string;
  maxPerWallet: number;
  cap: number;
  merkleRoot: `0x${string}`;
  minted: number;
}

/** Live sale state read from the contract. */
export interface OnchainSale {
  totalMinted: number;
  reserveMinted: number;
  reserved: number;
  maxSupply: number;
  publicRemaining: number;
  paused: boolean;
  revealed: boolean;
  revealOffset: number;
  balanceWei: string;
  payout: `0x${string}`;
  phases: OnchainPhase[];
  readAt: string;
}
