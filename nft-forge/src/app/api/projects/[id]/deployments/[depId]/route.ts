import { body, route } from "@/lib/api";
import type { DeployEvent } from "@/lib/chain/types";
import { applyEvent, getDeployment } from "@/lib/deployments";

export const GET = route<{ id: string; depId: string }>(async (_req, { id, depId }) => getDeployment(id, depId));

/** Progress events from the client-side engine (public data only: URIs, addresses, signatures). */
export const PATCH = route<{ id: string; depId: string }>(async (req, { id, depId }) => applyEvent(id, depId, await body<DeployEvent>(req)));
