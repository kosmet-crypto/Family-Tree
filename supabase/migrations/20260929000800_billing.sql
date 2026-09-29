-- Roots & Branches — billing (RevenueCat webhook bookkeeping)
-- Only the service role (API routes) reads or writes these.

-- Timestamp of the RevenueCat event that last changed the plan; older events arriving
-- late (webhooks are not ordered) are ignored.
alter table public.profiles add column plan_event_at timestamptz;

-- Every processed webhook event, for idempotency and support.
create table public.billing_events (
  id          text primary key,          -- RevenueCat event.id
  type        text not null,
  app_user_id text,
  environment text,
  payload     jsonb not null,
  applied     boolean not null default false,
  received_at timestamptz not null default now()
);

create index billing_events_user_idx on public.billing_events (app_user_id, received_at desc);

alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

-- Applies a plan change unless a newer event was already applied. Returns true when applied.
create or replace function public.apply_plan_change(
  p_user       uuid,
  p_plan       public.plan_tier,
  p_expires_at timestamptz,
  p_event_at   timestamptz,
  p_keep_plan  boolean default false
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.profiles
       set plan            = case when p_keep_plan then plan else p_plan end,
           plan_expires_at = p_expires_at,
           plan_event_at   = p_event_at
     where id = p_user
       and (plan_event_at is null or plan_event_at <= p_event_at)
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.apply_plan_change(uuid, public.plan_tier, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_plan_change(uuid, public.plan_tier, timestamptz, timestamptz, boolean)
  to service_role;
