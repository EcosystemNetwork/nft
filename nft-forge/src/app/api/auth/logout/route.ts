import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { clearCookie } from "@/lib/auth";

export const POST = route(async () => {
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", clearCookie());
  return res;
}, { auth: "public" });
