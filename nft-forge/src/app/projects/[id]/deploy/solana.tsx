"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { useProject } from "@/components/project-context";
import { short, SolanaWalletProvider, WalletButton } from "@/components/solana-wallet";
import { api, Badge, Button, Card, CardHeader, cx, Empty, Field, fmt, Input, Modal, PageHeader, Progress, Select, toast, useApi } from "@/components/ui";
import { explorerUrl, type Approval, type Deployment, type DeployPlan, type ReadinessCheck, type UriMode } from "@/lib/chain/types";

export function SolanaDeploy() {
  return (
    <SolanaWalletProvider>
      <DeploymentStudio />
    </SolanaWalletProvider>
  );
}

type Readiness = { checks: ReadinessCheck[]; ready: boolean; fingerprint: string; testDeploymentId?: string };
type Est = { upload: number; assetRent: number; collectionRent: number; fees: number; total: number; uploadBytes: number };

const STATUS_TONE: Record<string, "good" | "bad" | "amber" | "violet" | "neutral" | "cyan"> = {
  verified: "good",
  minted: "cyan",
  failed: "bad",
  cancelled: "amber",
  minting: "violet",
  uploading: "violet",
  created: "neutral",
};

function DeploymentStudio() {
  const { project, base } = useProject();
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58();
  const { data, reload } = useApi<{ deployments: Deployment[]; approvals: Approval[] }>(`${base}/deployments`);
  const { data: ready, reload: reloadReady, loading: readyLoading } = useApi<Readiness>(`${base}/deployments/readiness`);
  const [testCount, setTestCount] = useState(10);
  const [uriMode, setUriMode] = useState<UriMode>("irys");
  const [metaBase, setMetaBase] = useState("");
  const [collUri, setCollUri] = useState("");
  const [priority, setPriority] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [estimate, setEstimate] = useState<Record<string, Est>>({});
  const [confirmName, setConfirmName] = useState("");
  const [fundAsk, setFundAsk] = useState<{ amount: number; resolve: (v: boolean) => void } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const stopRef = useRef(false);

  const deployments = data?.deployments ?? [];
  const approval = data?.approvals.find((a) => !a.consumedBy && a.fingerprint === ready?.fingerprint && a.wallet === address);
  const solanaOk = project.chain === "solana";

  async function create(mode: "test" | "production") {
    if (!address) return toast.err("Connect a wallet first.");
    try {
      const d = await api<Deployment>(`${base}/deployments`, {
        method: "POST",
        json: { mode, wallet: address, uriMode, testCount, metadataBaseUri: metaBase, collectionMetadataUri: collUri, approvalId: approval?.id },
      });
      await reload();
      toast.ok(`Created ${mode} deployment of ${d.items.length} tokens on ${d.network}`);
      void estimateFor(d);
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function estimateFor(d: Deployment) {
    if (!wallet.publicKey) return;
    try {
      const plan = await api<DeployPlan>(`${base}/deployments/${d.id}/plan`);
      const { estimate: est } = await import("@/lib/chain/browser-runner");
      const r = await est(plan, wallet as never);
      setEstimate((m) => ({ ...m, [d.id]: r }));
    } catch (e) {
      toast.err(`Estimate failed: ${(e as Error).message}`);
    }
  }

  async function run(d: Deployment) {
    if (!address || address !== d.wallet) return toast.err(`Connect the wallet that created this deployment (${short(d.wallet)}).`);
    if (!wallet.signAllTransactions) return toast.err("This wallet can't sign transactions in batches.");
    stopRef.current = false;
    setRunning(d.id);
    setProgress(null);
    try {
      const plan = await api<DeployPlan>(`${base}/deployments/${d.id}/plan`);
      const { runInBrowser } = await import("@/lib/chain/browser-runner");
      const res = await runInBrowser(plan, {
        wallet: wallet as never,
        priorityMicroLamports: priority || undefined,
        report: async (e) => {
          await api(`${base}/deployments/${d.id}`, { method: "PATCH", json: e });
          if (e.type !== "log") void reload();
        },
        onProgress: setProgress,
        shouldStop: () => stopRef.current,
        confirmFunding: (amount) => new Promise((resolve) => setFundAsk({ amount, resolve })),
      });
      if (!("stopped" in res && res.stopped)) {
        toast.ok(`Minted ${res.minted} token(s). Verifying on-chain…`);
        await new Promise((r) => setTimeout(r, 1500));
        await verify(d);
      }
    } catch (e) {
      toast.err((e as Error).message.slice(0, 300));
    } finally {
      setRunning(null);
      await reload();
      void reloadReady();
    }
  }

  async function verify(d: Deployment) {
    try {
      const r = await api<Deployment>(`${base}/deployments/${d.id}/verify`, { method: "POST" });
      await reload();
      void reloadReady();
      if (r.status === "verified") toast.ok(`All ${r.items.length} assets verified on ${r.network}`);
      else toast.err(`${r.verification?.problems.length ?? 0} verification problem(s)`);
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function approve() {
    if (!address) return toast.err("Connect a wallet first.");
    try {
      await api(`${base}/deployments/approve`, { method: "POST", json: { wallet: address, confirmName } });
      await reload();
      toast.ok("Production deployment approved");
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  const current = deployments.find((d) => d.id === running);
  const open = deployments.find((d) => d.id === detail);

  return (
    <>
      <PageHeader
        title="Deployment Studio"
        sub="Solana · Metaplex Core. Test on devnet, then pass a separate approval for mainnet. Every transaction is signed in your wallet."
        right={<WalletButton />}
      />
      {!solanaOk && (
        <div className="mb-6 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-[13px] text-amber-200">
          This project targets {project.chain}. Deployment currently supports Solana (Metaplex Core); Ethereum, L2s and Sui adapters are on the roadmap.
        </div>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card glow className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">1 · Test deployment</h3>
            <Badge tone="cyan">DEVNET</Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted">Deploys the first N tokens to devnet: upload, collection with on-chain royalties, mints, verification.</p>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <Field label="Tokens to test">
              <Input type="number" min={1} max={100} value={testCount} onChange={(e) => setTestCount(Number(e.target.value))} />
            </Field>
            <Field label="Metadata hosting">
              <Select value={uriMode} onChange={(e) => setUriMode(e.target.value as UriMode)}>
                <option value="irys">Upload to Arweave (Irys)</option>
                <option value="base">Already hosted (base URI)</option>
              </Select>
            </Field>
            {uriMode === "base" && (
              <>
                <Field label="Metadata folder URI" hint="Folder containing {tokenId}.json" className="col-span-2">
                  <Input value={metaBase} onChange={(e) => setMetaBase(e.target.value)} placeholder="https://arweave.net/<id>/metadata/" />
                </Field>
                <Field label="Collection metadata URI" className="col-span-2">
                  <Input value={collUri} onChange={(e) => setCollUri(e.target.value)} placeholder="https://arweave.net/<id>/collection.json" />
                </Field>
              </>
            )}
          </div>
          <div className="mt-4 rounded-xl border border-line bg-black/20 p-3 text-[12px] text-muted">
            Need devnet SOL? Use <a className="text-violet-2 underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> (select Devnet) and switch your wallet to devnet.
          </div>
          <Button variant="primary" className="mt-5 w-full" disabled={!address || !solanaOk || !!running} onClick={() => create("test")}>
            Create devnet test deployment
          </Button>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">2 · Production</h3>
            <Badge tone="amber">MAINNET</Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted">Unlocks only when every check passes, and needs an explicit approval.</p>
          <ul className="mt-4 space-y-2">
            {readyLoading && !ready ? (
              <li className="text-sm text-dim">Checking readiness…</li>
            ) : (
              ready?.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-3 text-[13px]">
                  <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-[11px] font-bold", c.ok ? "bg-good/15 text-green-300" : "bg-bad/15 text-rose-300")}>
                    {c.ok ? "✓" : "✕"}
                  </span>
                  <span className="flex-1">
                    {c.label}
                    <span className="block text-[12px] text-dim">{c.detail}</span>
                  </span>
                </li>
              ))
            )}
          </ul>
          {ready?.ready && !approval && (
            <div className="mt-5 space-y-3 rounded-xl border border-amber/30 bg-amber/5 p-4">
              <div className="text-[13px] text-amber-100">
                Approve the production deployment of <b>{fmt.n(project.config.supply)}</b> tokens to Solana mainnet from <b>{address ? short(address) : "your wallet"}</b>. Type <b>{project.metadata.collectionName}</b> to confirm.
              </div>
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={project.metadata.collectionName} />
              <Button variant="danger" className="w-full" disabled={!address || confirmName !== project.metadata.collectionName} onClick={approve}>
                Approve production deployment
              </Button>
            </div>
          )}
          {approval && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-good/30 bg-good/5 p-3 text-[13px] text-green-200">✓ Approved {fmt.ago(approval.at)} for {short(approval.wallet)}. Single use.</div>
              <Field label="Priority fee (µLamports per CU)" hint="Raise during congestion. 0 = none.">
                <Input type="number" min={0} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
              </Field>
              <Button variant="primary" className="w-full" disabled={!!running} onClick={() => create("production")}>
                Create mainnet deployment
              </Button>
            </div>
          )}
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => reloadReady()}>
            ↻ Re-check
          </Button>
        </Card>
      </div>

      <Diagnostics />

      {current && (
        <Card glow className="mb-6 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold">Running {current.mode} deployment on {current.network}</div>
              <div className="text-[13px] text-muted">
                {progress ? `${progress.phase}: ${progress.done} / ${progress.total}` : "Preparing…"} · Keep this tab open and approve each batch in your wallet.
              </div>
            </div>
            <Button variant="danger" onClick={() => (stopRef.current = true)}>
              Pause after this batch
            </Button>
          </div>
          <div className="mt-3">
            <Progress value={progress?.done ?? 0} max={progress?.total || 1} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Deployment history" sub="Every deployment, its transactions and on-chain verification." />
        {!deployments.length ? (
          <div className="px-5 pb-5">
            <Empty title="No deployments yet">Connect a wallet and run a devnet test deployment.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] tracking-wide text-muted uppercase">
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium">Network</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Tokens</th>
                  <th className="py-2 pr-4 font-medium">Collection</th>
                  <th className="py-2 pr-4 font-medium">Est. cost</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => {
                  const minted = d.items.filter((i) => i.state === "minted" || i.state === "verified").length;
                  const verified = d.items.filter((i) => i.state === "verified").length;
                  const est = estimate[d.id];
                  const done = d.status === "verified";
                  return (
                    <tr key={d.id} className="border-b border-line/60 align-middle">
                      <td className="py-3 pr-4 text-muted">{fmt.ago(d.createdAt)}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={d.network === "devnet" ? "cyan" : "amber"}>{d.network}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                      </td>
                      <td className="py-3 pr-4 tabular-nums">
                        {minted}/{d.items.length} minted · {verified} verified
                      </td>
                      <td className="py-3 pr-4 font-mono text-[12px]">
                        {d.collection.address ? (
                          <a className="text-violet-2 hover:underline" href={explorerUrl(d.network, "address", d.collection.address)} target="_blank" rel="noreferrer">
                            {short(d.collection.address)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-muted">
                        {est && typeof est.total === "number" ? `${est.total.toFixed(4)} SOL` : <button className="text-violet-2" onClick={() => estimateFor(d)}>estimate</button>}
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-2">
                          {!done && (
                            <Button size="sm" variant="primary" disabled={!!running || !address} onClick={() => run(d)}>
                              {d.status === "created" ? "Run" : "Resume"}
                            </Button>
                          )}
                          {d.collection.address && (
                            <Button size="sm" onClick={() => verify(d)}>
                              Verify
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setDetail(d.id)}>
                            Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!fundAsk} onClose={() => { fundAsk?.resolve(false); setFundAsk(null); }} title="Fund the upload session key">
        <div className="space-y-3 text-sm">
          <p>
            Artwork and metadata are uploaded to Arweave by a temporary key that exists only in this tab, so your wallet isn&apos;t asked to sign every file.
          </p>
          <p>
            Your wallet will send <b>{fundAsk?.amount} SOL</b> to it now (estimated upload cost plus a small fee buffer). Unspent SOL is returned to your wallet when the upload finishes.
          </p>
          <p className="text-[12px] text-amber-200">If you close the tab mid-upload, whatever the temporary key still holds cannot be recovered.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => { fundAsk?.resolve(false); setFundAsk(null); }}>Cancel</Button>
            <Button variant="primary" onClick={() => { fundAsk?.resolve(true); setFundAsk(null); }}>Fund and upload</Button>
          </div>
        </div>
      </Modal>

      {open && <DeploymentDetail d={open} onClose={() => setDetail(null)} />}
    </>
  );
}

function Diagnostics() {
  const [net, setNet] = useState<"devnet" | "mainnet-beta">("devnet");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ check: string; ok: boolean; detail: string }[] | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("diagnostics")) void run("devnet");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function run(n = net) {
    setBusy(true);
    try {
      const { diagnostics } = await import("@/lib/chain/browser-runner");
      setRows(await diagnostics(n));
    } catch (e) {
      setRows([{ check: "Load deployment engine", ok: false, detail: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Network diagnostics</div>
          <div className="text-[13px] text-muted">Checks RPC, rent, Arweave pricing and transaction building in this browser. No wallet needed.</div>
        </div>
        <div className="flex gap-2">
          <Select value={net} onChange={(e) => setNet(e.target.value as typeof net)} className="h-9 w-36 text-[13px]">
            <option value="devnet">Devnet</option>
            <option value="mainnet-beta">Mainnet</option>
          </Select>
          <Button size="sm" busy={busy} onClick={() => run()}>Run checks</Button>
        </div>
      </div>
      {rows && (
        <ul id="diagnostics-result" data-ok={rows.every((r) => r.ok) ? "1" : "0"} className="mt-4 space-y-1.5 text-[13px]">
          {rows.map((r) => (
            <li key={r.check} className="flex gap-3">
              <span className={r.ok ? "text-green-300" : "text-rose-300"}>{r.ok ? "✓" : "✕"}</span>
              <span className="w-40 shrink-0 text-muted">{r.check}</span>
              <span className="break-all">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeploymentDetail({ d, onClose }: { d: Deployment; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`${d.mode === "test" ? "Test" : "Production"} deployment · ${d.id}`} wide>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2 text-[13px]">
          <div><span className="text-muted">Network:</span> {d.network}</div>
          <div><span className="text-muted">Wallet:</span> <a className="font-mono text-violet-2" href={explorerUrl(d.network, "address", d.wallet)} target="_blank" rel="noreferrer">{d.wallet}</a></div>
          <div><span className="text-muted">Content fingerprint:</span> <span className="font-mono">{d.fingerprint}</span></div>
          <div><span className="text-muted">Collection URI:</span> <span className="break-all">{d.collection.uri ?? "—"}</span></div>
          {d.verification && (
            <div className={cx("rounded-xl p-3", d.verification.problems.length ? "bg-bad/10 text-rose-200" : "bg-good/10 text-green-200")}>
              Verified {d.verification.ok}/{d.verification.checked} · {fmt.ago(d.verification.at)}
              {d.verification.problems.slice(0, 8).map((p) => <div key={p} className="text-[12px]">{p}</div>)}
            </div>
          )}
          <div className="pt-2 font-semibold">Transactions</div>
          <div className="max-h-48 overflow-auto rounded-lg bg-black/25 p-2 font-mono text-[11.5px]">
            {d.txs.length === 0 && <div className="text-dim">None yet</div>}
            {d.txs.map((t) => (
              <div key={t.signature + t.kind}>
                <span className="text-muted">{t.kind}</span>{" "}
                <a className="text-violet-2 hover:underline" href={explorerUrl(d.network, "tx", t.signature)} target="_blank" rel="noreferrer">{short(t.signature, 8)}</a>
                {t.tokens && <span className="text-dim"> #{t.tokens.join(", #")}</span>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-semibold">Tokens</div>
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full text-[12px]">
              <tbody>
                {d.items.map((it) => (
                  <tr key={it.tokenId} className="border-b border-line/60">
                    <td className="px-2 py-1.5 font-semibold">#{it.tokenId}</td>
                    <td className="px-2 py-1.5"><Badge tone={STATUS_TONE[it.state] ?? (it.state === "uploaded" ? "cyan" : "neutral")}>{it.state}</Badge></td>
                    <td className="px-2 py-1.5 font-mono">
                      {it.asset ? <a className="text-violet-2" href={explorerUrl(d.network, "address", it.asset)} target="_blank" rel="noreferrer">{short(it.asset)}</a> : "—"}
                    </td>
                    <td className="px-2 py-1.5">{it.metadataUri ? <a className="text-violet-2" href={it.metadataUri} target="_blank" rel="noreferrer">json</a> : ""}</td>
                    <td className="px-2 py-1.5 text-rose-300">{it.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 mb-1 text-[13px] font-semibold">Log</div>
          <div className="max-h-40 overflow-auto rounded-lg bg-black/25 p-2 font-mono text-[11px]">
            {[...d.log].reverse().map((l, i) => (
              <div key={i} className={l.level === "error" ? "text-rose-300" : "text-ink/80"}>
                <span className="text-dim">{new Date(l.at).toLocaleTimeString()}</span> {l.msg}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
