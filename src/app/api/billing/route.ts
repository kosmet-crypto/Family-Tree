import { json, route } from "@/server/http";
import { billingStatus } from "@/server/services/billing";
import { requireUser } from "@/server/supabase";

/** Plan and photo quota of the signed-in user. */
export const GET = route<unknown>(async (req) => {
  const { supabase, user } = await requireUser(req);
  return json(await billingStatus(supabase, user.id));
});
