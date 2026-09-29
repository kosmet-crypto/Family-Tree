-- Phase 1 behaviour tests (plain PostgreSQL + 00_supabase_stub.sql). Run with run.sh.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\o /dev/null

create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.as_user(p_uid uuid, p_email text default null) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'email', p_email, 'role', 'authenticated')::text, false);
$$;

-- Runs p_sql and asserts it fails; p_expect is matched against hint, SQLSTATE or message.
create function tests.expect_error(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare v_hint text; v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate, v_msg = message_text;
    if p_expect in (v_hint, v_state) or v_msg ilike '%' || p_expect || '%' then
      raise notice 'ok   %', p_label;
      return;
    end if;
    raise exception 'FAIL % : expected %, got [%] % (%)', p_label, p_expect, v_state, v_msg, v_hint;
  end;
  raise exception 'FAIL % : expected error %, statement succeeded', p_label, p_expect;
end $$;

create function tests.check(p_label text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'ok   %', p_label;
end $$;

grant execute on all functions in schema tests to authenticated, anon;

-- Fixed ids keep the script readable.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com',  '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'boris@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'ceca@example.com',  '{}');

select tests.check('profiles created by trigger', (select count(*) from public.profiles) = 3);
select tests.check('display name from metadata / email',
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Ana'
  and (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'boris');

-- ============================== Ana builds a tree ==============================
select tests.as_user('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
set role authenticated;

insert into public.trees (id, name) values ('10000000-0000-0000-0000-000000000001', 'Petrović');
select tests.check('owner membership added', public.tree_role_of('10000000-0000-0000-0000-000000000001') = 'owner');

insert into public.persons (id, tree_id, first_name, last_name, gender, birth_date, is_living) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Milan',  'Petrović', 'male',   '1930-01-01', false),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Mira',   'Petrović', 'female', '1932-01-01', false),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Jovan',  'Petrović', 'male',   '1960-05-05', true),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Jelena', 'Petrović', 'female', '1962-02-02', true),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Marko',  'Petrović', 'male',   '1990-03-03', true),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Sanja',  'Ilić',     'female', '1965-07-07', true),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Nikola', 'Petrović', 'male',   '2000-09-09', true),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Luka',   'Ilić',     'male',   '1995-01-01', true);

insert into public.parent_child (tree_id, parent_id, child_id, relation) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'biological'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'biological'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000005', 'biological'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', 'biological'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000007', 'biological'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000007', 'biological'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000008', 'step');

