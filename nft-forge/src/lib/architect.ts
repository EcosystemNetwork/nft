import Anthropic from "@anthropic-ai/sdk";
import type { TraitCategory } from "./engine/types";
import { newId, type Blueprint, type Project } from "./store";

// ---------------------------------------------------------------------------
// Module A — AI Project Architect. Providers are pluggable so the platform is
// not coupled to one AI vendor. "claude" is used when Anthropic credentials are
// configured; "offline" is a deterministic template generator that needs no key.
// ---------------------------------------------------------------------------

export interface ArchitectInput {
  name: string;
  concept: string;
  style: string;
  supply: number;
  chain: string;
  mode: string;
}

export interface ArchitectProvider {
  id: string;
  generate(input: ArchitectInput): Promise<Omit<Blueprint, "provider" | "createdAt">>;
}

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const named = { type: "array", items: obj({ name: str, description: str }) };

const BLUEPRINT_SCHEMA = obj({
  title: str,
  logline: str,
  lore: str,
  artBible: obj({
    style: str,
    palette: strArr,
    proportions: str,
    rendering: str,
    doList: strArr,
    dontList: strArr,
  }),
  archetypes: named,
  factions: named,
  traitPlan: {
    type: "array",
    items: obj({ category: str, required: { type: "boolean" }, examples: strArr }),
  },
  productionPlan: strArr,
  estimates: obj({ assetCount: { type: "integer" }, notes: str }),
});

const SYSTEM = `You are the project architect inside NFT Forge, a tool for producing generative NFT collections from modular 2D layers (and later 3D parts).
Turn the creator's idea into a production-ready blueprint.

- traitPlan lists trait categories in back-to-front layer order (Background first). Mark a category required only if every token must have it. Give 5-10 concrete, visually distinct example trait names per category, written as they would appear in marketplace metadata.
- Size the combination space so it comfortably exceeds the requested supply (aim for at least 10x), and say so in estimates.notes.
- The art bible must be specific enough that different artists produce consistent layers: shared canvas, anchor points, line weight, lighting direction, palette in hex.
- productionPlan is an ordered list of concrete steps for a small team.
- estimates.assetCount is the total number of layer images to produce.
Keep lore to two short paragraphs.`;

export class ClaudeProvider implements ArchitectProvider {
  id = "claude-opus-5-5";
  private client = new Anthropic();

  async generate(input: ArchitectInput) {
    const response = await this.client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: BLUEPRINT_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Project name: ${input.name}
Concept: ${input.concept}
Visual style: ${input.style}
Supply: ${input.supply}
Blockchain: ${input.chain}
Production: ${input.mode}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined to generate this blueprint.");
    if (response.stop_reason === "max_tokens") throw new Error("Blueprint was cut off before completion. Try again.");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text) as Omit<Blueprint, "provider" | "createdAt">;
  }
}

/** Deterministic, key-free fallback so the workflow is usable offline. */
export class OfflineProvider implements ArchitectProvider {
  id = "offline-template";

