import { body, route } from "@/lib/api";
import type { DeploymentMode, UriMode } from "@/lib/chain/types";
import { createDeployment, listDeployments } from "@/lib/deployments";
import { getProject, HttpError } from "@/lib/store";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await getProject(id);
  return listDeployments(id);
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = await body<{
    mode: DeploymentMode;
    wallet: string;
    uriMode: UriMode;
    testCount?: number;
    metadataBaseUri?: string;
    collectionMetadataUri?: string;
    approvalId?: string;
  }>(req);
  if (b.mode !== "test" && b.mode !== "production") throw new HttpError(400, "mode must be test or production");
  if (b.uriMode !== "irys" && b.uriMode !== "base") throw new HttpError(400, "uriMode must be irys or base");
  return createDeployment(id, b);
});
