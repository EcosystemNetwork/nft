import { body, route } from "@/lib/api";
import { approveEvmProduction } from "@/lib/evm-deployments";

/** Separate mainnet approval: readiness must pass, metadata must be permanently hosted, and the name typed. */
export const POST = route<{ id: string }>(async (req, { id }) =>
  approveEvmProduction(id, await body<{ wallet: string; confirmName: string; baseURI: string; contractURI: string }>(req)),
);
