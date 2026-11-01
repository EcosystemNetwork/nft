import { promises as fs } from "node:fs";
import path from "node:path";
import { route } from "@/lib/api";
import { getProject, paths } from "@/lib/store";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await getProject(id);
  let names: string[] = [];
  try {
    names = (await fs.readdir(paths.exportsDir(id))).filter((n) => n.endsWith(".zip"));
  } catch {
    return [];
  }
  const out = await Promise.all(
    names.map(async (name) => {
      const s = await fs.stat(path.join(paths.exportsDir(id), name));
      return { name, bytes: s.size, at: s.mtime.toISOString() };
    }),
  );
  return out.sort((a, b) => b.at.localeCompare(a.at));
});
