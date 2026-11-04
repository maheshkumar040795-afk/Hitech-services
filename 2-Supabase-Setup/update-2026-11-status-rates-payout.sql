-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): technician status, rate config, payouts
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Existing data is kept.
--
--  • Technician login / logout / last seen times (online-now comes live from the app)
--  • Service rates: one rate for Within Chennai and one for Outside Chennai
--  • Each order gets its region (Chennai by 600xxx pin code) and, when completed,
--    a snapshot of the rate → technician payout = rates − money the technician collected
--  • New payment type "Paid on Amazon" (customer already paid; technician collects nothing)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Technician login / logout / last seen
alter table public.technicians add column if not exists last_seen_at   timestamptz;
alter table public.technicians add column if not exists last_login_at  timestamptz;
alter table public.technicians add column if not exists last_logout_at timestamptz;

create or replace function public.tech_activity(p_event text default 'seen') returns void
language plpgsql security definer set search_path = public as $$
begin
  update technicians set
    last_seen_at   = now(),
    last_login_at  = case when p_event = 'login'  then now() else last_login_at end,
    last_logout_at = case when p_event = 'logout' then now() else last_logout_at end
  where user_id = auth.uid();
end $$;
revoke execute on function public.tech_activity(text) from public, anon;
grant execute on function public.tech_activity(text) to authenticated;

-- 2. Rate config (per service: Within Chennai / Outside Chennai)
create table if not exists public.service_rates (
  id            uuid primary key default gen_random_uuid(),
  service       text not null check (length(trim(service)) > 0),
  rate_chennai  numeric(12,2) check (rate_chennai is null or rate_chennai >= 0),
  rate_outside  numeric(12,2) check (rate_outside is null or rate_outside >= 0),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create unique index if not exists service_rates_key on public.service_rates (lower(trim(service)));
alter table public.service_rates enable row level security;
drop policy if exists service_rates_select on public.service_rates;
create policy service_rates_select on public.service_rates for select to authenticated using ((select public.is_office()));
drop policy if exists service_rates_write on public.service_rates;
create policy service_rates_write on public.service_rates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.service_rates to authenticated;
grant all on public.service_rates to service_role;

-- 3. Order region + rate snapshot; "Paid on Amazon"
alter table public.orders add column if not exists region      text;   -- CHENNAI / OUTSIDE
alter table public.orders add column if not exists payout_rate numeric(12,2);   -- technician's rate for this job (set when completed)
do $$ begin
  alter table public.orders add constraint orders_region_check check (region is null or region in ('CHENNAI','OUTSIDE'));
exception when duplicate_object then null; end $$;
alter table public.orders drop constraint if exists orders_payment_mode_check;
alter table public.orders add constraint orders_payment_mode_check check (payment_mode is null or payment_mode in ('CASH','ONLINE','AMAZON'));

-- Chennai = pin code 600xxx (or no pin code); any other pin code = Outside Chennai
create or replace function public.region_for(p_pin text) returns text
language sql immutable as $$
  select case when coalesce(trim(p_pin), '') = '' or trim(p_pin) like '600%' then 'CHENNAI' else 'OUTSIDE' end
$$;

create or replace function public.rate_for(p_service text, p_region text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_region = 'OUTSIDE' then rate_outside else rate_chennai end
    from service_rates where lower(trim(service)) = lower(trim(coalesce(p_service, ''))) limit 1
$$;

create or replace function public.orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text = 'RESCHEDULED' and new.rescheduled_date is null then
    raise exception 'Pick the reschedule date';
  end if;
  if new.status::text <> 'COMPLETED' then new.payment_mode := null; end if;
  if new.payment_mode = 'AMAZON' then new.cod_amount := 0; end if;

  -- region: from the pin code unless the office set it
  if new.region is null or (tg_op = 'UPDATE' and new.pin_code is distinct from old.pin_code and new.region is not distinct from old.region) then
    new.region := region_for(new.pin_code);
  end if;
  -- technician rate: taken from Rate config when the job is completed (later rate changes don't alter past payouts)
  if new.status::text = 'COMPLETED' and (new.payout_rate is null
       or (tg_op = 'UPDATE' and (new.service, new.region) is distinct from (old.service, old.region) and new.payout_rate is not distinct from old.payout_rate)) then
    new.payout_rate := coalesce(rate_for(new.service, new.region), new.payout_rate);
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
  if (new.status, new.cod_amount, new.comments, new.technician_id, new.is_deleted, new.rescheduled_date, new.payment_mode)
     is distinct from (old.status, old.cod_amount, old.comments, old.technician_id, old.is_deleted, old.rescheduled_date, old.payment_mode) then
    new.modified_by := coalesce(auth.uid(), new.modified_by);
    new.modified_at := now();
  end if;
  return new;
end $$;

-- Technician app: Cash / Online with an amount, or "Paid on Amazon" (amount 0)
create or replace function public.tech_update_job(p_order uuid, p_status public.order_status,
                                                  p_amount numeric default null, p_note text default null,
                                                  p_payment_mode text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_tech uuid := my_technician_id();
  v_o    orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_mode text := nullif(upper(trim(coalesce(p_payment_mode, ''))), '');
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
    status       = case when p_status::text = 'PENDING' and v_o.rescheduled_date is not null then 'RESCHEDULED'::text::order_status else p_status end,
    cod_amount   = case when p_status::text = 'COMPLETED' then round(p_amount, 2)
                        when p_status::text = 'REJECTED'  then 0
                        else cod_amount end,
    payment_mode = case when p_status::text = 'COMPLETED' and v_mode = 'AMAZON' then 'AMAZON'
                        when p_status::text = 'COMPLETED' and p_amount > 0 then v_mode end,
    payout_rate  = case when p_status::text = 'COMPLETED' then null else payout_rate end   -- re-taken from Rate config
  where id = p_order
  returning * into v_o;

  if v_note is not null then
    insert into comment_logs(order_id, user_id, comment)
    values (p_order, auth.uid(), case when p_status::text = 'REJECTED' then 'Not completed: ' || v_note else v_note end);
    select * into v_o from orders where id = p_order;
  end if;
  return v_o;
end $$;
revoke execute on function public.tech_update_job(uuid, public.order_status, numeric, text, text) from public, anon;
grant execute on function public.tech_update_job(uuid, public.order_status, numeric, text, text) to authenticated;

-- 4. Fill region for existing orders; rate for already-completed ones (once rates are entered,
--    use the "Apply rates to completed jobs" button on the Rate config page)
update public.orders set region = public.region_for(pin_code) where region is null;

create or replace function public.apply_rates_to_completed(p_from date default null, p_to date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update orders o set payout_rate = r.rate
    from (select id, rate_for(service, region) as rate from orders) r
   where o.id = r.id and r.rate is not null and o.status::text = 'COMPLETED' and not o.is_deleted
     and (p_from is null or (o.closed_at at time zone 'Asia/Kolkata')::date >= p_from)
     and (p_to   is null or (o.closed_at at time zone 'Asia/Kolkata')::date <= p_to)
     and o.payout_rate is distinct from r.rate;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.apply_rates_to_completed(date, date) from public, anon;
grant execute on function public.apply_rates_to_completed(date, date) to authenticated;

-- 5. Payout setting: does money paid "Online" go to the technician (deduct) or the company?
alter table public.app_settings add column if not exists online_to_technician boolean not null default true;

notify pgrst, 'reload schema';
