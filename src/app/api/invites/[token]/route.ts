import { json, route, type Params } from "@/server/http";
import { previewInvite, tokenParam } from "@/server/services/invites";
import { clientFor } from "@/server/supabase";

/** Invitation preview for the landing page (works without signing in). */
export const GET = route<Params<{ token: string }>>(async (req, { params }) => {
  const token = tokenParam((await params).token);
  const supabase = await clientFor(req);
  return json({ invite: await previewInvite(supabase, token) });
});
