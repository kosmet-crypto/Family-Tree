import { backupFileName } from "@/lib/backup/schema";
import { env } from "@/server/env";
import { route, uuidParam, type Params } from "@/server/http";
import { exportJson, exportZip } from "@/server/services/backup";
import { requireUser } from "@/server/supabase";

/** Download a backup: ?format=json (default) or ?format=zip (JSON + media files). */
export const GET = route<Params<{ treeId: string }>>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const data = await exportJson(supabase, treeId);
  const name = backupFileName(data.tree.name);
  if (format === "zip") {
    const out = await exportZip(supabase, treeId, env.backupZipMaxBytes);
    return new Response(out.zip as BodyInit, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name.replace(/\.json$/, ".zip")}"`,
        "x-backup-files": String(out.files),
        "x-backup-missing": String(out.missing.length),
      },
    });
  }
  return new Response(JSON.stringify(data, null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
});
