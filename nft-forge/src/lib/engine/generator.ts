import { createRng, sha256, stableStringify, weightedPick } from "./rng";
import {
  NONE,
  type CollectionConfig,
  type GenerationResult,
  type Nft,
  type Trait,
  type TraitCategory,
  type TraitRule,
} from "./types";

/**
 * Hash of everything that affects selection. Supply is excluded on purpose: growing
 * the collection must not change tokens that already exist.
 */
export function configHash(config: Pick<CollectionConfig, "categories" | "rules" | "seed">): string {
  const relevant = {
    seed: config.seed,
    categories: config.categories.map((c) => ({
      id: c.id,
      required: c.required,
      noneWeight: c.noneWeight,
      traits: c.traits.map((t) => ({ id: t.id, weight: t.weight })),
    })),
    rules: config.rules.map(({ note: _note, ...r }) => r),
  };
  return sha256(stableStringify(relevant)).slice(0, 16);
}

export function computeDna(categories: TraitCategory[], traits: Record<string, string>): string {
  return sha256(categories.map((c) => `${c.id}:${traits[c.id] ?? NONE}`).join("|")).slice(0, 16);
}

interface RuleIndex {
  traitToCategory: Map<string, TraitCategory>;
  traitById: Map<string, Trait>;
  excludes: Map<string, Set<string>>;
  requires: Map<string, Extract<TraitRule, { type: "require" }>[]>;
  weightMods: Map<string, Extract<TraitRule, { type: "weight" }>[]>;
}

export function buildRuleIndex(config: Pick<CollectionConfig, "categories" | "rules">): RuleIndex {
  const traitToCategory = new Map<string, TraitCategory>();
  const traitById = new Map<string, Trait>();
  for (const c of config.categories)
    for (const t of c.traits) {
      traitToCategory.set(t.id, c);
      traitById.set(t.id, t);
    }
  const excludes = new Map<string, Set<string>>();
  const requires = new Map<string, Extract<TraitRule, { type: "require" }>[]>();
  const weightMods = new Map<string, Extract<TraitRule, { type: "weight" }>[]>();
  const addEx = (a: string, b: string) => {
    if (!excludes.has(a)) excludes.set(a, new Set());
    excludes.get(a)!.add(b);
  };
  for (const r of config.rules) {
    if (r.type === "exclude") {
      addEx(r.traitId, r.targetTraitId);
      addEx(r.targetTraitId, r.traitId);
    } else if (r.type === "require") {
      if (!requires.has(r.traitId)) requires.set(r.traitId, []);
      requires.get(r.traitId)!.push(r);
    } else if (r.type === "weight") {
      if (!weightMods.has(r.traitId)) weightMods.set(r.traitId, []);
      weightMods.get(r.traitId)!.push(r);
    }
  }
  return { traitToCategory, traitById, excludes, requires, weightMods };
}

