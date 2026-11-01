import { body, route } from "@/lib/api";
import { keepGenerated } from "@/lib/sd/generate";
import { getProject, type AssetGeneration } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  return keepGenerated(id, await body<{ pngBase64?: string; name?: string; category?: string; generation?: AssetGeneration }>(req));
});
