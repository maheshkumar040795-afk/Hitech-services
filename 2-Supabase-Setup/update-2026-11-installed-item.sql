-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): "Installed item" on completed jobs
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Run AFTER update-2026-11-status-rates-payout.sql.
--
--  • When a technician marks a job Completed in HT Jobs, he picks what he installed
--    (e.g. "TV Installation (50 - 55 inch)", "Washing Machine Installation").
--    The list = the services on the Rate Config page.
--  • The technician's rate (payout) is taken from Rate Config for the INSTALLED item
--    (falls back to the order's service when no item was picked).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists installed_item text;

-- List of items for the technician app (names only — rates stay hidden from technicians)
create or replace function public.tech_install_items() returns setof text
language sql stable security definer set search_path = public as $$
  select service from service_rates
   where my_technician_id() is not null or is_office()
   order by service
$$;
revoke execute on function public.tech_install_items() from public, anon;
grant execute on function public.tech_install_items() to authenticated;

-- Which name to look up in Rate Config for an order
create or replace function public.rate_item(p_installed text, p_service text) returns text
language sql immutable as $$
  select coalesce(nullif(trim(coalesce(p_installed, '')), ''), p_service)
$$;

create or replace function public.orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text = 'RESCHEDULED' and new.rescheduled_date is null then
    raise exception 'Pick the reschedule date';
  end if;
  if new.status::text <> 'COMPLETED' then new.payment_mode := null; end if;
  if new.payment_mode = 'AMAZON' then new.cod_amount := 0; end if;
  new.installed_item := nullif(trim(coalesce(new.installed_item, '')), '');

  -- region: from the pin code unless the office set it
  if new.region is null or (tg_op = 'UPDATE' and new.pin_code is distinct from old.pin_code and new.region is not distinct from old.region) then
    new.region := region_for(new.pin_code);
  end if;
  -- technician rate: from Rate config for the installed item (or the service) when the job is completed
  if new.status::text = 'COMPLETED' and (new.payout_rate is null
       or (tg_op = 'UPDATE' and (new.service, new.region, new.installed_item) is distinct from (old.service, old.region, old.installed_item)
           and new.payout_rate is not distinct from old.payout_rate)) then
    new.payout_rate := coalesce(rate_for(rate_item(new.installed_item, new.service), new.region), new.payout_rate);
  end if;

  if tg_op = 'INSERT' then
    if new.technician_id is not null then
      new.assigned_at := now(); new.assigned_by := coalesce(new.assigned_by, auth.uid());
    end if;
    if new.status::text not in ('PENDING','RESCHEDULED') then new.closed_at := now(); end if;
    return new;
  end if;

  new.updated_at := now();
  if new.status is distinct from old.status then
    new.closed_at := case when new.status::text in ('PENDING','RESCHEDULED') then null else now() end;
  end if;
  if new.technician_id is distinct from old.technician_id then
    new.assigned_by := auth.uid();
    new.assigned_at := case when new.technician_id is null then null else now() end;
  end if;
  if (new.status, new.cod_amount, new.comments, new.technician_id, new.is_deleted, new.rescheduled_date, new.payment_mode, new.installed_item)
     is distinct from (old.status, old.cod_amount, old.comments, old.technician_id, old.is_deleted, old.rescheduled_date, old.payment_mode, old.installed_item) then
    new.modified_by := coalesce(auth.uid(), new.modified_by);
    new.modified_at := now();
  end if;
  return new;
end $$;

-- Technician app: installed item + Collect amount (Cash / Online) or Paid on Amazon
drop function if exists public.tech_update_job(uuid, public.order_status, numeric, text, text);
create or replace function public.tech_update_job(p_order uuid, p_status public.order_status,
                                                  p_amount numeric default null, p_note text default null,
                                                  p_payment_mode text default null, p_installed_item text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_tech uuid := my_technician_id();
  v_o    orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_mode text := nullif(upper(trim(coalesce(p_payment_mode, ''))), '');
  v_item text := nullif(trim(coalesce(p_installed_item, '')), '');
begin
  if v_tech is null then raise exception 'Only technicians can update jobs here' using errcode = '42501'; end if;

  select * into v_o from orders where id = p_order and not is_deleted for update;
  if not found or v_o.technician_id is distinct from v_tech then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_o.status::text not in ('PENDING','RESCHEDULED') and (v_o.closed_at at time zone 'Asia/Kolkata')::date < today_ist() then
    raise exception 'This job is locked. Please contact the office to change it.';
  end if;
  if p_status::text = 'RESCHEDULED' then raise exception 'Only the office can reschedule a job'; end if;

  if p_status::text = 'COMPLETED' and v_mode = 'AMAZON' then
    p_amount := 0;
  elsif p_status::text = 'COMPLETED' and (p_amount is null or p_amount < 0) then
    raise exception 'Enter the amount collected (enter 0 if nothing was collected)';
  end if;
  if p_status::text = 'COMPLETED' and p_amount > 0 and coalesce(v_mode, '') not in ('CASH','ONLINE') then
    raise exception 'Select Cash or Online';
  end if;
  if p_status::text = 'REJECTED' and v_note is null then
    raise exception 'Please select or type a reason';
  end if;

  update orders set
    status         = case when p_status::text = 'PENDING' and v_o.rescheduled_date is not null then 'RESCHEDULED'::text::order_status else p_status end,
    cod_amount     = case when p_status::text = 'COMPLETED' then round(p_amount, 2)
                          when p_status::text = 'REJECTED'  then 0
                          else cod_amount end,
    payment_mode   = case when p_status::text = 'COMPLETED' and v_mode = 'AMAZON' then 'AMAZON'
                          when p_status::text = 'COMPLETED' and p_amount > 0 then v_mode end,
    installed_item = case when p_status::text = 'COMPLETED' then coalesce(v_item, installed_item) else installed_item end,
    payout_rate    = case when p_status::text = 'COMPLETED' then null else payout_rate end   -- re-taken from Rate config
  where id = p_order
  returning * into v_o;

  if v_note is not null then
    insert into comment_logs(order_id, user_id, comment)
    values (p_order, auth.uid(), case when p_status::text = 'REJECTED' then 'Not completed: ' || v_note else v_note end);
    select * into v_o from orders where id = p_order;
  end if;
  return v_o;
end $$;
revoke execute on function public.tech_update_job(uuid, public.order_status, numeric, text, text, text) from public, anon;
grant execute on function public.tech_update_job(uuid, public.order_status, numeric, text, text, text) to authenticated;

create or replace function public.apply_rates_to_completed(p_from date default null, p_to date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update orders o set payout_rate = r.rate
    from (select id, rate_for(rate_item(installed_item, service), region) as rate from orders) r
   where o.id = r.id and r.rate is not null and o.status::text = 'COMPLETED' and not o.is_deleted
     and (p_from is null or (o.closed_at at time zone 'Asia/Kolkata')::date >= p_from)
     and (p_to   is null or (o.closed_at at time zone 'Asia/Kolkata')::date <= p_to)
     and o.payout_rate is distinct from r.rate;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.apply_rates_to_completed(date, date) from public, anon;
grant execute on function public.apply_rates_to_completed(date, date) to authenticated;

notify pgrst, 'reload schema';
