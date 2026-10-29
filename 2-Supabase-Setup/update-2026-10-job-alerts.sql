-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Oct 2026): new-job alerts on the technician's phone
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run.  (Deploy the "notify-assign" Edge Function too — see README.)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Lets the database call the Edge Function
create extension if not exists pg_net with schema extensions;

-- 2. One row per phone that turned on alerts
create table if not exists public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  technician_id  uuid not null references public.technicians(id) on delete cascade,
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  app_url        text,
  user_agent     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists push_subs_tech_idx on public.push_subscriptions (technician_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and technician_id = (select public.my_technician_id()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- 3. When a job is assigned (or re-assigned) → ask the Edge Function to notify the technician
create or replace function public.notify_job_assigned() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.technician_id is not null and not new.is_deleted
     and new.status::text in ('PENDING', 'RESCHEDULED')
     and (tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id)
     and exists (select 1 from push_subscriptions where technician_id = new.technician_id) then
    perform net.http_post(
      url     := 'https://eqtdqqhnwfsmoamxvain.supabase.co/functions/v1/notify-assign',
      body    := jsonb_build_object('order_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  end if;
  return null;
exception when others then
  return null;   -- an alert problem must never block assigning a job
end $$;
drop trigger if exists notify_job_assigned on public.orders;
create trigger notify_job_assigned after insert or update of technician_id on public.orders
for each row execute function public.notify_job_assigned();

notify pgrst, 'reload schema';
