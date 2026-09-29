-- Roots & Branches — Phase 1 / people and relations
-- Graph model: persons are nodes, parent_child and partnerships are edges.
-- Composite FKs (tree_id, person_id) guarantee that edges never cross trees.

create table public.persons (
  id                   uuid primary key default gen_random_uuid(),
  tree_id              uuid not null references public.trees (id) on delete cascade,
  first_name           text not null default '' check (char_length(first_name) <= 100),
  middle_name          text check (char_length(middle_name) <= 100),
  last_name            text check (char_length(last_name) <= 100),
  birth_name           text check (char_length(birth_name) <= 100),   -- maiden name
  nickname             text check (char_length(nickname) <= 100),
  gender               public.gender not null default 'unknown',
  birth_date           date,
  birth_date_precision public.date_precision not null default 'exact',
  birth_place          text check (char_length(birth_place) <= 200),
  is_living            boolean not null default true,
  death_date           date,
  death_date_precision public.date_precision not null default 'exact',
  death_place          text check (char_length(death_place) <= 200),
  occupation           text check (char_length(occupation) <= 200),
  bio                  text check (char_length(bio) <= 20000),
  notes                text check (char_length(notes) <= 20000),        -- complex mode
  avatar_media_id      uuid,                                             -- FK added in media migration
  extra                jsonb not null default '{}'::jsonb,               -- free-form custom fields
  search_text          text generated always as (
                         lower(first_name || ' ' || coalesce(middle_name, '') || ' ' ||
                               coalesce(last_name, '') || ' ' || coalesce(birth_name, '') || ' ' ||
                               coalesce(nickname, ''))
                       ) stored,
  created_by           uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tree_id, id),
  constraint persons_death_after_birth
    check (death_date is null or birth_date is null or death_date >= birth_date),
  constraint persons_living_has_no_death
    check (not is_living or (death_date is null and death_place is null)),
  constraint persons_extra_is_object check (jsonb_typeof(extra) = 'object')
);

create index persons_tree_idx   on public.persons (tree_id);
create index persons_search_idx on public.persons using gin (search_text extensions.gin_trgm_ops);

create trigger persons_updated_at
  before update on public.persons
  for each row execute function public.set_updated_at();

alter table public.trees
  add constraint trees_root_person_fk
  foreign key (id, root_person_id) references public.persons (tree_id, id)
  on delete set null (root_person_id);

-- ---------------------------------------------------------------------------
-- Parent → child edges (biological, adoptive, step, foster, guardian)
-- ---------------------------------------------------------------------------
create table public.parent_child (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references public.trees (id) on delete cascade,
  parent_id  uuid not null,
  child_id   uuid not null,
  relation   public.parent_relation not null default 'biological',
  start_date date,                                  -- e.g. adoption date
  notes      text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tree_id, parent_id) references public.persons (tree_id, id) on delete cascade,
  foreign key (tree_id, child_id)  references public.persons (tree_id, id) on delete cascade,
  constraint parent_child_not_self check (parent_id <> child_id),
  constraint parent_child_unique unique (parent_id, child_id)
);

create index parent_child_tree_idx  on public.parent_child (tree_id);
create index parent_child_child_idx on public.parent_child (child_id);

create trigger parent_child_updated_at
  before update on public.parent_child
  for each row execute function public.set_updated_at();

-- Rejects cycles (a person becoming their own ancestor), more than two biological
-- parents, and a parent born on/after the child (when both dates are exact).
create or replace function public.validate_parent_child()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_birth date;
  v_child_birth  date;
