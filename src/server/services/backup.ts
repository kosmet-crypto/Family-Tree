// Backup & restore.
// JSON backup = public.export_tree(). ZIP backup = backup.json + media/<storage path> files.
// Restore in place: public.restore_tree() (owner only, takes a pre_restore snapshot first).
// Import as a new tree: ids are re-generated, files re-uploaded under the new tree.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { remapIds } from "@/lib/backup/remap";
import { parseBackup, type BackupFile } from "@/lib/backup/schema";

export { remapIds };
import { extensionFor } from "@/lib/media/compress";
import { mediaStoragePath } from "@/lib/media/quota";
import type { SnapshotKind } from "@/lib/types/db";
import { config } from "@/lib/config";
import { ApiError, unwrap } from "../http";
import type { Db } from "../supabase";

export const ZIP_JSON_NAME = "backup.json";
const ZIP_MEDIA_DIR = "media/";

export async function exportJson(db: Db, treeId: string): Promise<BackupFile> {
  const data = unwrap(await db.rpc("export_tree", { p_tree: treeId })) as BackupFile | null;
  if (!data) throw new ApiError(404, "tree_not_found");
  return data;
}

export interface ZipExport {
  zip: Uint8Array;
  files: number;
  missing: string[]; // media rows whose file could not be downloaded
}

export async function exportZip(db: Db, treeId: string, maxBytes: number): Promise<ZipExport> {
  const backup = await exportJson(db, treeId);
  const total = backup.media.reduce((s, m) => s + Number((m as { size_bytes?: number }).size_bytes ?? 0), 0);
  if (total > maxBytes) {
    throw new ApiError(413, "backup_too_large", `Media is ${total} bytes; limit ${maxBytes}. Use the JSON backup.`);
  }
  const entries: Zippable = {};
  const missing: string[] = [];
  let files = 0;
  for (const m of backup.media) {
    const { data, error } = await db.storage.from(config.storageBucket).download(m.storage_path);
    if (error || !data) {
      missing.push(m.storage_path);
      continue;
    }
    // images are already compressed: store without deflate
    entries[ZIP_MEDIA_DIR + m.storage_path] = [new Uint8Array(await data.arrayBuffer()), { level: 0 }];
    files++;
  }
  entries[ZIP_JSON_NAME] = [strToU8(JSON.stringify(backup, null, 1)), { level: 6 }];
  return { zip: zipSync(entries), files, missing };
}

export interface ReadBackup {
  data: BackupFile;
  files: Map<string, Uint8Array>; // storage path -> bytes
}

/**
 * Accepts a JSON document or a ZIP made by exportZip().
 * maxUnpackedBytes guards against ZIP bombs (sum of uncompressed sizes).
 */
export function readBackup(body: Uint8Array | string | unknown, maxUnpackedBytes = 300 * 1024 * 1024): ReadBackup {
  let json: unknown = body;
  const files = new Map<string, Uint8Array>();
  if (body instanceof Uint8Array) {
    const isZip = body[0] === 0x50 && body[1] === 0x4b; // "PK"
    if (isZip) {
      let entries: Record<string, Uint8Array>;
      let unpacked = 0;
      try {
        entries = unzipSync(body, {
          filter: (f) => {
            unpacked += f.originalSize;
            if (unpacked > maxUnpackedBytes) throw new ApiError(413, "backup_too_large");
            return f.name === ZIP_JSON_NAME || f.name.startsWith(ZIP_MEDIA_DIR);
          },
        });
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(400, "bad_zip");
      }
      const main = entries[ZIP_JSON_NAME];
      if (!main) throw new ApiError(400, "bad_backup_format", `${ZIP_JSON_NAME} missing in ZIP`);
      json = strFromU8(main);
      for (const [name, bytes] of Object.entries(entries)) {
        if (name.startsWith(ZIP_MEDIA_DIR) && bytes.length) files.set(name.slice(ZIP_MEDIA_DIR.length), bytes);
      }
    } else {
      json = strFromU8(body);
    }
  }
  const parsed = parseBackup(json);
  if (!parsed.ok) throw new ApiError(400, parsed.problem.code === "not_json" ? "invalid_json" : "bad_backup_format", "detail" in parsed.problem ? parsed.problem.detail : undefined);
  return { data: parsed.data, files };
}

