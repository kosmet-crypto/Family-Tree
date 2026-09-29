-- Roots & Branches — app-wide settings.
-- free_photo_limit: number of photos a free user may upload; JSON null = no limit.
-- It starts switched off for the test phase; turn it on with:
--   update public.app_settings set value = '30' where key = 'free_photo_limit';

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);

insert into public.app_settings (key, value) values ('free_photo_limit', 'null');

-- null when the limit is switched off
create or replace function public.free_photo_limit()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (s.value #>> '{}')::int from public.app_settings s where s.key = 'free_photo_limit';
$$;

create or replace function public.can_upload_photo(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.free_photo_limit() is null
      or public.is_premium(p_user)
      or public.photo_count(p_user) < public.free_photo_limit();
$$;

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
    'remaining', case when public.is_premium(p_user) or public.free_photo_limit() is null then null
                      else greatest(public.free_photo_limit() - public.photo_count(p_user), 0) end,
    'premium',   public.is_premium(p_user)
  );
$$;
