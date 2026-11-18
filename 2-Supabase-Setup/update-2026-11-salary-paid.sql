-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): monthly salary in HT Jobs + "Mark as paid"
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Run AFTER update-2026-11-cash-collect.sql.
--
--  • HT Jobs shows Previous month and Current month: Earned − Collected = Net salary
--  • Technician Payout → pick a month → "Mark as paid" per technician.
--    The paid amount is saved; HT Jobs then shows that month's balance as ₹0.
--    (If more jobs of that month are completed later, only the new amount shows.)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.salary_payments (
  id             uuid primary key default gen_random_uuid(),
  technician_id  uuid not null references public.technicians(id) on delete cascade,
  month          date not null check (extract(day from month) = 1),   -- first day of the month
  earned         numeric(12,2) not null default 0,
  collected      numeric(12,2) not null default 0,
  amount         numeric(12,2) not null default 0,                   -- net paid (earned − collected)
  paid_at        timestamptz not null default now(),
  paid_by        uuid references public.profiles(id) on delete set null,
  unique (technician_id, month)
);
alter table public.salary_payments enable row level security;
drop policy if exists salary_payments_select on public.salary_payments;
create policy salary_payments_select on public.salary_payments for select to authenticated
  using ((select public.is_office()) or technician_id = (select public.my_technician_id()));
drop policy if exists salary_payments_write on public.salary_payments;
create policy salary_payments_write on public.salary_payments for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.salary_payments to authenticated;
grant all on public.salary_payments to service_role;

-- Earned / collected for one technician in one month (by completed date, India time)
create or replace function public.tech_month_totals(p_tech uuid, p_month date)
returns table(jobs int, earned numeric, collected numeric)
language sql stable security definer set search_path = public as $$
  select count(*)::int,
         coalesce(sum(coalesce(payout_rate, rate_for(rate_item(installed_item, service), region), 0)), 0),
         coalesce(sum(case when payment_mode = 'AMAZON' then 0 else cod_amount end), 0)
    from orders
   where technician_id = p_tech and status::text = 'COMPLETED' and not is_deleted
     and (closed_at at time zone 'Asia/Kolkata')::date >= p_month
     and (closed_at at time zone 'Asia/Kolkata')::date <  (p_month + interval '1 month')::date
$$;
revoke execute on function public.tech_month_totals(uuid, date) from public, anon, authenticated;

-- HT Jobs: previous month + current month for the logged-in technician
create or replace function public.tech_salary_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tech uuid := my_technician_id();
  v_cur  date := date_trunc('month', today_ist())::date;
  v_out  jsonb := '{}'::jsonb;
  v_m    date; v_k text; t record; p salary_payments;
begin
  if v_tech is null then raise exception 'Only technicians' using errcode = '42501'; end if;
  foreach v_k in array array['prev','cur'] loop
    v_m := case when v_k = 'prev' then (v_cur - interval '1 month')::date else v_cur end;
    select * into t from tech_month_totals(v_tech, v_m);
    select * into p from salary_payments where technician_id = v_tech and month = v_m;
    v_out := v_out || jsonb_build_object(v_k, jsonb_build_object(
      'month', v_m, 'jobs', t.jobs, 'earned', t.earned, 'collected', t.collected,
      'net', t.earned - t.collected,
      'paid', p.amount, 'paid_at', p.paid_at,
      'balance', t.earned - t.collected - coalesce(p.amount, 0)));
  end loop;
  return v_out;
end $$;
revoke execute on function public.tech_salary_summary() from public, anon;
grant execute on function public.tech_salary_summary() to authenticated;

notify pgrst, 'reload schema';
