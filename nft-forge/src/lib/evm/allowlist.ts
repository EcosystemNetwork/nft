// Merkle allowlists for ForgeCollection sale phases. Leaves are OpenZeppelin
// StandardMerkleTree leaves of (address, uint256 allowance), which is exactly what
// ForgeCollection.mint verifies: keccak256(bytes.concat(keccak256(abi.encode(account, allowance)))).
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, isAddress } from "viem";

export interface AllowlistEntry {
  address: `0x${string}`;
  allowance: number;
}

export interface ParsedAllowlist {
  entries: AllowlistEntry[];
  errors: string[];
}

export const MAX_ALLOWLIST = 50_000;

/**
 * Parse "address[,allowance]" lines (CSV or whitespace separated). Duplicate
 * addresses are merged by taking the larger allowance; checksums are normalized.
 */
export function parseAllowlist(text: string, defaultAllowance = 1): ParsedAllowlist {
  const byAddr = new Map<string, AllowlistEntry>();
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [addr, amt] = line.split(/[\s,;]+/);
    if (i === 0 && /^address$/i.test(addr)) return; // header row
    if (!isAddress(addr, { strict: false })) {
      errors.push(`Line ${i + 1}: "${addr.slice(0, 50)}" is not an address`);
      return;
    }
    const allowance = amt === undefined || amt === "" ? defaultAllowance : Number(amt);
    if (!Number.isInteger(allowance) || allowance < 1 || allowance > 1_000_000) {
      errors.push(`Line ${i + 1}: allowance must be a whole number ≥ 1`);
      return;
    }
    const address = getAddress(addr);
    const prev = byAddr.get(address);
    byAddr.set(address, { address, allowance: Math.max(allowance, prev?.allowance ?? 0) });
  });
  if (byAddr.size > MAX_ALLOWLIST) errors.push(`At most ${MAX_ALLOWLIST.toLocaleString()} addresses per phase`);
  return { entries: [...byAddr.values()], errors };
}

const ENCODING = ["address", "uint256"];

export function buildTree(entries: AllowlistEntry[]) {
  if (!entries.length) throw new Error("Allowlist is empty");
  return StandardMerkleTree.of(
    entries.map((e) => [e.address, BigInt(e.allowance)]),
    ENCODING,
  );
}

export function allowlistRoot(entries: AllowlistEntry[]): `0x${string}` {
  return buildTree(entries).root as `0x${string}`;
}

/** Proof for one wallet, or null if it isn't on the list. */
export function allowlistProof(entries: AllowlistEntry[], wallet: string): { allowance: number; proof: `0x${string}`[] } | null {
  if (!isAddress(wallet, { strict: false })) return null;
  const want = getAddress(wallet);
  const tree = buildTree(entries);
  for (const [i, [addr, allowance]] of tree.entries()) {
    if (getAddress(addr as string) === want) return { allowance: Number(allowance), proof: tree.getProof(i) as `0x${string}`[] };
  }
  return null;
}

/** Every wallet's proof, keyed by lowercase address (one tree build). */
export function allProofs(entries: AllowlistEntry[]) {
  const tree = buildTree(entries);
  const out = new Map<string, { allowance: number; proof: `0x${string}`[] }>();
  for (const [i, [addr, allowance]] of tree.entries()) out.set((addr as string).toLowerCase(), { allowance: Number(allowance), proof: tree.getProof(i) as `0x${string}`[] });
  return out;
}
