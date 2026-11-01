import { route } from "@/lib/api";
import { isEvmAddress } from "@/lib/evm/types";
import { getSale, phaseProof } from "@/lib/sale";
import { HttpError } from "@/lib/store";

/** Public: allowlist proof for one wallet in one phase (reveals only that wallet's own entry). */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const q = new URL(req.url).searchParams;
  const wallet = q.get("wallet") ?? "";
  const phase = Number(q.get("phase"));
  if (!isEvmAddress(wallet)) throw new HttpError(400, "wallet must be an address");
  const sale = await getSale(id);
  const p = sale.phases[phase];
  if (!sale.enabled || !p) throw new HttpError(404, "No such phase");
  if (!p.allowlist) return { allowlisted: false, open: true, allowance: 0, proof: [] };
  const pr = phaseProof(p, wallet);
  return pr ? { allowlisted: true, open: false, ...pr } : { allowlisted: false, open: false, allowance: 0, proof: [] };
}, { auth: "public" });
