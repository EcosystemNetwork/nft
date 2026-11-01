// Core domain types for NFT Forge. The engine modules are pure (no I/O) so they
// can be unit-tested and reused by the API, background jobs and CLI scripts.

export type ProductionMode = "2d" | "3d" | "hybrid";
export type NftStatus = "draft" | "approved" | "locked";

export interface Trait {
  id: string;
  name: string;
  /** Relative weight inside its category. Normalized at selection time. */
  weight: number;
  /** Asset rendered for this trait (2D layer). Optional while designing. */
  assetId?: string;
}

export interface TraitCategory {
  id: string;
  name: string;
  /** Required categories always receive a trait; optional ones may be "None". */
  required: boolean;
  /** Weight of the implicit "None" option for optional categories. */
  noneWeight: number;
  /**
   * Draw order (z-index) when compositing. Lower renders first (further back).
   * Selection order is the array order of `categories`, which lets conditional
   * rules reference categories chosen earlier independent of layering.
   */
  layer: number;
  traits: Trait[];
}

/**
 * Rules are evaluated during selection, not just afterwards, so the engine never
 * proposes an invalid combination:
 *  - exclude:  `traitId` and `targetTraitId` can never appear together (symmetric).
 *  - require:  if `traitId` is chosen, category `targetCategoryId` must be one of
 *              `allowedTraitIds` (use "none" to allow an empty optional slot).
 *  - weight:   if `traitId` is chosen, the weight of `targetTraitId` is multiplied
 *              by `multiplier` (conditional probability).
 */
export type TraitRule =
  | { id: string; type: "exclude"; traitId: string; targetTraitId: string; note?: string }
  | {
      id: string;
      type: "require";
      traitId: string;
      targetCategoryId: string;
      allowedTraitIds: string[];
      note?: string;
    }
  | { id: string; type: "weight"; traitId: string; targetTraitId: string; multiplier: number; note?: string };

export const NONE = "none";

export interface RarityTier {
  name: string;
  /** Upper bound of the rank percentile, e.g. 0.01 = top 1%. Tiers sorted ascending. */
  maxPercentile: number;
}

export const DEFAULT_TIERS: RarityTier[] = [
  { name: "Mythic", maxPercentile: 0.01 },
  { name: "Legendary", maxPercentile: 0.05 },
  { name: "Epic", maxPercentile: 0.15 },
  { name: "Rare", maxPercentile: 0.35 },
  { name: "Uncommon", maxPercentile: 0.65 },
  { name: "Common", maxPercentile: 1 },
];

export interface MetadataTemplate {
  /** "erc721" (OpenSea / Ethereum style) or "metaplex" (Solana token metadata). */
  standard: "erc721" | "metaplex";
  collectionName: string;
  symbol: string;
  /** Supports {collection} and {id}. */
  namePattern: string;
  description: string;
  /** Base URI for images, e.g. "ipfs://<CID>/". Token file name is appended. */
  imageBaseUri: string;
  externalUrl: string;
  sellerFeeBasisPoints: number;
  /** Token IDs start at 0 or 1. */
  startTokenId: number;
}

export interface CanvasConfig {
  width: number;
  height: number;
  format: "png" | "jpeg";
}

export interface CollectionConfig {
  supply: number;
  seed: string;
  categories: TraitCategory[];
  rules: TraitRule[];
  tiers: RarityTier[];
  /** Max retries per token before declaring the configuration unsatisfiable. */
  maxAttemptsPerToken: number;
}

export interface Nft {
  tokenId: number;
  /** Stable hash of the sorted trait selection; identical DNA = duplicate. */
  dna: string;
  /** categoryId -> traitId, or NONE for an empty optional slot. */
  traits: Record<string, string>;
  status: NftStatus;
  /** Reproducibility record: the attempt index that produced this token. */
  attempt: number;
  /** Hash of the configuration version that produced this token. */
  configHash: string;
}

export interface GenerationResult {
  nfts: Nft[];
  configHash: string;
  seed: string;
  stats: { generated: number; preserved: number; retries: number; durationMs: number };
  /** Hard failures, e.g. tokens that could not satisfy the rules. */
  errors: string[];
  /** Warnings such as combination space close to supply. */
  warnings: string[];
}
