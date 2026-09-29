// Row types mirroring supabase/migrations. Keep in sync when the schema changes.

export type Uuid = string;
/** ISO date "YYYY-MM-DD" */
export type IsoDate = string;

export type TreeRole = "viewer" | "editor" | "owner";
export type PlanTier = "free" | "premium";
export type EntryMode = "simple" | "complex";
export type Gender = "male" | "female" | "other" | "unknown";
export type DatePrecision = "exact" | "month" | "year" | "about" | "before" | "after";
export type ParentRelation = "biological" | "adoptive" | "step" | "foster" | "guardian";
export type PartnershipKind = "marriage" | "civil_union" | "partnership" | "engagement";
export type PartnershipStatus = "active" | "divorced" | "separated" | "widowed" | "annulled";
export type MediaKind = "photo" | "document";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";
export type SnapshotKind = "manual" | "auto" | "pre_restore" | "pre_merge";
export type SiblingType = "full" | "half" | "adoptive" | "step";

export const TREE_ROLES: readonly TreeRole[] = ["viewer", "editor", "owner"];
export const GENDERS: readonly Gender[] = ["male", "female", "other", "unknown"];
export const DATE_PRECISIONS: readonly DatePrecision[] = ["exact", "month", "year", "about", "before", "after"];
export const PARENT_RELATIONS: readonly ParentRelation[] = ["biological", "adoptive", "step", "foster", "guardian"];
export const PARTNERSHIP_KINDS: readonly PartnershipKind[] = ["marriage", "civil_union", "partnership", "engagement"];
export const PARTNERSHIP_STATUSES: readonly PartnershipStatus[] = ["active", "divorced", "separated", "widowed", "annulled"];

export interface Profile {
  id: Uuid;
  display_name: string | null;
  avatar_url: string | null;
  locale: string;
  entry_mode: EntryMode;
  auto_backup: boolean;
  plan: PlanTier;
  plan_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tree {
  id: Uuid;
  owner_id: Uuid;
  name: string;
  description: string | null;
  entry_mode: EntryMode;
  root_person_id: Uuid | null;
  created_at: string;
  updated_at: string;
}

export interface TreeMember {
  tree_id: Uuid;
  user_id: Uuid;
  role: TreeRole;
  invited_by: Uuid | null;
  joined_at: string;
}

export interface Person {
  id: Uuid;
  tree_id: Uuid;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  birth_name: string | null;
  nickname: string | null;
  gender: Gender;
  birth_date: IsoDate | null;
  birth_date_precision: DatePrecision;
  birth_place: string | null;
  is_living: boolean;
  death_date: IsoDate | null;
  death_date_precision: DatePrecision;
  death_place: string | null;
  occupation: string | null;
  bio: string | null;
  notes: string | null;
  avatar_media_id: Uuid | null;
  extra: Record<string, unknown>;
  created_by?: Uuid | null;
  created_at?: string;
  updated_at?: string;
}

export interface ParentChild {
  id: Uuid;
  tree_id: Uuid;
  parent_id: Uuid;
  child_id: Uuid;
  relation: ParentRelation;
  start_date: IsoDate | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Partnership {
  id: Uuid;
  tree_id: Uuid;
  person1_id: Uuid;
  person2_id: Uuid;
  kind: PartnershipKind;
  status: PartnershipStatus;
  start_date: IsoDate | null;
  start_place: string | null;
  end_date: IsoDate | null;
  sort_order: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Media {
  id: Uuid;
  tree_id: Uuid;
  person_id: Uuid | null;
  kind: MediaKind;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  taken_on: IsoDate | null;
  uploaded_by?: Uuid | null;
  is_copy: boolean;
  created_at?: string;
}

export interface Invitation {
  id: Uuid;
  tree_id: Uuid;
  invited_by: Uuid;
  email: string | null;
  role: Exclude<TreeRole, "owner">;
  token: string;
  message: string | null;
  status: InviteStatus;
  expires_at: string;
  accepted_by: Uuid | null;
  accepted_at: string | null;
  created_at: string;
}

/** jsonb returned by public.photo_quota() */
export interface PhotoQuotaRow {
  used: number;
  limit: number | null;
  remaining: number | null;
  premium: boolean;
}
