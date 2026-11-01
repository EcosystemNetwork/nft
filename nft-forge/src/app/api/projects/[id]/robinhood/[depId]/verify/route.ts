import { route } from "@/lib/api";
import { verifyEvmDeployment } from "@/lib/evm-deployments";

export const POST = route<{ id: string; depId: string }>(async (_req, { id, depId }) => verifyEvmDeployment(id, depId));
