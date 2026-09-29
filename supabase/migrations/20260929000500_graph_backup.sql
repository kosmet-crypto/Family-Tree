-- Roots & Branches — Phase 1 / recursive graph queries, backup snapshots, restore, merge

-- ---------------------------------------------------------------------------
-- Recursive traversal (SECURITY INVOKER: RLS applies to the caller)
-- ---------------------------------------------------------------------------
create or replace function public.get_ancestors(p_person uuid, p_max_depth integer default 30)
returns table (person_id uuid, depth integer, relation public.parent_relation, child_id uuid)
language sql
stable
set search_path = ''
as $$
  with recursive up(person_id, depth, relation, child_id, path) as (
    select pc.parent_id, 1, pc.relation, pc.child_id, array[pc.child_id, pc.parent_id]
      from public.parent_child pc
     where pc.child_id = p_person
    union all
    select pc.parent_id, up.depth + 1, pc.relation, pc.child_id, up.path || pc.parent_id
      from public.parent_child pc
      join up on pc.child_id = up.person_id
     where up.depth < p_max_depth
       and not pc.parent_id = any (up.path)
  )
  select person_id, depth, relation, child_id from up;
$$;

create or replace function public.get_descendants(p_person uuid, p_max_depth integer default 30)
returns table (person_id uuid, depth integer, relation public.parent_relation, parent_id uuid)
language sql
stable
set search_path = ''
as $$
  with recursive down(person_id, depth, relation, parent_id, path) as (
    select pc.child_id, 1, pc.relation, pc.parent_id, array[pc.parent_id, pc.child_id]
      from public.parent_child pc
     where pc.parent_id = p_person
    union all
    select pc.child_id, down.depth + 1, pc.relation, pc.parent_id, down.path || pc.child_id
      from public.parent_child pc
      join down on pc.parent_id = down.person_id
     where down.depth < p_max_depth
       and not pc.child_id = any (down.path)
  )
  select person_id, depth, relation, parent_id from down;
$$;

-- Whole tree as one JSON document (nodes + edges) for the canvas and for backups.
create or replace function public.export_tree(p_tree uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'format',       'roots-branches',
    'version',      1,
    'exported_at',  now(),
    'tree',         (select to_jsonb(t) - 'owner_id' from public.trees t where t.id = p_tree),
    'persons',      coalesce((select jsonb_agg(to_jsonb(p) - 'search_text' - 'created_by' order by p.created_at)
                                from public.persons p where p.tree_id = p_tree), '[]'::jsonb),
    'parent_child', coalesce((select jsonb_agg(to_jsonb(pc) order by pc.created_at)
                                from public.parent_child pc where pc.tree_id = p_tree), '[]'::jsonb),
    'partnerships', coalesce((select jsonb_agg(to_jsonb(pa) order by pa.created_at)
                                from public.partnerships pa where pa.tree_id = p_tree), '[]'::jsonb),
    'media',        coalesce((select jsonb_agg(to_jsonb(m) - 'uploaded_by' order by m.created_at)
                                from public.media m where m.tree_id = p_tree), '[]'::jsonb)
  )
  where exists (select 1 from public.trees t where t.id = p_tree);
$$;

