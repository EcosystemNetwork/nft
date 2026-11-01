import { NextResponse } from "next/server";
import { body, route } from "@/lib/api";
import { loginUser } from "@/lib/auth";

export const POST = route(async (req) => {
  const b = await body<{ email?: string; password?: string }>(req);
  const { user, cookie } = await loginUser(b.email ?? "", b.password ?? "", req);
  const res = NextResponse.json({ user });
  res.headers.append("set-cookie", cookie);
  return res;
}, { auth: "public" });
