import { body, route } from "@/lib/api";
import { applyEvmEvent, constructorArgs, getEvmDeployment } from "@/lib/evm-deployments";
import type { EvmEvent } from "@/lib/evm/types";

/** Deployment record plus the exact constructor arguments the browser deploys with. */
export const GET = route<{ id: string; depId: string }>(async (_req, { id, depId }) => {
  const d = await getEvmDeployment(id, depId);
  return { ...d, constructorArgs: constructorArgs(d.params).map((a) => (typeof a === "bigint" ? a.toString() : a)) };
});

export const PATCH = route<{ id: string; depId: string }>(async (req, { id, depId }) => applyEvmEvent(id, depId, await body<EvmEvent>(req)));
