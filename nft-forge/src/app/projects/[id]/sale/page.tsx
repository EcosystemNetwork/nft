"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, CardHeader, cx, Empty, Field, fmt, Input, PageHeader, Textarea, toast, Toggle, useApi } from "@/components/ui";
import type { AllowlistEntry } from "@/lib/evm/allowlist";
import type { SaleConfig, SalePhase } from "@/lib/sale";

type View = { sale: SaleConfig; problems: string[] };

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const ethOf = (wei: string) => {
  try {
    return formatEther(BigInt(wei));
  } catch {
    return "0";
  }
};

function newPhase(kind: "allowlist" | "public", after?: SalePhase): SalePhase {
  const start = after?.end ?? new Date(Date.now() + 7 * 86400_000).toISOString();
  return {
    id: "",
    name: kind === "allowlist" ? "Allowlist" : "Public",
    start,
    end: kind === "allowlist" ? new Date(Date.parse(start) + 86400_000).toISOString() : null,
    priceWei: "0",
    maxPerWallet: kind === "public" ? 5 : 0,
    cap: 0,
    allowlist: kind === "allowlist" ? [] : null,
  };
}

export default function SalePage() {
  const { project, base } = useProject();
  const { data, reload } = useApi<View>(`${base}/sale`);
  const [s, setS] = useState<SaleConfig | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data && !s) setS(data.sale);
  }, [data, s]);
  const dirty = useMemo(() => s && data && JSON.stringify(s) !== JSON.stringify(data.sale), [s, data]);

  if (!s) return <PageHeader title="Mint & Sale" sub="Loading…" />;
  const supply = project.config.supply;
  const forSale = s.enabled ? supply - s.reserved : 0;
  const set = (patch: Partial<SaleConfig>) => setS({ ...s, ...patch });
  const setPhase = (i: number, patch: Partial<SalePhase>) => set({ phases: s.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function save() {
    setSaving(true);
    try {
      const v = await api<View>(`${base}/sale`, { method: "PUT", json: s });
      setS(v.sale);
      await reload();
      toast.ok("Sale configuration saved");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Mint & Sale"
        sub="How collectors get tokens on Robinhood Chain: a team reserve the owner mints, and up to 8 sale phases with prices, wallet limits and allowlists."
        right={
          <>
            {dirty && <Badge tone="amber">Unsaved changes</Badge>}
            <Button variant="primary" busy={saving} disabled={!dirty} onClick={save}>
              Save
            </Button>
          </>
        }
      />
      {project.chain !== "robinhood" && (
        <div className="mb-6 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-[13px] text-amber-200">Public sales are available for Robinhood Chain projects. This project targets {project.chain}.</div>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Public sale</div>
              <div className="text-[13px] text-muted">
                {s.enabled ? "Collectors mint from a public mint page. You mint the team reserve from the Deployment Studio." : "Off: you mint the entire collection to your own wallet from the Deployment Studio."}
              </div>
            </div>
            <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v, phases: v && !s.phases.length ? [newPhase("public")] : s.phases })} label={s.enabled ? "On" : "Off"} />
          </div>
          {s.enabled && (
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Field label="Team reserve" hint="Minted by the owner. It can shrink after deployment, never grow.">
                <Input type="number" min={0} max={supply - 1} value={s.reserved} onChange={(e) => set({ reserved: Math.max(0, Math.floor(Number(e.target.value))) })} />
              </Field>
              <Field label="Payout address" hint="Where withdrawn proceeds go. Empty = the deploying wallet.">
                <Input value={s.payout ?? ""} placeholder="0x… (deploying wallet)" onChange={(e) => set({ payout: (e.target.value.trim() || null) as SaleConfig["payout"] })} />
              </Field>
              <div className="rounded-xl border border-line bg-black/20 p-3 text-[13px]">
                <div className="text-muted">For sale</div>
                <div className="text-xl font-semibold tabular-nums">{fmt.n(Math.max(0, forSale))}</div>
                <div className="text-[12px] text-dim">of {fmt.n(supply)} · {fmt.n(s.reserved)} reserved</div>
              </div>
            </div>
          )}
        </Card>

        <Card className={cx("p-5", !s.enabled && "opacity-50")}>
          <div className="flex items-center justify-between">
            <div className="font-semibold">Delayed reveal</div>
            <Toggle checked={s.enabled && s.delayedReveal} onChange={(v) => s.enabled && set({ delayedReveal: v })} />
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Tokens show a placeholder until you reveal. The reveal shifts which artwork each token gets by an offset nobody can predict while minting, so buyers can&apos;t snipe rare tokens. The provenance hash proves the artwork order was fixed beforehand.
          </p>
          {s.enabled && s.delayedReveal && (
            <div className="mt-4 space-y-3">
              <Field label="Placeholder name"><Input value={s.unrevealed.name} onChange={(e) => set({ unrevealed: { ...s.unrevealed, name: e.target.value } })} /></Field>
              <Field label="Placeholder description"><Textarea rows={2} value={s.unrevealed.description} onChange={(e) => set({ unrevealed: { ...s.unrevealed, description: e.target.value } })} /></Field>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${base}/metadata/unrevealed.png`} alt="Unrevealed placeholder" className="h-24 w-24 rounded-xl border border-line" />
            </div>
          )}
        </Card>
      </div>

      {data && data.problems.length > 0 && s.enabled && !dirty && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-[13px] text-rose-200">
          {data.problems.map((p) => (
            <div key={p}>• {p}</div>
          ))}
        </div>
      )}

      {s.enabled && (
        <Card>
          <CardHeader
            title="Sale phases"
            sub="Phases are numbered in this order on-chain. After deployment, push changes from the Deployment Studio (one wallet transaction per changed phase)."
            right={
              <div className="flex gap-2">
                <Button size="sm" disabled={s.phases.length >= 8} onClick={() => set({ phases: [...s.phases, newPhase("allowlist", s.phases.at(-1))] })}>+ Allowlist phase</Button>
                <Button size="sm" disabled={s.phases.length >= 8} onClick={() => set({ phases: [...s.phases, newPhase("public", s.phases.at(-1))] })}>+ Public phase</Button>
              </div>
            }
          />
          <div className="space-y-4 px-5 pb-5">
            {!s.phases.length && <Empty title="No phases">Add an allowlist or public phase.</Empty>}
            {s.phases.map((p, i) => (
              <PhaseEditor
                key={i}
                index={i}
                phase={p}
                onChange={(patch) => setPhase(i, patch)}
                onRemove={() => set({ phases: s.phases.filter((_, j) => j !== i) })}
                onMove={(dir) => {
                  const j = i + dir;
                  if (j < 0 || j >= s.phases.length) return;
                  const next = [...s.phases];
                  [next[i], next[j]] = [next[j], next[i]];
                  set({ phases: next });
                }}
                base={base}
              />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function PhaseEditor({ index, phase: p, onChange, onRemove, onMove, base }: { index: number; phase: SalePhase; onChange: (p: Partial<SalePhase>) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; base: string }) {
  const [price, setPrice] = useState(ethOf(p.priceWei));
  const [listText, setListText] = useState("");
  const [parsing, setParsing] = useState(false);
  const now = Date.now();
  const status = Date.parse(p.start) > now ? "upcoming" : p.end && Date.parse(p.end) <= now ? "ended" : "live";

  async function importList(text: string) {
    setParsing(true);
    try {
      const r = await api<{ entries: AllowlistEntry[]; errors: string[] }>(`${base}/sale`, { method: "POST", json: { text } });
      onChange({ allowlist: r.entries });
      if (r.errors.length) toast.err(`${r.errors.length} line(s) skipped: ${r.errors.slice(0, 3).join("; ")}`);
      else toast.ok(`${r.entries.length} wallets on the allowlist`);
      setListText("");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-black/15 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet/20 text-[13px] font-semibold text-violet-2">{index}</span>
        <Input className="h-9 max-w-[220px]" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
        <Badge tone={p.allowlist ? "violet" : "cyan"}>{p.allowlist ? `allowlist · ${p.allowlist.length}` : "public"}</Badge>
        <Badge tone={status === "live" ? "good" : status === "ended" ? "neutral" : "amber"}>{status}</Badge>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onMove(-1)} aria-label="Move up">↑</Button>
          <Button size="sm" variant="ghost" onClick={() => onMove(1)} aria-label="Move down">↓</Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Starts"><Input type="datetime-local" value={toLocal(p.start)} onChange={(e) => onChange({ start: fromLocal(e.target.value) ?? p.start })} /></Field>
        <Field label="Ends" hint="Empty = open-ended"><Input type="datetime-local" value={toLocal(p.end)} onChange={(e) => onChange({ end: fromLocal(e.target.value) })} /></Field>
        <Field label="Price (ETH)">
          <Input
            inputMode="decimal"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              try {
                onChange({ priceWei: parseEther(e.target.value || "0").toString() });
              } catch {
                onChange({ priceWei: "invalid" });
              }
            }}
          />
        </Field>
        {p.allowlist ? (
          <Field label="Per wallet" hint="Each wallet's own allowance from the list"><Input disabled value="from allowlist" /></Field>
        ) : (
          <Field label="Max per wallet" hint="0 = unlimited"><Input type="number" min={0} value={p.maxPerWallet} onChange={(e) => onChange({ maxPerWallet: Math.max(0, Math.floor(Number(e.target.value))) })} /></Field>
        )}
        <Field label="Phase cap" hint="0 = no cap"><Input type="number" min={0} value={p.cap} onChange={(e) => onChange({ cap: Math.max(0, Math.floor(Number(e.target.value))) })} /></Field>
      </div>
      {p.allowlist && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
          <Field label="Add wallets" hint="One per line: address or address,allowance (default 1). CSV with an address header works too. Importing replaces the list.">
            <Textarea rows={3} value={listText} onChange={(e) => setListText(e.target.value)} placeholder={"0xabc…,2\n0xdef…"} />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="cursor-pointer rounded-xl border border-line-2 px-3 py-2 text-center text-[13px] text-muted hover:text-ink">
              Upload CSV
              <input type="file" accept=".csv,.txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importList(await f.text()); e.target.value = ""; }} />
            </label>
            <Button size="sm" busy={parsing} disabled={!listText.trim()} onClick={() => importList(listText)}>Import</Button>
          </div>
          {p.allowlist.length > 0 && (
            <div className="text-[12px] text-dim lg:col-span-2">
              {p.allowlist.length} wallets · {fmt.n(p.allowlist.reduce((t, e) => t + e.allowance, 0))} total allowance · e.g. {p.allowlist.slice(0, 2).map((e) => `${e.address.slice(0, 8)}… ×${e.allowance}`).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
