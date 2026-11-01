import { body, route } from "@/lib/api";
import { deleteStyle, listStyles, saveStyle } from "@/lib/sd/styles";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await getProject(id);
  return listStyles(id);
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  return saveStyle(id, await body(req));
});

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  const b = await body<{ name?: string }>(req);
  return deleteStyle(id, b.name ?? "");
});
