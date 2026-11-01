"use client";

import { useEffect, useRef, useState } from "react";
import { EvmWalletButton, EvmWalletProvider, shortAddr, useEvmWallet } from "@/components/evm-wallet";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, CardHeader, cx, Empty, Field, fmt, Input, Modal, PageHeader, Progress, Select, toast, useApi } from "@/components/ui";
import { BRIDGE_URL, EVM_CHAINS, evmExplorer, FAUCET_URL, NETWORK_LABEL, type EvmNetwork } from "@/lib/evm/chains";
import type { EvmApproval, EvmDeployment } from "@/lib/evm/types";

type Dep = EvmDeployment & { constructorArgs: (string | number)[] };
type Readiness = { checks: { id: string; label: string; ok: boolean; detail: string }[]; ready: boolean; fingerprint: string };
type Estimate = Awaited<ReturnType<typeof import("@/lib/evm/browser").estimateEvm>>;

const TONE: Record<string, "good" | "bad" | "amber" | "violet" | "neutral" | "cyan"> = {
  verified: "good",
  minted: "cyan",
  failed: "bad",
  cancelled: "amber",
  minting: "violet",
  deploying: "violet",
  created: "neutral",
};

export function RobinhoodDeploy() {
  return (
    <EvmWalletProvider>
      <Studio />
    </EvmWalletProvider>
  );
}

