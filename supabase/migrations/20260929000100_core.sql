-- Roots & Branches — Phase 1 / core
-- Extensions, enums, shared helpers, profiles, trees and tree membership.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (order matters for tree_role: viewer < editor < owner)
-- ---------------------------------------------------------------------------
create type public.tree_role          as enum ('viewer', 'editor', 'owner');
create type public.plan_tier          as enum ('free', 'premium');
create type public.entry_mode         as enum ('simple', 'complex');
create type public.gender             as enum ('male', 'female', 'other', 'unknown');
create type public.date_precision     as enum ('exact', 'month', 'year', 'about', 'before', 'after');
create type public.parent_relation    as enum ('biological', 'adoptive', 'step', 'foster', 'guardian');
create type public.partnership_kind   as enum ('marriage', 'civil_union', 'partnership', 'engagement');
create type public.partnership_status as enum ('active', 'divorced', 'separated', 'widowed', 'annulled');
create type public.media_kind         as enum ('photo', 'document');
create type public.invite_status      as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.snapshot_kind      as enum ('manual', 'auto', 'pre_restore', 'pre_merge');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Casts text to uuid without raising (used by storage policies on user-supplied paths).
create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  display_name           text check (char_length(display_name) <= 120),
  avatar_url             text,
  locale                 text not null default 'sr' check (char_length(locale) <= 10),
  entry_mode             public.entry_mode not null default 'simple',
  auto_backup            boolean not null default true,
  -- Billing fields: written only by the service role (RevenueCat webhook), see grants.
  plan                   public.plan_tier not null default 'free',
  plan_expires_at        timestamptz,
  revenuecat_customer_id text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_premium(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.plan = 'premium' and (p.plan_expires_at is null or p.plan_expires_at > now())
       from public.profiles p
      where p.id = p_user
        and (auth.uid() is null or p_user = auth.uid())),  -- users may only ask about themselves
    false);
$$;

-- ---------------------------------------------------------------------------
-- Trees and membership
-- ---------------------------------------------------------------------------
create table public.trees (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  description    text check (char_length(description) <= 2000),
  entry_mode     public.entry_mode not null default 'simple',
  root_person_id uuid,  -- FK added in the people migration
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index trees_owner_idx on public.trees (owner_id);

create trigger trees_updated_at
  before update on public.trees
  for each row execute function public.set_updated_at();

create table public.tree_members (
  tree_id    uuid not null references public.trees (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.tree_role not null default 'viewer',
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (tree_id, user_id)
);

create index tree_members_user_idx on public.tree_members (user_id);

-- Exactly one owner row per tree, always the trees.owner_id.
create unique index tree_members_one_owner on public.tree_members (tree_id) where role = 'owner';

create or replace function public.add_tree_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tree_members (tree_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger trees_add_owner
  after insert on public.trees
  for each row execute function public.add_tree_owner();

-- Owner membership cannot be changed or removed while the tree exists.
create or replace function public.protect_owner_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' and exists (select 1 from public.trees t where t.id = old.tree_id) then
      raise exception 'The tree owner cannot leave or be removed' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (old.role = 'owner') <> (new.role = 'owner') then
    raise exception 'Ownership cannot be changed through membership roles' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger tree_members_protect_owner
  before update or delete on public.tree_members
  for each row execute function public.protect_owner_membership();

-- Role of the current user in a tree (null when not a member).
-- SECURITY DEFINER so RLS policies can call it without recursing into tree_members RLS.
create or replace function public.tree_role_of(p_tree uuid)
returns public.tree_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.tree_members m
   where m.tree_id = p_tree and m.user_id = auth.uid();
$$;

create or replace function public.has_tree_role(p_tree uuid, p_min public.tree_role default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.tree_role_of(p_tree) >= p_min, false);
$$;
