-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Oct 2026): unique Technician ID + keep-alive ping
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Existing data is kept.
--
--  • Every technician gets a unique ID, e.g. HT001, HT002 …
--  • Admin can type an ID when adding a technician; leave it blank → next free ID is given.
--  • Existing technicians are numbered in the order they were added.
--  • keep_alive(): tiny read-only function the GitHub "Keep Supabase awake" job calls
--    so the free project is never auto-paused. Returns 1, touches no data.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Column
alter table public.technicians add column if not exists tech_code text;

-- 2. Next free HT number (ignores any custom IDs that are not HT + digits)
create or replace function public.next_tech_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_n int; v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('technicians.tech_code'));
  select coalesce(max(substring(tech_code from '^HT(\d+)$')::int), 0) + 1 into v_n
    from technicians where tech_code ~ '^HT\d+$';
  loop
    v_code := 'HT' || lpad(v_n::text, 3, '0');
    exit when not exists (select 1 from technicians where upper(tech_code) = v_code);
    v_n := v_n + 1;
  end loop;
  return v_code;
end $$;

-- 3. Clean typed IDs and fill blanks automatically (works for the form, Excel import and order upload)
create or replace function public.technicians_set_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.tech_code := nullif(upper(regexp_replace(coalesce(new.tech_code, ''), '\s+', '', 'g')), '');
  if new.tech_code is null then
    if tg_op = 'UPDATE' and old.tech_code is not null then
      new.tech_code := old.tech_code;            -- clearing the box keeps the old ID
    else
      new.tech_code := public.next_tech_code();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists technicians_set_code on public.technicians;
create trigger technicians_set_code before insert or update of tech_code on public.technicians
for each row execute function public.technicians_set_code();

-- 4. Number existing technicians (oldest first)
do $$
declare r record;
begin
  for r in select id from public.technicians where tech_code is null or trim(tech_code) = '' order by created_at, name loop
    update public.technicians set tech_code = public.next_tech_code() where id = r.id;
  end loop;
end $$;

-- 5. Required + unique (case-insensitive) + simple format: letters, digits, - or /
alter table public.technicians alter column tech_code set not null;
create unique index if not exists technicians_code_uq on public.technicians (upper(tech_code));
do $$ begin
  alter table public.technicians add constraint technicians_code_check check (tech_code ~ '^[A-Z0-9/-]{1,20}$');
exception when duplicate_object then null; end $$;

-- 6. Audit log shows the ID too
create or replace function public.technicians_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(action, entity_type, entity_id, new_value, note, actor_id)
  values (case when tg_op = 'INSERT' then 'TECHNICIAN_CREATED' else 'TECHNICIAN_UPDATED' end,
          'technician', new.id::text,
          jsonb_build_object('id', new.tech_code, 'name', new.name, 'mobile', new.mobile, 'city', new.city, 'active', new.is_active),
          'Technician ' || new.name || ' (' || new.tech_code || ')' || case when tg_op = 'INSERT' then ' added' else ' updated' end,
          auth.uid());
  return null;
end $$;
drop trigger if exists technicians_audit on public.technicians;
create trigger technicians_audit after insert or update of tech_code, name, mobile, city, district, pincode, is_active
on public.technicians for each row
when (coalesce(current_setting('app.bulk_import', true), '') <> 'on')
execute function public.technicians_audit();

-- 6b. Order Excel upload: TECHNICIAN column can be the ID (HT001) or the name
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
                          pin_code, status, comments, technician_id, assigned_by, modified_by, modified_at)
      values (v_order_id, v_date, v_name,
              nullif(trim(v_row->>'phone_no'), ''), nullif(trim(v_row->>'service'), ''),
              nullif(trim(v_row->>'brand'), ''),    nullif(trim(v_row->>'location'), ''),
              nullif(trim(v_row->>'address'), ''),  nullif(trim(v_row->>'pin_code'), ''),
              coalesce(v_status, 'PENDING'), nullif(trim(v_row->>'comments'), ''),
              v_tech_id, auth.uid(), auth.uid(), now())
      on conflict (order_id) do update set
        order_date    = excluded.order_date,
        customer_name = excluded.customer_name,
        phone_no      = coalesce(excluded.phone_no, orders.phone_no),
        service       = coalesce(excluded.service,  orders.service),
        brand         = coalesce(excluded.brand,    orders.brand),
        location      = coalesce(excluded.location, orders.location),
        address       = coalesce(excluded.address,  orders.address),
        pin_code      = coalesce(excluded.pin_code, orders.pin_code),
        comments      = coalesce(excluded.comments, orders.comments),
        status        = case when orders.status = 'PENDING' then coalesce(v_status, orders.status) else orders.status end,
        technician_id = case when orders.status = 'PENDING' then coalesce(excluded.technician_id, orders.technician_id) else orders.technician_id end,
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

-- 7. Keep-alive ping for the GitHub job (read-only, returns 1)
create or replace function public.keep_alive() returns int language sql stable as $$ select 1 $$;
revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

-- next_tech_code is only for the trigger
revoke execute on function public.next_tech_code() from public, anon, authenticated;

notify pgrst, 'reload schema';
