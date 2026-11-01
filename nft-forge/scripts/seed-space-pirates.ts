/**
 * Seeds the flagship validation project: SPACE PIRATES — GENESIS COLLECTION (3,333).
 *
 *   npm run seed                 # create project + assets + traits + rules
 *   npm run seed -- --generate   # ...and generate the collection
 *   npm run seed -- --render     # ...and render all images + run QA
 *   npm run seed -- --force      # delete and recreate the project first
 */
import sharp from "sharp";
import { ingestAsset } from "../src/lib/assets";
import { generateForProject } from "../src/lib/collection";
import type { TraitCategory, TraitRule } from "../src/lib/engine/types";
import { runQa } from "../src/lib/qa";
import { LayerRenderer, existingRender } from "../src/lib/render";
import { createProject, deleteProject, getCollection, getProject, saveProject, type Blueprint } from "../src/lib/store";
import * as art from "./space-pirates-art";

const ID = "space-pirates-genesis";
const args = new Set(process.argv.slice(2));

const PLAN: { name: string; required: boolean; noneWeight?: number; art: Record<string, string>; weights: Record<string, number> }[] = [
  {
    name: "Background",
    required: true,
    art: art.backgrounds,
    weights: { "Deep Space": 30, "Nebula Violet": 25, "Sherwood Station": 20, "Red Giant": 12, "Asteroid Belt": 8, "Event Horizon": 4, "Royal Armada Gold": 1 },
  },
  {
    name: "Species",
    required: true,
    art: art.bodies,
    weights: { "Human Fair": 13, "Human Tan": 13, "Human Umber": 13, "Alien Verdant": 15, "Alien Violet": 9, Cyborg: 14, "Robot Chrome": 12, "Robot Brass": 6 },
  },
  {
    name: "Outfit",
    required: true,
    art: art.outfits,
    weights: { "Outlaw Coat": 25, "Ranger Uniform": 20, "Leather Vest": 20, "Space Suit": 15, "Captain's Greatcoat": 12, "Royal Exile Robes": 8 },
  },
  {
    name: "Eyes",
    required: true,
    art: art.eyes,
    weights: { Determined: 35, Squint: 20, Eyepatch: 15, Glowing: 12, "Star-Struck": 10, "LED Eyes": 8 },
  },
  {
    name: "Mouth",
    required: true,
    art: art.mouths,
    weights: { Grin: 30, Smirk: 30, Neutral: 20, "Gold Tooth": 8, Rebreather: 10, "Speaker Grille": 10 },
  },
  {
    name: "Headgear",
    required: false,
    noneWeight: 15,
    art: art.headgear,
    weights: { "Pirate Hood": 30, "Feathered Cap": 22, "Space Helmet": 18, "Cybernetic Visor": 15, Bandana: 12, "Royal Crown": 6, "Halo of Sherwood": 1 },
  },
  {
    name: "Weapon",
    required: false,
    noneWeight: 25,
    art: art.weapons,
    weights: { "Plasma Bow": 25, "Laser Cutlass": 25, "Ion Pistol": 20, "Star Staff": 10, "Quiver of Comets": 8 },
  },
  {
    name: "Companion",
    required: false,
    noneWeight: 60,
    art: art.companions,
    weights: { "Space Parrot": 15, "Scout Drone": 15, "Fox-bot": 8, "Baby Comet": 2 },
  },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const BLUEPRINT: Omit<Blueprint, "createdAt"> = {
  provider: "hand-authored",
  title: "Space Pirates — Genesis Collection",
  logline: "3,333 outlaws, exiles and rogue machines who rob the Galactic Crown to feed the outer colonies.",
  lore:
    "When the Crown Armada seized every fuel depot past the Sherwood Belt, the outer colonies began to starve. A loose crew of humans, aliens and decommissioned war-robots answered: hijack the Armada's tribute convoys and give the cargo back to the colonies they were taken from.\n\nThe Genesis crew are the first 3,333 to swear the Sherwood Oath. Some are rangers who deserted the Armada, some are royals exiled for siding with the colonies, and some are machines that simply decided to stop following orders.",
  artBible: {
    style: "Bold flat-vector bust portraits, thick dark outline, minimal cel shading, glowing sci-fi accents.",
    palette: ["#05070F", "#166534", "#7C3AED", "#22D3EE", "#FACC15", "#EF4444"],
    proportions: "1024×1024 canvas. Head centered at (512, 470), eyes at y=468 (x 447 / 577), mouth at y=572, shoulders from x=170 to 854.",
    rendering: "7px outline (#0B0B14), flat fills, one shade tone, glows via blur only on energy elements.",
    doList: ["Keep every overlay on a transparent background", "Align to the shared anchor points", "Reserve glow effects for energy weapons and rare traits"],
    dontList: ["Bake background colour into overlay layers", "Change outline weight", "Use real-world logos or text"],
  },
  archetypes: [
    { name: "Outlaw", description: "Hooded archers of the Sherwood Belt; Outlaw Coat, Plasma Bow." },
    { name: "Galactic Ranger", description: "Armada deserters; Ranger Uniform, Space Helmet." },
    { name: "Royal Exile", description: "Banished nobility; robes and the occasional crown." },
    { name: "Rogue Machine", description: "Robots who quit; LED eyes and speaker grilles only." },
    { name: "Cybernetic Pirate", description: "Half-rebuilt veterans with visors and eyepatches." },
  ],
  factions: [
    { name: "The Sherwood Crew", description: "The core outlaw fleet." },
    { name: "Exiles of the Crown", description: "Former royals funding the rebellion." },
    { name: "The Unbound", description: "Free machines." },
  ],
  traitPlan: PLAN.map((p) => ({ category: p.name, required: p.required, examples: Object.keys(p.weights) })),
  productionPlan: [
    "Lock art bible and anchor points",
    "Produce Background and Species bases",
    "Produce overlay layers per category",
    "Configure weights and compatibility rules",
    "Generate, review and approve 3,333 tokens",
    "Render, QA, export, then pin to IPFS/Arweave and deploy on Robinhood Chain (ERC-721)",
  ],
  estimates: { assetCount: PLAN.reduce((s, p) => s + Object.keys(p.weights).length, 0), notes: "Over 300 million combinations before rules." },
};

async function main() {
  const t0 = Date.now();
  if (args.has("--force")) await deleteProject(ID);
  let exists = true;
  try {
    await getProject(ID);
  } catch {
    exists = false;
  }

  if (!exists) {
    console.log("Creating project…");
    const project = await createProject({
      id: ID,
      name: "Space Pirates",
      concept:
        "Robin Hood-inspired intergalactic outlaw universe: humans, aliens, robots, cybernetic pirates, galactic rangers and royal exiles who rob the Galactic Crown.",
      supply: 3333,
      style: "Stylized 2D/3D hybrid — bold flat-vector busts with glowing sci-fi accents",
      chain: "robinhood",
      mode: "hybrid",
    });
    project.config.seed = "sherwood-3333";

    const categories: TraitCategory[] = [];
    for (const [ci, p] of PLAN.entries()) {
      const cat: TraitCategory = {
        id: slug(p.name),
        name: p.name,
        required: p.required,
        noneWeight: p.noneWeight ?? 0,
        layer: ci * 10,
        traits: [],
      };
      for (const [name, weight] of Object.entries(p.weights)) {
        const png = await sharp(Buffer.from(p.art[name])).png().toBuffer();
        const { asset } = await ingestAsset(ID, png, `${name}.png`, { categoryHint: p.name, source: "procedural" });
        cat.traits.push({ id: slug(name), name, weight, assetId: asset.id });
      }
      categories.push(cat);
      process.stdout.write(`  ${p.name}: ${cat.traits.length} traits\n`);
    }

    const robots = ["robot-chrome", "robot-brass"];
    const rules: TraitRule[] = [
      ...robots.flatMap((r): TraitRule[] => [
        { id: `${r}-mouth`, type: "require", traitId: r, targetCategoryId: "mouth", allowedTraitIds: ["speaker-grille"], note: "Robots only have speaker grilles" },
        { id: `${r}-eyes`, type: "require", traitId: r, targetCategoryId: "eyes", allowedTraitIds: ["led-eyes", "glowing"], note: "Robots have LED or glowing eyes" },
      ]),
      { id: "grille-robot", type: "require", traitId: "speaker-grille", targetCategoryId: "species", allowedTraitIds: robots, note: "Speaker grille is robot-only" },
      { id: "led-mech", type: "require", traitId: "led-eyes", targetCategoryId: "species", allowedTraitIds: [...robots, "cyborg"], note: "LED eyes need a machine body" },
      { id: "visor-patch", type: "exclude", traitId: "cybernetic-visor", targetTraitId: "eyepatch", note: "Visor covers both eyes" },
      // The visor fully covers the eyes: pin Eyes to one value so hidden eye traits
      // never create tokens that look identical but carry different metadata.
      { id: "visor-eyes", type: "require", traitId: "cybernetic-visor", targetCategoryId: "eyes", allowedTraitIds: ["squint"], note: "Visor hides the eyes" },
      ...robots.map((r): TraitRule => ({ id: `${r}-visor`, type: "exclude", traitId: r, targetTraitId: "cybernetic-visor", note: "Robot optics stay visible" })),
      { id: "helmet-suit", type: "require", traitId: "space-helmet", targetCategoryId: "outfit", allowedTraitIds: ["space-suit", "ranger-uniform"], note: "Helmets need a sealed suit" },
      { id: "helmet-parrot", type: "exclude", traitId: "space-helmet", targetTraitId: "space-parrot", note: "No parrots in vacuum" },
      { id: "robes-crown", type: "weight", traitId: "royal-exile-robes", targetTraitId: "royal-crown", multiplier: 6, note: "Exiles often keep their crowns" },
      { id: "coat-bow", type: "weight", traitId: "outlaw-coat", targetTraitId: "plasma-bow", multiplier: 2, note: "Outlaws favour the bow" },
      { id: "robot-hood", type: "weight", traitId: "robot-chrome", targetTraitId: "pirate-hood", multiplier: 0.3 },
    ];
    project.config.categories = categories;
    project.config.rules = rules;
    project.blueprint = { ...BLUEPRINT, createdAt: new Date().toISOString() };
    project.artBibleLocked = true;
    project.metadata = {
      ...project.metadata,
      collectionName: "Space Pirates",
      symbol: "SPIRATE",
      namePattern: "{collection} #{id}",
      description: BLUEPRINT.logline,
      sellerFeeBasisPoints: 500,
      startTokenId: 1,
    };
    await saveProject(project);
    console.log(`Project ready (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
  } else {
    console.log("Project already exists (use --force to recreate).");
  }

  if (args.has("--generate") || args.has("--render")) {
    const { run } = await generateForProject(ID);
    console.log(
      `Generated ${run.generated} (preserved ${run.preserved}, retries ${run.retries}) in ${run.durationMs} ms. Errors: ${run.errors.length}. Warnings: ${run.warnings.length}.`,
    );
    for (const e of run.errors.slice(0, 5)) console.log("  ERROR", e);
  }

  if (args.has("--render")) {
    const project = await getProject(ID);
    const nfts = (await getCollection(ID))!.nfts;
    const renderer = await new LayerRenderer(project).init();
    const t1 = Date.now();
    let done = 0;
    const queue = [...nfts];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let n = queue.shift(); n; n = queue.shift()) {
          if (!(await existingRender(project, n))) await renderer.renderToDisk(n);
          if (++done % 250 === 0) process.stdout.write(`  rendered ${done}/${nfts.length}\n`);
        }
      }),
    );
    console.log(`Rendered ${nfts.length} in ${((Date.now() - t1) / 1000).toFixed(1)}s.`);
    const qa = await runQa(ID);
    console.log(`QA ${qa.passed ? "PASSED" : "FAILED"}`);
    for (const c of qa.checks) console.log(`  [${c.status.toUpperCase()}] ${c.label}: ${c.detail}${c.items ? `\n      ${c.items.slice(0, 3).join("\n      ")}` : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
