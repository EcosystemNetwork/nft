"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { Button, cx, Modal, toast } from "./ui";

/** Wallet Standard wallets (Phantom, Solflare, Backpack, …) are detected automatically. */
export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider wallets={[]} autoConnect onError={(e) => toast.err(e.message || "Wallet error")}>
      {children}
    </WalletProvider>
  );
}

export function short(addr: string, n = 4) {
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

export function WalletButton() {
  const { wallets, wallet, publicKey, connecting, connected, select, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  if (connected && publicKey)
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-2 bg-panel-2 px-3 font-mono text-[13px]">
          {wallet?.adapter.icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wallet.adapter.icon} alt="" className="h-4 w-4" />
          )}
          {short(publicKey.toBase58())}
        </span>
        <Button variant="ghost" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );

  return (
    <>
      <Button variant="primary" busy={connecting} onClick={() => setOpen(true)}>
        Connect wallet
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Connect a Solana wallet">
        {!installed.length ? (
          <div className="space-y-2 text-sm text-muted">
            <p>No Solana wallet extension was detected in this browser.</p>
            <p>
              Install <a className="text-violet-2 underline" href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>,{" "}
              <a className="text-violet-2 underline" href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or{" "}
              <a className="text-violet-2 underline" href="https://backpack.app" target="_blank" rel="noreferrer">Backpack</a>, then reload this page.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {installed.map((w) => (
              <button
                key={w.adapter.name}
                onClick={async () => {
                  try {
                    select(w.adapter.name);
                    await new Promise((r) => setTimeout(r, 0));
                    await (w.adapter.connected ? Promise.resolve() : w.adapter.connect().catch(() => connect()));
                    setOpen(false);
                  } catch (e) {
                    toast.err((e as Error).message);
                  }
                }}
                className={cx("flex w-full items-center gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3 text-left hover:border-violet/50")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" className="h-7 w-7 rounded-lg" />
                <span className="font-medium">{w.adapter.name}</span>
              </button>
            ))}
            <p className="pt-2 text-[12px] text-dim">NFT Forge never sees your private key or seed phrase. Every transaction is approved in your wallet.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
