-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): REPAIRS (separate screen, rates, payout, HT Jobs)
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Run AFTER update-2026-11-job-photos.sql.
--
--  • Every order now has a JOB TYPE: INSTALLATION (all existing orders) or REPAIR.
--    The office "Repairs" screen works like Orders (upload, assign, status, cancel, export).
--  • Rate Config has separate REPAIR rates (Within Chennai / Outside Chennai).
--    A completed repair takes its rate from the repair list; an installation from the installation list.
--  • Technician Payout and HT Jobs salary show installations and repairs separately.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Job type on orders (existing orders = installations)
alter table public.orders add column if not exists job_type text not null default 'INSTALLATION';
do $$ begin
  alter table public.orders add constraint orders_job_type_check check (job_type in ('INSTALLATION','REPAIR'));
exception when duplicate_object then null; end $$;
create index if not exists orders_job_type_date_idx on public.orders (job_type, order_date desc) where not is_deleted;

-- 2. Rate Config: installation rates and repair rates (same name may exist in both lists)
alter table public.service_rates add column if not exists kind text not null default 'INSTALLATION';
do $$ begin
  alter table public.service_rates add constraint service_rates_kind_check check (kind in ('INSTALLATION','REPAIR'));
exception when duplicate_object then null; end $$;
drop index if exists public.service_rates_key;
create unique index if not exists service_rates_kind_key on public.service_rates (kind, lower(trim(service)));

-- Rate for a service / item, Within or Outside Chennai, from the installation or repair list
drop function if exists public.rate_for(text, text);
create or replace function public.rate_for(p_service text, p_region text, p_kind text default 'INSTALLATION') returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_region = 'OUTSIDE' then rate_outside else rate_chennai end
    from service_rates
   where kind = case when upper(coalesce(p_kind, '')) = 'REPAIR' then 'REPAIR' else 'INSTALLATION' end
     and lower(trim(service)) = lower(trim(coalesce(p_service, ''))) limit 1
$$;

-- 3. Rate on completion: from the list that matches the job type
create or replace function public.orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text = 'RESCHEDULED' and new.rescheduled_date is null then
    raise exception 'Pick the reschedule date';
  end if;
  if new.status::text <> 'COMPLETED' then new.payment_mode := null; end if;
  -- Cancelled = the owner installed it himself → no technician, no rate (shown as "Own Installation")
  if new.status::text = 'CANCELLED' then new.technician_id := null; new.payout_rate := null; end if;
  new.state       := nullif(trim(coalesce(new.state, '')), '');
  new.vendor_name := nullif(trim(coalesce(new.vendor_name, '')), '');
  if new.payment_mode = 'AMAZON' then new.cod_amount := 0; end if;
  new.installed_item := nullif(trim(coalesce(new.installed_item, '')), '');
  new.job_type := case when upper(trim(coalesce(new.job_type, ''))) = 'REPAIR' then 'REPAIR' else 'INSTALLATION' end;

  -- region: from the pin code unless the office set it
  if new.region is null or (tg_op = 'UPDATE' and new.pin_code is distinct from old.pin_code and new.region is not distinct from old.region) then
    new.region := region_for(new.pin_code);
  end if;
  -- technician rate: from Rate config for the installed item (or the service) when the job is completed
  if new.status::text = 'COMPLETED' and (new.payout_rate is null
       or (tg_op = 'UPDATE' and (new.service, new.region, new.installed_item, new.job_type) is distinct from (old.service, old.region, old.installed_item, old.job_type)
           and new.payout_rate is not distinct from old.payout_rate)) then
    new.payout_rate := coalesce(rate_for(rate_item(new.installed_item, new.service), new.region, new.job_type), new.payout_rate);
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

