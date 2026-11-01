"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// --- data --------------------------------------------------------------------

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/") && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/setup")) {
      const setup = (data as { setup?: boolean }).setup;
      const next = encodeURIComponent(location.pathname + location.search);
      location.assign(setup ? "/setup" : `/login?next=${next}`);
    }
    throw new Error(message);
  }
  return data as T;
}

export function useApi<T>(url: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const urlRef = useRef(url);
  urlRef.current = url;
  const load = useCallback(async () => {
    if (!urlRef.current) return;
    try {
      const d = await api<T>(urlRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(Boolean(url));
    void load();
    if (!opts.poll || !url) return;
    const t = setInterval(load, opts.poll);
    return () => clearInterval(t);
  }, [url, opts.poll, load]);
  return { data, error, loading, reload: load, setData };
}

// --- toasts ------------------------------------------------------------------

type Toast = { id: number; kind: "ok" | "err"; text: string };
let pushToast: (t: Omit<Toast, "id">) => void = () => {};
export const toast = {
  ok: (text: string) => pushToast({ kind: "ok", text }),
  err: (text: string) => pushToast({ kind: "err", text }),
};
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.kind === "err" ? 7000 : 3500);
    };
  }, []);
  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "rounded-xl border px-4 py-3 text-sm whitespace-pre-line shadow-2xl backdrop-blur",
            t.kind === "ok" ? "border-good/30 bg-good/10 text-green-200" : "border-bad/30 bg-bad/15 text-rose-200",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// --- primitives --------------------------------------------------------------

export function Card({ className, children, glow }: { className?: string; children: React.ReactNode; glow?: boolean }) {
  return (
    <div className={cx("rounded-2xl border border-line", glow ? "glow-card" : "bg-panel", className)}>{children}</div>
  );
}

export function CardHeader({ title, sub, right }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "good";
  size?: "sm" | "md";
  busy?: boolean;
};
export function Button({ variant = "outline", size = "md", busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" &&
          "bg-gradient-to-b from-violet-500 to-violet-700 text-white shadow-[0_0_0_1px_rgb(167_139_250/0.4),0_8px_24px_-8px_rgb(139_92_246/0.7)] hover:from-violet-400 hover:to-violet-600",
        variant === "outline" && "border border-line-2 bg-panel-2 text-ink hover:border-violet/50 hover:bg-panel-3",
        variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-ink",
        variant === "danger" && "border border-bad/30 bg-bad/10 text-rose-300 hover:bg-bad/20",
        variant === "good" && "border border-good/30 bg-good/10 text-green-300 hover:bg-good/20",
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}
type Tone = "neutral" | "violet" | "cyan" | "good" | "bad" | "amber";
const TONES: Record<Tone, string> = {
  neutral: "bg-white/5 text-muted ring-1 ring-white/10",
  violet: "bg-violet/15 text-violet-2 ring-1 ring-violet/30",
  cyan: "bg-cyan/10 text-cyan ring-1 ring-cyan/25",
  good: "bg-good/10 text-green-300 ring-1 ring-good/25",
  bad: "bg-bad/10 text-rose-300 ring-1 ring-bad/25",
  amber: "bg-amber/10 text-amber-300 ring-1 ring-amber/25",
};

/**
 * Rarity tiers are ordinal, so they use one sequential hue (violet), brighter =
 * rarer on the dark surface. Identity is always carried by the tier name too.
 */
export const TIER_COLORS: Record<string, string> = {
  Mythic: "#e4ddff",
  Legendary: "#c3b5fb",
  Epic: "#a08bf5",
  Rare: "#8065e8",
  Uncommon: "#6249cf",
  Common: "#4a3a9e",
};
export function TierBadge({ tier }: { tier: string }) {
  const c = TIER_COLORS[tier] ?? "#4a3a9e";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-ink uppercase ring-1 ring-white/10 backdrop-blur">
      <span className="h-2 w-2 rounded-full" style={{ background: c }} />
      {tier}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={status === "locked" ? "violet" : status === "approved" ? "good" : "neutral"}>
      {status === "locked" ? "🔒 " : status === "approved" ? "✓ " : ""}
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[12px] font-medium tracking-wide text-muted uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-dim">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-line-2 bg-panel-2 px-3 text-sm text-ink placeholder:text-dim outline-none transition focus:border-violet/60 focus:ring-2 focus:ring-violet/20";
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, "h-10", props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "py-2.5", props.className)} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "h-10 pr-8", props.className)} />;
}

export function Stat({
  label,
  value,
  sub,
  accent = "#8b5cf6",
  spark,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
  spark?: number[];
}) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-dim">{sub}</div>}
      {spark && spark.length > 1 && <Sparkline values={spark} color={accent} />}
      <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full blur-2xl" style={{ background: `${accent}26` }} />
    </Card>
  );
}

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 32;
  const bw = w / values.length;
  return (
    <svg className="absolute right-4 bottom-4" width={w} height={h} aria-hidden>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * h);
        return <rect key={i} x={i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh} rx={1.5} fill={color} opacity={0.85} />;
      })}
    </svg>
  );
}

export function Progress({ value, max, tone = "violet" }: { value: number; max: number; tone?: "violet" | "good" | "bad" }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3">
      <div
        className={cx(
          "h-full rounded-full transition-all duration-500",
          tone === "violet" && "bg-gradient-to-r from-violet-600 to-cyan-400",
          tone === "good" && "bg-good",
          tone === "bad" && "bg-bad",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-16 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-violet/15 text-xl">✦</div>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm text-muted">
      <span className={cx("relative h-5 w-9 rounded-full transition", checked ? "bg-violet" : "bg-panel-3 ring-1 ring-line-2")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx("max-h-[92vh] w-full overflow-auto rounded-2xl border border-line-2 bg-panel shadow-2xl", wide ? "max-w-5xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg px-2 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export const fmt = {
  n: (v: number) => v.toLocaleString(),
  pct: (v: number, d = 1) => `${(v * 100).toFixed(d)}%`,
  bytes: (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`),
  ago: (iso: string) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  },
};
