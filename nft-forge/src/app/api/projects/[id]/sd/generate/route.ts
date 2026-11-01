import { body, route } from "@/lib/api";
import { runGenerate } from "@/lib/sd/generate";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  return runGenerate(id, await body(req));
});
