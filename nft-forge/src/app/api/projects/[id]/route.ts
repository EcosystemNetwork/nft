import { body, route } from "@/lib/api";
import { validateConfig } from "@/lib/engine/generator";
import { deleteProject, getProject, HttpError, updateProject, type Project } from "@/lib/store";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const project = await getProject(id);
  return { project, validation: validateConfig(project.config) };
});

type Patch = Partial<
  Pick<Project, "name" | "concept" | "style" | "chain" | "mode" | "artBibleLocked" | "canvas" | "metadata" | "blueprint">
> & { config?: Partial<Project["config"]> };

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const b = await body<Patch>(req);
  const project = await updateProject(id, (p) => {
    for (const k of ["name", "concept", "style", "chain", "mode", "artBibleLocked", "blueprint"] as const)
      if (b[k] !== undefined) (p as unknown as Record<string, unknown>)[k] = b[k];
    if (b.canvas) {
      const { width, height, format } = { ...p.canvas, ...b.canvas };
      if (!(width >= 64 && width <= 8192 && height >= 64 && height <= 8192))
        throw new HttpError(400, "Canvas must be 64–8192 px");
      p.canvas = { width: Math.round(width), height: Math.round(height), format: format === "jpeg" ? "jpeg" : "png" };
    }
    if (b.metadata) p.metadata = { ...p.metadata, ...b.metadata };
    if (b.config) {
      const c = { ...p.config, ...b.config };
      if (!Number.isInteger(c.supply) || c.supply < 1 || c.supply > 100000)
        throw new HttpError(400, "Supply must be 1–100,000");
      p.config = c;
    }
  });
  return { project, validation: validateConfig(project.config) };
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  await getProject(id);
  await deleteProject(id);
  return { ok: true };
});
