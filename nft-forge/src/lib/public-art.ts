import { getEvmDeployment } from "./evm-deployments";
import { getSale } from "./sale";

/** Real artwork and per-token metadata stay private while a delayed reveal has not happened. */
export async function artworkIsPublic(projectId: string): Promise<boolean> {
  const sale = await getSale(projectId);
  if (!sale.enabled || !sale.delayedReveal) return true;
  if (!sale.liveDeploymentId) return false;
  try {
    const d = await getEvmDeployment(projectId, sale.liveDeploymentId);
    return Boolean(d.reveal);
  } catch {
    return false;
  }
}
