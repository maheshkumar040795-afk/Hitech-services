-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Oct 2026): order edit, Google Maps link, Reschedule,
--  completed date and Cash / Online payment
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Existing data is kept.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. New status "Rescheduled" (still open work: shows in the technician's Pending list)
alter type public.order_status add value if not exists 'RESCHEDULED';

-- 2. New order fields
alter table public.orders add column if not exists location_url     text;   -- Google Maps link
alter table public.orders add column if not exists rescheduled_date date;   -- new visit date when status = Rescheduled
alter table public.orders add column if not exists payment_mode     text;   -- CASH / ONLINE (how the amount was collected)
do $$ begin
  alter table public.orders add constraint orders_payment_mode_check check (payment_mode is null or payment_mode in ('CASH','ONLINE'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_location_url_check check (location_url is null or location_url ~* '^https?://');
exception when duplicate_object then null; end $$;
create index if not exists orders_resched_idx on public.orders (rescheduled_date) where rescheduled_date is not null;

-- 3. closed_at = completed / not-done date & time (stays empty while Pending or Rescheduled)
create or replace function public.orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text = 'RESCHEDULED' and new.rescheduled_date is null then
    raise exception 'Pick the reschedule date';
  end if;
  if new.status::text <> 'COMPLETED' then new.payment_mode := null; end if;

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

-- 4. Reschedule shows in the order history
create or replace function public.orders_reschedule_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text = 'RESCHEDULED' and (old.status is distinct from new.status or old.rescheduled_date is distinct from new.rescheduled_date) then
    insert into comment_logs(order_id, user_id, comment)
    values (new.id, auth.uid(), 'Rescheduled to ' || to_char(new.rescheduled_date, 'DD Mon YYYY'));
  end if;
  return null;
end $$;
drop trigger if exists orders_reschedule_log on public.orders;
create trigger orders_reschedule_log after update of status, rescheduled_date on public.orders
for each row execute function public.orders_reschedule_log();

-- 5. Technician app: Completed now asks Cash or Online
drop function if exists public.tech_update_job(uuid, public.order_status, numeric, text);
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

  if p_status::text = 'COMPLETED' and (p_amount is null or p_amount < 0) then
    raise exception 'Enter the amount collected (enter 0 if nothing was collected)';
  end if;
  if p_status::text = 'COMPLETED' and p_amount > 0 and coalesce(v_mode, '') not in ('CASH','ONLINE') then
    raise exception 'Select Cash or Online';
  end if;
  if p_status::text = 'REJECTED' and v_note is null then
    raise exception 'Please select or type a reason';
  end if;

  update orders set
    -- re-opening a rescheduled job keeps it Rescheduled (with its date)
    status       = case when p_status::text = 'PENDING' and v_o.rescheduled_date is not null then 'RESCHEDULED'::text::order_status else p_status end,
    cod_amount   = case when p_status::text = 'COMPLETED' then round(p_amount, 2)
                        when p_status::text = 'REJECTED'  then 0
                        else cod_amount end,
    payment_mode = case when p_status::text = 'COMPLETED' and p_amount > 0 then v_mode end
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

-- 6. Counts: Rescheduled counts as open work (Pending); Cash / Online totals on the dashboard
create or replace function public.dashboard_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; prev record; v_len int;
begin
  if not is_office() then raise exception 'Not allowed' using errcode = '42501'; end if;
  v_len := greatest((p_to - p_from) + 1, 1);

  select count(*)                                                   as total,
         count(*) filter (where status = 'COMPLETED')               as completed,
         count(*) filter (where status::text in ('PENDING','RESCHEDULED'))                 as pending,
         count(*) filter (where status = 'REJECTED')                as rejected,
         count(*) filter (where status::text in ('PENDING','RESCHEDULED') and technician_id is null) as unassigned,
         coalesce(sum(cod_amount) filter (where status = 'COMPLETED'), 0)   as amount,
         coalesce(sum(cod_amount) filter (where status = 'COMPLETED' and payment_mode = 'CASH'), 0)   as amount_cash,
         coalesce(sum(cod_amount) filter (where status = 'COMPLETED' and payment_mode = 'ONLINE'), 0) as amount_online,
         count(*) filter (where status::text = 'RESCHEDULED')       as rescheduled,
         round((avg(extract(epoch from (closed_at - assigned_at)) / 3600)
                filter (where status = 'COMPLETED' and assigned_at is not null and closed_at > assigned_at))::numeric, 1) as avg_hours
    into r
    from orders where not is_deleted and order_date between p_from and p_to;

  select count(*) as total, count(*) filter (where status = 'COMPLETED') as completed
    into prev
    from orders where not is_deleted and order_date between p_from - v_len and p_from - 1;

  return jsonb_build_object(
    'total', r.total, 'completed', r.completed, 'pending', r.pending, 'rejected', r.rejected,
    'unassigned', r.unassigned, 'amount', r.amount, 'amount_cash', r.amount_cash, 'amount_online', r.amount_online, 'rescheduled', r.rescheduled, 'avg_hours', r.avg_hours,
    'completion_rate', case when r.total > 0 then round(r.completed * 100.0 / r.total) else 0 end,
    'deltas', jsonb_build_object(
      'total',     case when prev.total > 0     then round((r.total - prev.total) * 100.0 / prev.total) end,
      'completed', case when prev.completed > 0 then round((r.completed - prev.completed) * 100.0 / prev.completed) end));
end $$;

create or replace function public.dashboard_trend(p_days int default 7)
returns table(day date, total bigint, completed bigint, pending bigint, rejected bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
    select d::date,
           count(o.id),
           count(o.id) filter (where o.status = 'COMPLETED'),
           count(o.id) filter (where o.status::text in ('PENDING','RESCHEDULED')),
           count(o.id) filter (where o.status = 'REJECTED')
      from generate_series(today_ist() - (least(greatest(p_days, 1), 90) - 1), today_ist(), interval '1 day') d
      left join orders o on o.order_date = d::date and not o.is_deleted
     group by d order by d;
end $$;

create or replace function public.technician_stats(p_from date default null, p_to date default null)
returns table(technician_id uuid, total bigint, completed bigint, pending bigint, rejected bigint,
              amount numeric, done_today bigint, amount_today numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
    select t.id,
           count(o.id),
           count(o.id) filter (where o.status = 'COMPLETED'),
           count(o.id) filter (where o.status::text in ('PENDING','RESCHEDULED')),
           count(o.id) filter (where o.status = 'REJECTED'),
           coalesce(sum(o.cod_amount) filter (where o.status = 'COMPLETED'), 0),
           count(o.id) filter (where o.status = 'COMPLETED' and (o.closed_at at time zone 'Asia/Kolkata')::date = today_ist()),
           coalesce(sum(o.cod_amount) filter (where o.status = 'COMPLETED' and (o.closed_at at time zone 'Asia/Kolkata')::date = today_ist()), 0)
      from technicians t
      left join orders o on o.technician_id = t.id and not o.is_deleted
                        and (p_from is null or o.order_date >= p_from)
                        and (p_to   is null or o.order_date <= p_to)
     group by t.id;
end $$;

create or replace function public.technician_monthly(p_tech uuid)
returns table(label text, total bigint, completed bigint, pending bigint, rejected bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
    select to_char(m, 'Mon YY'),
           count(o.id),
           count(o.id) filter (where o.status = 'COMPLETED'),
           count(o.id) filter (where o.status::text in ('PENDING','RESCHEDULED')),
           count(o.id) filter (where o.status = 'REJECTED')
      from generate_series(date_trunc('month', today_ist()) - interval '5 months', date_trunc('month', today_ist()), interval '1 month') m
      left join orders o on o.technician_id = p_tech and not o.is_deleted
                        and o.order_date >= m::date and o.order_date < (m + interval '1 month')::date
     group by m order by m;
end $$;

-- 7. Excel upload: optional "LOCATION URL" column; rescheduled orders treated like pending
create or replace function public.import_orders(p_rows jsonb, p_filename text default 'upload.xlsx')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb; v_idx int := 0;
  v_processed int := 0; v_created int := 0; v_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_order_id text; v_name text; v_tech_name text; v_tech_id uuid;
  v_status order_status; v_status_raw text; v_date date; v_exists boolean;
  v_log_id uuid; v_failed int;
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
      v_status := case when v_status_raw in ('PENDING','COMPLETED','REJECTED') then v_status_raw::order_status end;

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

      v_exists := exists (select 1 from orders where order_id = v_order_id);

      insert into orders (order_id, order_date, customer_name, phone_no, service, brand, location, address,
                          pin_code, status, comments, technician_id, assigned_by, modified_by, modified_at, location_url)
      values (v_order_id, v_date, v_name,
              nullif(trim(v_row->>'phone_no'), ''), nullif(trim(v_row->>'service'), ''),
              nullif(trim(v_row->>'brand'), ''),    nullif(trim(v_row->>'location'), ''),
              nullif(trim(v_row->>'address'), ''),  nullif(trim(v_row->>'pin_code'), ''),
              coalesce(v_status, 'PENDING'), nullif(trim(v_row->>'comments'), ''),
              v_tech_id, auth.uid(), auth.uid(), now(), nullif(trim(v_row->>'location_url'), ''))
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
          jsonb_build_object('file', p_filename, 'processed', v_processed, 'created', v_created,
                             'updated', v_updated, 'failed', v_failed),
          'Excel upload "' || coalesce(p_filename, '') || '": ' || v_created || ' new, ' || v_updated || ' updated, ' || v_failed || ' failed',
          auth.uid());

  return jsonb_build_object('processed', v_processed, 'created', v_created, 'updated', v_updated,
                            'failed', v_failed,
                            'errors', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_errors) e limit 50) s), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
