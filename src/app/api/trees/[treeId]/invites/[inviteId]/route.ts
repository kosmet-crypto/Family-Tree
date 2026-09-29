import { json, route, uuidParam, type Params } from "@/server/http";
import { revokeInvite } from "@/server/services/invites";
import { requireUser } from "@/server/supabase";

/** Revokes a pending invitation. */
export const DELETE = route<Params<{ treeId: string; inviteId: string }>>(async (req, { params }) => {
  const p = await params;
  const { supabase } = await requireUser(req);
  await revokeInvite(supabase, uuidParam(p.treeId, "treeId"), uuidParam(p.inviteId, "inviteId"));
  return json({ ok: true });
});
