import { readUpload } from "@/server/body";
import { env } from "@/server/env";
import { json, route, uuidParam, type Params } from "@/server/http";
import { readBackup, restoreInPlace } from "@/server/services/backup";
import { requireUser } from "@/server/supabase";

/**
 * Restores this tree from an uploaded backup (JSON or ZIP; multipart field "file" or raw body).
 * Owner only. The current state is saved as a 'pre_restore' snapshot first.
 */
export const POST = route<Params<{ treeId: string }>>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  const backup = readBackup(await readUpload(req), env.backupZipMaxBytes);
  return json({ restored: await restoreInPlace(supabase, treeId, backup.data) });
});
