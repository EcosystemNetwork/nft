import { body, route } from "@/lib/api";
import { createEvmDeployment, listEvmDeployments } from "@/lib/evm-deployments";
import { getProject, HttpError } from "@/lib/store";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await getProject(id);
  return listEvmDeployments(id);
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = await body<{ mode: "test" | "production"; wallet: string; testCount?: number; baseURI?: string; contractURI?: string; approvalId?: string; batchSize?: number }>(req);
  if (b.mode !== "test" && b.mode !== "production") throw new HttpError(400, "mode must be test or production");
  return createEvmDeployment(id, b, new URL(req.url).origin);
});
