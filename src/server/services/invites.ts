// Invitations, membership and tree merging. All calls run as the signed-in user (RLS).

import { z } from "zod";
import type { Invitation, TreeMember, TreeRole } from "@/lib/types/db";
import { ApiError, unwrap } from "../http";
import type { Db } from "../supabase";

export const createInviteSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()).nullable().optional(),
  role: z.enum(["viewer", "editor"]).default("viewer"),
  message: z.string().trim().max(500).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

/** Tokens are 24 random bytes as hex (see invitations.token default). */
export function tokenParam(token: string): string {
  if (!/^[0-9a-f]{48}$/.test(token)) throw new ApiError(404, "invite_not_found");
  return token;
}

export const inviteUrl = (appUrl: string, token: string) => `${appUrl}/invite?token=${token}`;

type PublicInvitation = Omit<Invitation, "token"> & { url: string | null };

function present(inv: Invitation, appUrl: string): PublicInvitation {
  const { token, ...rest } = inv;
  const expired = inv.status === "pending" && new Date(inv.expires_at) <= new Date();
  return {
    ...rest,
    status: expired ? "expired" : inv.status,
    // the link is only useful while the invitation can still be accepted
    url: inv.status === "pending" && !expired ? inviteUrl(appUrl, token) : null,
  };
}

export async function createInvite(db: Db, treeId: string, input: CreateInviteInput, appUrl: string) {
  const data = createInviteSchema.parse(input);
  const row = unwrap(
    await db
      .from("invitations")
      .insert({
        tree_id: treeId,
        email: data.email ?? null,
        role: data.role,
        message: data.message ?? null,
        expires_at: new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString(),
      })
      .select("*")
      .single(),
  ) as Invitation;
  return present(row, appUrl);
}

export async function listInvites(db: Db, treeId: string, appUrl: string) {
  const rows = unwrap(
    await db.from("invitations").select("*").eq("tree_id", treeId).order("created_at", { ascending: false }),
  ) as Invitation[];
  return rows.map((r) => present(r, appUrl));
}

export async function revokeInvite(db: Db, treeId: string, inviteId: string) {
  const rows = unwrap(
    await db
      .from("invitations")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("tree_id", treeId)
      .eq("status", "pending")
      .select("id"),
  ) as { id: string }[];
  if (rows.length === 0) throw new ApiError(404, "invite_not_found_or_not_pending");
}

export interface InvitePreview {
  tree_name: string;
  inviter_name: string | null;
  role: TreeRole;
  status: Invitation["status"];
  expires_at: string;
  email_locked: boolean;
}

export async function previewInvite(db: Db, token: string): Promise<InvitePreview> {
  const rows = unwrap(await db.rpc("get_invitation", { p_token: token })) as InvitePreview[];
  if (!rows?.length) throw new ApiError(404, "invite_not_found");
  return rows[0]!;
}

export async function acceptInvite(db: Db, token: string): Promise<{ treeId: string }> {
  const treeId = unwrap(await db.rpc("accept_invitation", { p_token: token })) as string;
  return { treeId };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(db: Db, treeId: string) {
  const members = unwrap(
    await db.from("tree_members").select("*").eq("tree_id", treeId).order("joined_at"),
  ) as TreeMember[];
  const ids = members.map((m) => m.user_id);
  const profiles = ids.length
    ? (unwrap(await db.from("profiles").select("id, display_name, avatar_url").in("id", ids)) as {
        id: string; display_name: string | null; avatar_url: string | null;
      }[])
    : [];
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return members.map((m) => ({
    ...m,
    display_name: byId.get(m.user_id)?.display_name ?? null,
    avatar_url: byId.get(m.user_id)?.avatar_url ?? null,
  }));
}

export const updateMemberSchema = z.object({ role: z.enum(["viewer", "editor"]) });

export async function updateMemberRole(db: Db, treeId: string, userId: string, role: "viewer" | "editor") {
  const rows = unwrap(
    await db.from("tree_members").update({ role }).eq("tree_id", treeId).eq("user_id", userId).select("user_id"),
  ) as unknown[];
  if (rows.length === 0) throw new ApiError(404, "member_not_found");
}

/** Owner removes a member, or a member leaves (userId = self). */
export async function removeMember(db: Db, treeId: string, userId: string) {
  const rows = unwrap(
    await db.from("tree_members").delete().eq("tree_id", treeId).eq("user_id", userId).select("user_id"),
  ) as unknown[];
  if (rows.length === 0) throw new ApiError(404, "member_not_found");
}

// ---------------------------------------------------------------------------
// Merge another tree into this one
// ---------------------------------------------------------------------------

export const mergeSchema = z.object({
  sourceTreeId: z.uuid(),
  /** { "<source person id>": "<target person id>" } for people present in both trees */
  personMap: z.record(z.uuid(), z.uuid()).default({}),
});

export interface MergeResult {
  persons_added: number;
  persons_linked: number;
  parent_child_added: number;
  partnerships_added: number;
  media_linked: number;
}

export async function mergeTrees(db: Db, targetTreeId: string, input: z.input<typeof mergeSchema>): Promise<MergeResult> {
  const data = mergeSchema.parse(input);
  return unwrap(
    await db.rpc("merge_trees", { p_source: data.sourceTreeId, p_target: targetTreeId, p_person_map: data.personMap }),
  ) as MergeResult;
}
