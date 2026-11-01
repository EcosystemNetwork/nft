import { route } from "@/lib/api";
import { verifyDeployment } from "@/lib/deployments";

export const POST = route<{ id: string; depId: string }>(async (_req, { id, depId }) => verifyDeployment(id, depId));
