-- Roots & Branches — Phase 1 / Row Level Security, column grants, Realtime
-- Roles per tree: viewer (read), editor (read + edit people/relations/media), owner (all).
-- Column-level grants stop clients from writing server-owned fields
-- (billing plan, owner_id, uploaded_by, is_copy, tree_id moves, ...).

alter table public.profiles       enable row level security;
alter table public.trees          enable row level security;
alter table public.tree_members   enable row level security;
alter table public.persons        enable row level security;
alter table public.parent_child   enable row level security;
alter table public.partnerships   enable row level security;
alter table public.media          enable row level security;
alter table public.invitations    enable row level security;
alter table public.tree_snapshots enable row level security;

-- Start from nothing for API roles, then grant exactly what the app needs.
revoke all on
  public.profiles, public.trees, public.tree_members, public.persons, public.parent_child,
  public.partnerships, public.media, public.invitations, public.tree_snapshots, public.person_siblings
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, locale, entry_mode, auto_backup) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (  -- co-members of any shared tree can see each other's name/avatar
      select 1 from public.tree_members me
      join public.tree_members other on other.tree_id = me.tree_id
      where me.user_id = auth.uid() and other.user_id = public.profiles.id
    )
  );

create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- trees
-- ---------------------------------------------------------------------------
grant select, delete on public.trees to authenticated;
grant insert (id, name, description, entry_mode) on public.trees to authenticated;
grant update (name, description, entry_mode, root_person_id) on public.trees to authenticated;

create policy trees_select on public.trees for select to authenticated
  using (public.has_tree_role(id, 'viewer'));
create policy trees_insert on public.trees for insert to authenticated
  with check (owner_id = auth.uid());
create policy trees_update on public.trees for update to authenticated
  using (public.has_tree_role(id, 'owner')) with check (public.has_tree_role(id, 'owner'));
create policy trees_delete on public.trees for delete to authenticated
  using (public.has_tree_role(id, 'owner'));

-- ---------------------------------------------------------------------------
-- tree_members (joining happens only through accept_invitation / tree creation)
-- ---------------------------------------------------------------------------
grant select, delete on public.tree_members to authenticated;
grant update (role) on public.tree_members to authenticated;

create policy tree_members_select on public.tree_members for select to authenticated
  using (public.has_tree_role(tree_id, 'viewer'));
create policy tree_members_update on public.tree_members for update to authenticated
  using (public.has_tree_role(tree_id, 'owner')) with check (public.has_tree_role(tree_id, 'owner'));
create policy tree_members_delete on public.tree_members for delete to authenticated
  using (user_id = auth.uid() or public.has_tree_role(tree_id, 'owner'));

-- ---------------------------------------------------------------------------
-- persons / parent_child / partnerships: viewers read, editors write
-- ---------------------------------------------------------------------------
grant select, delete on public.persons, public.parent_child, public.partnerships to authenticated;

grant insert (id, tree_id, first_name, middle_name, last_name, birth_name, nickname, gender,
              birth_date, birth_date_precision, birth_place, is_living, death_date, death_date_precision,
              death_place, occupation, bio, notes, avatar_media_id, extra)
  on public.persons to authenticated;
grant update (first_name, middle_name, last_name, birth_name, nickname, gender,
              birth_date, birth_date_precision, birth_place, is_living, death_date, death_date_precision,
              death_place, occupation, bio, notes, avatar_media_id, extra)
  on public.persons to authenticated;

grant insert (id, tree_id, parent_id, child_id, relation, start_date, notes) on public.parent_child to authenticated;
grant update (relation, start_date, notes) on public.parent_child to authenticated;

grant insert (id, tree_id, person1_id, person2_id, kind, status, start_date, start_place, end_date, sort_order, notes)
  on public.partnerships to authenticated;
grant update (kind, status, start_date, start_place, end_date, sort_order, notes)
  on public.partnerships to authenticated;

create policy persons_select on public.persons for select to authenticated
  using (public.has_tree_role(tree_id, 'viewer'));
create policy persons_insert on public.persons for insert to authenticated
  with check (public.has_tree_role(tree_id, 'editor'));
create policy persons_update on public.persons for update to authenticated
  using (public.has_tree_role(tree_id, 'editor')) with check (public.has_tree_role(tree_id, 'editor'));
create policy persons_delete on public.persons for delete to authenticated
  using (public.has_tree_role(tree_id, 'editor'));

create policy parent_child_select on public.parent_child for select to authenticated
  using (public.has_tree_role(tree_id, 'viewer'));
