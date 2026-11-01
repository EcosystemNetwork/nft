import { route } from "@/lib/api";
import { readiness } from "@/lib/deployments";

export const GET = route<{ id: string }>(async (_req, { id }) => readiness(id));
