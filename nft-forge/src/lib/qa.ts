import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildRuleIndex, configHash, validateCombination, validateConfig } from "./engine/generator";
import { buildTokenMetadata, validateTokenMetadata } from "./engine/metadata";
import { computeRarity } from "./engine/rarity";
import { NONE } from "./engine/types";
import { renderedSet } from "./render";
import { fileExists, getCollection, getProject, listAssets, paths } from "./store";

export type CheckStatus = "pass" | "warn" | "fail";
export interface QaCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  items?: string[];
}
export interface QaReport {
  projectId: string;
  generatedAt: string;
  passed: boolean;
  /** Whether the collection is fully rendered (export will render missing ones). */
  rendered: number;
  supply: number;
  statusCounts: Record<string, number>;
  checks: QaCheck[];
}

const MAX_ITEMS = 50;
const g = globalThis as unknown as { __forgeFp?: Map<string, string> };
const fpCache = (g.__forgeFp ??= new Map());

/**
 * Visual fingerprint: the render downscaled to 128×128 and quantized to 4 bits per
 * channel, then hashed. Equal fingerprints mean two tokens look the same to a viewer
 * (e.g. different trait names sharing identical art, or a layer fully hidden by
 * another), while small but real differences such as a changed mouth still differ.
 * Cached per render file, whose name includes the DNA.
 */
async function fingerprint(file: string): Promise<string> {
  const hit = fpCache.get(file);
  if (hit) return hit;
  const px = await sharp(file).flatten({ background: "#000" }).resize(128, 128, { fit: "fill" }).removeAlpha().raw().toBuffer();
  for (let i = 0; i < px.length; i++) px[i] >>= 4;
  const h = createHash("sha1").update(px).digest("hex");
  fpCache.set(file, h);
  return h;
}

function check(id: string, label: string, problems: string[], okDetail: string, level: CheckStatus = "fail"): QaCheck {
  return problems.length
    ? { id, label, status: level, detail: `${problems.length} issue(s)`, items: problems.slice(0, MAX_ITEMS) }
    : { id, label, status: "pass", detail: okDetail };
}

