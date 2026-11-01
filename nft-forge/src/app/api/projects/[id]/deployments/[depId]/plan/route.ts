import { route } from "@/lib/api";
import { buildPlan } from "@/lib/deployments";

export const GET = route<{ id: string; depId: string }>(async (_req, { id, depId }) => buildPlan(id, depId));
