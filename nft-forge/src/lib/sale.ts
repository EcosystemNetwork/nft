import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { allProofs, allowlistRoot, MAX_ALLOWLIST, type AllowlistEntry } from "./evm/allowlist";
import { isEvmAddress } from "./evm/types";
import { getProject, HttpError, newId, paths, withProjectLock, type Project } from "./store";

// ---------------------------------------------------------------------------
// Public sale configuration (Robinhood Chain / ForgeCollection). Stored per
// project; each deployment snapshots the parts that go into the constructor
// (reserve, delayed reveal, payout) and the creator pushes phases on-chain.
// ---------------------------------------------------------------------------

export const MAX_PHASES = 8;
export const MAX_PER_TX = 50;

export interface SalePhase {
  id: string;
  name: string;
  /** ISO timestamps. `end` null = open-ended. */
  start: string;
  end: string | null;
  /** Price per token in wei (decimal string). */
  priceWei: string;
  /** Public phases: 0 = unlimited. Allowlist phases use each entry's allowance. */
  maxPerWallet: number;
  /** Max tokens sold in this phase; 0 = no cap. */
  cap: number;
  /** null = open to everyone. */
  allowlist: AllowlistEntry[] | null;
}

export interface SaleConfig {
  /** false: the creator mints the whole supply (reserve = supply, no phases). */
  enabled: boolean;
  /** Team reserve minted by the owner (ignored when `enabled` is false). */
  reserved: number;
  delayedReveal: boolean;
  unrevealed: { name: string; description: string };
  /** Where sale proceeds go. Defaults to the deploying wallet. */
  payout: `0x${string}` | null;
  phases: SalePhase[];
  /** Deployment the public mint page sells from. */
  liveDeploymentId: string | null;
  updatedAt: string;
}

const file = (projectId: string) => path.join(paths.project(projectId), "sale.json");

