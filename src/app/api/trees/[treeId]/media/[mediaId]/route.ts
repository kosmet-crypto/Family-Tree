import { json, route, uuidParam, type Params } from "@/server/http";
import { deleteMedia } from "@/server/services/media";
import { requireUser } from "@/server/supabase";

export const DELETE = route<Params<{ treeId: string; mediaId: string }>>(async (req, { params }) => {
  const p = await params;
  const { supabase } = await requireUser(req);
  return json(await deleteMedia(supabase, uuidParam(p.treeId, "treeId"), uuidParam(p.mediaId, "mediaId")));
});
