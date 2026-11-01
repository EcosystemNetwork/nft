import { body, route } from "@/lib/api";
import { addUser, listPublicUsers, requireOwner } from "@/lib/auth";
import type { Role } from "@/lib/access";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireOwner(req);
  return { users: await listPublicUsers() };
});

export const POST = route(async (req) => {
  await requireOwner(req);
  const b = await body<{ name?: string; email?: string; password?: string; role?: Role }>(req);
  const user = await addUser({ name: b.name ?? "", email: b.email ?? "", password: b.password ?? "", role: b.role ?? "editor" });
  return { user };
});
