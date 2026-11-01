import { body, route } from "@/lib/api";
import { generateForProject } from "@/lib/collection";
import { HttpError } from "@/lib/store";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = await body<{ seed?: string }>(req).catch(() => ({}) as { seed?: string });
  const { run, collection } = await generateForProject(id, { seed: b.seed });
  if (run.errors.length && run.generated === 0 && run.preserved === 0) throw new HttpError(422, run.errors.join("\n"));
  return { run, count: collection.nfts.length };
});