export async function runQa(projectId: string, opts: { visualDuplicates?: boolean } = {}): Promise<QaReport> {
  const project = await getProject(projectId);
  const collection = await getCollection(projectId);
  const assets = await listAssets(projectId);
  const nfts = collection?.nfts ?? [];
  const cfg = project.config;
  const checks: QaCheck[] = [];

  const cv = validateConfig(cfg);
  checks.push(
    cv.errors.length
      ? { id: "config", label: "Trait configuration", status: "fail", detail: "Configuration errors", items: cv.errors }
      : cv.warnings.length
        ? { id: "config", label: "Trait configuration", status: "warn", detail: "Warnings", items: cv.warnings }
        : { id: "config", label: "Trait configuration", status: "pass", detail: "Valid" },
  );

  checks.push(
    check(
      "supply",
      "Collection supply",
      nfts.length === cfg.supply ? [] : [`Collection has ${nfts.length} tokens, configured supply is ${cfg.supply}.`],
      `${nfts.length} tokens`,
    ),
  );

  const start = project.metadata.startTokenId;
  const ids = nfts.map((n) => n.tokenId);
  const idProblems: string[] = [];
  if (new Set(ids).size !== ids.length) idProblems.push("Duplicate token ids found.");
  const sortedIds = [...ids].sort((a, b) => a - b);
  sortedIds.forEach((id, i) => {
    if (id !== start + i && idProblems.length < MAX_ITEMS) idProblems.push(`Expected token #${start + i}, found #${id}.`);
  });
  checks.push(check("token-ids", "Unique, sequential token IDs", idProblems, `#${start}–#${start + ids.length - 1}`));

  const byDna = new Map<string, number[]>();
  for (const n of nfts) byDna.set(n.dna, [...(byDna.get(n.dna) ?? []), n.tokenId]);
  checks.push(
    check(
      "dna",
      "Unique trait combinations",
      [...byDna.values()].filter((v) => v.length > 1).map((v) => `Tokens ${v.map((x) => `#${x}`).join(", ")} share DNA`),
      `${byDna.size} unique combinations`,
    ),
  );

  const index = buildRuleIndex(cfg);
  const invalid: string[] = [];
  for (const n of nfts) {
    const p = validateCombination(cfg, n.traits, index);
    if (p.length) invalid.push(`#${n.tokenId}: ${p.join(" ")}`);
  }
  checks.push(check("combinations", "Trait compatibility rules", invalid, "Zero invalid combinations"));

  const hash = configHash(cfg);
  const stale = nfts.filter((n) => n.status === "draft" && n.configHash !== hash).map((n) => `#${n.tokenId}`);
  checks.push(
    check(
      "stale",
      "Generated with current configuration",
      stale.length ? [`${stale.length} draft token(s) predate the current configuration: ${stale.slice(0, 20).join(", ")}…`] : [],
      "All drafts match current config",
      "warn",
    ),
  );

  // Missing / unassigned artwork for traits actually used.
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const used = new Set(nfts.flatMap((n) => Object.values(n.traits)).filter((t) => t !== NONE));
  const missingArt: string[] = [];
  for (const c of cfg.categories)
    for (const t of c.traits) {
      if (!used.has(t.id) && t.weight === 0) continue;
      const a = t.assetId ? assetById.get(t.assetId) : undefined;
      if (!a) missingArt.push(`${c.name} / ${t.name}: no artwork assigned`);
      else if (!(await fileExists(paths.assetFile(projectId, a.id, a.version))))
        missingArt.push(`${c.name} / ${t.name}: asset file missing on disk`);
    }
  checks.push(check("assets", "Artwork assigned to every trait", missingArt, "All traits have artwork"));

  const resProblems: string[] = [];
  const alphaProblems: string[] = [];
  const bottomLayer = Math.min(...cfg.categories.map((c) => c.layer));
  for (const c of cfg.categories)
    for (const t of c.traits) {
      const a = t.assetId ? assetById.get(t.assetId) : undefined;
      if (!a) continue;
      if (a.width < project.canvas.width || a.height < project.canvas.height)
        resProblems.push(`${c.name} / ${t.name}: ${a.width}×${a.height} is below canvas ${project.canvas.width}×${project.canvas.height}`);
      if (c.layer !== bottomLayer && !a.hasTransparency)
        alphaProblems.push(`${c.name} / ${t.name}: fully opaque, will hide every layer beneath it`);
    }
  checks.push(check("resolution", "Asset resolution", resProblems, "All assets meet canvas resolution"));
  checks.push(check("transparency", "Layer transparency", alphaProblems, "Overlay layers are transparent", "warn"));

  // Art reuse that produces identical images under different trait names.
  const shaUse = new Map<string, string[]>();
  for (const c of cfg.categories)
    for (const t of c.traits) {
      const a = t.assetId ? assetById.get(t.assetId) : undefined;
      if (a) shaUse.set(`${c.id}:${a.sha256}`, [...(shaUse.get(`${c.id}:${a.sha256}`) ?? []), `${c.name} / ${t.name}`]);
    }
  checks.push(
    check(
      "asset-duplicates",
      "Duplicate artwork within a category",
      [...shaUse.values()].filter((v) => v.length > 1).map((v) => `Identical art: ${v.join(" = ")}`),
      "No identical artwork across traits",
      "warn",
    ),
  );

  // Renders & visual duplicates.
  const files = await renderedSet(project);
  const ext = project.canvas.format === "jpeg" ? "jpg" : "png";
  const renderedNfts = nfts.filter((n) => files.has(`${n.tokenId}-${n.dna}.${ext}`));
  checks.push(
    check(
      "renders",
      "Artwork rendered",
      renderedNfts.length === nfts.length ? [] : [`${nfts.length - renderedNfts.length} token(s) not rendered yet.`],
      `${renderedNfts.length}/${nfts.length} rendered`,
      "warn",
    ),
  );

  if (opts.visualDuplicates !== false && renderedNfts.length) {
    const seen = new Map<string, number[]>();
    const dims: string[] = [];
    for (const n of renderedNfts) {
      const file = paths.render(projectId, n.tokenId, n.dna, ext);
      const meta = await sharp(file).metadata();
      if (meta.width !== project.canvas.width || meta.height !== project.canvas.height)
        dims.push(`#${n.tokenId}: ${meta.width}×${meta.height}`);
      const h = await fingerprint(file);
      seen.set(h, [...(seen.get(h) ?? []), n.tokenId]);
    }
    checks.push(check("render-resolution", "Rendered image resolution", dims, `${project.canvas.width}×${project.canvas.height}`));
    checks.push(
      check(
        "visual-duplicates",
        "Visual duplicate detection",
        [...seen.values()]
          .filter((v) => v.length > 1)
          .map((v) => `Visually identical: ${v.map((x) => `#${x}`).join(", ")}`),
        "No visually identical renders",
        "warn",
      ),
    );
  }

  const metaProblems: string[] = [];
  for (const n of nfts) {
    const p = validateTokenMetadata(buildTokenMetadata(project.metadata, cfg.categories, project.canvas, n), project.metadata);
    if (p.length && metaProblems.length < MAX_ITEMS) metaProblems.push(`#${n.tokenId}: ${p.join(", ")}`);
  }
  checks.push(check("metadata", "Metadata validation", metaProblems, `${nfts.length} valid metadata files`));
  if (!project.metadata.imageBaseUri)
    checks.push({
      id: "image-uri",
      label: "Image base URI",
      status: "warn",
      detail: "Not set — metadata will use relative file names until you upload artwork to IPFS/Arweave.",
    });

  const rarity = computeRarity(cfg, nfts);
  const rarityProblems: string[] = [];
  for (const c of rarity.categories) {
    const sum = c.traits.reduce((s, t) => s + t.count, 0);
    if (sum !== nfts.length) rarityProblems.push(`${c.name}: trait counts sum to ${sum}, expected ${nfts.length}`);
  }
  checks.push(check("rarity", "Rarity report matches collection", rarityProblems, "Counts reconcile with tokens"));

  const statusCounts: Record<string, number> = { draft: 0, approved: 0, locked: 0 };
  for (const n of nfts) statusCounts[n.status] = (statusCounts[n.status] ?? 0) + 1;
  checks.push(
    check(
      "review",
      "Manual review",
      statusCounts.draft ? [`${statusCounts.draft} token(s) still in Draft.`] : [],
      "All tokens approved or locked",
      "warn",
    ),
  );

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    passed: !checks.some((c) => c.status === "fail"),
    rendered: renderedNfts.length,
    supply: nfts.length,
    statusCounts,
    checks,
  };
}
