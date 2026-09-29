import { readUpload } from "@/server/body";
import { env } from "@/server/env";
import { json, route } from "@/server/http";
import { importAsNewTree, readBackup } from "@/server/services/backup";
import { requireUser } from "@/server/supabase";

/** Imports a backup (JSON or ZIP with media) as a new tree owned by the caller. ?name= overrides the name. */
export const POST = route<unknown>(async (req) => {
  const { supabase } = await requireUser(req);
  const backup = readBackup(await readUpload(req), env.backupZipMaxBytes);
  const name = new URL(req.url).searchParams.get("name") ?? undefined;
  return json({ imported: await importAsNewTree(supabase, backup, name) }, 201);
});
