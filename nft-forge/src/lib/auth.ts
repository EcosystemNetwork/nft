import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Role } from "./access";
import { DATA_DIR, HttpError } from "./store";

export type PublicUser = { id: string; email: string; name: string; role: Role; createdAt: string };

type StoredUser = PublicUser & { passwordHash: string };

const COOKIE = "nf_session";
const SESSION_SECONDS = 14 * 24 * 3600;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const authDir = () => path.join(DATA_DIR, "auth");
const usersFile = () => path.join(authDir(), "users.json");
const secretFile = () => path.join(authDir(), "secret");

let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function passwordOk(password: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const got = scryptSync(password, Buffer.from(salt, "hex"), 32, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  const exp = Buffer.from(hash, "hex");
  return got.length === exp.length && timingSafeEqual(got, exp);
}

function checkPassword(password: string) {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    throw new HttpError(400, "Password must be 10–200 characters.");
  }
}

function checkIdentity(name: string, email: string) {
  if (!name.trim() || name.trim().length > 80) throw new HttpError(400, "Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, "A real email is required.");
}

async function readUsers(): Promise<StoredUser[]> {
  try {
    return JSON.parse(await fs.readFile(usersFile(), "utf8")) as StoredUser[];
  } catch {
    return [];
  }
}

async function writeUsers(users: StoredUser[]) {
  const dir = authDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.users.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(users), { mode: 0o600 });
  await fs.rename(tmp, usersFile());
  await fs.chmod(usersFile(), 0o600);
}

let secretMemo: Promise<Buffer> | null = null;
export function authSecret(): Promise<Buffer> {
  const fromEnv = process.env.NFT_FORGE_AUTH_SECRET;
  if (fromEnv) return Promise.resolve(Buffer.from(fromEnv));
  secretMemo ??= (async () => {
    try {
      return await fs.readFile(secretFile());
    } catch {
      const buf = randomBytes(32);
      await fs.mkdir(authDir(), { recursive: true });
      await fs.writeFile(secretFile(), buf, { mode: 0o600 });
      await fs.chmod(secretFile(), 0o600);
      return buf;
    }
  })();
  return secretMemo;
}

export async function hasUsers(): Promise<boolean> {
  return (await readUsers()).length > 0;
}

function seal(sub: string, secret: Buffer, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function openToken(token: string, secret: Buffer, now = Date.now()): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub?: unknown; exp?: unknown };
    if (typeof data.sub !== "string" || typeof data.exp !== "number" || data.exp * 1000 <= now) return null;
    return data.sub;
  } catch {
    return null;
  }
}

export function tokenFromRequest(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    if (part.startsWith(`${COOKIE}=`)) return decodeURIComponent(part.slice(COOKIE.length + 1));
  }
  return null;
}

export function sessionCookie(token: string, req: Request): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

const toPublic = (u: StoredUser): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt });

export async function readSessionUser(req: Request): Promise<PublicUser | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const sub = openToken(token, await authSecret());
  if (!sub) return null;
  const user = (await readUsers()).find((u) => u.id === sub);
  return user ? toPublic(user) : null;
}

export async function requireUser(req: Request, opts?: { write?: boolean }): Promise<PublicUser> {
  if (!(await hasUsers())) throw new HttpError(401, "Set up the studio owner before using NFT Forge.");
  const user = await readSessionUser(req);
  if (!user) throw new HttpError(401, "Sign in required.");
  if (opts?.write && user.role === "viewer") throw new HttpError(403, "Viewers can't change the studio.");
  return user;
}

export async function requireOwner(req: Request): Promise<PublicUser> {
  const user = await requireUser(req);
  if (user.role !== "owner") throw new HttpError(403, "Only the studio owner can manage accounts.");
  return user;
}

const failures = new Map<string, { n: number; at: number }>();

function throttle(email: string) {
  const row = failures.get(email);
  if (row && row.n >= 8 && Date.now() - row.at < 15 * 60_000) throw new HttpError(429, "Too many sign-in attempts. Wait a few minutes.");
}

function noteFailure(email: string) {
  const row = failures.get(email);
  failures.set(email, { n: row && Date.now() - row.at < 15 * 60_000 ? row.n + 1 : 1, at: Date.now() });
}

export function resetLoginThrottle() {
  failures.clear();
}

export async function setupOwner(input: { name: string; email: string; password: string }, req: Request): Promise<{ user: PublicUser; cookie: string }> {
  return locked(async () => {
    if (await hasUsers()) throw new HttpError(409, "The studio already has an owner.");
    const name = input.name?.trim() ?? "";
    const email = input.email?.trim().toLowerCase() ?? "";
    checkIdentity(name, email);
    checkPassword(input.password);
    const user: StoredUser = {
      id: randomBytes(16).toString("hex"),
      email,
      name,
      role: "owner",
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(input.password),
    };
    await writeUsers([user]);
    const token = seal(user.id, await authSecret());
    return { user: toPublic(user), cookie: sessionCookie(token, req) };
  });
}

export async function loginUser(emailRaw: string, password: string, req: Request): Promise<{ user: PublicUser; cookie: string }> {
  const email = emailRaw.trim().toLowerCase();
  throttle(email);
  const user = (await readUsers()).find((u) => u.email === email);
  if (!user || !passwordOk(password, user.passwordHash)) {
    noteFailure(email);
    throw new HttpError(401, "Email or password is wrong.");
  }
  failures.delete(email);
  return { user: toPublic(user), cookie: sessionCookie(seal(user.id, await authSecret()), req) };
}

export async function listPublicUsers(): Promise<PublicUser[]> {
  return (await readUsers()).map(toPublic);
}

export async function addUser(input: { name: string; email: string; password: string; role: Role }): Promise<PublicUser> {
  return locked(async () => {
    if (input.role !== "editor" && input.role !== "viewer") throw new HttpError(400, "Role must be editor or viewer.");
    const name = input.name?.trim() ?? "";
    const email = input.email?.trim().toLowerCase() ?? "";
    checkIdentity(name, email);
    checkPassword(input.password);
    const users = await readUsers();
    if (users.some((u) => u.email === email)) throw new HttpError(409, "That email already has an account.");
    const user: StoredUser = {
      id: randomBytes(16).toString("hex"),
      email,
      name,
      role: input.role,
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(input.password),
    };
    await writeUsers([...users, user]);
    return toPublic(user);
  });
}

export async function removeUser(id: string, actorId: string) {
  return locked(async () => {
    const users = await readUsers();
    const target = users.find((u) => u.id === id);
    if (!target) throw new HttpError(404, "No such account.");
    if (target.role === "owner" || target.id === actorId) throw new HttpError(400, "The owner account stays.");
    await writeUsers(users.filter((u) => u.id !== id));
  });
}