select tests.expect_error('cycle rejected', $$
  insert into public.parent_child (tree_id, parent_id, child_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001')
$$, 'cycle');
select tests.expect_error('third biological parent rejected', $$
  insert into public.parent_child (tree_id, parent_id, child_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000005')
$$, 'too_many_biological_parents');
select tests.expect_error('parent younger than child rejected', $$
  insert into public.parent_child (tree_id, parent_id, child_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000008')
$$, 'parent_younger_than_child');
select tests.expect_error('self parent rejected', $$
  insert into public.parent_child (tree_id, parent_id, child_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005')
$$, 'self_parent');
select tests.expect_error('living person with death date rejected', $$
  update public.persons set death_date = '2020-01-01' where id = '20000000-0000-0000-0000-000000000005'
$$, '23514');

-- Adoptive parent in addition to two biological ones is fine.
insert into public.parent_child (tree_id, parent_id, child_id, relation)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000005', 'adoptive');

-- Jovan: divorced from Jelena, married to Sanja; remarriage to Jelena allowed after divorce.
insert into public.partnerships (tree_id, person1_id, person2_id, kind, status, start_date, end_date) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 'marriage', 'divorced', '1988-06-01', '1996-01-01'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000006', 'marriage', 'active',   '1998-06-01', null);
select tests.check('partnership pair normalized',
  (select count(*) from public.partnerships where person1_id < person2_id) = 2);
select tests.expect_error('duplicate active marriage rejected', $$
  insert into public.partnerships (tree_id, person1_id, person2_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003')
$$, '23505');

select tests.check('Marko & Nikola are half siblings',
  (select sibling_type from public.person_siblings
    where person_id = '20000000-0000-0000-0000-000000000005' and sibling_id = '20000000-0000-0000-0000-000000000007') = 'half');
select tests.check('Marko & Luka are step siblings',
  (select sibling_type from public.person_siblings
    where person_id = '20000000-0000-0000-0000-000000000005' and sibling_id = '20000000-0000-0000-0000-000000000008') = 'step');
select tests.check('ancestors of Marko = 5 (2 parents, adoptive, 2 grandparents)',
  (select count(*) from public.get_ancestors('20000000-0000-0000-0000-000000000005')) = 5);
select tests.check('descendants of Milan = 4',
  (select count(distinct person_id) from public.get_descendants('20000000-0000-0000-0000-000000000001')) = 4);
select tests.check('trigram search finds "petrov"',
  (select count(*) from public.persons where search_text like '%petrov%') = 6);

update public.trees set root_person_id = '20000000-0000-0000-0000-000000000001'
 where id = '10000000-0000-0000-0000-000000000001';

select tests.expect_error('user cannot change own plan', $$
  update public.profiles set plan = 'premium' where id = auth.uid()
$$, '42501');
select tests.expect_error('owner cannot leave own tree', $$
  delete from public.tree_members where user_id = auth.uid()
$$, 'owner cannot leave');

-- ============================== Isolation ==============================
reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000b', 'boris@example.com');
set role authenticated;
select tests.check('stranger sees no trees', (select count(*) from public.trees) = 0);
select tests.check('stranger sees no persons', (select count(*) from public.persons) = 0);
select tests.expect_error('stranger cannot insert into foreign tree', $$
  insert into public.persons (tree_id, first_name) values ('10000000-0000-0000-0000-000000000001', 'X')
$$, '42501');
select tests.expect_error('stranger cannot join by inserting membership', $$
  insert into public.tree_members (tree_id, user_id, role)
  values ('10000000-0000-0000-0000-000000000001', auth.uid(), 'owner')
$$, '42501');

reset role;
set role anon;
select tests.expect_error('anon cannot read trees', 'select * from public.trees', '42501');

-- ============================== Invitations ==============================
reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
set role authenticated;
insert into public.invitations (tree_id, email, role)
values ('10000000-0000-0000-0000-000000000001', 'boris@example.com', 'editor')
returning token as invite_token \gset

reset role;
set role anon;
select tests.check('anon can preview invitation',
  (select tree_name from public.get_invitation(:'invite_token')) = 'Petrović');

reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000c', 'ceca@example.com');
set role authenticated;
select tests.expect_error('invite locked to another email', format('select public.accept_invitation(%L)', :'invite_token'),
  'invite_email_mismatch');

reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000b', 'boris@example.com');
set role authenticated;
select tests.check('invite accepted',
  public.accept_invitation(:'invite_token') = '10000000-0000-0000-0000-000000000001');
select tests.expect_error('invite single use', format('select public.accept_invitation(%L)', :'invite_token'),
  'invite_not_pending');
select tests.check('editor sees shared tree persons', (select count(*) from public.persons) = 8);
select tests.check('editor sees co-member profile', (select count(*) from public.profiles) = 2);
select tests.expect_error('editor cannot invite editors', $$
  insert into public.invitations (tree_id, role) values ('10000000-0000-0000-0000-000000000001', 'editor')
$$, '42501');
insert into public.invitations (tree_id, role) values ('10000000-0000-0000-0000-000000000001', 'viewer');
select tests.expect_error('editor cannot rename tree (owner only)', $$
  do $x$ begin
    update public.trees set name = 'x' where id = '10000000-0000-0000-0000-000000000001';
    if not found then raise exception 'no rows' using errcode = '42501'; end if;
  end $x$
$$, '42501');

-- ============================== Media & photo quota ==============================
reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
set role authenticated;

do $$
begin
  for i in 1..30 loop
    insert into storage.objects (bucket_id, name)
    values ('family-media', '10000000-0000-0000-0000-000000000001/photos/p' || i || '.webp');
    insert into public.media (tree_id, person_id, kind, storage_path, mime_type, size_bytes)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 'photo',
            '10000000-0000-0000-0000-000000000001/photos/p' || i || '.webp', 'image/webp', 150000);
  end loop;
end $$;
select tests.check('quota shows 30/30', public.photo_quota() = '{"used":30,"limit":30,"remaining":0,"premium":false}');
select tests.expect_error('31st photo upload blocked by storage policy', $$
  insert into storage.objects (bucket_id, name)
  values ('family-media', '10000000-0000-0000-0000-000000000001/photos/p31.webp')
$$, '42501');

reset role;  -- simulate a file that got into storage anyway
insert into storage.objects (bucket_id, name) values ('family-media', '10000000-0000-0000-0000-000000000001/photos/p31.webp');
set role authenticated;
select tests.expect_error('31st photo row blocked by trigger', $$
  insert into public.media (tree_id, kind, storage_path, mime_type, size_bytes)
  values ('10000000-0000-0000-0000-000000000001', 'photo',
          '10000000-0000-0000-0000-000000000001/photos/p31.webp', 'image/webp', 1000)
$$, 'photo_quota_exceeded');
select tests.expect_error('client cannot set is_copy', $$
  insert into public.media (tree_id, kind, storage_path, mime_type, size_bytes, is_copy)
  values ('10000000-0000-0000-0000-000000000001', 'photo', 'x/photos/y', 'image/webp', 1000, true)
$$, '42501');
select tests.expect_error('media row needs uploaded file', $$
  insert into public.media (tree_id, kind, storage_path, mime_type, size_bytes)
  values ('10000000-0000-0000-0000-000000000001', 'document',
          '10000000-0000-0000-0000-000000000001/documents/missing.pdf', 'application/pdf', 1000)
$$, 'storage_object_missing');
insert into storage.objects (bucket_id, name) values ('family-media', '10000000-0000-0000-0000-000000000001/documents/rodni-list.pdf');
insert into public.media (tree_id, kind, storage_path, mime_type, size_bytes)
values ('10000000-0000-0000-0000-000000000001', 'document',
        '10000000-0000-0000-0000-000000000001/documents/rodni-list.pdf', 'application/pdf', 1000);
select tests.check('documents do not count against photo quota', public.photo_count() = 30);

reset role;  -- RevenueCat webhook (service role) upgrades Ana
update public.profiles set plan = 'premium' where id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
insert into public.media (tree_id, kind, storage_path, mime_type, size_bytes)
values ('10000000-0000-0000-0000-000000000001', 'photo',
        '10000000-0000-0000-0000-000000000001/photos/p31.webp', 'image/webp', 1000);
select tests.check('premium: unlimited photos', public.photo_quota() ->> 'limit' is null and public.photo_count() = 31);
select public.photo_quota('00000000-0000-0000-0000-00000000000b') ->> 'used' as other_used \gset
select tests.check('cannot read another user''s quota', :'other_used' = '0');

update public.persons set avatar_media_id = (select id from public.media where storage_path like '%/p1.webp')
 where id = '20000000-0000-0000-0000-000000000005';

-- ============================== Backup & restore ==============================
select tests.check('export has 8 persons',
  jsonb_array_length(public.export_tree('10000000-0000-0000-0000-000000000001') -> 'persons') = 8);
select public.create_snapshot('10000000-0000-0000-0000-000000000001', 'manual', 'test') is not null as snap \gset
select data as backup from public.tree_snapshots where label = 'test' \gset

delete from public.persons where tree_id = '10000000-0000-0000-0000-000000000001';
select tests.check('persons wiped', (select count(*) from public.persons) = 0);

reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000b', 'boris@example.com');
set role authenticated;
select tests.expect_error('editor cannot restore', format(
  'select public.restore_tree(%L, %L::jsonb)', '10000000-0000-0000-0000-000000000001', :'backup'), '42501');

reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
set role authenticated;
select public.restore_tree('10000000-0000-0000-0000-000000000001', :'backup') as restored \gset
select tests.check('restore counts', :'restored'::jsonb = '{"persons":8,"parent_child":8,"partnerships":2}');
select tests.check('restore relinks media and avatar and root',
  (select count(*) from public.media where person_id = '20000000-0000-0000-0000-000000000005') = 30
  and (select avatar_media_id is not null from public.persons where id = '20000000-0000-0000-0000-000000000005')
  and (select root_person_id from public.trees where id = '10000000-0000-0000-0000-000000000001')
      = '20000000-0000-0000-0000-000000000001');
select tests.check('pre_restore snapshot taken',
  (select count(*) from public.tree_snapshots where kind = 'pre_restore') = 1);
select tests.check('auto snapshot created once',
  public.auto_snapshot('10000000-0000-0000-0000-000000000001') is not null
  and public.auto_snapshot('10000000-0000-0000-0000-000000000001') is null);

-- ============================== Merge ==============================
reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000b', 'boris@example.com');
set role authenticated;
insert into public.trees (id, name) values ('10000000-0000-0000-0000-000000000002', 'Borisova grana');
insert into public.persons (id, tree_id, first_name, last_name, gender) values
  ('21000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Jovan', 'Petrović', 'male'),   -- duplicate of Jovan
  ('21000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Ivana', 'Petrović', 'female'),
  ('21000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Mila',  'Petrović', 'female');
insert into public.parent_child (tree_id, parent_id, child_id) values
  ('10000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000003');

select public.merge_trees('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
  '{"21000000-0000-0000-0000-000000000001": "20000000-0000-0000-0000-000000000003"}') as merged \gset
select tests.check('merge stats',
  (:'merged'::jsonb ->> 'persons_added')::int = 2 and (:'merged'::jsonb ->> 'persons_linked')::int = 1
  and (:'merged'::jsonb ->> 'parent_child_added')::int = 2);
select tests.check('Ivana is now Jovan''s child in the shared tree',
  exists (select 1 from public.person_siblings
           where person_id = '20000000-0000-0000-0000-000000000005' and sibling_type = 'half'
             and sibling_id in (select id from public.persons where first_name = 'Ivana'
                                  and tree_id = '10000000-0000-0000-0000-000000000001')));
select tests.expect_error('bad person map rejected', $$
  select public.merge_trees('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
    '{"21000000-0000-0000-0000-000000000003": "21000000-0000-0000-0000-000000000001"}')
$$, 'bad_person_map');

reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000c', 'ceca@example.com');
set role authenticated;
select tests.expect_error('merge needs editor rights on both trees', $$
  select public.merge_trees('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')
$$, '42501');

reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000b', 'boris@example.com');
set role authenticated;
-- Boris leaves; he loses access.
delete from public.tree_members where tree_id = '10000000-0000-0000-0000-000000000001' and user_id = auth.uid();
select tests.check('member left', (select count(*) from public.trees) = 1);

-- ============================== Tree deletion ==============================
reset role;
select tests.as_user('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
set role authenticated;
delete from public.trees where id = '10000000-0000-0000-0000-000000000001';
reset role;
select tests.check('tree delete cascades',
  (select count(*) from public.persons where tree_id = '10000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.media where tree_id = '10000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.tree_members where tree_id = '10000000-0000-0000-0000-000000000001') = 0);

\echo ALL PHASE 1 TESTS PASSED
