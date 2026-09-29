// RevenueCat → profiles.plan.
// The app configures RevenueCat with appUserID = Supabase user id, so webhook events
// (Google Play, App Store, Stripe/Web Billing alike) name our user directly.

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parsePhotoQuota } from "@/lib/media/quota";
import { unwrap } from "../http";
import type { Db } from "../supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const revenueCatEventSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string(),
  app_user_id: z.string().nullable().optional(),
  original_app_user_id: z.string().nullable().optional(),
  aliases: z.array(z.string()).nullable().optional(),
  entitlement_ids: z.array(z.string()).nullable().optional(),
  entitlement_id: z.string().nullable().optional(),
  expiration_at_ms: z.number().nullable().optional(),
  event_timestamp_ms: z.number().nullable().optional(),
  environment: z.string().nullable().optional(),
  transferred_from: z.array(z.string()).nullable().optional(),
  transferred_to: z.array(z.string()).nullable().optional(),
});
export const revenueCatWebhookSchema = z.looseObject({ event: revenueCatEventSchema });
export type RevenueCatEvent = z.infer<typeof revenueCatEventSchema>;

const GRANT = new Set([
  "INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT",
]);
/** Access continues until expiration; only the expiry date may change. */
const KEEP = new Set(["CANCELLATION", "BILLING_ISSUE", "SUBSCRIPTION_PAUSED"]);
const REVOKE = new Set(["EXPIRATION"]);

/** Constant-time check of the webhook Authorization header. */
export function webhookAuthorized(header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  const candidates = [header, header.replace(/^Bearer\s+/i, "")];
  const s = Buffer.from(secret);
  return candidates.some((c) => {
    const b = Buffer.from(c);
    return b.length === s.length && timingSafeEqual(b, s);
  });
}

export type PlanChange = { userId: string; plan: "free" | "premium"; expiresAt: string | null; keepPlan?: boolean };

/** Pure mapping of one event to plan changes (no I/O). */
export function planChangesFor(event: RevenueCatEvent, entitlement: string): PlanChange[] {
  const users = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
    .filter((u): u is string => !!u && UUID_RE.test(u))
    .map((u) => u.toLowerCase());
  const unique = [...new Set(users)];
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
  const hasEntitlement =
    (event.entitlement_ids ?? []).includes(entitlement) || event.entitlement_id === entitlement;

  if (event.type === "TRANSFER") {
    return (event.transferred_from ?? [])
      .filter((u) => UUID_RE.test(u))
      .map((u) => ({ userId: u.toLowerCase(), plan: "free" as const, expiresAt: null }));
  }
  if (!hasEntitlement || unique.length === 0) return [];
  if (GRANT.has(event.type)) return unique.map((userId) => ({ userId, plan: "premium" as const, expiresAt }));
  if (KEEP.has(event.type)) return unique.map((userId) => ({ userId, plan: "premium" as const, expiresAt, keepPlan: true }));
  if (REVOKE.has(event.type)) return unique.map((userId) => ({ userId, plan: "free" as const, expiresAt }));
  return [];
}

export interface WebhookOutcome {
  duplicate: boolean;
  applied: number;
  ignored?: string;
  /** users whose state must be refreshed from the RevenueCat API (e.g. transfer targets) */
  resync: string[];
}

/** Records the event (idempotent) and applies it with the service-role client. */
export async function handleRevenueCatEvent(
  admin: Db,
  event: RevenueCatEvent,
  opts: { entitlement: string; ignoreSandbox: boolean },
): Promise<WebhookOutcome> {
  const ins = await admin
    .from("billing_events")
    .upsert(
      { id: event.id, type: event.type, app_user_id: event.app_user_id ?? null, environment: event.environment ?? null, payload: event },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  const inserted = unwrap(ins) as unknown[];
  if (inserted.length === 0) return { duplicate: true, applied: 0, resync: [] };

  const resync = event.type === "TRANSFER"
    ? (event.transferred_to ?? []).filter((u) => UUID_RE.test(u)).map((u) => u.toLowerCase())
    : [];
  if (opts.ignoreSandbox && event.environment === "SANDBOX") {
    return { duplicate: false, applied: 0, ignored: "sandbox", resync: [] };
  }

  const eventAt = new Date(event.event_timestamp_ms ?? Date.now()).toISOString();
  let applied = 0;
  for (const change of planChangesFor(event, opts.entitlement)) {
    // Ignored when a newer event was already applied (webhooks may arrive out of order).
    const ok = unwrap(
      await admin.rpc("apply_plan_change", {
        p_user: change.userId,
        p_plan: change.plan,
        p_expires_at: change.expiresAt,
        p_event_at: eventAt,
        p_keep_plan: change.keepPlan ?? false,
      }),
    ) as boolean;
    if (ok) applied++;
  }
  if (applied > 0) {
    unwrap(await admin.from("billing_events").update({ applied: true }).eq("id", event.id));
  }
  return { duplicate: false, applied, resync };
}

/**
 * Pulls the current entitlement from the RevenueCat REST API and stores it.
 * Used right after a purchase (before the webhook arrives) and for transfer targets.
 */
export async function syncFromRevenueCat(
  admin: Db,
  userId: string,
  opts: { secretKey: string; entitlement: string; fetchImpl?: typeof fetch },
): Promise<{ plan: "free" | "premium"; expiresAt: string | null }> {
  const res = await (opts.fetchImpl ?? fetch)(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${opts.secretKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`RevenueCat API ${res.status}`);
  const body = (await res.json()) as { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } };
  const ent = body.subscriber?.entitlements?.[opts.entitlement];
  const expiresAt = ent?.expires_date ?? null;
  const active = !!ent && (expiresAt === null || new Date(expiresAt) > new Date());
  const plan = active ? "premium" : "free";
  unwrap(
    await admin
      .from("profiles")
      .update({ plan, plan_expires_at: active ? expiresAt : null, plan_event_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id"),
  );
  return { plan, expiresAt: active ? expiresAt : null };
}

/** What the app shows in Settings: plan and photo quota for the caller. */
export async function billingStatus(db: Db, userId: string) {
  const profile = unwrap(
    await db.from("profiles").select("plan, plan_expires_at").eq("id", userId).single(),
  ) as { plan: "free" | "premium"; plan_expires_at: string | null };
  const premium = unwrap(await db.rpc("is_premium", { p_user: userId })) as boolean;
  const quota = parsePhotoQuota(unwrap(await db.rpc("photo_quota", { p_user: userId })));
  return { plan: profile.plan, planExpiresAt: profile.plan_expires_at, premium, photos: quota };
}
