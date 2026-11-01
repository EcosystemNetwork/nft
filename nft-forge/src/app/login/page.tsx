import { redirect } from "next/navigation";
import { hasUsers } from "@/lib/auth";
import { safeNext } from "@/lib/access";
import { AuthShell, LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!(await hasUsers())) redirect("/setup");
  const next = safeNext((await searchParams).next);
  return (
    <AuthShell title="Sign in" sub="The studio is private. Collectors still mint without an account.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