function Studio() {
  const { project, base } = useProject();
  const { account, chainId, wallet } = useEvmWallet();
  const { data, reload } = useApi<{ deployments: EvmDeployment[]; approvals: EvmApproval[] }>(`${base}/robinhood`);
  const { data: ready, reload: reloadReady, loading: readyLoading } = useApi<Readiness>(`${base}/robinhood/readiness`);
  const [testCount, setTestCount] = useState(25);
  const [hosting, setHosting] = useState<"preview" | "hosted">("preview");
  const [baseURI, setBaseURI] = useState("");
  const [contractURI, setContractURI] = useState("");
  const [prodBase, setProdBase] = useState("");
  const [prodContract, setProdContract] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [estimates, setEstimates] = useState<Record<string, Estimate | "loading">>({});
  const [detail, setDetail] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Pre-fill hosted metadata from the current IPFS publication.
  const { data: ipfs } = useApi<{ publication: { baseURI: string; contractURI: string } | null; stale: boolean }>(`${base}/ipfs`);
  useEffect(() => {
    const p = ipfs?.publication;
    if (!p || ipfs.stale) return;
    setHosting("hosted");
    setBaseURI(p.baseURI);
    setContractURI(p.contractURI);
    setProdBase(p.baseURI);
    setProdContract(p.contractURI);
  }, [ipfs]);

  const deployments = data?.deployments ?? [];
  const approval = data?.approvals.find((a) => !a.consumedBy && a.fingerprint === ready?.fingerprint && a.wallet.toLowerCase() === account?.toLowerCase());
  const onRobinhood = chainId === EVM_CHAINS.robinhood.id || chainId === EVM_CHAINS["robinhood-testnet"].id;

  async function create(mode: "test" | "production") {
    if (!account) return toast.err("Connect a wallet first.");
    try {
      const d = await api<EvmDeployment>(`${base}/robinhood`, {
        method: "POST",
        json:
          mode === "test"
            ? { mode, wallet: account, testCount, baseURI: hosting === "hosted" ? baseURI : undefined, contractURI: hosting === "hosted" ? contractURI : undefined }
            : { mode, wallet: account, approvalId: approval?.id, contractURI: prodContract || undefined },
      });
      await reload();
      toast.ok(`Created ${mode === "test" ? "testnet" : "mainnet"} deployment (${d.mintTarget} tokens)`);
      void estimate(d.id);
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function estimate(id: string) {
    setEstimates((m) => ({ ...m, [id]: "loading" }));
    try {
      const d = await api<Dep>(`${base}/robinhood/${id}`);
      const { estimateEvm } = await import("@/lib/evm/browser");
      const e = await estimateEvm(d);
      setEstimates((m) => ({ ...m, [id]: e }));
    } catch (e) {
      setEstimates((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
      toast.err(`Estimate failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  async function run(id: string) {
    if (!wallet || !account) return toast.err("Connect a wallet first.");
    stopRef.current = false;
    setRunning(id);
    setProgress(null);
    try {
      const d = await api<Dep>(`${base}/robinhood/${id}`);
      const { runEvmDeployment } = await import("@/lib/evm/browser");
      const res = await runEvmDeployment(d, {
        provider: wallet.provider,
        account,
        report: async (e) => {
          await api(`${base}/robinhood/${id}`, { method: "PATCH", json: e });
          if (e.type !== "log") void reload();
        },
        onProgress: setProgress,
        shouldStop: () => stopRef.current,
      });
      if (!res.stopped) {
        toast.ok("Minting complete. Publishing source and verifying on-chain…");
        await api(`${base}/robinhood/${id}/source`, { method: "POST" }).catch(() => undefined);
        await verify(id);
      }
    } catch (e) {
      toast.err(((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 300));
    } finally {
      setRunning(null);
      await reload();
      void reloadReady();
    }
  }

  async function verify(id: string) {
    try {
      const d = await api<EvmDeployment>(`${base}/robinhood/${id}/verify`, { method: "POST" });
      await reload();
      void reloadReady();
      if (d.verification?.ok) toast.ok("Verified on-chain: every check passed");
      else toast.err(`${d.verification?.checks.filter((c) => !c.ok).length ?? 0} verification check(s) failed. See Details.`);
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function approve() {
    if (!account) return toast.err("Connect a wallet first.");
    try {
      await api(`${base}/robinhood/approve`, {
        method: "POST",
        json: { wallet: account, confirmName, baseURI: prodBase, contractURI: prodContract || `${prodBase.replace(/\/?$/, "/")}collection.json` },
      });
      await reload();
      toast.ok("Mainnet deployment approved");
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
        sub="Robinhood Chain · ERC-721. Test on Robinhood Chain Testnet, then pass a separate approval for mainnet. Every transaction is signed in your wallet."
        right={
          <>
            {account && (
              <Badge tone={onRobinhood ? "good" : "amber"}>
                {chainId === EVM_CHAINS.robinhood.id ? "Robinhood Chain" : chainId === EVM_CHAINS["robinhood-testnet"].id ? "Robinhood Testnet" : `Chain ${chainId}`}
              </Badge>
            )}
            <EvmWalletButton />
          </>
        }
      />
      {project.chain !== "robinhood" && (
        <div className="mb-6 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-[13px] text-amber-200">
          This project targets {project.chain}. Switch it to Robinhood Chain in Settings to deploy here.
        </div>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card glow className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">1 · Testnet deployment</h3>
            <Badge tone="cyan">TESTNET · 46630</Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Deploys the collection contract with the real provenance hash and royalties, mints the first N tokens to your wallet, publishes the source on Blockscout and verifies everything on-chain.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <Field label="Tokens to mint">
              <Input type="number" min={1} max={project.config.supply} value={testCount} onChange={(e) => setTestCount(Number(e.target.value))} />
            </Field>
            <Field label="Metadata" hint={hosting === "preview" ? "Served by this NFT Forge server. Fine for testing the contract; explorers and wallets elsewhere can't load it." : undefined}>
              <Select value={hosting} onChange={(e) => setHosting(e.target.value as typeof hosting)}>
                <option value="preview">NFT Forge preview URLs</option>
                <option value="hosted">Already hosted (IPFS / Arweave)</option>
              </Select>
            </Field>
            {hosting === "hosted" && (
              <>
                <Field label="Metadata folder URI" hint="Folder containing {tokenId}.json" className="col-span-2">
                  <Input value={baseURI} onChange={(e) => setBaseURI(e.target.value)} placeholder="ipfs://bafy…/metadata/" />
                </Field>
                <Field label="Collection metadata URI" className="col-span-2">
                  <Input value={contractURI} onChange={(e) => setContractURI(e.target.value)} placeholder="ipfs://bafy…/collection.json" />
                </Field>
              </>
            )}
          </div>
          <div className="mt-4 rounded-xl border border-line bg-black/20 p-3 text-[12px] text-muted">
            Test ETH: <a className="text-violet-2 underline" href={FAUCET_URL} target="_blank" rel="noreferrer">Robinhood Chain faucet</a>. Mainnet ETH: bridge from Ethereum via the{" "}
            <a className="text-violet-2 underline" href={BRIDGE_URL} target="_blank" rel="noreferrer">Arbitrum bridge</a> (~10 min).
          </div>
          <Button variant="primary" className="mt-5 w-full" disabled={!account || project.chain !== "robinhood" || !!running} onClick={() => create("test")}>
            Create testnet deployment
          </Button>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">2 · Mainnet</h3>
            <Badge tone="amber">ROBINHOOD CHAIN · 4663</Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted">Unlocks only when every check passes, and needs an explicit, single-use approval.</p>
          <ul className="mt-4 space-y-2">
            {readyLoading && !ready ? (
              <li className="text-sm text-dim">Checking readiness…</li>
            ) : (
              ready?.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-3 text-[13px]">
                  <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-[11px] font-bold", c.ok ? "bg-good/15 text-green-300" : "bg-bad/15 text-rose-300")}>{c.ok ? "✓" : "✕"}</span>
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
              <Field label="Permanent metadata folder URI" hint="Upload the export's metadata/ folder to IPFS or Arweave first">
                <Input value={prodBase} onChange={(e) => setProdBase(e.target.value)} placeholder="ipfs://bafy…/metadata/" />
              </Field>
              <Field label="Collection metadata URI (optional)">
                <Input value={prodContract} onChange={(e) => setProdContract(e.target.value)} placeholder="defaults to <folder>/collection.json" />
              </Field>
              <div className="text-[13px] text-amber-100">
                Approve deploying <b>{fmt.n(project.config.supply)}</b> tokens to Robinhood Chain mainnet from <b>{account ? shortAddr(account) : "your wallet"}</b>. Type <b>{project.metadata.collectionName}</b> to confirm.
              </div>
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={project.metadata.collectionName} />
              <Button variant="danger" className="w-full" disabled={!account || !prodBase || confirmName !== project.metadata.collectionName} onClick={approve}>
                Approve mainnet deployment
              </Button>
            </div>
          )}
          {approval && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-good/30 bg-good/5 p-3 text-[13px] text-green-200">
                ✓ Approved {fmt.ago(approval.at)} for {shortAddr(approval.wallet)} · metadata {approval.baseURI}. Single use.
              </div>
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
              <div className="font-semibold">Running on {NETWORK_LABEL[current.network]}</div>
              <div className="text-[13px] text-muted">
                {progress ? (progress.phase === "deploy" ? "Deploying contract…" : `Minted ${progress.done} / ${progress.total}`) : "Preparing…"} · Approve each transaction in your wallet ({current.batchSize} tokens per mint transaction).
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
        <CardHeader title="Deployment history" sub="Contracts, transactions, source verification and on-chain checks." />
        {!deployments.length ? (
          <div className="px-5 pb-5">
            <Empty title="No deployments yet">Connect a wallet, get test ETH from the faucet, and run a testnet deployment.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] tracking-wide text-muted uppercase">
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium">Network</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Minted</th>
                  <th className="py-2 pr-4 font-medium">Contract</th>
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">Cost estimate</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => {
                  const minted = d.mints.filter((m) => m.status === "confirmed").reduce((s, m) => s + m.quantity, 0);
                  const est = estimates[d.id];
                  return (
                    <tr key={d.id} className="border-b border-line/60">
                      <td className="py-3 pr-4 text-muted">{fmt.ago(d.createdAt)}</td>
                      <td className="py-3 pr-4"><Badge tone={d.network === "robinhood" ? "amber" : "cyan"}>{d.network === "robinhood" ? "mainnet" : "testnet"}</Badge></td>
                      <td className="py-3 pr-4"><Badge tone={TONE[d.status] ?? "neutral"}>{d.status}</Badge></td>
                      <td className="py-3 pr-4 tabular-nums">{minted} / {d.mintTarget}</td>
                      <td className="py-3 pr-4 font-mono text-[12px]">
                        {d.contract ? <a className="text-violet-2 hover:underline" href={evmExplorer(d.network, "address", d.contract)} target="_blank" rel="noreferrer">{shortAddr(d.contract)}</a> : "—"}
                      </td>
                      <td className="py-3 pr-4">
                        {d.sourceVerification ? <Badge tone={d.sourceVerification.status === "verified" ? "good" : d.sourceVerification.status === "failed" ? "bad" : "violet"}>{d.sourceVerification.status}</Badge> : <span className="text-dim">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-muted tabular-nums">
                        {est === "loading" ? "…" : est ? (
                          <span title={`deploy ${est.deployEth} + mint ${est.mintEth} ETH at ${est.gasPriceGwei} gwei · wallet ${est.balanceEth} ETH`}>
                            {Number(est.totalEth).toFixed(6)} ETH · {est.txs} tx{!est.enough && <span className="text-amber-300"> · low balance</span>}
                          </span>
                        ) : (
                          <button className="text-violet-2" onClick={() => estimate(d.id)}>estimate</button>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-2">
                          {d.status !== "verified" && d.status !== "minted" && (
                            <Button size="sm" variant="primary" disabled={!!running || !account} onClick={() => run(d.id)}>
                              {d.status === "created" ? "Run" : "Resume"}
                            </Button>
                          )}
                          {d.contract && d.sourceVerification?.status !== "verified" && (
                            <Button size="sm" onClick={async () => {
                              try {
                                await api(`${base}/robinhood/${d.id}/source`, { method: "POST" });
                                await reload();
                              } catch (e) {
                                toast.err((e as Error).message);
                              }
                            }}>Publish source</Button>
                          )}
                          {d.contract && <Button size="sm" onClick={() => verify(d.id)}>Verify</Button>}
                          <Button size="sm" variant="ghost" onClick={() => setDetail(d.id)}>Details</Button>
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

      {open && <Detail d={open} onClose={() => setDetail(null)} />}
    </>
  );
}

function Diagnostics() {
  const [net, setNet] = useState<EvmNetwork>("robinhood-testnet");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ check: string; ok: boolean; detail: string }[] | null>(null);
  async function run(n: EvmNetwork = net) {
    setBusy(true);
    try {
      const { evmDiagnostics } = await import("@/lib/evm/browser");
      setRows(await evmDiagnostics(n));
    } catch (e) {
      setRows([{ check: "Load deployment engine", ok: false, detail: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("diagnostics")) void run("robinhood-testnet");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Network diagnostics</div>
          <div className="text-[13px] text-muted">Checks the RPC, gas price and a full contract-deployment simulation on Robinhood Chain from this browser. No wallet needed.</div>
        </div>
        <div className="flex gap-2">
          <Select value={net} onChange={(e) => setNet(e.target.value as EvmNetwork)} className="h-9 w-44 text-[13px]">
            <option value="robinhood-testnet">Robinhood Testnet</option>
            <option value="robinhood">Robinhood Chain</option>
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

function Detail({ d, onClose }: { d: EvmDeployment; onClose: () => void }) {
  const p = d.params;
  return (
    <Modal open onClose={onClose} title={`${d.mode === "test" ? "Testnet" : "Mainnet"} deployment · ${d.id}`} wide>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-1.5 text-[13px]">
          <div><span className="text-muted">Network:</span> {NETWORK_LABEL[d.network]}</div>
          <div><span className="text-muted">Owner wallet:</span> <a className="font-mono text-violet-2" href={evmExplorer(d.network, "address", d.wallet)} target="_blank" rel="noreferrer">{d.wallet}</a></div>
          {d.contract && <div><span className="text-muted">Contract:</span> <a className="font-mono text-violet-2" href={evmExplorer(d.network, "address", d.contract)} target="_blank" rel="noreferrer">{d.contract}</a></div>}
          <div><span className="text-muted">Name / symbol:</span> {p.name} ({p.symbol})</div>
          <div><span className="text-muted">Supply:</span> {p.maxSupply} max · minting {d.mintTarget} · IDs from #{p.startTokenId}</div>
          <div><span className="text-muted">Royalties:</span> {p.royaltyBps / 100}% (ERC-2981)</div>
          <div className="break-all"><span className="text-muted">Base URI:</span> {p.baseURI}</div>
          <div className="break-all"><span className="text-muted">Provenance:</span> <span className="font-mono text-[12px]">{p.provenanceHash}</span></div>
          {d.sourceVerification && <div><span className="text-muted">Source:</span> {d.sourceVerification.status}: {d.sourceVerification.message}</div>}
          {d.contract && d.sourceVerification?.status !== "verified" && (
            <div className="flex flex-wrap gap-3 pt-1 text-[12px]">
              <a className="text-violet-2 underline" href={`/api/projects/${d.projectId}/robinhood/${d.id}/source`}>Download verification input</a>
              <a className="text-violet-2 underline" href={`${evmExplorer(d.network, "address", d.contract)}?tab=contract`} target="_blank" rel="noreferrer">Verify on Blockscout</a>
            </div>
          )}
          {d.verification && (
            <div className={cx("mt-3 space-y-1 rounded-xl p-3 text-[12px]", d.verification.ok ? "bg-good/10" : "bg-bad/10")}>
              <div className="font-semibold">On-chain verification · {fmt.ago(d.verification.at)}</div>
              {d.verification.checks.map((c) => (
                <div key={c.label} className={c.ok ? "text-green-200" : "text-rose-200"}>
                  {c.ok ? "✓" : "✕"} {c.label} <span className="text-dim">· {c.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-[13px] font-semibold">Transactions</div>
          <div className="max-h-56 overflow-auto rounded-lg bg-black/25 p-2 font-mono text-[11.5px]">
            {d.deployTx && <div><span className="text-muted">deploy</span> <a className="text-violet-2" href={evmExplorer(d.network, "tx", d.deployTx)} target="_blank" rel="noreferrer">{shortAddr(d.deployTx)}</a></div>}
            {d.mints.map((m) => (
              <div key={m.tx} className={m.status === "failed" ? "text-rose-300" : ""}>
                <span className="text-muted">mint</span> <a className="text-violet-2" href={evmExplorer(d.network, "tx", m.tx)} target="_blank" rel="noreferrer">{shortAddr(m.tx)}</a> #{m.firstTokenId}–#{m.firstTokenId + m.quantity - 1} · {m.status}
              </div>
            ))}
            {!d.deployTx && !d.mints.length && <div className="text-dim">None yet</div>}
          </div>
          <div className="mt-3 mb-1 text-[13px] font-semibold">Log</div>
          <div className="max-h-48 overflow-auto rounded-lg bg-black/25 p-2 font-mono text-[11px]">
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
