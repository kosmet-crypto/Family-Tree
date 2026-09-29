-- Roots & Branches — Phase 1 / invitations (sharing trees)
-- Flow: an owner/editor creates an invitation -> link with token -> invitee signs in and
-- calls accept_invitation(token) -> becomes a tree member. Merging an invitee's own tree
-- into the shared one is done afterwards with merge_trees() (backup migration).

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references public.trees (id) on delete cascade,
  invited_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  email       text check (email is null or email = lower(email) and email like '%_@_%'),
  role        public.tree_role not null default 'viewer' check (role <> 'owner'),
  token       text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  message     text check (char_length(message) <= 500),
  status      public.invite_status not null default 'pending',
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint invitations_expiry_window
    check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

create index invitations_tree_idx on public.invitations (tree_id);
create index invitations_email_idx on public.invitations (email) where status = 'pending';

-- Public preview of an invitation (for the landing page before sign-in).
create or replace function public.get_invitation(p_token text)
returns table (
  tree_name    text,
  inviter_name text,
  role         public.tree_role,
  status       public.invite_status,
  expires_at   timestamptz,
  email_locked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name,
         p.display_name,
         i.role,
         case when i.status = 'pending' and i.expires_at <= now()
              then 'expired'::public.invite_status else i.status end,
         i.expires_at,
         i.email is not null
    from public.invitations i
    join public.trees t on t.id = i.tree_id
    left join public.profiles p on p.id = i.invited_by
   where i.token = p_token;
$$;

-- Accepts an invitation for the signed-in user; returns the tree id.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv   public.invitations;
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_uid is null then
    raise exception 'Sign in to accept the invitation' using errcode = '28000';
  end if;

  select * into v_inv from public.invitations where token = p_token for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002', hint = 'invite_not_found';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is %', v_inv.status using errcode = 'P0001', hint = 'invite_not_pending';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Invitation has expired' using errcode = 'P0001', hint = 'invite_expired';
  end if;
  if v_inv.email is not null and v_inv.email <> v_email then
    raise exception 'Invitation was sent to a different email address'
      using errcode = '42501', hint = 'invite_email_mismatch';
  end if;

  -- Join, or upgrade an existing lower role (never downgrade, never touch the owner).
  insert into public.tree_members (tree_id, user_id, role, invited_by)
  values (v_inv.tree_id, v_uid, v_inv.role, v_inv.invited_by)
  on conflict (tree_id, user_id) do update
     set role = excluded.role
   where public.tree_members.role < excluded.role;

  update public.invitations
     set status = 'accepted', accepted_by = v_uid, accepted_at = now()
   where id = v_inv.id;

  return v_inv.tree_id;
end;
$$;
