// App-wide settings read from env (NEXT_PUBLIC_* are available in the browser).
// The authoritative photo limit lives in the database (public.app_settings); this value
// is only used for UI hints before the server answers.

function intOrNull(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "" || v === "off") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const config = {
  /** Free-plan photo limit; null = switched off (test phase). */
  freePhotoLimit: intOrNull(process.env.NEXT_PUBLIC_FREE_PHOTO_LIMIT),
  storageBucket: "family-media",
  /** Must match storage.buckets.file_size_limit */
  maxUploadBytes: 20 * 1024 * 1024,
} as const;
