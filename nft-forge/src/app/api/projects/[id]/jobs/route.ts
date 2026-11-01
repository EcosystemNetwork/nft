import { body, route } from "@/lib/api";
import { listJobs, startExportJob, startRenderJob } from "@/lib/jobs";
import { getProject, HttpError } from "@/lib/store";

export const GET = route<{ id: string }>(async (_req, { id }) => listJobs(id));

export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  const b = await body<{ type: "render" | "export"; tokenIds?: number[]; force?: boolean }>(req);
  if (b.type === "render") return startRenderJob(id, { tokenIds: b.tokenIds });
  if (b.type === "export") return startExportJob(id, { force: b.force });
  throw new HttpError(400, "Unknown job type");
});
