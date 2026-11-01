import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { submitSourceVerification, verificationBundle } from "@/lib/evm-deployments";

/** POST: publish the contract source on Blockscout automatically. */
export const POST = route<{ id: string; depId: string }>(async (_req, { id, depId }) => submitSourceVerification(id, depId));

/** GET: download the exact verification input for manual verification (explorer UI or forge). */
export const GET = route<{ id: string; depId: string }>(async (_req, { id, depId }) =>
  NextResponse.json(await verificationBundle(id, depId), {
    headers: { "content-disposition": `attachment; filename="ForgeCollection-verification-${depId}.json"` },
  }),
);
