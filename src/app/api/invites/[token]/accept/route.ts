import { json, route, type Params } from "@/server/http";
import { acceptInvite, tokenParam } from "@/server/services/invites";
import { requireUser } from "@/server/supabase";

/** Signed-in user joins the tree. */
export const POST = route<Params<{ token: string }>>(async (req, { params }) => {
  const token = tokenParam((await params).token);
  const { supabase } = await requireUser(req);
  return json(await acceptInvite(supabase, token));
});
