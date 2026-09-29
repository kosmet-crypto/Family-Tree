-- Roots & Branches — Phase 1 / media (photos, documents) and Storage
-- Free plan: at most 30 photos per user. Enforced twice: by the Storage upload policy
-- (no quota -> no upload) and by a trigger on public.media (authoritative count).
-- Storage layout: bucket "family-media", path "<tree_id>/photos|documents/<file>".

create or replace function public.free_photo_limit()
returns integer
language sql
immutable
as $$ select 30 $$;

create table public.media (
  id           uuid primary key default gen_random_uuid(),
  tree_id      uuid not null references public.trees (id) on delete cascade,
  person_id    uuid,
  kind         public.media_kind not null,
  storage_path text not null,
  mime_type    text not null check (char_length(mime_type) <= 100),
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 20 * 1024 * 1024),
  width        integer check (width > 0),
  height       integer check (height > 0),
  caption      text check (char_length(caption) <= 1000),
  taken_on     date,
  uploaded_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  -- true for rows copied by merge_trees(): they reuse the original file and do not use quota.
  is_copy      boolean not null default false,
  created_at   timestamptz not null default now(),
  foreign key (tree_id, person_id) references public.persons (tree_id, id) on delete set null (person_id),
  unique (tree_id, id),
  constraint media_photo_is_image check (kind <> 'photo' or mime_type like 'image/%'),
  constraint media_path_in_tree_folder check (
    is_copy or split_part(storage_path, '/', 1) = tree_id::text
  ),
  constraint media_path_matches_kind check (
    is_copy or split_part(storage_path, '/', 2) = case kind when 'photo' then 'photos' else 'documents' end
  )
);

create index media_tree_idx     on public.media (tree_id);
create index media_person_idx   on public.media (person_id);
create index media_path_idx     on public.media (storage_path);
create index media_uploader_idx on public.media (uploaded_by) where kind = 'photo' and not is_copy;

alter table public.persons
  add constraint persons_avatar_fk
  foreign key (tree_id, avatar_media_id) references public.media (tree_id, id)
  on delete set null (avatar_media_id);

-- Photos counted against a user's quota.
create or replace function public.photo_count(p_user uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.media m
   where m.uploaded_by = p_user and m.kind = 'photo' and not m.is_copy
     and (auth.uid() is null or p_user = auth.uid());  -- users may only ask about themselves
$$;

-- { used, limit (null = unlimited), remaining (null = unlimited), premium } for the UI.
create or replace function public.photo_quota(p_user uuid default auth.uid())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used',      public.photo_count(p_user),
    'limit',     case when public.is_premium(p_user) then null else public.free_photo_limit() end,
    'remaining', case when public.is_premium(p_user) then null
                      else greatest(public.free_photo_limit() - public.photo_count(p_user), 0) end,
    'premium',   public.is_premium(p_user)
  );
$$;

create or replace function public.can_upload_photo(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_premium(p_user) or public.photo_count(p_user) < public.free_photo_limit();
$$;

create or replace function public.enforce_media_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_copy then
    return new;
  end if;

  if new.kind = 'photo' and new.uploaded_by is not null then
    -- Serialize per user so parallel uploads cannot overshoot the limit.
    perform pg_advisory_xact_lock(hashtextextended('photo_quota:' || new.uploaded_by::text, 0));
    if not public.can_upload_photo(new.uploaded_by) then
      raise exception 'Photo limit reached (% photos on the free plan)', public.free_photo_limit()
        using errcode = 'P0001', hint = 'photo_quota_exceeded';
    end if;
  end if;

  -- The file must already be uploaded to Storage.
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'family-media' and o.name = new.storage_path
  ) then
    raise exception 'File % not found in storage', new.storage_path
      using errcode = 'P0001', hint = 'storage_object_missing';
  end if;

  return new;
end;
$$;

create trigger media_enforce_rules
  before insert on public.media
  for each row execute function public.enforce_media_rules();

-- ---------------------------------------------------------------------------
-- Storage bucket and policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-media', 'family-media', false, 20 * 1024 * 1024,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'image/gif',
    'application/pdf', 'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

-- Upload: editors of the tree in the first path segment; photos also need quota.
create policy "family-media: editors upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'family-media'
    and public.has_tree_role(public.try_uuid((storage.foldername(name))[1]), 'editor')
    and (storage.foldername(name))[2] in ('photos', 'documents')
    and ((storage.foldername(name))[2] <> 'photos' or public.can_upload_photo())
  );

-- Read: members of the folder's tree, or of any tree holding a (merged) copy of the file.
create policy "family-media: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'family-media'
    and (
      public.has_tree_role(public.try_uuid((storage.foldername(name))[1]), 'viewer')
      or exists (
        select 1 from public.media m
         where m.storage_path = storage.objects.name
           and public.has_tree_role(m.tree_id, 'viewer')
      )
    )
  );

-- Delete: editors of the folder's tree, unless another tree still uses the file
-- (merged copy). Files are immutable (no update policy).
create policy "family-media: editors delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'family-media'
    and public.has_tree_role(public.try_uuid((storage.foldername(name))[1]), 'editor')
    and not exists (
      select 1 from public.media m
       where m.storage_path = storage.objects.name
         and m.tree_id is distinct from public.try_uuid((storage.foldername(storage.objects.name))[1])
    )
  );
