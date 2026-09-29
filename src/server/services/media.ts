// Deleting media: removes the database row and the file (unless a merged copy in
// another tree still uses the file; the Storage policy refuses that delete).

import { config } from "@/lib/config";
import { ApiError, unwrap } from "../http";
import type { Db } from "../supabase";

export async function deleteMedia(db: Db, treeId: string, mediaId: string): Promise<{ fileDeleted: boolean }> {
  const row = unwrap(
    await db.from("media").select("id, storage_path, is_copy").eq("id", mediaId).eq("tree_id", treeId).maybeSingle(),
  ) as { id: string; storage_path: string; is_copy: boolean } | null;
  if (!row) throw new ApiError(404, "media_not_found");

  const deleted = unwrap(await db.from("media").delete().eq("id", mediaId).select("id")) as unknown[];
  if (deleted.length === 0) throw new ApiError(403, "forbidden");

  // Copies point at another tree's file: never delete it from here.
  if (row.is_copy) return { fileDeleted: false };
  const { data, error } = await db.storage.from(config.storageBucket).remove([row.storage_path]);
  return { fileDeleted: !error && (data?.length ?? 0) > 0 };
}