/** Static checks on the configuration itself, run before any generation. */
export function validateConfig(config: CollectionConfig): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenCat = new Set<string>();
  const seenTrait = new Set<string>();
  if (config.categories.length === 0) errors.push("No trait categories configured.");
  if (!Number.isInteger(config.supply) || config.supply < 1) errors.push("Supply must be a positive integer.");
  for (const c of config.categories) {
    if (seenCat.has(c.id)) errors.push(`Duplicate category id "${c.id}".`);
    seenCat.add(c.id);
    const positive = c.traits.filter((t) => t.weight > 0);
    if (c.required && positive.length === 0)
      errors.push(`Required category "${c.name}" has no traits with a positive weight.`);
    if (!c.required && c.noneWeight < 0) errors.push(`Category "${c.name}" has a negative "None" weight.`);
    for (const t of c.traits) {
      if (t.id === NONE) errors.push(`Trait id "${NONE}" is reserved (category "${c.name}").`);
      if (seenTrait.has(t.id)) errors.push(`Duplicate trait id "${t.id}". Trait ids must be unique across categories.`);
      seenTrait.add(t.id);
      if (!(t.weight >= 0)) errors.push(`Trait "${t.name}" has an invalid weight.`);
    }
  }
  for (const r of config.rules) {
    if (!seenTrait.has(r.traitId)) errors.push(`Rule ${r.id} references unknown trait "${r.traitId}".`);
    if (r.type === "require") {
      if (!seenCat.has(r.targetCategoryId))
        errors.push(`Rule ${r.id} references unknown category "${r.targetCategoryId}".`);
      for (const a of r.allowedTraitIds)
        if (a !== NONE && !seenTrait.has(a)) errors.push(`Rule ${r.id} allows unknown trait "${a}".`);
    } else if (!seenTrait.has(r.targetTraitId)) {
      errors.push(`Rule ${r.id} references unknown trait "${r.targetTraitId}".`);
    }
    if (r.type === "weight" && !(r.multiplier >= 0)) errors.push(`Rule ${r.id} has an invalid multiplier.`);
  }
  // Upper bound on unique combinations (ignores rules, so the true space is smaller).
  const space = config.categories.reduce(
    (p, c) => p * (c.traits.filter((t) => t.weight > 0).length + (c.required ? 0 : 1)),
    1,
  );
  if (space < config.supply)
    errors.push(`Only ${space} combinations are possible but supply is ${config.supply}. Add traits or categories.`);
  else if (space < config.supply * 3)
    warnings.push(
      `Combination space (${space}) is under 3x the supply. Rare traits may be over-represented to avoid duplicates.`,
    );
  return { errors, warnings };
}

/** Full rule check of a finished selection. Used by the generator and by QA. */
export function validateCombination(
  config: Pick<CollectionConfig, "categories" | "rules">,
  traits: Record<string, string>,
  index = buildRuleIndex(config),
): string[] {
  const problems: string[] = [];
  const name = (id: string) => (id === NONE ? "None" : (index.traitById.get(id)?.name ?? id));
  for (const c of config.categories) {
    const v = traits[c.id] ?? NONE;
    if (v === NONE) {
      if (c.required) problems.push(`Missing required trait "${c.name}".`);
    } else if (index.traitToCategory.get(v)?.id !== c.id) {
      problems.push(`Trait "${v}" does not belong to category "${c.name}".`);
    }
  }
  const chosen = Object.values(traits).filter((v) => v !== NONE);
  for (let i = 0; i < chosen.length; i++)
    for (let j = i + 1; j < chosen.length; j++)
      if (index.excludes.get(chosen[i])?.has(chosen[j]))
        problems.push(`"${name(chosen[i])}" cannot be combined with "${name(chosen[j])}".`);
  for (const t of chosen)
    for (const r of index.requires.get(t) ?? []) {
      const actual = traits[r.targetCategoryId] ?? NONE;
      if (!r.allowedTraitIds.includes(actual)) {
        const cat = config.categories.find((c) => c.id === r.targetCategoryId)?.name ?? r.targetCategoryId;
        problems.push(`"${name(t)}" requires ${cat} to be one of: ${r.allowedTraitIds.map(name).join(", ")}.`);
      }
    }
  return problems;
}

function candidateOptions(
  cat: TraitCategory,
  chosen: Record<string, string>,
  index: RuleIndex,
): { item: string; weight: number }[] {
  const options = cat.traits.map((t) => ({ item: t.id, weight: t.weight }));
  if (!cat.required) options.push({ item: NONE, weight: cat.noneWeight });
  const chosenIds = Object.values(chosen).filter((v) => v !== NONE);
  const out: { item: string; weight: number }[] = [];
  for (const opt of options) {
    if (opt.weight <= 0) continue;
    let ok = true;
    if (opt.item !== NONE) {
      const ex = index.excludes.get(opt.item);
      if (ex && chosenIds.some((x) => ex.has(x))) ok = false;
      // The candidate's own requirements on categories already decided.
      for (const r of index.requires.get(opt.item) ?? [])
        if (r.targetCategoryId in chosen && !r.allowedTraitIds.includes(chosen[r.targetCategoryId])) ok = false;
    }
    // Requirements imposed on this category by traits already chosen.
    for (const x of chosenIds)
      for (const r of index.requires.get(x) ?? [])
        if (r.targetCategoryId === cat.id && !r.allowedTraitIds.includes(opt.item)) ok = false;
    if (!ok) continue;
    let weight = opt.weight;
    for (const x of chosenIds)
      for (const r of index.weightMods.get(x) ?? []) if (r.targetTraitId === opt.item) weight *= r.multiplier;
    if (weight > 0) out.push({ item: opt.item, weight });
  }
  return out;
}

