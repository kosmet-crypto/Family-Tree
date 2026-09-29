import { json, route, uuidParam, type Params } from "@/server/http";
import { listMembers } from "@/server/services/invites";
import { requireUser } from "@/server/supabase";

export const GET = route<Params<{ treeId: string }>>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  return json({ members: await listMembers(supabase, treeId) });
});
