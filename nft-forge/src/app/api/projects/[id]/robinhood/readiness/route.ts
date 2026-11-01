import { route } from "@/lib/api";
import { evmReadiness } from "@/lib/evm-deployments";

export const GET = route<{ id: string }>(async (_req, { id }) => evmReadiness(id));
