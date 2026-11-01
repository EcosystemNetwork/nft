import { body, route } from "@/lib/api";
import { approveProduction } from "@/lib/deployments";

/** Separate production approval step: readiness must pass and the collection name must be typed. */
export const POST = route<{ id: string }>(async (req, { id }) =>
  approveProduction(id, await body<{ wallet: string; confirmName: string }>(req)),
);
