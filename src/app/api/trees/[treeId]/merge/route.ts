import { json, parseJson, route, uuidParam, type Params } from "@/server/http";
import { mergeSchema, mergeTrees } from "@/server/services/invites";
import { requireUser } from "@/server/supabase";

/** Copies another tree (sourceTreeId) into this one; personMap links people present in both. */
export const POST = route<Params<{ treeId: string }>>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  const input = await parseJson(req, mergeSchema);
  return json({ merged: await mergeTrees(supabase, treeId, input) });
});
