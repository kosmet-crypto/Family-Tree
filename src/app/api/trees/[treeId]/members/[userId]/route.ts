import { json, parseJson, route, uuidParam, type Params } from "@/server/http";
import { removeMember, updateMemberRole, updateMemberSchema } from "@/server/services/invites";
import { requireUser } from "@/server/supabase";

type P = Params<{ treeId: string; userId: string }>;

/** Owner changes a member's role (viewer / editor). */
export const PATCH = route<P>(async (req, { params }) => {
  const p = await params;
  const { supabase } = await requireUser(req);
  const { role } = await parseJson(req, updateMemberSchema);
  await updateMemberRole(supabase, uuidParam(p.treeId, "treeId"), uuidParam(p.userId, "userId"), role);
  return json({ ok: true });
});

/** Owner removes a member, or a member leaves the tree (userId = own id). */
export const DELETE = route<P>(async (req, { params }) => {
  const p = await params;
  const { supabase } = await requireUser(req);
  await removeMember(supabase, uuidParam(p.treeId, "treeId"), uuidParam(p.userId, "userId"));
  return json({ ok: true });
});
