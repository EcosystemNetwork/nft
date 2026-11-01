import { route } from "@/lib/api";
import { removeUser, requireOwner } from "@/lib/auth";

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const owner = await requireOwner(req);
  await removeUser(id, owner.id);
  return { ok: true };
});