begin
  if new.parent_id = new.child_id then
    raise exception 'A person cannot be their own parent' using errcode = 'P0001', hint = 'self_parent';
  end if;

  -- Serialize graph edits per tree so two concurrent inserts cannot close a cycle.
  perform pg_advisory_xact_lock(hashtextextended('parent_child:' || new.tree_id::text, 0));

  if exists (
    with recursive descendants(id) as (
      select pc.child_id from public.parent_child pc
       where pc.parent_id = new.child_id and pc.id <> new.id
      union
      select pc.child_id from public.parent_child pc
        join descendants d on pc.parent_id = d.id
       where pc.id <> new.id
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'Relationship would create a cycle (a person cannot be their own ancestor)'
      using errcode = 'P0001', hint = 'cycle';
  end if;

  if new.relation = 'biological' and (
    select count(*) from public.parent_child pc
     where pc.child_id = new.child_id and pc.relation = 'biological' and pc.id <> new.id
  ) >= 2 then
    raise exception 'A person can have at most two biological parents'
      using errcode = 'P0001', hint = 'too_many_biological_parents';
  end if;

  select p.birth_date into v_parent_birth from public.persons p
   where p.id = new.parent_id and p.birth_date_precision = 'exact';
  select c.birth_date into v_child_birth from public.persons c
   where c.id = new.child_id and c.birth_date_precision = 'exact';
  if new.relation = 'biological' and v_parent_birth is not null and v_child_birth is not null
     and v_parent_birth >= v_child_birth then
    raise exception 'A biological parent must be born before the child'
      using errcode = 'P0001', hint = 'parent_younger_than_child';
  end if;

  return new;
end;
$$;

create trigger parent_child_validate
  before insert or update of parent_id, child_id, relation on public.parent_child
  for each row execute function public.validate_parent_child();

-- ---------------------------------------------------------------------------
-- Partnerships (marriages, unions; multiple per person, ordered by sort_order)
-- ---------------------------------------------------------------------------
create table public.partnerships (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references public.trees (id) on delete cascade,
  person1_id  uuid not null,
  person2_id  uuid not null,
  kind        public.partnership_kind not null default 'marriage',
  status      public.partnership_status not null default 'active',
  start_date  date,
  start_place text check (char_length(start_place) <= 200),
  end_date    date,
  sort_order  smallint not null default 0,
  notes       text check (char_length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (tree_id, person1_id) references public.persons (tree_id, id) on delete cascade,
  foreign key (tree_id, person2_id) references public.persons (tree_id, id) on delete cascade,
  constraint partnerships_not_self check (person1_id <> person2_id),
  constraint partnerships_dates check (end_date is null or start_date is null or end_date >= start_date)
);

create index partnerships_tree_idx on public.partnerships (tree_id);
create index partnerships_p1_idx   on public.partnerships (person1_id);
create index partnerships_p2_idx   on public.partnerships (person2_id);

create trigger partnerships_updated_at
  before update on public.partnerships
  for each row execute function public.set_updated_at();

-- Stores each pair in a canonical order so (A,B) and (B,A) look the same.
create or replace function public.normalize_partnership()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tmp uuid;
begin
  if new.person1_id > new.person2_id then
    v_tmp := new.person1_id;
    new.person1_id := new.person2_id;
    new.person2_id := v_tmp;
  end if;
  return new;
end;
$$;

create trigger partnerships_normalize
  before insert or update of person1_id, person2_id on public.partnerships
  for each row execute function public.normalize_partnership();

-- Only one *active* partnership of the same kind per pair (remarriage after divorce is allowed).
create unique index partnerships_one_active_pair
  on public.partnerships (person1_id, person2_id, kind) where status = 'active';

-- ---------------------------------------------------------------------------
-- Siblings (derived): full / half / adoptive / step, via shared parents
-- ---------------------------------------------------------------------------
create view public.person_siblings
with (security_invoker = true) as
select
  a.tree_id,
  a.child_id as person_id,
  b.child_id as sibling_id,
  count(*) filter (where a.relation = 'biological' and b.relation = 'biological') as shared_biological_parents,
  count(*) as shared_parents,
  case
    when count(*) filter (where a.relation = 'biological' and b.relation = 'biological') >= 2 then 'full'
    when count(*) filter (where a.relation = 'biological' and b.relation = 'biological') = 1 then 'half'
    when bool_or(a.relation = 'adoptive' or b.relation = 'adoptive') then 'adoptive'
    else 'step'
  end as sibling_type
from public.parent_child a
join public.parent_child b
  on b.parent_id = a.parent_id and b.child_id <> a.child_id
group by a.tree_id, a.child_id, b.child_id;

-- ---------------------------------------------------------------------------
-- Keep trees.updated_at fresh on any graph change (drives sync / auto-backup)
-- ---------------------------------------------------------------------------
create or replace function public.touch_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trees set updated_at = now()
   where id = coalesce(new.tree_id, old.tree_id)
     and updated_at < now();
  return null;
end;
$$;

create trigger persons_touch_tree
  after insert or update or delete on public.persons
  for each row execute function public.touch_tree();
create trigger parent_child_touch_tree
  after insert or update or delete on public.parent_child
  for each row execute function public.touch_tree();
create trigger partnerships_touch_tree
  after insert or update or delete on public.partnerships
  for each row execute function public.touch_tree();
