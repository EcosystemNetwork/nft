import { createHash } from "node:crypto";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable JSON stringify (sorted keys) so hashes don't depend on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * Deterministic PRNG (sfc32) seeded from SHA-256 of the key. Each token gets its
 * own stream keyed by (seed, tokenId, attempt), so regenerating or re-ordering
 * one token never shifts the randomness of another.
 */
export function createRng(key: string): () => number {
  const h = createHash("sha256").update(key).digest();
  let a = h.readUInt32LE(0);
  let b = h.readUInt32LE(4);
  let c = h.readUInt32LE(8);
  let d = h.readUInt32LE(12);
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function weightedPick<T>(rng: () => number, items: { item: T; weight: number }[]): T | undefined {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const i of items) {
    r -= Math.max(0, i.weight);
    if (r < 0) return i.item;
  }
  return items[items.length - 1]?.item;
}
