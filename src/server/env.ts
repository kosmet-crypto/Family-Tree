// Server-side environment. Read lazily so tests can set process.env before the first call.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  /** Service role key: server only, never exposed to the browser. */
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  /** Public base URL used in invitation links. */
  get appUrl() {
    return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  /** Value RevenueCat sends in the Authorization header of webhooks. */
  get revenueCatWebhookAuth() {
    return process.env.REVENUECAT_WEBHOOK_AUTH ?? "";
  },
  /** Secret (sk_...) REST API key, optional: enables /api/billing/sync. */
  get revenueCatSecretKey() {
    return process.env.REVENUECAT_SECRET_API_KEY ?? "";
  },
  get revenueCatEntitlement() {
    return process.env.REVENUECAT_ENTITLEMENT_ID ?? "premium";
  },
  get revenueCatIgnoreSandbox() {
    return process.env.REVENUECAT_IGNORE_SANDBOX === "true";
  },
  /** Upper bound for a ZIP backup built in memory. */
  get backupZipMaxBytes() {
    return Number(process.env.BACKUP_ZIP_MAX_BYTES ?? 300 * 1024 * 1024);
  },
};
