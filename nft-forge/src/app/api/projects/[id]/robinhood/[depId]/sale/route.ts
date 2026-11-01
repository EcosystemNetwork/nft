import { route } from "@/lib/api";
import { getEvmDeployment, readOnchainSale } from "@/lib/evm-deployments";
import { HttpError } from "@/lib/store";

/** Live sale state read from the contract. */
export const GET = route<{ id: string; depId: string }>(async (_req, { id, depId }) => {
  const d = await getEvmDeployment(id, depId);
  if (!d.contract) throw new HttpError(409, "No contract deployed yet.");
  return readOnchainSale(d.network, d.contract);
});
