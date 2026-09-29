import { json, route, uuidParam, type Params } from "@/server/http";
import { restoreSnapshot } from "@/server/services/backup";
import { requireUser } from "@/server/supabase";

export const POST = route<Params<{ treeId: string; snapshotId: string }>>(async (req, { params }) => {
  const p = await params;
  const { supabase } = await requireUser(req);
  return json({ restored: await restoreSnapshot(supabase, uuidParam(p.treeId, "treeId"), uuidParam(p.snapshotId, "snapshotId")) });
});
