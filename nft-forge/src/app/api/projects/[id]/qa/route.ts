import { route } from "@/lib/api";
import { runQa } from "@/lib/qa";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const visual = new URL(req.url).searchParams.get("visual") !== "0";
  return runQa(id, { visualDuplicates: visual });
});
