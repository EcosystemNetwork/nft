"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppFrame, Icon, MobileNav, Sidebar, type NavItem } from "@/components/shell";
import { api, Badge, Button, Card, Empty, Field, fmt, Input, Modal, PageHeader, Select, Stat, Textarea, toast, useApi } from "@/components/ui";
import type { Project } from "@/lib/store";

type ProjectRow = Project & {
  stats: { assets: number; categories: number; traits: number; generated: number; approved: number };
};

const NAV: NavItem[] = [{ href: "/", label: "Projects", icon: "dashboard" }];

const STEPS = [
  ["Describe", "AI blueprint & art bible"],
  ["Assets", "Import layer artwork"],
  ["Traits", "Weights & rules"],
  ["Generate", "Seeded, unique, valid"],
  ["Review", "Gallery, rarity, QA"],
  ["Export", "Images + metadata ZIP"],
];

export default function Dashboard() {
  const { data: projects, loading, reload } = useApi<ProjectRow[]>("/api/projects");
  const [open, setOpen] = useState(false);
  const totals = (projects ?? []).reduce(
    (t, p) => ({
      generated: t.generated + p.stats.generated,
      assets: t.assets + p.stats.assets,
      approved: t.approved + p.stats.approved,
    }),
    { generated: 0, assets: 0, approved: 0 },
  );

  return (
    <AppFrame
      sidebar={
        <Sidebar
          items={NAV}
          top={
            <Card glow className="p-4">
              <div className="text-[13px] font-medium text-green-300">Ready to forge</div>
              <div className="mt-0.5 text-[12px] text-muted">Local workspace · all MVP modules</div>
              <Button variant="primary" size="sm" className="mt-3 w-full" onClick={() => setOpen(true)}>
                <Icon name="plus" className="h-4 w-4" /> New project
              </Button>
            </Card>
          }
          footer={<div className="px-2 text-[11px] text-dim">NFT Forge v0.1 · MVP</div>}
        />
      }
      mobile={<MobileNav items={NAV} />}
    >
      <PageHeader
        title="Projects"
        sub="From first idea to a validated, export-ready collection."
        right={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Icon name="plus" className="h-4 w-4" /> New project
          </Button>
        }
      />

      <Card glow className="relative mb-6 overflow-hidden p-6 sm:p-8">
        <div className="max-w-2xl">
          <Badge tone="violet">WORKFLOW</Badge>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Forge a complete collection without hand-editing a single token.</h2>
          <p className="mt-2 text-sm text-muted">Every token is reproducible from its seed, every combination is checked against your rules, and every export ships with a QA report and SHA-256 manifest.</p>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map(([t, s], i) => (
            <div key={t} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 backdrop-blur">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-violet/30 text-[10px] text-violet-2">{i + 1}</span>
                {t}
              </div>
              <div className="mt-1 text-[11px] text-muted">{s}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Projects" value={projects?.length ?? "—"} accent="#8b5cf6" />
        <Stat label="Tokens generated" value={fmt.n(totals.generated)} accent="#22d3ee" />
        <Stat label="Approved / locked" value={fmt.n(totals.approved)} accent="#22c55e" />
        <Stat label="Layer assets" value={fmt.n(totals.assets)} accent="#f59e0b" />
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Recent projects</h2>
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-2xl border border-line bg-panel" />
          ))}
        </div>
      ) : !projects?.length ? (
        <Empty
          title="No projects yet"
          action={
            <Button variant="primary" onClick={() => setOpen(true)}>
              Create your first project
            </Button>
          }
        >
          Create a project, or run <code className="rounded bg-panel-3 px-1">npm run seed</code> to load the Space Pirates flagship collection.
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <CreateProject open={open} onClose={() => setOpen(false)} onCreated={reload} />
    </AppFrame>
  );
}

function ProjectCard({ p }: { p: ProjectRow }) {
  const start = p.metadata.startTokenId;
  const pct = p.config.supply ? p.stats.generated / p.config.supply : 0;
  return (
    <Link href={`/projects/${p.id}`} className="group">
      <Card className="overflow-hidden transition group-hover:border-violet/50 group-hover:shadow-[0_0_40px_-12px_rgb(139_92_246/0.6)]">
        <div className="relative grid h-44 grid-cols-3 gap-px overflow-hidden bg-line">
          {p.stats.generated > 0 ? (
            [0, 1, 2].map((i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={`/api/projects/${p.id}/nfts/${start + i}/image?size=256`}
                alt=""
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
            ))
          ) : (
            <div className="col-span-3 grid place-items-center bg-gradient-to-br from-violet-900/40 via-panel-2 to-cyan-900/20 text-4xl">✦</div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-panel to-transparent" />
        </div>
        <div className="p-5 pt-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate font-semibold">{p.name}</h3>
            <Badge tone="cyan">{p.chain.toUpperCase()}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{p.concept || "No concept yet."}</p>
          <div className="mt-4 flex items-center justify-between text-[12px] text-muted">
            <span>
              {fmt.n(p.stats.generated)} / {fmt.n(p.config.supply)} tokens
            </span>
            <span>{fmt.ago(p.updatedAt)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-3">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-400" style={{ width: `${pct * 100}%` }} />
          </div>
          <div className="mt-3 flex gap-3 text-[12px] text-dim">
            <span>{p.stats.categories} categories</span>·<span>{p.stats.traits} traits</span>·<span>{p.stats.assets} assets</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function CreateProject({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", concept: "", supply: 3333, style: "", chain: "robinhood", mode: "2d" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: k === "supply" ? Number(e.target.value) : e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<Project>("/api/projects", { method: "POST", json: f });
      onCreated();
      router.push(`/projects/${p.id}`);
    } catch (err) {
      toast.err((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project name">
          <Input value={f.name} onChange={set("name")} placeholder="Space Pirates" required autoFocus />
        </Field>
        <Field label="Collection concept" hint="Describe it in plain language. The AI Architect turns this into a blueprint.">
          <Textarea rows={3} value={f.concept} onChange={set("concept")} placeholder="Robin Hood-inspired intergalactic outlaws who rob the Galactic Crown…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supply">
            <Input type="number" min={1} max={100000} value={f.supply} onChange={set("supply")} />
          </Field>
          <Field label="Visual style">
            <Input value={f.style} onChange={set("style")} placeholder="Flat vector, cel-shaded" />
          </Field>
          <Field label="Blockchain">
            <Select value={f.chain} onChange={set("chain")}>
              <option value="robinhood">Robinhood Chain (ERC-721)</option>
              <option value="solana">Solana (Metaplex)</option>
              <option value="ethereum">Ethereum</option>
              <option value="base">Base (L2)</option>
              <option value="sui">Sui</option>
            </Select>
          </Field>
          <Field label="Production">
            <Select value={f.mode} onChange={set("mode")}>
              <option value="2d">2D layers</option>
              <option value="hybrid">2D/3D hybrid</option>
              <option value="3d">3D (Phase 4)</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
}
