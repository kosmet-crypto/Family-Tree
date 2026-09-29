import { env } from "@/server/env";
import { json, parseJson, route, uuidParam, type Params } from "@/server/http";
import { createInvite, createInviteSchema, listInvites } from "@/server/services/invites";
import { requireUser } from "@/server/supabase";

type P = Params<{ treeId: string }>;

/** Pending and past invitations of a tree (owners and editors). */
export const GET = route<P>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  return json({ invites: await listInvites(supabase, treeId, env.appUrl) });
});

/** Creates an invitation; the response contains the link to share. */
export const POST = route<P>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  const input = await parseJson(req, createInviteSchema);
  return json({ invite: await createInvite(supabase, treeId, input, env.appUrl) }, 201);
});
