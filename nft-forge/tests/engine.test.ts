import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRuleIndex,
  configHash,
  generateCollection,
  regenerateToken,
  validateCombination,
  validateConfig,
} from "../src/lib/engine/generator";
import { buildTokenMetadata, validateTokenMetadata } from "../src/lib/engine/metadata";
import { computeRarity, expectedDistribution } from "../src/lib/engine/rarity";
import { DEFAULT_TIERS, NONE, type CollectionConfig, type MetadataTemplate } from "../src/lib/engine/types";

function config(overrides: Partial<CollectionConfig> = {}): CollectionConfig {
  const cat = (id: string, n: number, required = true, noneWeight = 0) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    required,
    noneWeight,
    layer: 0,
    traits: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, name: `${id} ${i}`, weight: 10 + i })),
  });
  return {
    supply: 500,
    seed: "test-seed",
    categories: [cat("bg", 5), cat("body", 4), cat("eyes", 5), cat("hat", 6, false, 20), cat("pet", 3, false, 50)],
    rules: [],
    tiers: DEFAULT_TIERS,
    maxAttemptsPerToken: 200,
    ...overrides,
  };
}

test("generation is deterministic for the same seed and config", () => {
  const a = generateCollection(config());
  const b = generateCollection(config());
  assert.equal(a.errors.length, 0);
  assert.deepEqual(
    a.nfts.map((n) => n.dna),
    b.nfts.map((n) => n.dna),
  );
  const c = generateCollection(config({ seed: "other" }));
  assert.notDeepEqual(
    a.nfts.map((n) => n.dna),
    c.nfts.map((n) => n.dna),
  );
});

test("every token is unique and ids are sequential from startTokenId", () => {
  const r = generateCollection(config(), { startTokenId: 1 });
  assert.equal(r.nfts.length, 500);
  assert.equal(new Set(r.nfts.map((n) => n.dna)).size, 500);
  assert.deepEqual(
    r.nfts.map((n) => n.tokenId),
    Array.from({ length: 500 }, (_, i) => i + 1),
  );
});

test("exclude, require and weight rules are never violated", () => {
  const cfg = config({
    rules: [
      { id: "r1", type: "exclude", traitId: "hat-0", targetTraitId: "eyes-0" },
      { id: "r2", type: "require", traitId: "body-3", targetCategoryId: "hat", allowedTraitIds: ["hat-5", NONE] },
      { id: "r3", type: "require", traitId: "pet-2", targetCategoryId: "body", allowedTraitIds: ["body-1"] },
      { id: "r4", type: "weight", traitId: "body-0", targetTraitId: "hat-4", multiplier: 0 },
    ],
  });
  const r = generateCollection(cfg);
  assert.equal(r.errors.length, 0);
  const index = buildRuleIndex(cfg);
  for (const n of r.nfts) {
    assert.deepEqual(validateCombination(cfg, n.traits, index), [], `token ${n.tokenId}`);
    assert.ok(!(n.traits.body === "body-0" && n.traits.hat === "hat-4"), "weight 0 multiplier must exclude");
  }
  assert.ok(r.nfts.some((n) => n.traits.pet === "pet-2"), "pet-2 still reachable via body-1");
});

test("conditional weight multiplier shifts the distribution", () => {
  const base = config({ supply: 250 });
  const boosted = config({
    supply: 250,
    rules: [{ id: "w", type: "weight", traitId: "body-0", targetTraitId: "hat-0", multiplier: 20 }],
  });
  const rate = (cfg: CollectionConfig) => {
    const nfts = generateCollection(cfg).nfts.filter((n) => n.traits.body === "body-0");
    return nfts.filter((n) => n.traits.hat === "hat-0").length / nfts.length;
  };
  assert.ok(rate(boosted) > rate(base) * 2.5, `${rate(boosted)} vs ${rate(base)}`);
});

test("approved and locked tokens survive regeneration unchanged", () => {
  const first = generateCollection(config());
  first.nfts[3].status = "approved";
  first.nfts[7].status = "locked";
  const second = generateCollection(config({ seed: "new-seed" }), { previous: first.nfts });
  assert.deepEqual(second.nfts[3], first.nfts[3]);
  assert.deepEqual(second.nfts[7], first.nfts[7]);
  assert.equal(second.stats.preserved, 2);
  assert.equal(new Set(second.nfts.map((n) => n.dna)).size, second.nfts.length);
});

