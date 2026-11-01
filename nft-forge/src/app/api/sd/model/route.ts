import { body, route } from "@/lib/api";
import { sdJson } from "@/lib/sd/client";
import { HttpError } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const b = await body<{ checkpoint?: string }>(req);
  const title = (b.checkpoint ?? "").trim();
  if (!title) throw new HttpError(400, "Checkpoint name is required");
  const models = await sdJson<{ title: string }[]>("/sdapi/v1/sd-models", { timeoutMs: 8_000 });
  if (!models.some((m) => m.title === title)) throw new HttpError(400, "Unknown checkpoint");
  await sdJson("/sdapi/v1/options", { method: "POST", body: { sd_model_checkpoint: title }, timeoutMs: 180_000 });
  return { ok: true, model: title };
});
