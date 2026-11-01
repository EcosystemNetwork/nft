import { NextResponse } from "next/server";
import { HttpError } from "./store";

type Ctx<P> = { params: Promise<P> };

/** Wrap a route handler with uniform JSON error handling. */
export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const out = await fn(req, await ctx.params);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return NextResponse.json({ error: (e as Error).message }, { status });
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
