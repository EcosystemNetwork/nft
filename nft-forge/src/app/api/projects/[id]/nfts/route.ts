import { body, route } from "@/lib/api";
import { setStatus } from "@/lib/collection";
import type { NftStatus } from "@/lib/engine/types";
import { HttpError } from "@/lib/store";

/** Batch review: set status on many tokens at once. */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const b = await body<{ tokenIds: number[]; status: NftStatus }>(req);
  if (!["draft", "approved", "locked"].includes(b.status)) throw new HttpError(400, "Invalid status");
  if (!Array.isArray(b.tokenIds)) throw new HttpError(400, "tokenIds must be an array");
  return setStatus(id, b.tokenIds.map(Number), b.status);
});