create or replace function public.apply_rates_to_completed(p_from date default null, p_to date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update orders o set payout_rate = r.rate
    from (select id, rate_for(rate_item(installed_item, service), region, job_type) as rate from orders) r
   where o.id = r.id and r.rate is not null and o.status::text = 'COMPLETED' and not o.is_deleted
     and (p_from is null or (o.closed_at at time zone 'Asia/Kolkata')::date >= p_from)
     and (p_to   is null or (o.closed_at at time zone 'Asia/Kolkata')::date <= p_to)
     and o.payout_rate is distinct from r.rate;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.apply_rates_to_completed(date, date) from public, anon;
grant execute on function public.apply_rates_to_completed(date, date) to authenticated;

-- 4. HT Jobs: "What did you install?" list = installation items; "What did you repair?" = repair items
create or replace function public.tech_install_items() returns setof text
language sql stable security definer set search_path = public as $$
  select service from service_rates
   where kind = 'INSTALLATION' and (my_technician_id() is not null or is_office())
   order by service
$$;
create or replace function public.tech_repair_items() returns setof text
language sql stable security definer set search_path = public as $$
  select service from service_rates
   where kind = 'REPAIR' and (my_technician_id() is not null or is_office())
   order by service
$$;
revoke execute on function public.tech_repair_items() from public, anon;
grant execute on function public.tech_repair_items() to authenticated;

-- 5. Monthly totals, split into installations and repairs
drop function if exists public.tech_month_totals(uuid, date);
create or replace function public.tech_month_totals(p_tech uuid, p_month date)
returns table(jobs int, earned numeric, collected numeric,
              installs int, install_earned numeric, repairs int, repair_earned numeric)
language sql stable security definer set search_path = public as $$
  with j as (
    select job_type,
           coalesce(payout_rate, rate_for(rate_item(installed_item, service), region, job_type), 0) as rate,
           case when payment_mode = 'AMAZON' then 0 else cod_amount end as coll
      from orders
     where technician_id = p_tech and status::text = 'COMPLETED' and not is_deleted
       and (closed_at at time zone 'Asia/Kolkata')::date >= p_month
       and (closed_at at time zone 'Asia/Kolkata')::date <  (p_month + interval '1 month')::date
  )
  select count(*)::int, coalesce(sum(rate), 0), coalesce(sum(coll), 0),
         (count(*) filter (where job_type <> 'REPAIR'))::int, coalesce(sum(rate) filter (where job_type <> 'REPAIR'), 0),
         (count(*) filter (where job_type = 'REPAIR'))::int,  coalesce(sum(rate) filter (where job_type = 'REPAIR'), 0)
    from j
$$;
revoke execute on function public.tech_month_totals(uuid, date) from public, anon, authenticated;

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
      'installs', t.installs, 'install_earned', t.install_earned,
      'repairs', t.repairs, 'repair_earned', t.repair_earned,
      'net', t.earned - t.collected,
      'paid', p.amount, 'paid_at', p.paid_at,
      'balance', t.earned - t.collected - coalesce(p.amount, 0)));
  end loop;
  return v_out;
end $$;
revoke execute on function public.tech_salary_summary() from public, anon;
grant execute on function public.tech_salary_summary() to authenticated;

-- 6. Upload / Google Sheet import: Orders screen imports installations, Repairs screen imports repairs.
--    An Order ID that already exists as the other type is reported as an error (not overwritten).
drop function if exists public.import_orders(jsonb, text);
create or replace function public.import_orders(p_rows jsonb, p_filename text default 'upload.xlsx', p_job_type text default 'INSTALLATION')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb; v_idx int := 0;
  v_processed int := 0; v_created int := 0; v_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_order_id text; v_name text; v_tech_name text; v_tech_id uuid;
  v_status order_status; v_status_raw text; v_date date; v_exists boolean;
  v_log_id uuid; v_failed int;
  v_type text := case when upper(trim(coalesce(p_job_type, ''))) = 'REPAIR' then 'REPAIR' else 'INSTALLATION' end;
  v_other text;
