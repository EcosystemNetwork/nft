import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import sharp from "sharp";

process.env.NFT_FORGE_DATA = mkdtempSync(path.join(os.tmpdir(), "forge-sd-"));
process.env.NFT_FORGE_AUTH_SECRET = "test-secret-test-secret-test-secret!!";
process.env.NFT_FORGE_SD_URL = "http://127.0.0.1:7860";

type Prompt = typeof import("../src/lib/sd/prompt");
type Png = typeof import("../src/lib/sd/png-text");
type Payload = typeof import("../src/lib/sd/payload");
type Client = typeof import("../src/lib/sd/client");
type Generate = typeof import("../src/lib/sd/generate");
type Styles = typeof import("../src/lib/sd/styles");

let prompt: Prompt;
let pngText: Png;
let payload: Payload;
let client: Client;
let generate: Generate;
let styles: Styles;

before(async () => {
  prompt = await import("../src/lib/sd/prompt");
  pngText = await import("../src/lib/sd/png-text");
  payload = await import("../src/lib/sd/payload");
  client = await import("../src/lib/sd/client");
  generate = await import("../src/lib/sd/generate");
  styles = await import("../src/lib/sd/styles");
});

test("prompt matrix matches Automatic1111 combination order", () => {
  const out = prompt.expandPromptMatrix("a cat|hat|cape");
  assert.deepEqual(out, ["a cat", "a cat, hat", "a cat, cape", "a cat, hat, cape"]);
  assert.equal(prompt.expandPromptMatrix("a cat|hat", { atStart: true })[1], "hat, a cat");
  assert.equal(prompt.expandPromptMatrix("solo").length, 1);
});

test("attention nudge wraps, steps, and unwraps at 1.0", () => {
  const once = prompt.nudgeAttention("a tuxedo", 2, 8, 0.1);
  assert.equal(once.text, "a (tuxedo:1.1)");
  const twice = prompt.nudgeAttention(once.text, once.start, once.end, 0.1);
  assert.equal(twice.text, "a (tuxedo:1.2)");
  const down = prompt.nudgeAttention(twice.text, twice.start, twice.end, -0.1);
  const back = prompt.nudgeAttention(down.text, down.start, down.end, -0.1);
  assert.equal(back.text, "a tuxedo");
});

test("styles replace {prompt} or append", () => {
  assert.equal(prompt.applyStyles("cat", ["masterpiece", "{prompt}, studio"]), "cat, masterpiece, studio");
});

test("infotext round trip", () => {
  const raw = "a cat in a hat\nNegative prompt: blurry\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 42, Size: 512x768, Model: dreamshaper";
  const info = prompt.parseInfotext(raw);
  assert.equal(info.prompt, "a cat in a hat");
  assert.equal(info.negativePrompt, "blurry");
  assert.equal(info.steps, 20);
  assert.equal(info.sampler, "Euler a");
  assert.equal(info.cfg, 7);
  assert.equal(info.seed, 42);
  assert.equal(info.width, 512);
  assert.equal(info.height, 768);
  assert.equal(info.model, "dreamshaper");
});

test("png parameters chunk round trip, including non-latin1", async () => {
  assert.equal(pngText.crc32(Buffer.from("123456789")), 0xcbf43926);
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#112233" } }).png().toBuffer();
  const latin = pngText.embedPngText(png, "parameters", "a cat\nSteps: 20, Seed: 1");
  assert.equal(pngText.readPngText(latin, "parameters"), "a cat\nSteps: 20, Seed: 1");
  const uni = pngText.embedPngText(png, "parameters", "猫 hat");
  assert.equal(pngText.readPngText(uni, "parameters"), "猫 hat");
});

test("generation body is clamped and has no host", () => {
  const g = payload.parseGenRequest({ mode: "txt2img", prompt: "cat", width: 100, batchSize: 99, steps: 9999 });
  assert.equal(g.width, 104);
  assert.equal(g.batchSize, 4);
  assert.equal(g.steps, 150);
  const body = payload.txt2imgBody(g, "cat", "", -1);
  assert.equal(body.sampler_name, "Euler a");
  assert.equal("url" in body, false);
  assert.equal("init_images" in body, false);
  assert.throws(() => payload.parseGenRequest({ mode: "txt2img", prompt: "   " }), /empty/i);
  assert.throws(() => payload.parseGenRequest({ mode: "txt2img", prompt: "cat", matrix: { enabled: true }, plot: { enabled: true, xAxis: "Steps", yAxis: "CFG scale", xValues: "1", yValues: "1" } }), /not both/i);
});

test("webui origin is the server env, not a file URL", () => {
  process.env.NFT_FORGE_SD_URL = "file:///etc/passwd";
  assert.throws(() => client.sdOrigin(), /http/);
  process.env.NFT_FORGE_SD_URL = "http://127.0.0.1:7861/sdapi/v1";
  assert.equal(client.sdOrigin(), "http://127.0.0.1:7861");
  process.env.NFT_FORGE_SD_URL = "http://127.0.0.1:7860";
});

test("prompt matrix calls txt2img once per combination and builds a grid", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#224466" } }).png().toBuffer();
  const b64 = png.toString("base64");
  const calls: Record<string, unknown>[] = [];
  const out = await generate.runGenerate(
    "sd-test",
    { mode: "txt2img", prompt: "a cat|hat|cape", matrix: { enabled: true }, seed: 5 },
    {
      async txt2img(body) {
        calls.push(body);
        return { images: [b64], info: JSON.stringify({ all_seeds: [body.seed], infotexts: [`${body.prompt}\nSteps: 20, Seed: ${body.seed}`] }) };
      },
      async img2img() {
        throw new Error("img2img should not run");
      },
      async extra() {
        throw new Error("extras should not run");
      },
      async readAsset() {
        return png;
      },
    },
  );
  assert.deepEqual(
    calls.map((c) => c.prompt),
    ["a cat", "a cat, hat", "a cat, cape", "a cat, hat, cape"],
  );
  assert.equal(out.images[0].grid, true);
  assert.equal(out.images.length, 5);
  assert.equal("init_images" in calls[0], false);
});

test("a saved style is applied before the webui call", async () => {
  await styles.saveStyle("styled", { name: "Paint", prompt: "{prompt}, oil", negativePrompt: "photo" });
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#445566" } }).png().toBuffer();
  let seen = "";
  let neg = "";
  await generate.runGenerate(
    "styled",
    { mode: "txt2img", prompt: "ship", styleNames: ["Paint"], seed: 1, batchCount: 1, batchSize: 1 },
    {
      async txt2img(body) {
        seen = String(body.prompt);
        neg = String(body.negative_prompt);
        return { images: [png.toString("base64")], info: JSON.stringify({ all_seeds: [1], infotexts: ["ship, oil"] }) };
      },
      async img2img() {
        throw new Error("no");
      },
      async extra() {
        throw new Error("no");
      },
      async readAsset() {
        return png;
      },
    },
  );
  assert.equal(seen, "ship, oil");
  assert.equal(neg, "photo");
});
