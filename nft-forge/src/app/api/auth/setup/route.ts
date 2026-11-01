import { NextResponse } from "next/server";
import { body, route } from "@/lib/api";
import { setupOwner } from "@/lib/auth";

export const POST = route(async (req) => {
  const b = await body<{ name?: string; email?: string; password?: string }>(req);
  const { user, cookie } = await setupOwner({ name: b.name ?? "", email: b.email ?? "", password: b.password ?? "" }, req);
  const res = NextResponse.json({ user });
  res.headers.append("set-cookie", cookie);
  return res;
}, { auth: "public" });
