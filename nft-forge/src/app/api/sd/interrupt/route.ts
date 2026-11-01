import { route } from "@/lib/api";
import { sdJson } from "@/lib/sd/client";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  await sdJson("/sdapi/v1/interrupt", { method: "POST", timeoutMs: 8_000 });
  return { ok: true };
});
