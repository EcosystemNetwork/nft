import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => ({ user: await requireUser(req) }));
