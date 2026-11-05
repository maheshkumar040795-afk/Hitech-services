-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): order sheet in the Amazon model format
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run.
--
--  Sheet columns: DATE, SERVICE_ORDER_ID, CUSTOMER NAME, PHONE NUMBER, SERVICE, BRAND,
--                 PRODUCT_TYPE, LOCATION, PIN CODE, TECHNICIAN, STATUS
--  • PRODUCT_TYPE is saved on each order (e.g. TELEVISION)
--  • STATUS from the sheet is kept as written (e.g. "Physically completed") and mapped:
--      COMPLETED / Physically completed → Completed,  NOT_SERVICED → Pending,
--      CANCELLED / REJECTED / NOT DONE → Rejected
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists product_type  text;
alter table public.orders add column if not exists source_status text;   -- STATUS exactly as in the uploaded sheet

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

      v_exists := exists (select 1 from orders where order_id = v_order_id);

      insert into orders (order_id, order_date, customer_name, phone_no, service, brand, location, address,
                          pin_code, status, comments, technician_id, assigned_by, modified_by, modified_at, location_url, product_type, source_status)
      values (v_order_id, v_date, v_name,
              nullif(trim(v_row->>'phone_no'), ''), nullif(trim(v_row->>'service'), ''),
              nullif(trim(v_row->>'brand'), ''),    nullif(trim(v_row->>'location'), ''),
              nullif(trim(v_row->>'address'), ''),  nullif(trim(v_row->>'pin_code'), ''),
              coalesce(v_status, 'PENDING'), nullif(trim(v_row->>'comments'), ''),
              v_tech_id, auth.uid(), auth.uid(), now(), nullif(trim(v_row->>'location_url'), ''),
              nullif(trim(v_row->>'product_type'), ''), nullif(trim(v_row->>'status'), ''))
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
