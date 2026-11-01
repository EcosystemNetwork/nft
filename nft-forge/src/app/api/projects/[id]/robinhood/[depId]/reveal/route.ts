import { NextResponse } from "next/server";
import { body, route } from "@/lib/api";
import { currentRevealOffset, prepareReveal, revealSecret } from "@/lib/evm-deployments";
import { startRevealPack } from "@/lib/publish";
import { HttpError } from "@/lib/store";

/** Backup download of the reveal secret. Losing it makes the collection impossible to reveal. */
export const GET = route<{ id: string; depId: string }>(async (_req, { id, depId }) => {
  const secret = await revealSecret(id, depId);
  return new NextResponse(JSON.stringify({ deployment: depId, secret, note: "ForgeCollection reveal secret. Keep it private until reveal; keccak256(abi.encode(secret)) is the on-chain revealCommitment." }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="reveal-secret-${depId}.json"`, "cache-control": "no-store" },
  });
});

/** action "prepare": compute offset + metadata location (returns the secret for the wallet tx). "pack": build mainnet revealed metadata CAR. */
export const POST = route<{ id: string; depId: string }>(async (req, { id, depId }) => {
  const b = await body<{ action: "prepare" | "pack" }>(req);
  if (b.action === "prepare") return prepareReveal(id, depId, new URL(req.url).origin);
  if (b.action === "pack") {
    const { deployment: d, offset } = await currentRevealOffset(id, depId);
    if (d.mode !== "production") throw new HttpError(400, "Testnet reveals use this server's metadata; no packing needed.");
    return startRevealPack(id, depId, offset, d.params.maxSupply, d.params.startTokenId);
  }
  throw new HttpError(400, "Unknown action");
});
