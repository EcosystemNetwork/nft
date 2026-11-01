import { NONE, type CanvasConfig, type MetadataTemplate, type Nft, type TraitCategory } from "./types";

export interface Attribute {
  trait_type: string;
  value: string;
}

export type TokenMetadata = Record<string, unknown> & {
  name: string;
  description: string;
  image: string;
  attributes: Attribute[];
};

export function imageFileName(tokenId: number, canvas: CanvasConfig): string {
  return `${tokenId}.${canvas.format === "jpeg" ? "jpg" : "png"}`;
}

export function joinUri(base: string, file: string): string {
  if (!base) return file;
  return base.endsWith("/") ? base + file : `${base}/${file}`;
}

export function tokenAttributes(categories: TraitCategory[], nft: Nft): Attribute[] {
  const out: Attribute[] = [];
  for (const c of categories) {
    const v = nft.traits[c.id] ?? NONE;
    if (v === NONE) continue; // Empty optional slots are omitted, the common marketplace convention.
    const t = c.traits.find((x) => x.id === v);
    out.push({ trait_type: c.name, value: t?.name ?? v });
  }
  return out;
}

/** Metadata templates are per-standard rather than assuming every chain is the same. */
export function buildTokenMetadata(
  template: MetadataTemplate,
  categories: TraitCategory[],
  canvas: CanvasConfig,
  nft: Nft,
): TokenMetadata {
  const file = imageFileName(nft.tokenId, canvas);
  const image = joinUri(template.imageBaseUri, file);
  const name = template.namePattern
    .replaceAll("{collection}", template.collectionName)
    .replaceAll("{id}", String(nft.tokenId));
  const attributes = tokenAttributes(categories, nft);
  const base = { name, description: template.description, image, attributes };
  const external = template.externalUrl ? { external_url: joinUri(template.externalUrl, String(nft.tokenId)) } : {};

  if (template.standard === "metaplex") {
    return {
      name,
      symbol: template.symbol,
      description: template.description,
      seller_fee_basis_points: template.sellerFeeBasisPoints,
      image,
      ...external,
      attributes,
      properties: {
        files: [{ uri: image, type: canvas.format === "jpeg" ? "image/jpeg" : "image/png" }],
        category: "image",
      },
    };
  }
  return { ...base, ...external };
}

export function buildCollectionMetadata(template: MetadataTemplate, supply: number) {
  return {
    name: template.collectionName,
    symbol: template.symbol,
    description: template.description,
    external_url: template.externalUrl || undefined,
    seller_fee_basis_points: template.sellerFeeBasisPoints,
    supply,
    standard: template.standard,
  };
}

export function validateTokenMetadata(meta: TokenMetadata, template: MetadataTemplate): string[] {
  const problems: string[] = [];
  if (!meta.name?.trim()) problems.push("missing name");
  if (!meta.description?.trim()) problems.push("missing description");
  if (!meta.image?.trim()) problems.push("missing image URI");
  if (!Array.isArray(meta.attributes) || meta.attributes.length === 0) problems.push("no attributes");
  for (const a of meta.attributes ?? [])
    if (!a.trait_type || a.value === undefined || a.value === "") problems.push(`attribute with empty field`);
  if (template.standard === "metaplex") {
    if (!template.symbol) problems.push("metaplex requires a symbol");
    if (template.symbol && template.symbol.length > 10) problems.push("metaplex symbol must be 10 characters or fewer");
    if (meta.name.length > 32) problems.push("metaplex name must be 32 characters or fewer");
    if (template.sellerFeeBasisPoints < 0 || template.sellerFeeBasisPoints > 10000)
      problems.push("seller_fee_basis_points must be 0-10000");
  }
  return problems;
}
