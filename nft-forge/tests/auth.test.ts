import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { decide } from "../src/lib/access";

process.env.NFT_FORGE_DATA = mkdtempSync(path.join(os.tmpdir(), "forge-auth-"));
process.env.NFT_FORGE_AUTH_SECRET = "test-secret-test-secret-test-secret!!";

type Auth = typeof import("../src/lib/auth");
let auth: Auth;

before(async () => {
  auth = await import("../src/lib/auth");
});

const req = (cookie?: string) => new Request("http://127.0.0.1/api/projects", { headers: cookie ? { cookie } : {} });

test("studio stays shut until an owner exists, then a session opens it", async () => {
  assert.equal(decide("/api/projects", "GET", null, false).type, "deny");
  assert.equal(decide("/", "GET", null, false).type, "redirect");
  assert.equal((decide("/", "GET", null, false) as { to: string }).to, "/setup");
  assert.equal(decide("/mint/space-pirates-genesis", "GET", null, false).type, "next");
  assert.equal(decide("/api/mint/space-pirates-genesis", "GET", null, false).type, "next");

  const { user, cookie } = await auth.setupOwner({ name: "Rex", email: "Owner@Example.com", password: "correct horse" }, req());
  assert.equal(user.role, "owner");
  assert.equal(user.email, "owner@example.com");
  await assert.rejects(() => auth.setupOwner({ name: "Other", email: "a@b.co", password: "correct horse" }, req()), /already has an owner/);

  const session = await auth.readSessionUser(req(cookie.split(";")[0]));
  assert.equal(session?.id, user.id);
  assert.equal(decide("/api/projects", "GET", session, true).type, "next");
  assert.equal(decide("/", "GET", null, true).type, "redirect");

  await assert.rejects(() => auth.loginUser("owner@example.com", "wrong-password", req()), /wrong/);
  const again = await auth.loginUser("owner@example.com", "correct horse", req());
  assert.equal(again.user.id, user.id);
});

test("viewers cannot write and cannot remove the owner", async () => {
  const owner = await auth.readSessionUser(req((await auth.loginUser("owner@example.com", "correct horse", req())).cookie.split(";")[0]));
  assert.ok(owner);
  const viewer = await auth.addUser({ name: "Guest", email: "guest@example.com", password: "view-only-pw", role: "viewer" });
  const editor = await auth.addUser({ name: "Ed", email: "ed@example.com", password: "editor-pass", role: "editor" });
  const denied = decide("/api/projects/x", "POST", viewer, true);
  assert.equal(denied.type, "deny");
  if (denied.type === "deny") assert.equal(denied.status, 403);
  assert.equal(decide("/api/projects/x", "GET", viewer, true).type, "next");
  assert.equal(decide("/api/projects/x", "POST", editor, true).type, "next");
  await assert.rejects(() => auth.removeUser(owner.id, owner.id), /owner account stays/);
  await auth.removeUser(viewer.id, owner.id);
  assert.equal((await auth.listPublicUsers()).some((u) => u.id === viewer.id), false);
});

test("a tampered cookie is not a session", async () => {
  const { cookie } = await auth.loginUser("ed@example.com", "editor-pass", req());
  const raw = cookie.split(";")[0].slice("nf_session=".length);
  const broken = `nf_session=${raw.slice(0, -2)}aa`;
  assert.equal(await auth.readSessionUser(req(broken)), null);
});

test("reveal secret route rejects an anonymous caller", async () => {
  const mod = await import("../src/app/api/projects/[id]/robinhood/[depId]/reveal/route");
  const res = await mod.GET(new Request("http://127.0.0.1/api/projects/x/robinhood/y/reveal"), { params: Promise.resolve({ id: "x", depId: "y" }) });
  assert.equal(res.status, 401);
});

test("mint route does not demand a session", async () => {
  const mod = await import("../src/app/api/mint/[id]/route");
  const res = await mod.GET(new Request("http://127.0.0.1/api/mint/missing"), { params: Promise.resolve({ id: "missing" }) });
  assert.notEqual(res.status, 401);
});

test("delayed reveal hides artwork until a reveal exists", async () => {
  const store = await import("../src/lib/store");
  const sale = await import("../src/lib/sale");
  const art = await import("../src/lib/public-art");
  const project = await store.createProject({ name: "Hidden", concept: "", supply: 3, style: "", chain: "robinhood", mode: "hybrid" });
  assert.equal(await art.artworkIsPublic(project.id), true);
  await sale.updateSale(project.id, {
    enabled: true,
    delayedReveal: true,
    reserved: 0,
    phases: [{ id: "ph1", name: "Public", start: new Date().toISOString(), end: null, priceWei: "0", maxPerWallet: 1, cap: 0, allowlist: null }],
  });
  assert.equal(await art.artworkIsPublic(project.id), false);
});

test("auth files are not world-readable", async () => {
  const mode = (await stat(path.join(process.env.NFT_FORGE_DATA!, "auth", "users.json"))).mode & 0o777;
  assert.equal(mode, 0o600);
  await chmod(path.join(process.env.NFT_FORGE_DATA!, "auth", "users.json"), 0o600);
});
