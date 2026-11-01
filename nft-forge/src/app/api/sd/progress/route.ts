import { route } from "@/lib/api";
import { sdProgress } from "@/lib/sd/client";

export const dynamic = "force-dynamic";

export const GET = route(async () => sdProgress());