export interface RestoreResult {
  persons: number;
  parent_child: number;
  partnerships: number;
}

/** Replaces the tree's people and relations with the backup (owner only). */
export async function restoreInPlace(db: Db, treeId: string, data: BackupFile): Promise<RestoreResult> {
  return unwrap(await db.rpc("restore_tree", { p_tree: treeId, p_data: data })) as RestoreResult;
}

export interface ImportResult extends RestoreResult {
  treeId: string;
  media_imported: number;
  media_skipped: number;
}

/** Creates a new tree owned by the caller and fills it from the backup. */
export async function importAsNewTree(db: Db, backup: ReadBackup, name?: string): Promise<ImportResult> {
  const original = backup.data;
  const { data } = remapIds(original);
  const treeId = crypto.randomUUID();
  unwrap(
    await db.from("trees").insert({
      id: treeId,
      name: (name ?? original.tree.name).slice(0, 120) || "Stablo",
      description: (original.tree as { description?: string | null }).description ?? null,
      entry_mode: (original.tree as { entry_mode?: string }).entry_mode ?? "simple",
    }),
  );

  // Media first (rows must exist before restore_tree links them to people).
  let imported = 0;
  let skipped = 0;
  const keptMedia: BackupFile["media"] = [];
  for (let i = 0; i < data.media.length; i++) {
    const m = data.media[i]!;
    const bytes = backup.files.get(original.media[i]!.storage_path);
    const mm = m as typeof m & { mime_type?: string; size_bytes?: number; width?: number | null; height?: number | null; caption?: string | null; taken_on?: string | null };
    if (!bytes || !mm.mime_type) { skipped++; continue; }
    const path = mediaStoragePath(treeId, m.kind, m.id, extensionFor(mm.mime_type) === "bin" ? (m.storage_path.split(".").pop() ?? "bin") : extensionFor(mm.mime_type));
    const up = await db.storage.from(config.storageBucket).upload(path, bytes, { contentType: mm.mime_type, upsert: false });
    if (up.error) { skipped++; continue; }
    const ins = await db.from("media").insert({
      id: m.id, tree_id: treeId, kind: m.kind, storage_path: path, mime_type: mm.mime_type,
      size_bytes: bytes.length, width: mm.width ?? null, height: mm.height ?? null,
      caption: mm.caption ?? null, taken_on: mm.taken_on ?? null,
    });
    if (ins.error) {
      // e.g. photo quota reached: keep the tree, drop this file
      await db.storage.from(config.storageBucket).remove([path]);
      skipped++;
      continue;
    }
    imported++;
    keptMedia.push(m);
  }

  const restored = await restoreInPlace(db, treeId, { ...data, media: keptMedia });
  return { treeId, ...restored, media_imported: imported, media_skipped: skipped };
}

// ---------------------------------------------------------------------------
// Snapshots stored in the database
// ---------------------------------------------------------------------------

export async function listSnapshots(db: Db, treeId: string) {
  return unwrap(
    await db
      .from("tree_snapshots")
      .select("id, kind, label, person_count, created_at, created_by")
      .eq("tree_id", treeId)
      .order("created_at", { ascending: false }),
  ) as { id: string; kind: SnapshotKind; label: string | null; person_count: number; created_at: string; created_by: string | null }[];
}

export async function createSnapshot(db: Db, treeId: string, label?: string | null): Promise<{ id: string }> {
  const id = unwrap(await db.rpc("create_snapshot", { p_tree: treeId, p_kind: "manual", p_label: label ?? null })) as string;
  return { id };
}

export async function restoreSnapshot(db: Db, treeId: string, snapshotId: string): Promise<RestoreResult> {
  const row = unwrap(
    await db.from("tree_snapshots").select("data").eq("id", snapshotId).eq("tree_id", treeId).maybeSingle(),
  ) as { data: BackupFile } | null;
  if (!row) throw new ApiError(404, "snapshot_not_found");
  return restoreInPlace(db, treeId, row.data);
}

/** Called by the app on start; creates at most one automatic snapshot per day, only after changes. */
export async function autoBackup(db: Db, treeId: string): Promise<{ id: string | null }> {
  const id = unwrap(await db.rpc("auto_snapshot", { p_tree: treeId })) as string | null;
  return { id };
}