test("regenerateToken produces a new unique draft and refuses locked tokens", () => {
  const cfg = config();
  const r = generateCollection(cfg);
  const next = regenerateToken(cfg, r.nfts, 5)!;
  assert.notEqual(next.dna, r.nfts[5].dna);
  assert.ok(!r.nfts.some((n) => n.dna === next.dna));
  r.nfts[6].status = "locked";
  assert.throws(() => regenerateToken(cfg, r.nfts, 6));
});

test("validateConfig catches impossible supply and bad references", () => {
  const tiny = config({ supply: 10_000_000 });
  assert.ok(validateConfig(tiny).errors.some((e) => e.includes("combinations")));
  const bad = config({ rules: [{ id: "x", type: "exclude", traitId: "nope", targetTraitId: "bg-0" }] });
  assert.ok(validateConfig(bad).errors.length > 0);
  assert.equal(generateCollection(bad).nfts.length, 0);
});

test("unsatisfiable rules are reported, not silently ignored", () => {
  const cfg = config({
    supply: 5,
    rules: [
      { id: "a", type: "require", traitId: "bg-0", targetCategoryId: "body", allowedTraitIds: [] },
      { id: "b", type: "require", traitId: "bg-1", targetCategoryId: "body", allowedTraitIds: [] },
      { id: "c", type: "require", traitId: "bg-2", targetCategoryId: "body", allowedTraitIds: [] },
      { id: "d", type: "require", traitId: "bg-3", targetCategoryId: "body", allowedTraitIds: [] },
      { id: "e", type: "require", traitId: "bg-4", targetCategoryId: "body", allowedTraitIds: [] },
    ],
  });
  const r = generateCollection(cfg);
  assert.equal(r.nfts.length, 0);
  assert.equal(r.errors.length, 5);
});

test("config hash ignores supply but tracks weights", () => {
  assert.equal(configHash(config({ supply: 1 })), configHash(config({ supply: 999 })));
  const c = config();
  c.categories[0].traits[0].weight = 99;
  assert.notEqual(configHash(c), configHash(config()));
});

test("rarity is computed from actual counts and reconciles with supply", () => {
  const cfg = config();
  const r = generateCollection(cfg);
  const report = computeRarity(cfg, r.nfts, expectedDistribution(cfg, 4000));
  for (const c of report.categories) {
    assert.equal(
      c.traits.reduce((s, t) => s + t.count, 0),
      500,
    );
    for (const t of c.traits) assert.ok(Math.abs(t.actual - t.expected) < 0.08, `${c.name}/${t.name}`);
  }
  assert.equal(report.tokens.length, 500);
  assert.equal(report.tokens[0].rank, 1);
  assert.equal(Object.values(report.tierCounts).reduce((a, b) => a + b, 0), 500);
  for (let i = 1; i < report.tokens.length; i++) assert.ok(report.tokens[i - 1].score >= report.tokens[i].score);
});

test("metadata templates produce valid ERC-721 and Metaplex documents", () => {
  const cfg = config();
  const nft = generateCollection(cfg).nfts[0];
  const tpl: MetadataTemplate = {
    standard: "metaplex",
    collectionName: "Test",
    symbol: "TST",
    namePattern: "{collection} #{id}",
    description: "desc",
    imageBaseUri: "ipfs://cid",
    externalUrl: "",
    sellerFeeBasisPoints: 500,
    startTokenId: 0,
  };
  const canvas = { width: 512, height: 512, format: "png" as const };
  const m = buildTokenMetadata(tpl, cfg.categories, canvas, nft);
  assert.equal(m.image, "ipfs://cid/0.png");
  assert.equal(m.name, "Test #0");
  assert.deepEqual(validateTokenMetadata(m, tpl), []);
  assert.ok(m.attributes.every((a) => a.value !== "None"));
  const e = buildTokenMetadata({ ...tpl, standard: "erc721" }, cfg.categories, canvas, nft);
  assert.equal(e.properties, undefined);
});
