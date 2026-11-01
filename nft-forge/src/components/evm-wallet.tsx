"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Button, Modal, toast } from "./ui";

// EIP-1193 provider + EIP-6963 multi-wallet discovery (MetaMask, Rabby, Coinbase,
// Robinhood Wallet and others announce themselves; no wallet SDKs needed).
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
  removeListener?(event: string, cb: (...a: unknown[]) => void): void;
}
interface Announced {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}
interface Ctx {
  wallets: Announced[];
  wallet: Announced | null;
  account: `0x${string}` | null;
  chainId: number | null;
  connect: (w: Announced) => Promise<void>;
  disconnect: () => void;
}

const EvmCtx = createContext<Ctx | null>(null);
export const useEvmWallet = () => {
  const c = useContext(EvmCtx);
  if (!c) throw new Error("useEvmWallet outside provider");
  return c;
};

const LAST = "nft-forge:evm-wallet";

export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<Announced[]>([]);
  const [wallet, setWallet] = useState<Announced | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Announced>).detail;
      setWallets((ws) => (ws.some((w) => w.info.uuid === d.info.uuid) ? ws : [...ws, d]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Legacy injected wallet that doesn't implement EIP-6963.
    const t = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
      setWallets((ws) => (ws.length || !eth ? ws : [{ info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected" }, provider: eth }]));
    }, 600);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  const attach = useCallback(async (w: Announced, prompt: boolean) => {
    const accounts = (await w.provider.request({ method: prompt ? "eth_requestAccounts" : "eth_accounts" })) as string[];
    if (!accounts?.length) return false;
    setWallet(w);
    setAccount(accounts[0] as `0x${string}`);
    setChainId(Number(await w.provider.request({ method: "eth_chainId" })));
    try {
      localStorage.setItem(LAST, w.info.rdns);
    } catch {
      /* storage unavailable */
    }
    return true;
  }, []);

  // Silent reconnect to the last-used wallet (no prompt).
  useEffect(() => {
    if (wallet) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST);
    } catch {
      /* storage unavailable */
    }
    const w = wallets.find((x) => x.info.rdns === last);
    if (w) void attach(w, false).catch(() => undefined);
  }, [wallets, wallet, attach]);

  useEffect(() => {
    if (!wallet?.provider.on) return;
    const onAccounts = (a: unknown) => setAccount(((a as string[])[0] as `0x${string}`) ?? null);
    const onChain = (c: unknown) => setChainId(Number(c));
    wallet.provider.on("accountsChanged", onAccounts);
    wallet.provider.on("chainChanged", onChain);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", onAccounts);
      wallet.provider.removeListener?.("chainChanged", onChain);
    };
  }, [wallet]);

  const connect = useCallback(
    async (w: Announced) => {
      try {
        await attach(w, true);
      } catch (e) {
        toast.err((e as Error).message || "Wallet connection was rejected");
      }
    },
    [attach],
  );
  const disconnect = useCallback(() => {
    setWallet(null);
    setAccount(null);
    try {
      localStorage.removeItem(LAST);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return <EvmCtx.Provider value={{ wallets, wallet, account, chainId, connect, disconnect }}>{children}</EvmCtx.Provider>;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function EvmWalletButton() {
  const { wallets, wallet, account, connect, disconnect } = useEvmWallet();
  const [open, setOpen] = useState(false);
  if (account)
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-2 bg-panel-2 px-3 font-mono text-[13px]">
          {wallet?.info.icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wallet.info.icon} alt="" className="h-4 w-4" />
          )}
          {shortAddr(account)}
        </span>
        <Button variant="ghost" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Connect wallet
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Connect an EVM wallet">
        {!wallets.length ? (
          <div className="space-y-2 text-sm text-muted">
            <p>No browser wallet was detected.</p>
            <p>Install Robinhood Wallet, MetaMask, Rabby or Coinbase Wallet, then reload this page.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {wallets.map((w) => (
              <button
                key={w.info.uuid}
                onClick={async () => {
                  await connect(w);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3 text-left hover:border-violet/50"
              >
                {w.info.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.info.icon} alt="" className="h-7 w-7 rounded-lg" />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-panel-3">◆</span>
                )}
                <span className="font-medium">{w.info.name}</span>
              </button>
            ))}
            <p className="pt-2 text-[12px] text-dim">NFT Forge never sees your private key or seed phrase. Every transaction is approved in your wallet.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
