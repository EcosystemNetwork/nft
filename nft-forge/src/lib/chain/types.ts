// Shared (client + server) deployment types. No Node or browser imports here.

export type Network = "devnet" | "mainnet-beta";
export type DeploymentMode = "test" | "production";
/** "irys": upload images + metadata to Arweave via Irys. "base": metadata is already hosted. */
export type UriMode = "irys" | "base";

export type ItemState = "pending" | "uploaded" | "minting" | "minted" | "verified" | "failed";

export interface DeployItem {
  tokenId: number;
  state: ItemState;
  imageUri?: string;
  metadataUri?: string;
  /** Asset address, recorded *before* the mint transaction is sent so crashes can be reconciled on-chain. */
  asset?: string;
  signature?: string;
  error?: string;
}

export type DeploymentStatus = "created" | "uploading" | "minting" | "minted" | "verified" | "failed" | "cancelled";

export interface Deployment {
  id: string;
  projectId: string;
  mode: DeploymentMode;
  network: Network;
  uriMode: UriMode;
  /** For uriMode "base": folder holding {tokenId}.json, and the collection metadata URI. */
  metadataBaseUri?: string;
  collectionMetadataUri?: string;
  /** Creator wallet public key. Never a secret. */
  wallet: string;
  status: DeploymentStatus;
  createdAt: string;
  updatedAt: string;
  /** Fingerprint of everything that defines the collection's content (config, tokens, template, canvas). */
  fingerprint: string;
  approvalId?: string;
  collection: { name: string; symbol: string; royaltyBps: number; uri?: string; address?: string; signature?: string };
  items: DeployItem[];
  txs: { kind: "fund" | "collection" | "mint" | "sweep"; signature: string; at: string; tokens?: number[] }[];
  log: { at: string; level: "info" | "error"; msg: string }[];
  verification?: { at: string; checked: number; ok: number; problems: string[] };
  error?: string;
}

export interface Approval {
  id: string;
  at: string;
  wallet: string;
  fingerprint: string;
  testDeploymentId: string;
  checklist: ReadinessCheck[];
  consumedBy?: string;
}

export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** Everything the client-side engine needs to run (or resume) a deployment. */
export interface DeployPlan {
  deploymentId: string;
  network: Network;
  uriMode: UriMode;
  wallet: string;
  collection: {
    name: string;
    symbol: string;
    royaltyBps: number;
    uri?: string;
    address?: string;
    metadata: Record<string, unknown>;
    imageTokenId: number;
  };
  tokens: {
    tokenId: number;
    name: string;
    /** Metadata JSON; the engine fills in image URIs for Irys uploads. */
    metadata: Record<string, unknown>;
    /** Path of the rendered image on this server, relative to its origin. */
    imagePath: string;
    imageBytes: number;
    state: ItemState;
    imageUri?: string;
    metadataUri?: string;
    asset?: string;
  }[];
}

export type DeployEvent =
  | { type: "log"; level?: "info" | "error"; msg: string }
  | { type: "status"; status: DeploymentStatus; error?: string }
  | { type: "uploaded"; items: { tokenId: number; imageUri?: string; metadataUri: string }[] }
  | { type: "collection"; address: string; uri: string; signature: string }
  | { type: "minting"; items: { tokenId: number; asset: string }[] }
  | { type: "minted"; items: { tokenId: number; asset: string; signature: string }[] }
  | { type: "failed"; items: { tokenId: number; error: string }[] }
  | { type: "tx"; kind: "fund" | "sweep"; signature: string };

export const RPC: Record<Network, string> = {
  devnet: process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC || "https://api.devnet.solana.com",
  "mainnet-beta": process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
};

export function explorerUrl(network: Network, kind: "address" | "tx", value: string) {
  return `https://explorer.solana.com/${kind}/${value}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

export function isBase58Address(s: unknown): s is string {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}
export function isBase58Signature(s: unknown): s is string {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s);
}
