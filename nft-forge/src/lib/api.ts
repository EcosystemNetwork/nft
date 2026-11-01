import { NextResponse } from "next/server";
import { requireUser } from "./auth";
import { HttpError } from "./store";

type Ctx<P> = { params: Promise<P> };

/**
 * Wrap a route handler with uniform JSON errors. Studio routes require a
 * signed-in user. Pass `{ auth: "public" }` only for collector and login routes.
 */
export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<unknown>, opts?: { auth?: "user" | "public" }) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      if (opts?.auth !== "public") {
        const write = req.method !== "GET" && req.method !== "HEAD";
        await requireUser(req, { write });
      }
      const out = await fn(req, await ctx.params);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      const setup = status === 401 && /set up the studio/i.test((e as Error).message);
      return NextResponse.json({ error: (e as Error).message, ...(setup ? { setup: true } : {}) }, { status });
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