begin
  if not is_office() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid file data'; end if;
  if jsonb_array_length(p_rows) = 0 then raise exception 'File has no data rows'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Max 5000 rows per upload'; end if;
  if not pg_try_advisory_xact_lock(hashtext('hitech_order_import')) then
    raise exception 'UPLOAD_LOCKED: Another file is being processed. Please try again in a moment.';
  end if;

  perform set_config('app.bulk_import', 'on', true);   -- skip per-row audit; one summary row below

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      v_order_id := nullif(trim(v_row->>'order_id'), '');
      v_name     := nullif(trim(v_row->>'customer_name'), '');
      if v_order_id is null or v_name is null then
        v_errors := v_errors || jsonb_build_object('row', v_idx + 1, 'error', 'Missing ORDER ID or CUSTOMER NAME');
        continue;
      end if;

      v_date := coalesce(nullif(v_row->>'order_date', '')::date, today_ist());
      v_status_raw := upper(nullif(trim(v_row->>'status'), ''));
      -- Amazon / office wording → our status (anything else leaves the status as it is)
      v_status := case regexp_replace(coalesce(v_status_raw, ''), '[^A-Z]', '', 'g')
                    when 'COMPLETED' then 'COMPLETED' when 'PHYSICALLYCOMPLETED' then 'COMPLETED' when 'DONE' then 'COMPLETED' when 'CLOSED' then 'COMPLETED'
                    when 'PENDING' then 'PENDING' when 'NOTSERVICED' then 'PENDING' when 'OPEN' then 'PENDING' when 'NEW' then 'PENDING' when 'ASSIGNED' then 'PENDING'
                    when 'REJECTED' then 'REJECTED' when 'CANCELLED' then 'REJECTED' when 'CANCELED' then 'REJECTED' when 'NOTDONE' then 'REJECTED'
                  end::text::order_status;

      v_tech_id := null;
      v_tech_name := nullif(trim(v_row->>'technician'), '');
      if v_tech_name is not null then
        select id into v_tech_id from technicians
          where upper(tech_code) = upper(replace(v_tech_name, ' ', '')) or lower(name) = lower(v_tech_name)
          order by (upper(tech_code) = upper(replace(v_tech_name, ' ', ''))) desc limit 1;   -- TECHNICIAN column may hold the ID (HT001) or the name
        if v_tech_id is null then
          insert into technicians(name) values (v_tech_name) returning id into v_tech_id;
        end if;
      end if;

      select job_type into v_other from orders where order_id = v_order_id;
      v_exists := found;
      if v_exists and v_other is distinct from v_type then
        v_errors := v_errors || jsonb_build_object('row', v_idx + 1, 'error',
          'Order ID ' || v_order_id || ' is already in ' || case when v_other = 'REPAIR' then 'Repairs' else 'Orders (installation)' end);
        continue;
      end if;

      insert into orders (order_id, order_date, customer_name, phone_no, service, brand, location, address,
                          pin_code, status, comments, technician_id, assigned_by, modified_by, modified_at, location_url, product_type, source_status,
                          state, vendor_name, job_type)
      values (v_order_id, v_date, v_name,
              nullif(trim(v_row->>'phone_no'), ''), nullif(trim(v_row->>'service'), ''),
              nullif(trim(v_row->>'brand'), ''),    nullif(trim(v_row->>'location'), ''),
              nullif(trim(v_row->>'address'), ''),  nullif(trim(v_row->>'pin_code'), ''),
              coalesce(v_status, 'PENDING'), nullif(trim(v_row->>'comments'), ''),
              v_tech_id, auth.uid(), auth.uid(), now(), nullif(trim(v_row->>'location_url'), ''),
              nullif(trim(v_row->>'product_type'), ''), nullif(trim(v_row->>'status'), ''),
              nullif(trim(v_row->>'state'), ''), nullif(trim(v_row->>'vendor_name'), ''), v_type)
      on conflict (order_id) do update set
        order_date    = excluded.order_date,
        customer_name = excluded.customer_name,
        phone_no      = coalesce(excluded.phone_no, orders.phone_no),
        service       = coalesce(excluded.service,  orders.service),
        brand         = coalesce(excluded.brand,    orders.brand),
        location      = coalesce(excluded.location, orders.location),
        address       = coalesce(excluded.address,  orders.address),
        pin_code      = coalesce(excluded.pin_code, orders.pin_code),
        location_url  = coalesce(excluded.location_url, orders.location_url),
        product_type  = coalesce(excluded.product_type, orders.product_type),
        source_status = coalesce(excluded.source_status, orders.source_status),
        state         = coalesce(excluded.state, orders.state),
        vendor_name   = coalesce(excluded.vendor_name, orders.vendor_name),
        comments      = coalesce(excluded.comments, orders.comments),
        status        = case when orders.status::text in ('PENDING','RESCHEDULED') then coalesce(v_status, orders.status) else orders.status end,
        technician_id = case when orders.status::text in ('PENDING','RESCHEDULED') then coalesce(excluded.technician_id, orders.technician_id) else orders.technician_id end,
        is_deleted    = false;

      if v_exists then v_updated := v_updated + 1; else v_created := v_created + 1; end if;
      v_processed := v_processed + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_idx + 1, 'error', sqlerrm);
    end;
  end loop;

  v_failed := jsonb_array_length(v_errors);
  insert into upload_logs(filename, upload_type, status, records_processed, records_created, records_updated,
                          records_failed, error_message, uploaded_by)
  values (coalesce(nullif(p_filename, ''), 'upload.xlsx'), 'excel',
          case when v_processed = 0 then 'FAILED' when v_failed = 0 then 'SUCCESS' else 'PARTIAL' end::upload_status,
          v_processed, v_created, v_updated, v_failed,
          case when v_failed > 0 then left((select jsonb_agg(e) from (select e from jsonb_array_elements(v_errors) e limit 20) s)::text, 4000) end,
          auth.uid())
  returning id into v_log_id;

  insert into audit_logs(action, entity_type, entity_id, new_value, note, actor_id)
  values ('UPLOAD_EXCEL', 'upload', v_log_id::text,
          jsonb_build_object('file', p_filename, 'job_type', v_type, 'processed', v_processed, 'created', v_created,
                             'updated', v_updated, 'failed', v_failed),
          case when v_type = 'REPAIR' then 'Repairs ' else '' end || 'Excel upload "' || coalesce(p_filename, '') || '": ' || v_created || ' new, ' || v_updated || ' updated, ' || v_failed || ' failed',
          auth.uid());

  return jsonb_build_object('processed', v_processed, 'created', v_created, 'updated', v_updated,
                            'failed', v_failed,
                            'errors', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_errors) e limit 50) s), '[]'::jsonb));
end $$;
revoke execute on function public.import_orders(jsonb, text, text) from public, anon;
grant execute on function public.import_orders(jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
