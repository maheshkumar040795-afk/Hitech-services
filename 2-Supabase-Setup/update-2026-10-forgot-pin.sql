-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Oct 2026): technician "Forgot PIN"
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Existing data is kept.
--
--  How it works
--   • HT Jobs login → "Forgot PIN?" → technician enters their mobile → request goes to the office.
--   • Office sees it instantly (Technicians page banner + red badge in the menu).
--   • Admin taps "Reset PIN & send" → new PIN is sent to the technician on WhatsApp.
--   • The technician can also tap "WhatsApp the office" (uses the phone saved in Settings).
--  No SMS provider needed; works the same on Android and iPhone.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.pin_reset_requests (
  id             uuid primary key default gen_random_uuid(),
  technician_id  uuid not null references public.technicians(id) on delete cascade,
  mobile         text not null,
  status         text not null default 'OPEN' check (status in ('OPEN','DONE','CANCELLED')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references public.profiles(id) on delete set null
);
create unique index if not exists pin_reset_one_open on public.pin_reset_requests (technician_id) where status = 'OPEN';
create index if not exists pin_reset_created_idx on public.pin_reset_requests (created_at desc);

alter table public.pin_reset_requests enable row level security;
drop policy if exists pin_reset_select on public.pin_reset_requests;
create policy pin_reset_select on public.pin_reset_requests for select to authenticated using ((select public.is_office()));
drop policy if exists pin_reset_update on public.pin_reset_requests;
create policy pin_reset_update on public.pin_reset_requests for update to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
grant select, update on public.pin_reset_requests to authenticated;
grant all on public.pin_reset_requests to service_role;

-- Called from the login screen (not logged in). Never reveals whether a mobile is registered.
create or replace function public.request_pin_reset(p_mobile text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mobile text := right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10);
  v_tech   technicians%rowtype;
  v_phone  text;
  v_recent boolean;
begin
  if v_mobile !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter your 10-digit mobile number';
  end if;
  select company_phone into v_phone from app_settings where id = 1;

  select * into v_tech from technicians where mobile = v_mobile and is_active;
  if found then
    -- at most one new request every 2 minutes per technician
    select exists (select 1 from pin_reset_requests where technician_id = v_tech.id and created_at > now() - interval '2 minutes')
      into v_recent;
    if not v_recent then
      insert into pin_reset_requests (technician_id, mobile)
      values (v_tech.id, v_mobile)
      on conflict (technician_id) where status = 'OPEN' do update set created_at = now(), mobile = excluded.mobile;
      insert into audit_logs (action, entity_type, entity_id, note)
      values ('PIN_RESET_REQUESTED', 'technician', v_tech.id::text,
              'Forgot PIN: ' || v_tech.name || coalesce(' (' || v_tech.tech_code || ')', '') || ' asked for a new PIN');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'office_phone', v_phone);
end $$;
revoke execute on function public.request_pin_reset(text) from public;
grant execute on function public.request_pin_reset(text) to anon, authenticated;

-- Live badge in the office app
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.pin_reset_requests; exception when duplicate_object then null; end;
  end if;
end $$;

notify pgrst, 'reload schema';
