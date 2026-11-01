import { body, route } from "@/lib/api";
import { checkAvailability, publicationStatus, startFilebaseUpload, startPack } from "@/lib/publish";
import { getProject, HttpError } from "@/lib/store";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await getProject(id);
  return publicationStatus(id);
});

/** action: "pack" (build CARs + CIDs), "filebase" (upload), "check" (gateway availability). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  const b = await body<{ action: "pack" | "filebase" | "check" }>(req);
  if (b.action === "pack") return startPack(id);
  if (b.action === "filebase") return startFilebaseUpload(id);
  if (b.action === "check") return checkAvailability(id);
  throw new HttpError(400, "Unknown action");
});