-- ---------------------------------------------------------------------------
-- Snapshots (manual + automatic backups stored in the database)
-- ---------------------------------------------------------------------------
create table public.tree_snapshots (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references public.trees (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  kind       public.snapshot_kind not null default 'manual',
  label      text check (char_length(label) <= 120),
  data       jsonb not null,
  person_count integer generated always as (jsonb_array_length(data -> 'persons')) stored,
  created_at timestamptz not null default now(),
  constraint tree_snapshots_format check (data ->> 'format' = 'roots-branches')
);

create index tree_snapshots_tree_idx on public.tree_snapshots (tree_id, created_at desc);

-- Keep the newest 10 snapshots per tree and kind (manual ones are kept up to 50).
create or replace function public.prune_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tree_snapshots s
   where s.tree_id = new.tree_id and s.kind = new.kind
     and s.id in (
       select id from public.tree_snapshots
        where tree_id = new.tree_id and kind = new.kind
        order by created_at desc, id
        offset case when new.kind = 'manual' then 50 else 10 end
     );
  return null;
end;
$$;

create trigger tree_snapshots_prune
  after insert on public.tree_snapshots
  for each row execute function public.prune_snapshots();

create or replace function public.create_snapshot(
  p_tree uuid,
  p_kind public.snapshot_kind default 'manual',
  p_label text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_data jsonb := public.export_tree(p_tree);
begin
  if v_data is null then
    raise exception 'Tree not found' using errcode = 'P0002';
  end if;
  insert into public.tree_snapshots (tree_id, kind, label, data)
  values (p_tree, p_kind, p_label, v_data)
  returning id into v_id;
  return v_id;
end;
$$;

-- Automatic backup: at most one per 24h per tree, only if something changed since the last one.
-- Call from the client on app start, or schedule with pg_cron (see supabase/README.md).
create or replace function public.auto_snapshot(p_tree uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_last timestamptz;
  v_changed timestamptz;
begin
  if not public.has_tree_role(p_tree, 'editor') and auth.uid() is not null then
    return null;
  end if;
  select max(created_at) into v_last from public.tree_snapshots where tree_id = p_tree and kind = 'auto';
  select updated_at into v_changed from public.trees where id = p_tree;
  if v_changed is null or (v_last is not null and (v_last > now() - interval '24 hours' or v_last >= v_changed)) then
    return null;
  end if;
  return public.create_snapshot(p_tree, 'auto');
end;
$$;

-- ---------------------------------------------------------------------------
-- Restore: replaces people and relations of a tree with a backup document.
-- A 'pre_restore' snapshot is taken first so a restore can itself be undone.
-- Media rows are kept (files live in Storage); person links and captions are restored.
-- ---------------------------------------------------------------------------
create or replace function public.restore_tree(p_tree uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer  -- keeps ids/created_at from the backup; access is checked below
set search_path = ''
as $$
declare
  v_persons int;
  v_edges int;
  v_partners int;
begin
  if not public.has_tree_role(p_tree, 'owner') then
    raise exception 'Only the tree owner can restore a backup' using errcode = '42501';
  end if;
  if p_data ->> 'format' is distinct from 'roots-branches' or (p_data ->> 'version')::int > 1 then
    raise exception 'Unsupported backup format' using errcode = '22023', hint = 'bad_backup_format';
  end if;

  perform public.create_snapshot(p_tree, 'pre_restore');

  update public.trees set root_person_id = null where id = p_tree;
  delete from public.persons where tree_id = p_tree;  -- cascades to edges, unlinks media

  insert into public.persons (
    id, tree_id, first_name, middle_name, last_name, birth_name, nickname, gender,
    birth_date, birth_date_precision, birth_place, is_living, death_date, death_date_precision,
    death_place, occupation, bio, notes, extra, created_at
  )
  select r.id, p_tree, coalesce(r.first_name, ''), r.middle_name, r.last_name, r.birth_name, r.nickname,
         coalesce(r.gender, 'unknown'), r.birth_date, coalesce(r.birth_date_precision, 'exact'),
         r.birth_place, coalesce(r.is_living, true), r.death_date,
         coalesce(r.death_date_precision, 'exact'), r.death_place, r.occupation, r.bio, r.notes,
         coalesce(r.extra, '{}'::jsonb), coalesce(r.created_at, now())
    from jsonb_populate_recordset(null::public.persons, coalesce(p_data -> 'persons', '[]')) r;
  get diagnostics v_persons = row_count;

  insert into public.parent_child (id, tree_id, parent_id, child_id, relation, start_date, notes, created_at)
  select r.id, p_tree, r.parent_id, r.child_id, coalesce(r.relation, 'biological'), r.start_date, r.notes,
         coalesce(r.created_at, now())
    from jsonb_populate_recordset(null::public.parent_child, coalesce(p_data -> 'parent_child', '[]')) r;
  get diagnostics v_edges = row_count;

  insert into public.partnerships (id, tree_id, person1_id, person2_id, kind, status, start_date,
                                   start_place, end_date, sort_order, notes, created_at)
  select r.id, p_tree, r.person1_id, r.person2_id, coalesce(r.kind, 'marriage'), coalesce(r.status, 'active'),
         r.start_date, r.start_place, r.end_date, coalesce(r.sort_order, 0), r.notes, coalesce(r.created_at, now())
    from jsonb_populate_recordset(null::public.partnerships, coalesce(p_data -> 'partnerships', '[]')) r;
  get diagnostics v_partners = row_count;

  -- Re-link media that still exists in this tree.
  update public.media m
     set person_id = r.person_id, caption = r.caption, taken_on = r.taken_on
    from jsonb_populate_recordset(null::public.media, coalesce(p_data -> 'media', '[]')) r
   where m.id = r.id and m.tree_id = p_tree
     and (r.person_id is null or exists (select 1 from public.persons p where p.id = r.person_id and p.tree_id = p_tree));

  update public.persons p
     set avatar_media_id = r.avatar_media_id
    from jsonb_populate_recordset(null::public.persons, coalesce(p_data -> 'persons', '[]')) r
   where p.id = r.id and p.tree_id = p_tree and r.avatar_media_id is not null
     and exists (select 1 from public.media m where m.id = r.avatar_media_id and m.tree_id = p_tree);

  update public.trees t
     set root_person_id = (p_data -> 'tree' ->> 'root_person_id')::uuid
   where t.id = p_tree
     and exists (select 1 from public.persons p
                  where p.tree_id = p_tree and p.id = (p_data -> 'tree' ->> 'root_person_id')::uuid);

  return jsonb_build_object('persons', v_persons, 'parent_child', v_edges, 'partnerships', v_partners);
end;
$$;

-- ---------------------------------------------------------------------------
-- Merge: copies the source tree into the target tree.
-- p_person_map = {"<source person id>": "<target person id>", ...} marks people that already
-- exist in the target (duplicates); they are linked instead of copied.
-- Requires editor rights on both trees. Takes a 'pre_merge' snapshot of the target.
-- Media rows are copied as is_copy (same file, no quota use).
-- ---------------------------------------------------------------------------
create or replace function public.merge_trees(p_source uuid, p_target uuid, p_person_map jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_persons int;
  v_edges int;
  v_partners int;
  v_media int;
begin
  if p_source = p_target then
    raise exception 'Cannot merge a tree into itself' using errcode = '22023';
  end if;
  if not (public.has_tree_role(p_source, 'editor') and public.has_tree_role(p_target, 'editor')) then
    raise exception 'Editor rights on both trees are required to merge' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_person_map, '{}'::jsonb)) <> 'object' then
    raise exception 'p_person_map must be a JSON object' using errcode = '22023';
  end if;

  perform public.create_snapshot(p_target, 'pre_merge', 'Before merge');

  create temp table if not exists _merge_person_map (src uuid primary key, dst uuid not null, is_new boolean not null)
    on commit drop;
  create temp table if not exists _merge_media_map (src uuid primary key, dst uuid not null)
    on commit drop;
  truncate _merge_person_map, _merge_media_map;

  insert into _merge_person_map (src, dst, is_new)
  select p.id,
         coalesce(public.try_uuid(p_person_map ->> p.id::text), gen_random_uuid()),
         public.try_uuid(p_person_map ->> p.id::text) is null
    from public.persons p
   where p.tree_id = p_source;

  if exists (
    select 1 from _merge_person_map mp
     where not mp.is_new
       and not exists (select 1 from public.persons t where t.id = mp.dst and t.tree_id = p_target)
  ) then
    raise exception 'p_person_map points to people that are not in the target tree'
      using errcode = '22023', hint = 'bad_person_map';
  end if;

  insert into public.persons (
    id, tree_id, first_name, middle_name, last_name, birth_name, nickname, gender,
    birth_date, birth_date_precision, birth_place, is_living, death_date, death_date_precision,
    death_place, occupation, bio, notes, extra, created_by
  )
  select mp.dst, p_target, p.first_name, p.middle_name, p.last_name, p.birth_name, p.nickname, p.gender,
         p.birth_date, p.birth_date_precision, p.birth_place, p.is_living, p.death_date,
         p.death_date_precision, p.death_place, p.occupation, p.bio, p.notes, p.extra, auth.uid()
    from public.persons p
    join _merge_person_map mp on mp.src = p.id and mp.is_new;
  get diagnostics v_persons = row_count;

  insert into public.parent_child (tree_id, parent_id, child_id, relation, start_date, notes)
  select distinct on (par.dst, chi.dst) p_target, par.dst, chi.dst, pc.relation, pc.start_date, pc.notes
    from public.parent_child pc
    join _merge_person_map par on par.src = pc.parent_id
    join _merge_person_map chi on chi.src = pc.child_id
   where pc.tree_id = p_source
     and not exists (select 1 from public.parent_child e where e.parent_id = par.dst and e.child_id = chi.dst)
     -- skip biological edges the target already has enough of (e.g. a duplicate parent)
     and not (pc.relation = 'biological' and not chi.is_new and (
          select count(*) from public.parent_child e
           where e.child_id = chi.dst and e.relation = 'biological') >= 2);
  get diagnostics v_edges = row_count;

  insert into public.partnerships (tree_id, person1_id, person2_id, kind, status, start_date,
                                   start_place, end_date, sort_order, notes)
  select distinct on (least(a.dst, b.dst), greatest(a.dst, b.dst), pa.kind, pa.status, pa.start_date)
         p_target, a.dst, b.dst, pa.kind, pa.status, pa.start_date, pa.start_place, pa.end_date,
         pa.sort_order, pa.notes
    from public.partnerships pa
    join _merge_person_map a on a.src = pa.person1_id
    join _merge_person_map b on b.src = pa.person2_id
   where pa.tree_id = p_source
     and not exists (
       select 1 from public.partnerships e
        where e.person1_id = least(a.dst, b.dst) and e.person2_id = greatest(a.dst, b.dst)
          and e.kind = pa.kind
          and (e.status = pa.status or e.start_date is not distinct from pa.start_date));
  get diagnostics v_partners = row_count;

  insert into _merge_media_map (src, dst)
  select m.id, gen_random_uuid() from public.media m
   where m.tree_id = p_source
     and not exists (select 1 from public.media e where e.tree_id = p_target and e.storage_path = m.storage_path);

  insert into public.media (id, tree_id, person_id, kind, storage_path, mime_type, size_bytes,
                            width, height, caption, taken_on, uploaded_by, is_copy)
  select mm.dst, p_target, pm.dst, m.kind, m.storage_path, m.mime_type, m.size_bytes,
         m.width, m.height, m.caption, m.taken_on, m.uploaded_by, true
    from public.media m
    join _merge_media_map mm on mm.src = m.id
    left join _merge_person_map pm on pm.src = m.person_id;
  get diagnostics v_media = row_count;

  update public.persons t
     set avatar_media_id = mm.dst
    from public.persons s
    join _merge_person_map pm on pm.src = s.id and pm.is_new
    join _merge_media_map mm on mm.src = s.avatar_media_id
   where t.id = pm.dst;

  return jsonb_build_object(
    'persons_added', v_persons,
    'persons_linked', (select count(*) from _merge_person_map where not is_new),
    'parent_child_added', v_edges,
    'partnerships_added', v_partners,
    'media_linked', v_media
  );
end;
$$;
