import { env } from "@/server/env";
import { json, parseJson, route } from "@/server/http";
import { handleRevenueCatEvent, revenueCatWebhookSchema, syncFromRevenueCat, webhookAuthorized } from "@/server/services/billing";
import { adminClient } from "@/server/supabase";

/**
 * RevenueCat webhook. Configure in RevenueCat: URL <app>/api/webhooks/revenuecat and an
 * Authorization header equal to REVENUECAT_WEBHOOK_AUTH.
 */
export const POST = route<unknown>(async (req) => {
  if (!webhookAuthorized(req.headers.get("authorization"), env.revenueCatWebhookAuth)) {
    return json({ error: "unauthorized" }, 401);
  }
  const { event } = await parseJson(req, revenueCatWebhookSchema);
  const admin = adminClient();
  const outcome = await handleRevenueCatEvent(admin, event, {
    entitlement: env.revenueCatEntitlement,
    ignoreSandbox: env.revenueCatIgnoreSandbox,
  });
  if (env.revenueCatSecretKey) {
    for (const userId of outcome.resync) {
      await syncFromRevenueCat(admin, userId, { secretKey: env.revenueCatSecretKey, entitlement: env.revenueCatEntitlement })
        .catch((e) => console.error("RevenueCat resync failed", userId, e));
    }
  }
  return json(outcome);
});
