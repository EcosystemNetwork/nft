"use client";

import { useState } from "react";
import { AppFrame, MobileNav, SessionFooter, Sidebar, STUDIO_NAV } from "@/components/shell";
import { api, Button, Card, CardHeader, Field, Input, PageHeader, Select, toast, useApi } from "@/components/ui";
import type { Role } from "@/lib/access";
import type { PublicUser } from "@/lib/auth";

type Me = { user: PublicUser };
type Users = { users: PublicUser[] };

export default function AccountPage() {
  const me = useApi<Me>("/api/auth/me");
  const users = useApi<Users>(me.data?.user.role === "owner" ? "/api/auth/users" : null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const owner = me.data?.user.role === "owner";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/auth/users", { method: "POST", json: { name, email, password, role } });
      setName("");
      setEmail("");
      setPassword("");
      await users.reload();
      toast.ok("Account added");
    } catch (err) {
      toast.err((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/auth/users/${id}`, { method: "DELETE" });
      await users.reload();
      toast.ok("Account removed");
    } catch (err) {
      toast.err((err as Error).message);
    }
  }

  return (
    <AppFrame
      sidebar={<Sidebar items={STUDIO_NAV} footer={<SessionFooter />} />}
      mobile={<MobileNav items={STUDIO_NAV} />}
    >
      <PageHeader title="Studio access" sub="Accounts live on this machine. The public mint page does not use them." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="You" sub={me.data ? `${me.data.user.role} · ${me.data.user.email}` : "Loading…"} />
          <div className="px-5 pb-5 text-[13px] text-muted">
            Editors can build and deploy collections. Viewers can look, not change anything. Only the owner adds or removes accounts.
          </div>
        </Card>
        {owner && (
          <Card>
            <CardHeader title="People" />
            <ul className="space-y-2 px-5 pb-4">
              {(users.data?.users ?? []).map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">
                    <span className="text-ink">{u.name}</span> <span className="text-dim">{u.email}</span> · {u.role}
                  </span>
                  {u.role !== "owner" && (
                    <Button size="sm" variant="danger" onClick={() => remove(u.id)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <form onSubmit={add} className="space-y-3 border-t border-line px-5 py-4">
              <Field label="Name">
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Password">
                  <Input type="password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Field label="Role">
                  <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit" variant="primary" busy={busy}>
                Add account
              </Button>
            </form>
          </Card>
        )}
      </div>
    </AppFrame>
  );
}
