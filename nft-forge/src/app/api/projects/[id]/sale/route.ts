import { body, route } from "@/lib/api";
import { parseAllowlist } from "@/lib/evm/allowlist";
import { getSale, phaseOnChain, saleProblems, updateSale, type SaleConfig } from "@/lib/sale";
import { getProject, HttpError } from "@/lib/store";

const view = (s: SaleConfig, supply: number) => ({
  sale: s,
  problems: saleProblems(s, supply),
  onchain: s.phases.map((p) => {
    const c = phaseOnChain(p);
    return { start: Number(c.start), end: Number(c.end), price: c.price.toString(), maxPerWallet: c.maxPerWallet, cap: c.cap, merkleRoot: c.merkleRoot };
  }),
});

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const project = await getProject(id);
  return view(await getSale(id), project.config.supply);
});

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const project = await getProject(id);
  return view(await updateSale(id, await body<Partial<SaleConfig>>(req)), project.config.supply);
});

/** Parse an allowlist upload (CSV / one address per line) without saving it. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  await getProject(id);
  const b = await body<{ text?: string; defaultAllowance?: number }>(req);
  if (typeof b.text !== "string") throw new HttpError(400, "text is required");
  if (b.text.length > 5_000_000) throw new HttpError(413, "Allowlist file too large");
  return parseAllowlist(b.text, Math.max(1, Math.floor(b.defaultAllowance ?? 1)));
});
