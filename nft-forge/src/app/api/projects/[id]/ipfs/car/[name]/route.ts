import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { route } from "@/lib/api";
import { carPath } from "@/lib/publish";
import { HttpError } from "@/lib/store";

/** Download a CAR to import into any IPFS pinning service (CIDs are preserved). */
export const GET = route<{ id: string; name: string }>(async (_req, { id, name }) => {
  const file = carPath(id, name);
  const size = await fs.stat(file).then((s) => s.size).catch(() => {
    throw new HttpError(404, "Not packed yet");
  });
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { "content-type": "application/vnd.ipld.car", "content-length": String(size), "content-disposition": `attachment; filename="${id}-${name}"` },
  });
});
