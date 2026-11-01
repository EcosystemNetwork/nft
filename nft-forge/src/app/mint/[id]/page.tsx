"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { EvmWalletButton, EvmWalletProvider, shortAddr, useEvmWallet } from "@/components/evm-wallet";
import { api, Badge, Button, Card, cx, Progress, Spinner, Toaster, toast, useApi } from "@/components/ui";
import type { EvmNetwork } from "@/lib/evm/chains";
import type { OnchainSale } from "@/lib/evm/types";

interface PublicPhase {
  index: number;
  name: string;
  start: string;
  end: string | null;
  priceWei: string;
  maxPerWallet: number;
  cap: number;
  allowlisted: boolean;
  allowlistSize: number;
}
interface MintInfo {
  collection: { name: string; symbol: string; description: string; externalUrl: string | null; royaltyBps: number; image: string };
  contract: { address: `0x${string}`; network: EvmNetwork; chainId: number; chainName: string; explorer: string; testnet: boolean; provenanceHash: string; delayedReveal: boolean };
  phases: PublicPhase[];
  onchain: OnchainSale;
}
type Proof = { allowlisted: boolean; open: boolean; allowance: number; proof: `0x${string}`[] };

export default function MintPage() {
  return (
    <EvmWalletProvider>
      <Mint />
      <Toaster />
    </EvmWalletProvider>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const eth = (wei: string | bigint) => {
  const v = Number(formatEther(BigInt(wei)));
  return v === 0 ? "Free" : `${v.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;
};

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d ? `${d}d ${h}h ${m}m` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function Mint() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<MintInfo>(`/api/mint/${id}`, { poll: 15_000 });
  const now = useNow();

  if (loading && !data)
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (!data)
    return (
      <div className="grid min-h-screen place-items-center px-4 text-center">
        <div>
          <div className="text-xl font-semibold">Mint not available</div>
          <p className="mt-2 text-sm text-muted">{error ?? "This collection isn't minting right now."}</p>
        </div>
      </div>
    );

  const { collection, contract, phases, onchain } = data;
  const sold = onchain.totalMinted;
  const soldOut = onchain.publicRemaining === 0;
  const live = phases.filter((p) => Date.parse(p.start) <= now && (!p.end || Date.parse(p.end) > now));
  const next = phases.filter((p) => Date.parse(p.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <span className="font-semibold tracking-wide text-ink">{collection.symbol}</span>
          <span>·</span>
          <span>{contract.chainName}</span>
          {contract.testnet && <Badge tone="amber">Testnet: tokens have no value</Badge>}
        </div>
        <EvmWalletButton />
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div>
          <Card className="overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={collection.image} alt={collection.name} className="aspect-square w-full object-cover" />
          </Card>
        </div>

        <div className="min-w-0">
          <h1 className="text-[32px] leading-tight font-semibold tracking-tight sm:text-[40px]">{collection.name}</h1>
          {collection.description && <p className="mt-3 text-[15px] leading-relaxed text-muted">{collection.description}</p>}

          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between text-[13px]">
              <span className="text-muted">Minted</span>
              <span className="tabular-nums">
                <b className="text-ink">{sold.toLocaleString()}</b> <span className="text-muted">/ {onchain.maxSupply.toLocaleString()}</span>
              </span>
            </div>
            <Progress value={sold} max={onchain.maxSupply} tone={soldOut ? "good" : "violet"} />
          </div>

          <div className="mt-6">
            {soldOut ? (
              <Card className="p-5 text-center">
                <div className="text-lg font-semibold">Sold out</div>
                <p className="mt-1 text-sm text-muted">Every token available to the public has been minted.</p>
              </Card>
            ) : onchain.paused ? (
              <Card className="p-5 text-center">
                <div className="text-lg font-semibold">Paused</div>
                <p className="mt-1 text-sm text-muted">The creator paused the sale. Check back soon.</p>
              </Card>
            ) : live.length ? (
              <MintBox projectId={id} info={data} phases={live} onMinted={reload} now={now} />
            ) : next ? (
              <Card className="p-5">
                <div className="text-[13px] text-muted">{next.name} starts in</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{countdown(Date.parse(next.start) - now)}</div>
                <div className="mt-1 text-[13px] text-muted">{new Date(next.start).toLocaleString()} · {eth(next.priceWei)}</div>
              </Card>
            ) : (
              <Card className="p-5 text-center text-sm text-muted">The sale has ended.</Card>
            )}
          </div>

          <div className="mt-8">
            <div className="mb-3 text-[13px] font-semibold tracking-wide text-muted uppercase">Schedule</div>
            <ol className="space-y-2">
              {phases.map((p) => {
                const st = Date.parse(p.start) > now ? "upcoming" : p.end && Date.parse(p.end) <= now ? "ended" : "live";
                const oc = onchain.phases[p.index];
                return (
                  <li key={p.index} className={cx("flex items-center gap-3 rounded-xl border px-4 py-3 text-[13px]", st === "live" ? "border-violet/40 bg-violet/5" : "border-line bg-panel/60")}>
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", st === "live" ? "bg-green-400" : st === "upcoming" ? "bg-amber-400" : "bg-dim")} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {p.name} {p.allowlisted && <span className="text-[12px] text-muted">· allowlist</span>}
                      </div>
                      <div className="text-[12px] text-muted">
                        {new Date(p.start).toLocaleString()} {p.end ? `→ ${new Date(p.end).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular-nums">{eth(p.priceWei)}</div>
                      <div className="text-[12px] text-muted">
                        {p.allowlisted ? "per allowance" : p.maxPerWallet ? `max ${p.maxPerWallet}/wallet` : "no wallet limit"}
                        {p.cap ? ` · ${oc?.minted ?? 0}/${p.cap}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <details className="mt-8 text-[12px] text-dim">
            <summary className="cursor-pointer text-muted">Contract & provenance</summary>
            <div className="mt-2 space-y-1 break-all">
              <div>
                Contract:{" "}
                <a className="text-violet-2 underline" href={`${contract.explorer}/address/${contract.address}`} target="_blank" rel="noreferrer">
                  {contract.address}
                </a>
              </div>
              <div>Provenance hash: {contract.provenanceHash}</div>
              <div>Royalties: {collection.royaltyBps / 100}%</div>
              {contract.delayedReveal && (
                <div>
                  Delayed reveal: tokens show a placeholder until the creator reveals. Which artwork each token gets is decided at reveal by an offset nobody could predict while minting, and the provenance hash proves the artwork order was fixed before the sale.
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function MintBox({ projectId, info, phases, onMinted, now }: { projectId: string; info: MintInfo; phases: PublicPhase[]; onMinted: () => void; now: number }) {
  const { account, wallet } = useEvmWallet();
  const [phaseIdx, setPhaseIdx] = useState(phases[0].index);
  const phase = phases.find((p) => p.index === phaseIdx) ?? phases[0];
  const [qty, setQty] = useState(1);
  const [proof, setProof] = useState<Proof | null>(null);
  const [mintedHere, setMintedHere] = useState(0);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<"idle" | "wallet" | "pending">("idle");
  const [done, setDone] = useState<{ tx: string; ids: number[] } | null>(null);
  const { contract, onchain } = info;

  // Eligibility for allowlist phases; pick the phase this wallet can actually use.
  useEffect(() => {
    let off = false;
    setProof(null);
    if (!account) return;
    (async () => {
      const pr = await api<Proof>(`/api/mint/${encodeURIComponent(projectId)}/proof?wallet=${account}&phase=${phase.index}`).catch(() => null);
      if (!off) setProof(pr);
      const { walletMinted, walletBalance } = await import("@/lib/evm/mint");
      const [m, b] = await Promise.all([walletMinted(contract.network, contract.address, phase.index, account), walletBalance(contract.network, account)]);
      if (!off) {
        setMintedHere(m);
        setBalance(b);
      }
    })().catch(() => undefined);
    return () => {
      off = true;
    };
  }, [projectId, account, phase.index, contract.network, contract.address, done]);

  const phaseLeft = phase.cap ? Math.max(0, phase.cap - (onchain.phases[phase.index]?.minted ?? 0)) : Infinity;
  const walletLimit = phase.allowlisted ? (proof?.allowlisted ? proof.allowance : 0) : phase.maxPerWallet || Infinity;
  const walletLeft = Math.max(0, walletLimit - mintedHere);
  const max = Math.max(0, Math.min(50, walletLeft, phaseLeft, onchain.publicRemaining));
  const eligible = !phase.allowlisted || Boolean(proof?.allowlisted);
  const total = BigInt(phase.priceWei) * BigInt(Math.max(1, qty));
  const short = balance !== null && balance < total;
  const ends = phase.end ? Date.parse(phase.end) - now : null;

  useEffect(() => {
    setQty((q) => Math.min(Math.max(1, q), Math.max(1, max)));
  }, [max]);

  const cta = useMemo(() => {
    if (!account) return "Connect a wallet to mint";
    if (phase.allowlisted && !proof) return "Checking allowlist…";
    if (!eligible) return "Not on the allowlist";
    if (max === 0) return walletLeft === 0 ? "Wallet limit reached" : "Phase sold out";
    if (short) return "Not enough ETH";
    if (busy === "wallet") return "Confirm in your wallet…";
    if (busy === "pending") return "Minting…";
    return `Mint ${qty} · ${eth(total)}`;
  }, [account, phase.allowlisted, proof, eligible, max, walletLeft, short, busy, qty, total]);

  async function mint() {
    if (!wallet || !account) return;
    setBusy("wallet");
    setDone(null);
    try {
      const { collectorMint } = await import("@/lib/evm/mint");
      const r = await collectorMint({
        provider: wallet.provider,
        account,
        network: contract.network,
        contract: contract.address,
        phase: phase.index,
        quantity: qty,
        priceWei: BigInt(phase.priceWei),
        allowance: proof?.allowance ?? 0,
        proof: proof?.proof ?? [],
        onSent: () => setBusy("pending"),
      });
      setDone(r);
      toast.ok(`Minted ${r.ids.length} token${r.ids.length === 1 ? "" : "s"}`);
      onMinted();
    } catch (e) {
      const { mintError } = await import("@/lib/evm/mint");
      toast.err(mintError(e));
    } finally {
      setBusy("idle");
    }
  }

  return (
    <Card glow className="p-5">
      {phases.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {phases.map((p) => (
            <button
              key={p.index}
              onClick={() => setPhaseIdx(p.index)}
              className={cx("rounded-lg px-3 py-1.5 text-[13px]", p.index === phase.index ? "bg-violet/25 text-ink ring-1 ring-violet/40" : "text-muted hover:bg-panel-2")}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] text-muted">{phase.name} · live</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{eth(phase.priceWei)}</div>
        </div>
        {ends !== null && (
          <div className="text-right text-[12px] text-muted">
            ends in
            <div className="text-[15px] font-medium text-ink tabular-nums">{countdown(ends)}</div>
          </div>
        )}
      </div>

      {account && (
        <div className="mt-4 rounded-xl border border-line bg-black/20 px-3 py-2.5 text-[13px]">
          {phase.allowlisted && !proof ? (
            <span className="text-muted">Checking {shortAddr(account)}…</span>
          ) : !eligible ? (
            <span className="text-rose-300">{shortAddr(account)} isn&apos;t on this phase&apos;s allowlist.</span>
          ) : (
            <span className="text-muted">
              {shortAddr(account)} · minted {mintedHere} here
              {Number.isFinite(walletLimit) ? ` of ${walletLimit}` : ""}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center rounded-xl border border-line-2">
          <button className="h-11 w-11 text-lg text-muted hover:text-ink disabled:opacity-30" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)} aria-label="Fewer">
            −
          </button>
          <span className="w-10 text-center tabular-nums">{qty}</span>
          <button className="h-11 w-11 text-lg text-muted hover:text-ink disabled:opacity-30" disabled={qty >= max} onClick={() => setQty((q) => q + 1)} aria-label="More">
            +
          </button>
        </div>
        <Button variant="primary" className="h-11 flex-1" disabled={!account || !eligible || max === 0 || short || busy !== "idle"} busy={busy !== "idle"} onClick={mint}>
          {cta}
        </Button>
      </div>
      {!account && (
        <div className="mt-3 flex justify-center">
          <EvmWalletButton />
        </div>
      )}
      <div className="mt-3 text-[12px] text-dim">Plus network gas (a fraction of a cent on {contract.chainName}).</div>

      {done && (
        <div className="mt-4 rounded-xl border border-good/30 bg-good/5 p-3 text-[13px] text-green-200">
          ✓ You minted #{done.ids.slice(0, 8).join(", #")}
          {done.ids.length > 8 ? "…" : ""}.{" "}
          <a className="underline" href={`${contract.explorer}/tx/${done.tx}`} target="_blank" rel="noreferrer">
            View transaction
          </a>
          {contract.delayedReveal && !onchain.revealed && <div className="mt-1 text-[12px] text-green-200/70">Artwork appears when the collection is revealed.</div>}
        </div>
      )}
    </Card>
  );
}
