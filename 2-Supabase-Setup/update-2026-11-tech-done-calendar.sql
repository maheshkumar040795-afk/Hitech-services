-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): HT Jobs "Done" calendar
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Run AFTER update-2026-11-delete-technicians.sql.
--
--  HT Jobs → Done: a month calendar. The technician picks a day (or the whole month) and
--  sees every completed job with installed / repaired item, EARNED (Rate Config rate),
--  cash collected, location and pin code, plus totals.
-- ════════════════════════════════════════════════════════════════════════════

-- Completed jobs of the logged-in technician between two dates (India time), max ~2 months.
create or replace function public.tech_done_jobs(p_from date, p_to date)
returns table(id uuid, order_id text, customer_name text, job_type text, service text, installed_item text,
              location text, pin_code text, region text, closed_at timestamptz, closed_on date,
              payment_mode text, earned numeric, collected numeric, photos text[])
language plpgsql stable security definer set search_path = public as $$
declare v_tech uuid := my_technician_id();
begin
  if v_tech is null then raise exception 'Only technicians' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Pick up to 2 months';
  end if;
  return query
  select o.id, o.order_id, o.customer_name, o.job_type, o.service, o.installed_item,
         o.location, o.pin_code, o.region, o.closed_at, (o.closed_at at time zone 'Asia/Kolkata')::date,
         o.payment_mode::text,
         coalesce(o.payout_rate, rate_for(rate_item(o.installed_item, o.service), o.region, o.job_type), 0),
         case when o.payment_mode::text = 'AMAZON' then 0 else coalesce(o.cod_amount, 0) end,
         coalesce(o.photos, '{}')
    from orders o
   where o.technician_id = v_tech and o.status::text = 'COMPLETED' and not o.is_deleted
     and (o.closed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
   order by o.closed_at desc;
end $$;
revoke execute on function public.tech_done_jobs(date, date) from public, anon;
grant execute on function public.tech_done_jobs(date, date) to authenticated;

notify pgrst, 'reload schema';