create policy parent_child_insert on public.parent_child for insert to authenticated
  with check (public.has_tree_role(tree_id, 'editor'));
create policy parent_child_update on public.parent_child for update to authenticated
  using (public.has_tree_role(tree_id, 'editor')) with check (public.has_tree_role(tree_id, 'editor'));
create policy parent_child_delete on public.parent_child for delete to authenticated
  using (public.has_tree_role(tree_id, 'editor'));

create policy partnerships_select on public.partnerships for select to authenticated
  using (public.has_tree_role(tree_id, 'viewer'));
create policy partnerships_insert on public.partnerships for insert to authenticated
  with check (public.has_tree_role(tree_id, 'editor'));
create policy partnerships_update on public.partnerships for update to authenticated
  using (public.has_tree_role(tree_id, 'editor')) with check (public.has_tree_role(tree_id, 'editor'));
create policy partnerships_delete on public.partnerships for delete to authenticated
  using (public.has_tree_role(tree_id, 'editor'));

grant select on public.person_siblings to authenticated;

-- ---------------------------------------------------------------------------
-- media
-- ---------------------------------------------------------------------------
grant select, delete on public.media to authenticated;
grant insert (id, tree_id, person_id, kind, storage_path, mime_type, size_bytes, width, height, caption, taken_on)
  on public.media to authenticated;
grant update (person_id, caption, taken_on) on public.media to authenticated;

create policy media_select on public.media for select to authenticated
  using (public.has_tree_role(tree_id, 'viewer'));
create policy media_insert on public.media for insert to authenticated
  with check (public.has_tree_role(tree_id, 'editor') and uploaded_by = auth.uid());
create policy media_update on public.media for update to authenticated
  using (public.has_tree_role(tree_id, 'editor')) with check (public.has_tree_role(tree_id, 'editor'));
create policy media_delete on public.media for delete to authenticated
  using (public.has_tree_role(tree_id, 'editor'));

-- ---------------------------------------------------------------------------
-- invitations: owners invite any role, editors invite viewers
-- ---------------------------------------------------------------------------
grant select on public.invitations to authenticated;
grant insert (tree_id, email, role, message, expires_at) on public.invitations to authenticated;
grant update (status) on public.invitations to authenticated;

create policy invitations_select on public.invitations for select to authenticated
  using (public.has_tree_role(tree_id, 'editor'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    invited_by = auth.uid()
    and status = 'pending'
    and (public.has_tree_role(tree_id, 'owner')
         or (public.has_tree_role(tree_id, 'editor') and role = 'viewer'))
  );
-- Only revoking is allowed from the client (accepting goes through accept_invitation).
create policy invitations_update on public.invitations for update to authenticated
  using (status = 'pending'
         and (public.has_tree_role(tree_id, 'owner') or invited_by = auth.uid()))
  with check (status = 'revoked');

-- ---------------------------------------------------------------------------
-- tree_snapshots
-- ---------------------------------------------------------------------------
grant select, delete on public.tree_snapshots to authenticated;
grant insert (tree_id, kind, label, data) on public.tree_snapshots to authenticated;

create policy tree_snapshots_select on public.tree_snapshots for select to authenticated
  using (public.has_tree_role(tree_id, 'editor'));
create policy tree_snapshots_insert on public.tree_snapshots for insert to authenticated
  with check (public.has_tree_role(tree_id, 'editor') and created_by = auth.uid());
create policy tree_snapshots_delete on public.tree_snapshots for delete to authenticated
  using (public.has_tree_role(tree_id, 'owner'));

-- ---------------------------------------------------------------------------
-- Functions: nothing is callable by anon except the invitation preview.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

grant execute on function
  public.try_uuid(text),
  public.is_premium(uuid),
  public.tree_role_of(uuid),
  public.has_tree_role(uuid, public.tree_role),
  public.free_photo_limit(),
  public.photo_count(uuid),
  public.photo_quota(uuid),
  public.can_upload_photo(uuid),
  public.accept_invitation(text),
  public.get_ancestors(uuid, integer),
  public.get_descendants(uuid, integer),
  public.export_tree(uuid),
  public.create_snapshot(uuid, public.snapshot_kind, text),
  public.auto_snapshot(uuid),
  public.restore_tree(uuid, jsonb),
  public.merge_trees(uuid, uuid, jsonb)
  to authenticated;

grant execute on function public.get_invitation(text) to anon, authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes respects RLS)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime
  add table public.trees, public.tree_members, public.persons,
            public.parent_child, public.partnerships, public.media;
