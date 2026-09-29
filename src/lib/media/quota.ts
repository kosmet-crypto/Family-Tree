// Photo quota helpers. The database enforces the limit (Storage policy + media trigger);
// these helpers let the UI explain it before an upload is attempted.

import type { PhotoQuotaRow } from "../types/db";

export interface QuotaCheck {
  allowed: number;        // how many of the requested photos may be uploaded now
  blocked: number;        // how many exceed the limit
  unlimited: boolean;
  remaining: number | null;
}

/** Normalises the jsonb returned by public.photo_quota(). */
export function parsePhotoQuota(row: unknown): PhotoQuotaRow {
  const r = (row ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    used: num(r.used) ?? 0,
    limit: num(r.limit),
    remaining: num(r.remaining),
    premium: r.premium === true,
  };
}

/** Local computation (same rules as SQL) for when only the count and plan are known. */
export function computePhotoQuota(used: number, premium: boolean, freeLimit: number | null): PhotoQuotaRow {
  const limit = premium ? null : freeLimit;
  return {
    used,
    limit,
    remaining: limit === null ? null : Math.max(limit - used, 0),
    premium,
  };
}

/** How many of `requested` new photos fit in the quota. */
export function checkPhotoUpload(quota: PhotoQuotaRow, requested: number): QuotaCheck {
  if (quota.limit === null || quota.remaining === null) {
    return { allowed: requested, blocked: 0, unlimited: true, remaining: null };
  }
  const allowed = Math.max(0, Math.min(requested, quota.remaining));
  return { allowed, blocked: requested - allowed, unlimited: false, remaining: quota.remaining };
}

/** Is the user close to the limit (for an "upgrade" hint)? */
export function isNearLimit(quota: PhotoQuotaRow, threshold = 0.8): boolean {
  return quota.limit !== null && quota.used >= Math.ceil(quota.limit * threshold);
}

/** Storage object path, matching the bucket policies: <tree_id>/<photos|documents>/<uuid>.<ext> */
export function mediaStoragePath(treeId: string, kind: "photo" | "document", fileId: string, ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${treeId}/${kind === "photo" ? "photos" : "documents"}/${fileId}.${clean}`;
}
