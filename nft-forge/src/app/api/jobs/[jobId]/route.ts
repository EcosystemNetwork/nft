import { body, route } from "@/lib/api";
import { controlJob, getJob } from "@/lib/jobs";
import { HttpError } from "@/lib/store";

export const GET = route<{ jobId: string }>(async (_req, { jobId }) => {
  const job = getJob(jobId);
  if (!job) throw new HttpError(404, "Job not found (jobs are kept in memory until the server restarts)");
  return job;
});

export const POST = route<{ jobId: string }>(async (req, { jobId }) => {
  const b = await body<{ action: "pause" | "resume" | "cancel" }>(req);
  const job = controlJob(jobId, b.action);
  if (!job) throw new HttpError(404, "Job not found");
  return job;
});
