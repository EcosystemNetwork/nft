import { body, route } from "@/lib/api";
import { readPngText } from "@/lib/sd/png-text";
import { parseInfotext } from "@/lib/sd/prompt";
import { getProject, HttpError } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  const b = await body<{ text?: string; imageBase64?: string }>(req);
  let text = b.text ?? "";
  if (b.imageBase64) {
    const raw = b.imageBase64.includes(",") ? b.imageBase64.slice(b.imageBase64.indexOf(",") + 1) : b.imageBase64;
    if (raw.length > 18_000_000) throw new HttpError(413, "PNG is too large");
    text = readPngText(Buffer.from(raw, "base64"), "parameters") ?? "";
    if (!text) throw new HttpError(400, "That PNG has no parameters chunk");
  }
  if (!text.trim()) throw new HttpError(400, "Paste parameters text or drop a PNG");
  return { ...parseInfotext(text), infotext: text.trim() };
});