  async generate(input: ArchitectInput) {
    const c = input.concept.toLowerCase();
    const space = /space|galac|star|cosmic|sci-?fi/.test(c);
    const pirate = /pirate|outlaw|robin|bandit|rogue/.test(c);
    const traitPlan = [
      { category: "Background", required: true, examples: space ? ["Nebula", "Deep Space", "Asteroid Field", "Red Giant", "Black Hole"] : ["Dusk", "Forest", "City", "Desert", "Void"] },
      { category: "Body", required: true, examples: space ? ["Human", "Alien", "Robot", "Cyborg"] : ["Light", "Medium", "Dark", "Fantasy"] },
      { category: "Outfit", required: true, examples: pirate ? ["Outlaw Coat", "Ranger Uniform", "Royal Exile Robes", "Space Suit"] : ["Jacket", "Hoodie", "Armor", "Robe"] },
      { category: "Eyes", required: true, examples: ["Determined", "Eyepatch", "Glowing", "Squint"] },
      { category: "Mouth", required: true, examples: ["Grin", "Smirk", "Neutral", "Rebreather"] },
      { category: "Headgear", required: false, examples: pirate ? ["Pirate Hood", "Feathered Cap", "Space Helmet", "Royal Crown"] : ["Cap", "Crown", "Helmet", "Halo"] },
      { category: "Weapon", required: false, examples: pirate ? ["Plasma Bow", "Laser Cutlass", "Ion Pistol"] : ["Sword", "Staff", "Bow"] },
      { category: "Companion", required: false, examples: ["Drone", "Parrot", "Fox"] },
    ];
    const combos = traitPlan.reduce((p, t) => p * (t.examples.length + (t.required ? 0 : 1)), 1);
    return {
      title: input.name,
      logline: `${input.supply.toLocaleString()} unique characters from the world of ${input.name}.`,
      lore: `${input.concept}\n\n(Offline template — set ANTHROPIC_API_KEY or sign in with \`ant auth login\` to generate full lore with Claude.)`,
      artBible: {
        style: input.style || "Stylized flat vector with soft shading",
        palette: ["#0B0F1E", "#7C3AED", "#22D3EE", "#F59E0B", "#F8FAFC"],
        proportions: "Bust portrait, head centered at 47% height, shoulders spanning 60% of canvas width.",
        rendering: "Single light source from upper left, 6px outline at 1024px, cel-shaded with one highlight tone.",
        doList: ["Use the shared canvas and anchor points", "Keep every overlay layer on a transparent background", "Name files after trait names"],
        dontList: ["Bake backgrounds into overlay layers", "Change line weight between layers", "Use text or logos inside traits"],
      },
      archetypes: [
        { name: "The Captain", description: "Leader archetype; rarer outfits and headgear." },
        { name: "The Ranger", description: "Scout archetype; bows and practical gear." },
        { name: "The Exile", description: "Fallen royalty; crowns and robes." },
      ],
      factions: [
        { name: "Free Crew", description: "Outlaws who share their loot." },
        { name: "Imperial Remnant", description: "Exiles plotting a return." },
      ],
      traitPlan,
      productionPlan: [
        "Lock the art bible and canvas template",
        "Produce base bodies, then one layer category at a time",
        "Import layers into Asset Studio and assign them to traits",
        "Set weights and compatibility rules in the Trait Engine",
        "Generate a 100-token preview, review, then generate the full supply",
        "Render, QA, export",
      ],
      estimates: {
        assetCount: traitPlan.reduce((s, t) => s + t.examples.length, 0),
        notes: `Up to ${combos.toLocaleString()} combinations before rules (${(combos / Math.max(1, input.supply)).toFixed(1)}x supply).`,
      },
    };
  }
}

export function hasClaudeCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

export function getProvider(preferred?: string): ArchitectProvider {
  if (preferred === "offline") return new OfflineProvider();
  if (preferred === "claude" || hasClaudeCredentials()) return new ClaudeProvider();
  return new OfflineProvider();
}

export async function generateBlueprint(project: Project, preferred?: string): Promise<Blueprint> {
  const provider = getProvider(preferred);
  const bp = await provider.generate({
    name: project.name,
    concept: project.concept,
    style: project.style,
    supply: project.config.supply,
    chain: project.chain,
    mode: project.mode,
  });
  return { ...bp, provider: provider.id, createdAt: new Date().toISOString() };
}

/** Scaffold trait categories from the blueprint (artwork is assigned later). */
export function categoriesFromBlueprint(bp: Blueprint): TraitCategory[] {
  return bp.traitPlan.map((t, i) => ({
    id: newId("cat"),
    name: t.category,
    required: t.required,
    noneWeight: t.required ? 0 : 30,
    layer: i * 10,
    traits: t.examples.map((name) => ({ id: newId("t"), name, weight: 10 })),
  }));
}
