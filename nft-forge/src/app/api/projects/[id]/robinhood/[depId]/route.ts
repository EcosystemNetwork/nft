import { body, route } from "@/lib/api";
import { applyEvmEvent, getEvmDeployment } from "@/lib/evm-deployments";
import type { EvmEvent } from "@/lib/evm/types";

/** Deployment record (the browser builds the constructor arguments from `params`). */
export const GET = route<{ id: string; depId: string }>(async (_req, { id, depId }) => getEvmDeployment(id, depId));

export const PATCH = route<{ id: string; depId: string }>(async (req, { id, depId }) => applyEvmEvent(id, depId, await body<EvmEvent>(req)));
