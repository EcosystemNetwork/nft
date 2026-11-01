"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, cx, Toaster, useApi } from "./ui";

const ICONS: Record<string, string> = {
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  architect: "M12 2l2.4 6.9H21l-5.4 4.2 2 7L12 16l-5.6 4.1 2-7L3 8.9h6.6z",
  palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.3-1-1.4-1-2.6 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01",
  assets: "M4 5h16v14H4zM4 15l4-4 5 5 3-3 4 4M15 9h.01",
  traits: "M4 6h16M4 12h10M4 18h6M18 12l2 2-2 2M14 18l2-2",
  generate: "M13 2L4 14h7l-1 8 9-12h-7z",
  gallery: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  rarity: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  qa: "M9 12l2 2 4-4M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  export: "M12 3v12M7 10l5 5 5-5M4 21h16",
  cloud: "M7 18a5 5 0 0 1-.9-9.9A6 6 0 0 1 17.7 8 4.5 4.5 0 0 1 17.5 18H7zM12 11v6M9.5 13.5 12 11l2.5 2.5",
  sale: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  deploy: "M12 2c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10zM9 15l-2 5 3-2M15 15l2 5-3-2M12 9h.01",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  back: "M15 18l-6-6 6-6",
  plus: "M12 5v14M5 12h14",
};

export function Icon({ name, className }: { name: keyof typeof ICONS | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("h-[18px] w-[18px] shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name] ?? ICONS.dashboard} />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 shadow-[0_0_30px_-4px_rgb(139_92_246/0.7)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor" aria-hidden>
          <path d="M4 9h11c0 2 1.5 3 4 3v2c-2 0-3 .8-3.5 2H18v3H6v-3h2.5C8 14.8 6.5 14 4 14z" />
          <path d="M17 3l.8 1.9L20 5.7l-2.2.8L17 8.5l-.8-2L14 5.7l2.2-.8z" opacity=".9" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-wide">NFT FORGE</div>
        <div className="text-[10px] font-medium tracking-[0.2em] text-muted">COLLECTION STUDIO</div>
      </div>
    </Link>
  );
}

export const STUDIO_NAV: NavItem[] = [
  { href: "/", label: "Projects", icon: "dashboard" },
  { href: "/account", label: "Studio access", icon: "settings" },
];

export function SessionFooter() {
  const { data } = useApi<{ user: { name: string; email: string; role: string } }>("/api/auth/me");
  const user = data?.user;
  return (
    <div className="mt-3 border-t border-line px-2 pt-3">
      {user ? (
        <>
          <div className="truncate text-[13px] text-ink">{user.name}</div>
          <div className="truncate text-[11px] text-dim">
            {user.role} · {user.email}
          </div>
        </>
      ) : (
        <div className="text-[12px] text-dim">Studio session</div>
      )}
      <button
        type="button"
        className="mt-2 text-[12px] text-muted hover:text-ink"
        onClick={() => {
          void api("/api/auth/logout", { method: "POST" }).finally(() => location.assign("/login"));
        }}
      >
        Sign out
      </button>
    </div>
  );
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export function Sidebar({ items, top, footer }: { items: NavItem[]; top?: React.ReactNode; footer?: React.ReactNode }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-line bg-panel/70 px-4 py-5 backdrop-blur lg:flex">
      <div className="px-2">
        <Logo />
      </div>
      {top && <div className="mt-6">{top}</div>}
      <nav className="mt-6 flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {items.map((it) => {
          const active = path === it.href;
          return (
            <Link
              key={it.href}
              href={it.disabled ? "#" : it.href}
              className={cx(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition",
                active
                  ? "bg-gradient-to-r from-violet/25 to-violet/5 text-ink shadow-[inset_0_0_0_1px_rgb(139_92_246/0.35)]"
                  : "text-muted hover:bg-panel-2 hover:text-ink",
                it.disabled && "pointer-events-none opacity-40",
              )}
            >
              <Icon name={it.icon} className={active ? "text-violet-2" : "text-dim group-hover:text-muted"} />
              <span className="flex-1">{it.label}</span>
              {it.badge}
            </Link>
          );
        })}
      </nav>
      {footer}
    </aside>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <div className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-line bg-panel/90 px-3 py-2 backdrop-blur lg:hidden">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={cx(
            "shrink-0 rounded-lg px-3 py-1.5 text-[13px]",
            path === it.href ? "bg-violet/20 text-ink" : "text-muted",
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

export function AppFrame({ sidebar, mobile, children }: { sidebar: React.ReactNode; mobile?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {sidebar}
      <div className="min-w-0 flex-1">
        {mobile}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-8">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
