import { NextResponse, type NextRequest } from "next/server";
import { decide } from "./lib/access";
import { hasUsers, readSessionUser } from "./lib/auth";

export async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const session = await readSessionUser(req);
  const decision = decide(url.pathname, req.method, session, await hasUsers());
  if (decision.type === "next") return NextResponse.next();
  if (decision.type === "redirect") return NextResponse.redirect(new URL(decision.to, req.url));
  return NextResponse.json(
    { error: decision.setup ? "Set up the studio owner before using NFT Forge." : decision.status === 403 ? "Viewers can't change the studio." : "Sign in required.", ...(decision.setup ? { setup: true } : {}) },
    { status: decision.status },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
