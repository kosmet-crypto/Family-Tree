import { env } from "@/server/env";
import { ApiError, json, route } from "@/server/http";
import { syncFromRevenueCat } from "@/server/services/billing";
import { adminClient, requireUser } from "@/server/supabase";

/** Refreshes the caller's plan from RevenueCat right after a purchase (before the webhook arrives). */
export const POST = route<unknown>(async (req) => {
  const { user } = await requireUser(req);
  if (!env.revenueCatSecretKey) throw new ApiError(503, "billing_not_configured");
  const result = await syncFromRevenueCat(adminClient(), user.id, {
    secretKey: env.revenueCatSecretKey,
    entitlement: env.revenueCatEntitlement,
  });
  return json(result);
});
