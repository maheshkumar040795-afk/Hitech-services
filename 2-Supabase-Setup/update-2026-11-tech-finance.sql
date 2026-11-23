-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): Petrol allowance + Salary advance per technician
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Run AFTER update-2026-11-repairs.sql.
--
--  • Technicians screen → ₹ (Finance) on a technician → admin adds Petrol allowance or
--    Salary advance entries (amount, date, note).
--  • Net salary = Earned − Collected from customer + Petrol allowance − Salary advance
--    (by the entry date's month), in Technician Payout and in HT Jobs.
--  • HT Jobs: tap the Previous / Current month card for the full breakdown with every entry.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.tech_finance (
  id             uuid primary key default gen_random_uuid(),
  technician_id  uuid not null references public.technicians(id) on delete cascade,
  kind           text not null check (kind in ('PETROL','ADVANCE')),
  amount         numeric(12,2) not null check (amount > 0),
  entry_date     date not null default public.today_ist(),
  note           text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists tech_finance_tech_date_idx on public.tech_finance (technician_id, entry_date);
create index if not exists tech_finance_date_idx on public.tech_finance (entry_date);

alter table public.tech_finance enable row level security;
drop policy if exists tech_finance_select on public.tech_finance;
create policy tech_finance_select on public.tech_finance for select to authenticated
  using ((select public.is_office()) or technician_id = (select public.my_technician_id()));
drop policy if exists tech_finance_write on public.tech_finance;
create policy tech_finance_write on public.tech_finance for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.tech_finance to authenticated;
grant all on public.tech_finance to service_role;

-- Audit: who gave which allowance / advance
create or replace function public.tech_finance_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare r tech_finance := coalesce(new, old); v_name text;
begin
  select name into v_name from technicians where id = r.technician_id;
  insert into audit_logs(action, entity_type, entity_id, note, actor_id)
  values (case when tg_op = 'DELETE' then 'FINANCE_DELETED' else 'FINANCE_ADDED' end, 'technician', r.technician_id::text,
          case when r.kind = 'PETROL' then 'Petrol allowance ₹' else 'Salary advance ₹' end || r.amount
            || ' · ' || coalesce(v_name, '') || ' · ' || to_char(r.entry_date, 'DD Mon YYYY')
            || case when tg_op = 'DELETE' then ' (deleted)' else '' end
            || coalesce(' · ' || nullif(trim(r.note), ''), ''),
          auth.uid());
  return null;
end $$;
drop trigger if exists tech_finance_audit on public.tech_finance;
create trigger tech_finance_audit after insert or delete on public.tech_finance
  for each row execute function public.tech_finance_audit();

-- Salary paid: keep the petrol / advance that were part of the paid amount
alter table public.salary_payments add column if not exists petrol  numeric(12,2) not null default 0;
alter table public.salary_payments add column if not exists advance numeric(12,2) not null default 0;

-- HT Jobs: previous + current month, now with petrol allowance and salary advance (and the entries)
create or replace function public.tech_salary_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tech uuid := my_technician_id();
  v_cur  date := date_trunc('month', today_ist())::date;
  v_out  jsonb := '{}'::jsonb;
  v_m    date; v_k text; t record; p salary_payments;
  v_petrol numeric; v_adv numeric; v_entries jsonb; v_net numeric;
begin
  if v_tech is null then raise exception 'Only technicians' using errcode = '42501'; end if;
  foreach v_k in array array['prev','cur'] loop
    v_m := case when v_k = 'prev' then (v_cur - interval '1 month')::date else v_cur end;
    select * into t from tech_month_totals(v_tech, v_m);
    select * into p from salary_payments where technician_id = v_tech and month = v_m;
    select coalesce(sum(amount) filter (where kind = 'PETROL'), 0), coalesce(sum(amount) filter (where kind = 'ADVANCE'), 0),
           coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'date', entry_date, 'note', note)
                              order by entry_date, created_at), '[]'::jsonb)
      into v_petrol, v_adv, v_entries
      from tech_finance
     where technician_id = v_tech and entry_date >= v_m and entry_date < (v_m + interval '1 month')::date;
    v_net := t.earned - t.collected + v_petrol - v_adv;
    v_out := v_out || jsonb_build_object(v_k, jsonb_build_object(
      'month', v_m, 'jobs', t.jobs, 'earned', t.earned, 'collected', t.collected,
      'installs', t.installs, 'install_earned', t.install_earned,
      'repairs', t.repairs, 'repair_earned', t.repair_earned,
      'petrol', v_petrol, 'advance', v_adv, 'entries', v_entries,
      'net', v_net,
      'paid', p.amount, 'paid_at', p.paid_at,
      'balance', v_net - coalesce(p.amount, 0)));
  end loop;
  return v_out;
end $$;
revoke execute on function public.tech_salary_summary() from public, anon;
grant execute on function public.tech_salary_summary() to authenticated;

notify pgrst, 'reload schema';
