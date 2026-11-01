"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { shortAddr, useEvmWallet } from "@/components/evm-wallet";
import { api, Badge, Button, Card, CardHeader, cx, fmt, Select, Stat, toast, useApi } from "@/components/ui";
import { evmExplorer, NETWORK_LABEL } from "@/lib/evm/chains";
import type { EvmDeployment, OnchainSale } from "@/lib/evm/types";
import type { PhaseArgs } from "@/lib/evm/browser";
import type { SaleConfig } from "@/lib/sale";

type SaleView = { sale: SaleConfig; problems: string[]; onchain: PhaseArgs[] };
type Prepared = { needsPublish: true; offset: number; message: string } | { needsPublish: false; secret: `0x${string}`; offset: number; baseURI: string };

const hasSale = (d: EvmDeployment) => d.params.reserved < d.params.maxSupply;
const fmtTime = (s: number) => (s ? new Date(s * 1000).toLocaleString() : "open-ended");

/** Live sale controls for deployed public-sale contracts (owner actions are signed in the wallet). */
export function SalePanel({ deployments, base, onChanged }: { deployments: EvmDeployment[]; base: string; onChanged: () => void }) {
  const eligible = deployments.filter((d) => d.contract && hasSale(d));
  const [selected, setSelected] = useState<string | null>(null);
  const d = eligible.find((x) => x.id === selected) ?? eligible[0];
  const { account, wallet } = useEvmWallet();
  const { data: cfg, reload: reloadCfg } = useApi<SaleView>(`${base}/sale`);
  const { data: chain, error: chainError, reload: reloadChain } = useApi<OnchainSale>(d ? `${base}/robinhood/${d.id}/sale` : null, { poll: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (d && selected !== d.id) setSelected(d.id);
  }, [d, selected]);
  if (!d) return null;

  const isOwner = account?.toLowerCase() === d.wallet.toLowerCase();
  const delayed = d.params.unrevealedURI !== "";
  const live = cfg?.sale.liveDeploymentId === d.id;
  const changed = cfg && chain ? cfg.onchain.map((p, i) => !chain.phases[i] || !same(p, chain.phases[i])) : [];
  const nChanged = changed.filter(Boolean).length;

  async function owner<T>(label: string, fn: (b: typeof import("@/lib/evm/browser")) => Promise<T>) {
    if (!wallet || !account) return toast.err("Connect the owner wallet first.");
    if (!isOwner) return toast.err(`Connect ${shortAddr(d.wallet)}, the contract owner.`);
    setBusy(label);
    try {
      const r = await fn(await import("@/lib/evm/browser"));
      await reloadChain();
      onChanged();
      return r;
    } catch (e) {
      toast.err(((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 300));
    } finally {
      setBusy(null);
    }
  }

  async function syncPhases() {
    if (!cfg || !chain) return;
    if (cfg.problems.length) return toast.err(`Fix the sale configuration first: ${cfg.problems[0]}`);
    await owner("sync", async (b) => {
      await b.syncPhases(d, wallet!.provider, account!, cfg.onchain, chain.phases, (i) => toast.ok(`Phase ${i} updated on-chain`));
      toast.ok("Phases match the configuration");
    });
  }

  async function reveal() {
    setBusy("reveal");
    try {
      const p = await api<Prepared>(`${base}/robinhood/${d.id}/reveal`, { method: "POST", json: { action: "prepare" } });
      if (p.needsPublish) {
        const ok = window.confirm(`${p.message}\n\nPack the revealed metadata now? You'll then pin it from IPFS Publishing.`);
        if (ok) {
          await api(`${base}/robinhood/${d.id}/reveal`, { method: "POST", json: { action: "pack" } });
          toast.ok("Packing revealed metadata. Pin it on IPFS Publishing, then reveal again.");
        }
        return;
      }
      setBusy(null);
      await owner("reveal", (b) =>
        b.sendReveal(d, wallet!.provider, account!, p, async (tx) => {
          await api(`${base}/robinhood/${d.id}`, { method: "PATCH", json: { type: "reveal-sent", tx } });
        }),
      );
      toast.ok(`Revealed with offset ${p.offset}. Re-verify the deployment.`);
    } catch (e) {
      toast.err(((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 300));
    } finally {
      setBusy(null);
    }
  }

  async function setLive(on: boolean) {
    try {
      await api(`${base}/sale`, { method: "PUT", json: { liveDeploymentId: on ? d.id : null } });
      await reloadCfg();
      toast.ok(on ? "Public mint page now sells from this contract" : "Public mint page closed");
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  const mintUrl = `/mint/${d.projectId}`;
  return (
    <Card className="mb-6">
      <CardHeader
        title="Live sale"
        sub={`Owner controls for ${NETWORK_LABEL[d.network]} · ${shortAddr(d.contract!)}. Every action is a wallet transaction from ${shortAddr(d.wallet)}.`}
        right={
          eligible.length > 1 ? (
            <Select className="h-9 w-56 text-[13px]" value={d.id} onChange={(e) => setSelected(e.target.value)}>
              {eligible.map((x) => (
                <option key={x.id} value={x.id}>{x.network === "robinhood" ? "Mainnet" : "Testnet"} · {shortAddr(x.contract!)}</option>
              ))}
            </Select>
          ) : undefined
        }
      />
      <div className="px-5 pb-5">
        {chainError && <div className="mb-4 text-[13px] text-rose-300">Couldn&apos;t read the contract: {chainError}</div>}
        {chain && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Minted" value={`${fmt.n(chain.totalMinted)} / ${fmt.n(chain.maxSupply)}`} />
            <Stat label="Public left" value={fmt.n(chain.publicRemaining)} />
            <Stat label="Reserve minted" value={`${chain.reserveMinted} / ${chain.reserved}`} />
            <Stat label="Proceeds in contract" value={`${Number(formatEther(BigInt(chain.balanceWei))).toFixed(4)} ETH`} />
            <Stat label="State" value={chain.paused ? "Paused" : chain.revealed ? (delayed ? "Revealed" : "Live") : "Unrevealed"} />
          </div>
        )}

        <div className="mb-5 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium">#</th>
                <th className="py-2 pr-4 font-medium">Phase</th>
                <th className="py-2 pr-4 font-medium">Window</th>
                <th className="py-2 pr-4 font-medium">Price</th>
                <th className="py-2 pr-4 font-medium">Sold</th>
                <th className="py-2 font-medium">On-chain</th>
              </tr>
            </thead>
            <tbody>
              {cfg?.sale.phases.map((p, i) => {
                const oc = chain?.phases[i];
                return (
                  <tr key={p.id} className="border-b border-line/60">
                    <td className="py-2.5 pr-4 text-muted">{i}</td>
                    <td className="py-2.5 pr-4">{p.name} {p.allowlist && <Badge tone="violet">allowlist</Badge>}</td>
                    <td className="py-2.5 pr-4 text-muted">{fmtTime(cfg.onchain[i].start)} → {fmtTime(cfg.onchain[i].end)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{formatEther(BigInt(cfg.onchain[i].price))} ETH</td>
                    <td className="py-2.5 pr-4 tabular-nums">{oc ? `${oc.minted}${p.cap ? ` / ${p.cap}` : ""}` : "—"}</td>
                    <td className="py-2.5">{changed[i] ? <Badge tone="amber">{oc ? "changed" : "not set"}</Badge> : <Badge tone="good">in sync</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {chain && cfg && chain.phases.length > cfg.sale.phases.length && (
            <div className="mt-2 text-[12px] text-amber-200">The contract has {chain.phases.length - cfg.sale.phases.length} phase(s) that are no longer configured. Phases can&apos;t be removed on-chain; edit them to end in the past.</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!nChanged || !!busy} busy={busy === "sync"} onClick={syncPhases}>
            {nChanged ? `Push ${nChanged} phase change${nChanged > 1 ? "s" : ""} on-chain` : "Phases in sync"}
          </Button>
          {chain && (
            <Button disabled={!!busy} busy={busy === "pause"} onClick={() => owner("pause", (b) => b.ownerAction(d, wallet!.provider, account!, { kind: "pause", paused: !chain.paused }))}>
              {chain.paused ? "Resume sale" : "Pause sale"}
            </Button>
          )}
          {chain && BigInt(chain.balanceWei) > 0n && (
            <Button disabled={!!busy} busy={busy === "withdraw"} onClick={() => owner("withdraw", (b) => b.ownerAction(d, wallet!.provider, account!, { kind: "withdraw" }))}>
              Withdraw {Number(formatEther(BigInt(chain.balanceWei))).toFixed(4)} ETH → {shortAddr(chain.payout)}
            </Button>
          )}
          {delayed && chain && !chain.revealed && (
            <Button variant="danger" disabled={!!busy} busy={busy === "reveal"} onClick={reveal}>Reveal…</Button>
          )}
          {chain?.revealed && (
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => window.confirm("Freeze metadata permanently? The base URI can never change again.") && owner("freeze", (b) => b.ownerAction(d, wallet!.provider, account!, { kind: "freeze" }))}
            >
              Freeze metadata
            </Button>
          )}
        </div>

        <div className={cx("mt-5 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-[13px]", live ? "border-good/30 bg-good/5" : "border-line bg-black/20")}>
          <span className="flex-1">
            {live ? (
              <>
                Public mint page is <b>open</b> for this contract:{" "}
                <a className="text-violet-2 underline" href={mintUrl} target="_blank" rel="noreferrer">{mintUrl}</a>
              </>
            ) : (
              "The public mint page isn't selling from this contract."
            )}
          </span>
          <Button size="sm" variant={live ? "ghost" : "primary"} onClick={() => setLive(!live)}>{live ? "Close mint page" : "Open mint page here"}</Button>
          {delayed && (
            <a className="text-[12px] text-violet-2 underline" href={`${base}/robinhood/${d.id}/reveal`}>Back up reveal secret</a>
          )}
          <a className="text-[12px] text-violet-2 underline" href={evmExplorer(d.network, "address", d.contract!)} target="_blank" rel="noreferrer">Explorer</a>
        </div>
        {delayed && <p className="mt-2 text-[12px] text-dim">Keep a backup of the reveal secret. Without it this collection can never be revealed.</p>}
      </div>
    </Card>
  );
}

function same(a: PhaseArgs, b: OnchainSale["phases"][number]) {
  return a.start === b.start && a.end === b.end && a.price === b.priceWei && a.maxPerWallet === b.maxPerWallet && a.cap === b.cap && a.merkleRoot.toLowerCase() === b.merkleRoot.toLowerCase();
}
