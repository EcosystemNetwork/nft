import { route } from "@/lib/api";
import { EVM_CHAINS } from "@/lib/evm/chains";
import { getEvmDeployment, readOnchainSale } from "@/lib/evm-deployments";
import { getCollection, getProject, HttpError } from "@/lib/store";
import { getSale, publicPhases } from "@/lib/sale";

// Public, unauthenticated: what a collector's mint page needs, nothing more
// (no allowlist contents, no reveal secret, no internal deployment log).

const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 5_000;

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const project = await getProject(id);
  const sale = await getSale(id);
  if (!sale.enabled || !sale.liveDeploymentId) throw new HttpError(404, "This collection's mint is not open.");
  const d = await getEvmDeployment(id, sale.liveDeploymentId);
  if (!d.contract) throw new HttpError(404, "This collection's mint is not open.");
  const onchain = await readOnchainSale(d.network, d.contract);
  const first = (await getCollection(id))?.nfts[0]?.tokenId ?? project.metadata.startTokenId;
  const value = {
    collection: {
      name: project.metadata.collectionName,
      symbol: project.metadata.symbol,
      description: project.metadata.description,
      externalUrl: project.metadata.externalUrl || null,
      royaltyBps: project.metadata.sellerFeeBasisPoints,
      // Before reveal the mint page shows the placeholder, never real artwork.
      image: d.params.unrevealedURI && !onchain.revealed ? `/api/projects/${id}/metadata/unrevealed.png` : `/api/projects/${id}/nfts/${first}/image`,
    },
    contract: {
      address: d.contract,
      network: d.network,
      chainId: EVM_CHAINS[d.network].id,
      chainName: EVM_CHAINS[d.network].name,
      explorer: EVM_CHAINS[d.network].blockExplorers!.default.url,
      testnet: d.network !== "robinhood",
      provenanceHash: d.params.provenanceHash,
      delayedReveal: Boolean(d.params.unrevealedURI),
    },
    phases: publicPhases(sale),
    onchain,
  };
  cache.set(id, { at: Date.now(), value });
  return value;
}, { auth: "public" });
