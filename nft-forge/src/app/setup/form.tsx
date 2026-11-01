"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { AuthShell } from "../login/form";

export default function SetupPage() {
  return (
    <AuthShell title="Create the owner account" sub="This machine's studio has no accounts yet. The owner can add editors and viewers later. Mint pages stay public.">
      <SetupForm />
    </AuthShell>
  );
}

function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not create the owner");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name">
        <Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email">
        <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" hint="At least 10 characters. Stored as a scrypt hash on this machine.">
        <Input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <div className="text-[13px] text-rose-300">{error}</div>}
      <Button type="submit" variant="primary" busy={busy} className="w-full">
        Create owner
      </Button>
    </form>
  );
}
