import { json, route, uuidParam, type Params } from "@/server/http";
import { autoBackup } from "@/server/services/backup";
import { requireUser } from "@/server/supabase";

/** Called by the app on start: at most one automatic snapshot per day, only after changes. */
export const POST = route<Params<{ treeId: string }>>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  return json(await autoBackup(supabase, treeId));
});
