// Who may hit a path before the route handler runs. Collector image and metadata
// URLs are "handler": the route itself decides, because delayed-reveal art stays
// private until the collection is revealed.

export type Role = "owner" | "editor" | "viewer";

export type Decision =
  | { type: "next" }
  | { type: "redirect"; to: string }
  | { type: "deny"; status: 401 | 403; setup?: boolean };

const PUBLIC_PAGE = [/^\/login\/?$/, /^\/setup\/?$/, /^\/mint(\/|$)/];
const PUBLIC_API = [/^\/api\/mint(\/|$)/, /^\/api\/auth\/(login|setup|logout)\/?$/];
const HANDLER_GET = [
  /^\/api\/projects\/[^/]+\/metadata\/[^/]+$/,
  /^\/api\/projects\/[^/]+\/nfts\/[^/]+\/image$/,
  /^\/api\/projects\/[^/]+\/revealed\/[^/]+\/[^/]+$/,
];

export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.startsWith("/login") || raw.startsWith("/setup")) return "/";
  return raw;
}

export function decide(pathname: string, method: string, session: { role: Role } | null, hasUsers: boolean): Decision {
  const verb = method.toUpperCase();
  const page = pathname.split("?")[0] || "/";
  if (PUBLIC_API.some((r) => r.test(page)) || PUBLIC_PAGE.some((r) => r.test(page))) {
    if (page.replace(/\/$/, "") === "/setup" && hasUsers) return { type: "redirect", to: "/login" };
    if (page.replace(/\/$/, "") === "/login" && !hasUsers) return { type: "redirect", to: "/setup" };
    if ((page === "/login" || page === "/setup" || page === "/login/" || page === "/setup/") && session) return { type: "redirect", to: "/" };
    return { type: "next" };
  }
  if ((verb === "GET" || verb === "HEAD") && HANDLER_GET.some((r) => r.test(page))) return { type: "next" };
  if (!hasUsers) {
    if (page.startsWith("/api/")) return { type: "deny", status: 401, setup: true };
    return { type: "redirect", to: "/setup" };
  }
  if (!session) {
    if (page.startsWith("/api/")) return { type: "deny", status: 401 };
    return { type: "redirect", to: `/login?next=${encodeURIComponent(page)}` };
  }
  if (session.role === "viewer" && verb !== "GET" && verb !== "HEAD") {
    if (page.startsWith("/api/")) return { type: "deny", status: 403 };
    return { type: "redirect", to: "/" };
  }
  return { type: "next" };
}
