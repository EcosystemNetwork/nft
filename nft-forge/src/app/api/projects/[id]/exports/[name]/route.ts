import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { route } from "@/lib/api";
import { HttpError, paths } from "@/lib/store";

export const GET = route<{ id: string; name: string }>(async (_req, { id, name }) => {
  if (!/^[a-zA-Z0-9_.-]+\.zip$/.test(name)) throw new HttpError(400, "Invalid file name");
  const file = path.join(paths.exportsDir(id), name);
  let size: number;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    throw new HttpError(404, "Export not found");
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
});
