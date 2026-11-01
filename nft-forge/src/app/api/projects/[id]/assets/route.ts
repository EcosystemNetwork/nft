import { route } from "@/lib/api";
import { ingestAsset } from "@/lib/assets";
import { getProject, HttpError, listAssets } from "@/lib/store";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await getProject(id);
  return listAssets(id);
});

/** Multipart batch upload. Field "files" (many); optional "category" and "replace" (asset id → new version). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "No files uploaded");
  const category = (form.get("category") as string | null) || undefined;
  const replace = (form.get("replace") as string | null) || undefined;
  const paths = form.getAll("paths").map(String);
  const results = [];
  for (const [i, f] of files.entries()) {
    // Folder uploads send "Headgear/Crown.png"; the folder name becomes the category hint.
    const parts = (paths[i] || f.name).split(/[\\/]/);
    const hint = category ?? (parts.length > 1 ? parts[parts.length - 2] : undefined);
    try {
      const r = await ingestAsset(id, Buffer.from(await f.arrayBuffer()), parts[parts.length - 1], {
        categoryHint: hint,
        replaceAssetId: replace,
      });
      results.push({ file: f.name, ok: true, ...r });
    } catch (e) {
      results.push({ file: f.name, ok: false, error: (e as Error).message });
    }
  }
  return { results };
});