/** One deterministic selection attempt for a token. Returns null if a dead end is hit. */
export function selectTraits(
  config: Pick<CollectionConfig, "categories" | "rules" | "seed">,
  index: RuleIndex,
  tokenId: number,
  attempt: number,
): Record<string, string> | null {
  const rng = createRng(`${config.seed}:${tokenId}:${attempt}`);
  const chosen: Record<string, string> = {};
  for (const cat of config.categories) {
    const pick = weightedPick(rng, candidateOptions(cat, chosen, index));
    if (pick === undefined) return null;
    chosen[cat.id] = pick;
  }
  return validateCombination(config, chosen, index).length === 0 ? chosen : null;
}

export interface GenerateOptions {
  startTokenId?: number;
  /** Existing collection. Approved and locked tokens are carried over unchanged. */
  previous?: Nft[];
}

export function generateCollection(config: CollectionConfig, opts: GenerateOptions = {}): GenerationResult {
  const started = Date.now();
  const start = opts.startTokenId ?? 0;
  const { errors, warnings } = validateConfig(config);
  const hash = configHash(config);
  const result: GenerationResult = {
    nfts: [],
    configHash: hash,
    seed: config.seed,
    stats: { generated: 0, preserved: 0, retries: 0, durationMs: 0 },
    errors: [...errors],
    warnings: [...warnings],
  };
  if (errors.length) return result;

  const index = buildRuleIndex(config);
  const preserved = new Map<number, Nft>();
  for (const n of opts.previous ?? [])
    if (n.status !== "draft" && n.tokenId >= start && n.tokenId < start + config.supply) preserved.set(n.tokenId, n);

  // Preserved DNA is reserved first so new tokens can never duplicate an approved one.
  const used = new Set<string>([...preserved.values()].map((n) => n.dna));
  for (let i = 0; i < config.supply; i++) {
    const tokenId = start + i;
    const keep = preserved.get(tokenId);
    if (keep) {
      result.nfts.push(keep);
      result.stats.preserved++;
      continue;
    }
    let made: Nft | null = null;
    for (let attempt = 0; attempt < config.maxAttemptsPerToken; attempt++) {
      const traits = selectTraits(config, index, tokenId, attempt);
      if (!traits) {
        result.stats.retries++;
        continue;
      }
      const dna = computeDna(config.categories, traits);
      if (used.has(dna)) {
        result.stats.retries++;
        continue;
      }
      used.add(dna);
      made = { tokenId, dna, traits, status: "draft", attempt, configHash: hash };
      break;
    }
    if (!made) {
      result.errors.push(
        `Token #${tokenId}: no valid unique combination after ${config.maxAttemptsPerToken} attempts. Rules may be too strict or the trait space too small.`,
      );
      continue;
    }
    result.nfts.push(made);
    result.stats.generated++;
  }
  result.stats.durationMs = Date.now() - started;
  return result;
}

/** Re-roll a single draft token, keeping it unique against the rest of the collection. */
export function regenerateToken(config: CollectionConfig, nfts: Nft[], tokenId: number): Nft | null {
  const current = nfts.find((n) => n.tokenId === tokenId);
  if (!current) return null;
  if (current.status !== "draft") throw new Error(`Token #${tokenId} is ${current.status}; unlock it first.`);
  const index = buildRuleIndex(config);
  const hash = configHash(config);
  const used = new Set(nfts.map((n) => n.dna));
  const from = current.configHash === hash ? current.attempt + 1 : 0;
  for (let attempt = from; attempt < from + config.maxAttemptsPerToken; attempt++) {
    const traits = selectTraits(config, index, tokenId, attempt);
    if (!traits) continue;
    const dna = computeDna(config.categories, traits);
    if (used.has(dna)) continue;
    return { tokenId, dna, traits, status: "draft", attempt, configHash: hash };
  }
  return null;
}
