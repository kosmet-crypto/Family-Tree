// Backup file format = the JSON produced by public.export_tree(). Checked before
// public.restore_tree() is called so a broken or foreign file is rejected with a clear reason.

import { z } from "zod";
import { searchKey } from "../search";

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const person = z.looseObject({
  id: uuid,
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  birth_date: date,
  death_date: date,
  avatar_media_id: uuid.nullable().optional(),
});

const parentChild = z.looseObject({
  id: uuid,
  parent_id: uuid,
  child_id: uuid,
  relation: z.enum(["biological", "adoptive", "step", "foster", "guardian"]).optional(),
});

const partnership = z.looseObject({
  id: uuid,
  person1_id: uuid,
  person2_id: uuid,
});

const media = z.looseObject({
  id: uuid,
  person_id: uuid.nullable().optional(),
  storage_path: z.string(),
  kind: z.enum(["photo", "document"]),
});

export const backupSchema = z.object({
  format: z.literal("roots-branches"),
  version: z.number().int().min(1).max(1),
  exported_at: z.string(),
  tree: z.looseObject({ id: uuid, name: z.string(), root_person_id: uuid.nullable().optional() }),
  persons: z.array(person),
  parent_child: z.array(parentChild),
  partnerships: z.array(partnership),
  media: z.array(media).default([]),
});

export type BackupFile = z.infer<typeof backupSchema>;

export type BackupProblem =
  | { code: "not_json" }
  | { code: "wrong_format"; detail: string }
  | { code: "dangling_reference"; detail: string };

export interface BackupSummary {
  treeName: string;
  exportedAt: string;
  persons: number;
  relations: number;
  partnerships: number;
  media: number;
}

export function parseBackup(input: string | unknown):
  | { ok: true; data: BackupFile; summary: BackupSummary }
  | { ok: false; problem: BackupProblem } {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, problem: { code: "not_json" } };
    }
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, problem: { code: "wrong_format", detail: `${first?.path.join(".")}: ${first?.message}` } };
  }
  const data = parsed.data;
  const ids = new Set(data.persons.map((p) => p.id));
  const missing = (id: string | null | undefined) => !!id && !ids.has(id);
  for (const e of data.parent_child) {
    if (missing(e.parent_id) || missing(e.child_id)) {
      return { ok: false, problem: { code: "dangling_reference", detail: `parent_child ${e.id}` } };
    }
  }
  for (const e of data.partnerships) {
    if (missing(e.person1_id) || missing(e.person2_id)) {
      return { ok: false, problem: { code: "dangling_reference", detail: `partnership ${e.id}` } };
    }
  }
  return {
    ok: true,
    data,
    summary: {
      treeName: data.tree.name,
      exportedAt: data.exported_at,
      persons: data.persons.length,
      relations: data.parent_child.length,
      partnerships: data.partnerships.length,
      media: data.media.length,
    },
  };
}

/** File name for a downloaded backup: "porodicno-stablo-petrovic-2026-09-29.json" */
export function backupFileName(treeName: string, at: Date = new Date()): string {
  const slug = searchKey(treeName).replace(/ /g, "-").slice(0, 40) || "stablo";
  return `porodicno-stablo-${slug}-${at.toISOString().slice(0, 10)}.json`;
}
