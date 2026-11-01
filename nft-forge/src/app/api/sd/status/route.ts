import { route } from "@/lib/api";
import { probeSd } from "@/lib/sd/client";

export const dynamic = "force-dynamic";

export const GET = route(async () => probeSd());
