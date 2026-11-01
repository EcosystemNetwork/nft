"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeNext } from "@/lib/access";
import { Button, Card, Field, Input } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; setup?: boolean };
      if (data.setup) {
        router.replace("/setup");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Sign-in failed");
      router.replace(safeNext(next));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email">
        <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <div className="text-[13px] text-rose-300">{error}</div>}
      <Button type="submit" variant="primary" busy={busy} className="w-full">
        Sign in
      </Button>
    </form>
  );
}

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card glow className="w-full max-w-md p-6">
        <div className="mb-1 text-[11px] font-medium tracking-[0.2em] text-muted">NFT FORGE</div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 mb-5 text-[13px] text-muted">{sub}</p>
        {children}
      </Card>
    </main>
  );
}