export function defaultSale(project: Project): SaleConfig {
  return {
    enabled: false,
    reserved: 0,
    delayedReveal: true,
    unrevealed: { name: `${project.metadata.collectionName} — Unrevealed`, description: "Artwork is revealed after the mint." },
    payout: null,
    phases: [],
    liveDeploymentId: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getSale(projectId: string): Promise<SaleConfig> {
  const project = await getProject(projectId);
  try {
    return { ...defaultSale(project), ...(JSON.parse(await fs.readFile(file(projectId), "utf8")) as SaleConfig) };
  } catch {
    return defaultSale(project);
  }
}

async function writeSale(projectId: string, s: SaleConfig) {
  const f = file(projectId);
  const tmp = `${f}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s));
  await fs.rename(tmp, f);
}

const isWei = (s: unknown): s is string => typeof s === "string" && /^\d{1,40}$/.test(s);
const U32 = 2 ** 32 - 1;

/** Validate a full sale config; returns problems (empty = valid). */
export function saleProblems(s: SaleConfig, supply: number): string[] {
  const out: string[] = [];
  if (!s.enabled) return out;
  if (!Number.isInteger(s.reserved) || s.reserved < 0 || s.reserved > supply) out.push(`Reserve must be 0–${supply}`);
  if (s.reserved === supply) out.push("The reserve is the whole supply, so nothing is left to sell.");
  if (s.payout !== null && !isEvmAddress(s.payout)) out.push("Payout must be an address");
  if (!s.phases.length) out.push("Add at least one sale phase");
  if (s.phases.length > MAX_PHASES) out.push(`At most ${MAX_PHASES} phases`);
  s.phases.forEach((p, i) => {
    const label = `Phase ${i + 1} (${p.name || "unnamed"})`;
    const start = Date.parse(p.start);
    const end = p.end ? Date.parse(p.end) : null;
    if (!p.name?.trim()) out.push(`${label}: name it`);
    if (Number.isNaN(start)) out.push(`${label}: invalid start time`);
    if (end !== null && (Number.isNaN(end) || end <= start)) out.push(`${label}: end must be after start`);
    if (!isWei(p.priceWei)) out.push(`${label}: invalid price`);
    if (!Number.isInteger(p.maxPerWallet) || p.maxPerWallet < 0 || p.maxPerWallet > U32) out.push(`${label}: invalid wallet limit`);
    if (!Number.isInteger(p.cap) || p.cap < 0 || p.cap > U32) out.push(`${label}: invalid phase cap`);
    if (p.allowlist) {
      if (!p.allowlist.length) out.push(`${label}: allowlist is empty`);
      if (p.allowlist.length > MAX_ALLOWLIST) out.push(`${label}: allowlist too large`);
      if (p.allowlist.some((e) => !isEvmAddress(e.address) || !Number.isInteger(e.allowance) || e.allowance < 1)) out.push(`${label}: invalid allowlist entry`);
    }
  });
  return out;
}

export async function updateSale(projectId: string, patch: Partial<SaleConfig>): Promise<SaleConfig> {
  const project = await getProject(projectId);
  return withProjectLock(`${projectId}:sale`, async () => {
    const cur = await getSale(projectId);
    const next: SaleConfig = { ...cur, updatedAt: new Date().toISOString() };
    if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
    if (patch.reserved !== undefined) next.reserved = Math.floor(Number(patch.reserved));
    if (patch.delayedReveal !== undefined) next.delayedReveal = Boolean(patch.delayedReveal);
    if (patch.unrevealed) next.unrevealed = { name: String(patch.unrevealed.name ?? "").slice(0, 200), description: String(patch.unrevealed.description ?? "").slice(0, 2000) };
    if (patch.payout !== undefined) next.payout = patch.payout ? (patch.payout as `0x${string}`) : null;
    if (patch.liveDeploymentId !== undefined) next.liveDeploymentId = patch.liveDeploymentId || null;
    if (patch.phases) {
      next.phases = patch.phases.map((p) => ({
        id: p.id && /^[\w-]{1,40}$/.test(p.id) ? p.id : newId("ph"),
        name: String(p.name ?? "").slice(0, 60),
        start: String(p.start),
        end: p.end ? String(p.end) : null,
        priceWei: String(p.priceWei ?? "0"),
        maxPerWallet: Math.floor(Number(p.maxPerWallet ?? 0)),
        cap: Math.floor(Number(p.cap ?? 0)),
        allowlist: p.allowlist ? p.allowlist.map((e) => ({ address: e.address, allowance: Math.floor(Number(e.allowance)) })) : null,
      }));
    }
    const problems = saleProblems(next, project.config.supply);
    if (problems.length) throw new HttpError(400, problems.join("; "));
    await writeSale(projectId, next);
    return next;
  });
}

// Tree builds are O(n log n) keccaks; memoize by list content so request handlers stay cheap.
const listKey = (l: AllowlistEntry[]) => createHash("sha256").update(JSON.stringify(l)).digest("hex");
const roots = new Map<string, `0x${string}`>();
function rootOf(l: AllowlistEntry[]) {
  const k = listKey(l);
  let r = roots.get(k);
  if (!r) {
    r = allowlistRoot(l);
    if (roots.size >= 64) roots.delete(roots.keys().next().value!);
    roots.set(k, r);
  }
  return r;
}

/** The phase as the contract stores it. */
export function phaseOnChain(p: SalePhase) {
  return {
    start: BigInt(Math.floor(Date.parse(p.start) / 1000)),
    end: p.end ? BigInt(Math.floor(Date.parse(p.end) / 1000)) : 0n,
    price: BigInt(p.priceWei),
    maxPerWallet: p.allowlist ? 0 : p.maxPerWallet,
    cap: p.cap,
    merkleRoot: p.allowlist ? rootOf(p.allowlist) : (`0x${"0".repeat(64)}` as `0x${string}`),
  };
}

/** Public view of the phases (no allowlist contents), safe to serve to anyone. */
export function publicPhases(s: SaleConfig) {
  return s.phases.map((p, i) => {
    const c = phaseOnChain(p);
    return {
      index: i,
      name: p.name,
      start: p.start,
      end: p.end,
      priceWei: p.priceWei,
      maxPerWallet: p.maxPerWallet,
      cap: p.cap,
      allowlisted: Boolean(p.allowlist),
      allowlistSize: p.allowlist?.length ?? 0,
      merkleRoot: c.merkleRoot,
    };
  });
}

// Building a 50k-leaf tree per request is slow: build once per allowlist root and index every proof.
const proofCache = new Map<string, ReturnType<typeof allProofs>>();
export function phaseProof(p: SalePhase, wallet: string) {
  if (!p.allowlist) return null;
  const root = phaseOnChain(p).merkleRoot;
  let m = proofCache.get(root);
  if (!m) {
    m = allProofs(p.allowlist);
    if (proofCache.size >= 32) proofCache.delete(proofCache.keys().next().value!);
    proofCache.set(root, m);
  }
  return m.get(wallet.toLowerCase()) ?? null;
}

// ------------------------------------------------------------ unrevealed art

/** Placeholder artwork shown before reveal: a dark card with a large question mark. */
export async function unrevealedImage(project: Project): Promise<Buffer> {
  const w = project.canvas.width;
  const h = project.canvas.height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#2a2140"/><stop offset="1" stop-color="#0b0a12"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(Math.min(w, h) * 0.42)}" fill="#a78bfa" fill-opacity="0.9">?</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export function unrevealedMetadata(s: SaleConfig, image: string) {
  return { name: s.unrevealed.name, description: s.unrevealed.description, image, attributes: [] as unknown[] };
}
