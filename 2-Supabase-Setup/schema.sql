-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — Supabase database
--  Run this whole file ONCE in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run: it uses IF NOT EXISTS / CREATE OR REPLACE everywhere.
--
--  Roles
--    ADMIN       office admin — everything, incl. users, reports, audit log
--    STAFF       office staff — orders, upload, assign, technicians, billing
--    TECHNICIAN  field technician — sees ONLY own jobs, updates status/amount/notes
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── Types ──────────────────────────────────────────────────────────────────
do $$ begin create type public.user_role    as enum ('ADMIN','STAFF','TECHNICIAN'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('PENDING','COMPLETED','REJECTED');  exception when duplicate_object then null; end $$;
do $$ begin create type public.upload_status as enum ('SUCCESS','FAILED','PARTIAL');      exception when duplicate_object then null; end $$;

-- ─── Tables ─────────────────────────────────────────────────────────────────

-- One row per login (office user or technician). id = auth.users.id
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  login       text not null unique,          -- email for office users, 10-digit mobile for technicians
  role        public.user_role not null default 'STAFF',
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.technicians (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  mobile      text unique check (mobile is null or mobile ~ '^[6-9][0-9]{9}$'),
  aadhar      text,
  state       text not null default 'Tamil Nadu',
  district    text,
  city        text,
  pincode     text,
  is_active   boolean not null default true,
  user_id     uuid unique references public.profiles(id) on delete set null,   -- set when app login is enabled
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists technicians_name_ci on public.technicians (lower(name));

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_id       text not null unique,                  -- Amazon order id
  order_date     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  customer_name  text not null,
  phone_no       text,
  service        text,
  brand          text,
  location       text,
  address        text,
  pin_code       text,
  status         public.order_status not null default 'PENDING',
  comments       text,                                  -- latest comment (full history in comment_logs)
  cod_amount     numeric(12,2) not null default 0 check (cod_amount >= 0),
  technician_id  uuid references public.technicians(id) on delete set null,
  assigned_by    uuid references public.profiles(id) on delete set null,
  assigned_at    timestamptz,
  modified_by    uuid references public.profiles(id) on delete set null,
  modified_at    timestamptz,
  closed_at      timestamptz,                           -- when COMPLETED / REJECTED
  is_deleted     boolean not null default false,        -- soft delete
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists orders_status_idx     on public.orders (status) where not is_deleted;
create index if not exists orders_date_idx       on public.orders (order_date desc);
create index if not exists orders_tech_idx       on public.orders (technician_id, status);
create index if not exists orders_pin_idx        on public.orders (pin_code);

create table if not exists public.comment_logs (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  comment     text not null check (length(trim(comment)) > 0),
  created_at  timestamptz not null default now()
);
create index if not exists comment_logs_order_idx on public.comment_logs (order_id, created_at desc);

create table if not exists public.upload_logs (
  id                 uuid primary key default gen_random_uuid(),
  filename           text not null,
  upload_type        text not null default 'excel',
  status             public.upload_status not null,
  records_processed  int not null default 0,
  records_created    int not null default 0,
  records_updated    int not null default 0,
  records_failed     int not null default 0,
  error_message      text,
  uploaded_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,
  entity_type  text not null,
  entity_id    text not null,
  old_value    jsonb,
  new_value    jsonb,
  note         text,
  actor_id     uuid references public.profiles(id) on delete set null,
  order_id     uuid references public.orders(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_order_idx   on public.audit_logs (order_id);

create sequence if not exists public.bill_number_seq;
create table if not exists public.bills (
  id             uuid primary key default gen_random_uuid(),
  bill_number    text not null unique,
  bill_date      date not null default ((now() at time zone 'Asia/Kolkata')::date),
  customer_name  text not null,
  address        text,
  items          jsonb not null default '[]'::jsonb,
  total_amount   numeric(12,2) not null default 0,
  order_id       uuid references public.orders(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Single-row company settings (used on printed bills)
create table if not exists public.app_settings (
  id               int primary key default 1 check (id = 1),
  company_name     text not null default 'HITECH SERVICES',
  company_address  text not null default 'Chennai, Tamil Nadu',
  company_phone    text,
  company_gstin    text,
  updated_at       timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- ─── Helper functions (used by security rules) ──────────────────────────────
create or replace function public.today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('ADMIN','STAFF') from profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'ADMIN' from profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.my_technician_id() returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from technicians t join profiles p on p.id = t.user_id
  where t.user_id = auth.uid() and p.is_active and p.role = 'TECHNICIAN' and t.is_active
$$;

create or replace function public.next_bill_number() returns text
language plpgsql as $$
declare n bigint := nextval('public.bill_number_seq');
begin
  return case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
end $$;
alter table public.bills alter column bill_number set default public.next_bill_number();

-- ─── Triggers ───────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists technicians_touch on public.technicians;
create trigger technicians_touch before update on public.technicians for each row execute function public.touch_updated_at();

-- Keeps who/when columns correct no matter who updates the order
create or replace function public.orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.technician_id is not null then
      new.assigned_at := now(); new.assigned_by := coalesce(new.assigned_by, auth.uid());
    end if;
    if new.status <> 'PENDING' then new.closed_at := now(); end if;
    return new;
  end if;

  new.updated_at := now();
  if new.status is distinct from old.status then
    new.closed_at := case when new.status = 'PENDING' then null else now() end;
  end if;
  if new.technician_id is distinct from old.technician_id then
    new.assigned_by := auth.uid();
    new.assigned_at := case when new.technician_id is null then null else now() end;
  end if;
  if (new.status, new.cod_amount, new.comments, new.technician_id, new.is_deleted)
     is distinct from (old.status, old.cod_amount, old.comments, old.technician_id, old.is_deleted) then
    new.modified_by := coalesce(auth.uid(), new.modified_by);
    new.modified_at := now();
  end if;
  return new;
end $$;

drop trigger if exists orders_before_write on public.orders;
create trigger orders_before_write before insert or update on public.orders
for each row execute function public.orders_before_write();

-- Automatic audit trail (cannot be skipped by the app)
create or replace function public.orders_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old_t text; v_new_t text;
begin
  if coalesce(current_setting('app.bulk_import', true), '') = 'on' then return null; end if;

  if tg_op = 'INSERT' then
    insert into audit_logs(action, entity_type, entity_id, new_value, note, actor_id, order_id)
    values ('ORDER_CREATED', 'order', new.id::text, jsonb_build_object('status', new.status),
            'Order ' || new.order_id || ' created', auth.uid(), new.id);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into audit_logs(action, entity_type, entity_id, old_value, new_value, note, actor_id, order_id)
    values ('STATUS_CHANGED', 'order', new.id::text,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status),
            'Status: ' || old.status || ' → ' || new.status, auth.uid(), new.id);
  end if;

  if new.technician_id is distinct from old.technician_id then
    select name into v_old_t from technicians where id = old.technician_id;
    select name into v_new_t from technicians where id = new.technician_id;
    insert into audit_logs(action, entity_type, entity_id, old_value, new_value, note, actor_id, order_id)
    values (case when new.technician_id is null then 'TECH_UNASSIGNED' else 'TECH_ASSIGNED' end,
            'order', new.id::text,
            jsonb_build_object('technician', v_old_t), jsonb_build_object('technician', v_new_t),
            case when new.technician_id is null then 'Unassigned from ' || coalesce(v_old_t, '—')
                 else 'Assigned to ' || coalesce(v_new_t, '—') || coalesce(' (was ' || v_old_t || ')', '') end,
            auth.uid(), new.id);
  end if;

  if new.cod_amount is distinct from old.cod_amount then
    insert into audit_logs(action, entity_type, entity_id, old_value, new_value, note, actor_id, order_id)
    values ('AMOUNT_UPDATED', 'order', new.id::text,
            jsonb_build_object('amount', old.cod_amount), jsonb_build_object('amount', new.cod_amount),
            'Amount: ₹' || old.cod_amount || ' → ₹' || new.cod_amount, auth.uid(), new.id);
  end if;

  if new.is_deleted and not old.is_deleted then
    insert into audit_logs(action, entity_type, entity_id, note, actor_id, order_id)
    values ('ORDER_DELETED', 'order', new.id::text, 'Order ' || new.order_id || ' deleted', auth.uid(), new.id);
  elsif old.is_deleted and not new.is_deleted then
    insert into audit_logs(action, entity_type, entity_id, note, actor_id, order_id)
    values ('ORDER_RESTORED', 'order', new.id::text, 'Order ' || new.order_id || ' restored', auth.uid(), new.id);
  end if;
  return null;
end $$;

drop trigger if exists orders_audit on public.orders;
create trigger orders_audit after insert or update on public.orders
for each row execute function public.orders_audit();

-- New comment → becomes the order's "latest comment"
create or replace function public.comment_to_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update orders set comments = new.comment where id = new.order_id;
  return null;
end $$;
drop trigger if exists comment_to_order on public.comment_logs;
create trigger comment_to_order after insert on public.comment_logs
for each row execute function public.comment_to_order();

-- Technician changes → audit
create or replace function public.technicians_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(action, entity_type, entity_id, new_value, note, actor_id)
  values (case when tg_op = 'INSERT' then 'TECHNICIAN_CREATED' else 'TECHNICIAN_UPDATED' end,
          'technician', new.id::text,
          jsonb_build_object('name', new.name, 'mobile', new.mobile, 'city', new.city, 'active', new.is_active),
          'Technician ' || new.name || case when tg_op = 'INSERT' then ' added' else ' updated' end,
          auth.uid());
  return null;
end $$;
drop trigger if exists technicians_audit on public.technicians;
create trigger technicians_audit after insert or update of name, mobile, city, district, pincode, is_active
on public.technicians for each row
when (coalesce(current_setting('app.bulk_import', true), '') <> 'on')
execute function public.technicians_audit();

-- ─── Row Level Security ─────────────────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.technicians  enable row level security;
alter table public.orders       enable row level security;
alter table public.comment_logs enable row level security;
alter table public.upload_logs  enable row level security;
alter table public.audit_logs   enable row level security;
alter table public.bills        enable row level security;
alter table public.app_settings enable row level security;

-- profiles: you see yourself; office sees everyone. Writes only via the admin-users Edge Function.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (select public.is_office()));

-- technicians: office full access; a technician sees only their own row
drop policy if exists technicians_select on public.technicians;
create policy technicians_select on public.technicians for select to authenticated
  using ((select public.is_office()) or user_id = auth.uid());
drop policy if exists technicians_insert on public.technicians;
create policy technicians_insert on public.technicians for insert to authenticated
  with check ((select public.is_office()) and user_id is null);
drop policy if exists technicians_update on public.technicians;
create policy technicians_update on public.technicians for update to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));

-- orders: office full access; technician READ-ONLY on own jobs (updates go through tech_update_job)
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using ((select public.is_office())
         or (technician_id = (select public.my_technician_id()) and not is_deleted));
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated
  with check ((select public.is_office()));
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete to authenticated
  using ((select public.is_admin()));

-- comments: office on any order; technician on own jobs only
drop policy if exists comments_select on public.comment_logs;
create policy comments_select on public.comment_logs for select to authenticated
  using ((select public.is_office())
         or exists (select 1 from public.orders o where o.id = comment_logs.order_id
                    and o.technician_id = (select public.my_technician_id()) and not o.is_deleted));
drop policy if exists comments_insert on public.comment_logs;
create policy comments_insert on public.comment_logs for insert to authenticated
  with check (user_id = auth.uid() and (
    (select public.is_office())
    or exists (select 1 from public.orders o where o.id = comment_logs.order_id
               and o.technician_id = (select public.my_technician_id()) and not o.is_deleted)));

drop policy if exists uploads_select on public.upload_logs;
create policy uploads_select on public.upload_logs for select to authenticated
  using ((select public.is_office()));

-- audit: admin sees all; office staff see order history only. Rows are written by triggers.
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using ((select public.is_admin()) or ((select public.is_office()) and order_id is not null));

drop policy if exists bills_select on public.bills;
create policy bills_select on public.bills for select to authenticated using ((select public.is_office()));
drop policy if exists bills_insert on public.bills;
create policy bills_insert on public.bills for insert to authenticated
  with check ((select public.is_office()) and created_by = auth.uid());

drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (true);
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─── App functions (called from the web / mobile app) ───────────────────────

-- Excel / CSV import. Rows are parsed in the browser and sent as JSON.
-- Rules on re-upload of an existing ORDER ID:
--   • customer / address details are refreshed
--   • STATUS and TECHNICIAN from Excel are applied ONLY while the order is still PENDING
--     (so a re-uploaded sheet never undoes work a technician already completed)
--   • amount collected is never touched by Excel
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

-- Technician updates own job from the mobile app.
--   COMPLETED → amount collected required (0 allowed)
--   REJECTED  → reason required
--   PENDING   → re-open (same day only)
-- A closed job can be changed by the technician only on the day it was closed (IST).
create or replace function public.tech_update_job(p_order uuid, p_status public.order_status,
                                                  p_amount numeric default null, p_note text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_tech uuid := my_technician_id();
  v_o    orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_tech is null then raise exception 'Only technicians can update jobs here' using errcode = '42501'; end if;

  select * into v_o from orders where id = p_order and not is_deleted for update;
  if not found or v_o.technician_id is distinct from v_tech then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'PENDING' and (v_o.closed_at at time zone 'Asia/Kolkata')::date < today_ist() then
    raise exception 'This job is locked. Please contact the office to change it.';
  end if;

  if p_status = 'COMPLETED' and (p_amount is null or p_amount < 0) then
    raise exception 'Enter the amount collected (enter 0 if nothing was collected)';
  end if;
  if p_status = 'REJECTED' and v_note is null then
    raise exception 'Please select or type a reason';
  end if;

  update orders set
    status     = p_status,
    cod_amount = case when p_status = 'COMPLETED' then round(p_amount, 2)
                      when p_status = 'REJECTED'  then 0
                      else cod_amount end
  where id = p_order
  returning * into v_o;

  if v_note is not null then
    insert into comment_logs(order_id, user_id, comment)
    values (p_order, auth.uid(), case when p_status = 'REJECTED' then 'Not completed: ' || v_note else v_note end);
    select * into v_o from orders where id = p_order;
  end if;
  return v_o;
end $$;

-- Dashboard KPIs for a date range (+ % change vs the previous range of equal length)
create or replace function public.dashboard_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; prev record; v_len int;
begin
  if not is_office() then raise exception 'Not allowed' using errcode = '42501'; end if;
  v_len := greatest((p_to - p_from) + 1, 1);

  select count(*)                                                   as total,
         count(*) filter (where status = 'COMPLETED')               as completed,
         count(*) filter (where status = 'PENDING')                 as pending,
         count(*) filter (where status = 'REJECTED')                as rejected,
         count(*) filter (where status = 'PENDING' and technician_id is null) as unassigned,
         coalesce(sum(cod_amount) filter (where status = 'COMPLETED'), 0)   as amount,
         round((avg(extract(epoch from (closed_at - assigned_at)) / 3600)
                filter (where status = 'COMPLETED' and assigned_at is not null and closed_at > assigned_at))::numeric, 1) as avg_hours
    into r
    from orders where not is_deleted and order_date between p_from and p_to;

  select count(*) as total, count(*) filter (where status = 'COMPLETED') as completed
    into prev
    from orders where not is_deleted and order_date between p_from - v_len and p_from - 1;

  return jsonb_build_object(
    'total', r.total, 'completed', r.completed, 'pending', r.pending, 'rejected', r.rejected,
    'unassigned', r.unassigned, 'amount', r.amount, 'avg_hours', r.avg_hours,
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
           count(o.id) filter (where o.status = 'PENDING'),
           count(o.id) filter (where o.status = 'REJECTED')
      from generate_series(today_ist() - (least(greatest(p_days, 1), 90) - 1), today_ist(), interval '1 day') d
      left join orders o on o.order_date = d::date and not o.is_deleted
     group by d order by d;
end $$;

create or replace function public.dashboard_breakdown(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'by_location', coalesce((select jsonb_agg(x) from (
        select initcap(lower(trim(coalesce(location, '—')))) as name, count(*) as count
          from orders where not is_deleted and order_date between p_from and p_to
         group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'by_service', coalesce((select jsonb_agg(x) from (
        select coalesce(nullif(trim(service), ''), '—') as name, count(*) as count
          from orders where not is_deleted and order_date between p_from and p_to
         group by 1 order by 2 desc limit 8) x), '[]'::jsonb));
end $$;

-- Per-technician counts for a date range (null = all time) + today's numbers
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
           count(o.id) filter (where o.status = 'PENDING'),
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
           count(o.id) filter (where o.status = 'PENDING'),
           count(o.id) filter (where o.status = 'REJECTED')
      from generate_series(date_trunc('month', today_ist()) - interval '5 months', date_trunc('month', today_ist()), interval '1 month') m
      left join orders o on o.technician_id = p_tech and not o.is_deleted
                        and o.order_date >= m::date and o.order_date < (m + interval '1 month')::date
     group by m order by m;
end $$;

create or replace function public.audit_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total_7d', (select count(*) from audit_logs where created_at >= now() - interval '7 days'),
    'by_action', coalesce((select jsonb_agg(x) from (
        select action, count(*) as count from audit_logs where created_at >= now() - interval '7 days'
         group by action order by 2 desc limit 6) x), '[]'::jsonb),
    'top_actors', coalesce((select jsonb_agg(x) from (
        select coalesce(p.name, 'System') as name, count(*) as count
          from audit_logs a left join profiles p on p.id = a.actor_id
         where a.created_at >= now() - interval '7 days'
         group by 1 order by 2 desc limit 5) x), '[]'::jsonb));
end $$;

-- ─── Permissions ────────────────────────────────────────────────────────────
-- Not logged in = no access at all.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- service_role = the admin-users Edge Function (server-side only, never in the browser)
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ─── Realtime (live updates on dashboard + technician phones) ───────────────
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.orders;       exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.comment_logs; exception when duplicate_object then null; end;
  end if;
end $$;


-- ════ Added Oct 2026: Technician ID + keep-alive (same as update-2026-10-technician-id.sql) ════
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

-- 7. Keep-alive ping for the GitHub job (read-only, returns 1)
create or replace function public.keep_alive() returns int language sql stable as $$ select 1 $$;
revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

-- next_tech_code is only for the trigger
revoke execute on function public.next_tech_code() from public, anon, authenticated;

notify pgrst, 'reload schema';


-- ════ Added Oct 2026: technician Forgot PIN (same as update-2026-10-forgot-pin.sql) ════
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


-- ════ Added Oct 2026: Reschedule, Google Maps link, Cash/Online (same as update-2026-10-orders-reschedule-payment.sql) ════

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


-- ════ Added Oct 2026: crisp audit log (same as update-2026-10-audit-trim.sql) ════
-- exact time of each change (several changes in one save keep their order)
alter table public.audit_logs alter column created_at set default clock_timestamp();
create index if not exists audit_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

-- 1. Trim: newest 3 per order / technician / user
create or replace function public.audit_keep_recent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from audit_logs
   where entity_type = new.entity_type and entity_id = new.entity_id
     and id not in (select id from audit_logs
                     where entity_type = new.entity_type and entity_id = new.entity_id
                     order by created_at desc, id desc limit 3);
  -- Excel uploads are one entry each: keep the last 20
  if new.entity_type = 'upload' then
    delete from audit_logs where entity_type = 'upload'
       and id not in (select id from audit_logs where entity_type = 'upload' order by created_at desc limit 20);
  end if;
  return null;
end $$;
drop trigger if exists audit_keep_recent on public.audit_logs;
create trigger audit_keep_recent after insert on public.audit_logs
for each row execute function public.audit_keep_recent();

create or replace function public.upload_logs_keep_recent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from upload_logs where id not in (select id from upload_logs order by created_at desc limit 20);
  return null;
end $$;
drop trigger if exists upload_logs_keep_recent on public.upload_logs;
create trigger upload_logs_keep_recent after insert on public.upload_logs
for each statement execute function public.upload_logs_keep_recent();

-- 2. One-time clean-up of existing history (old/new value copies are not needed either)
delete from public.audit_logs a
 using (select id, row_number() over (partition by entity_type, entity_id order by created_at desc, id desc) as rn
          from public.audit_logs) r
 where a.id = r.id and r.rn > 3;
delete from public.audit_logs where entity_type = 'upload'
   and id not in (select id from public.audit_logs where entity_type = 'upload' order by created_at desc limit 20);
delete from public.upload_logs where id not in (select id from public.upload_logs order by created_at desc limit 20);
update public.audit_logs set old_value = null, new_value = null where old_value is not null or new_value is not null;

-- 3. Order-wise view: latest-changed orders first, each with its last 3 changes
create or replace function public.audit_by_order(p_search text default null, p_limit int default 20, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(distinct a.order_id) from audit_logs a join orders o on o.id = a.order_id
               where v_q is null or o.order_id ilike '%' || v_q || '%' or o.customer_name ilike '%' || v_q || '%'),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.last_at desc) from (
        select o.id, o.order_id, o.customer_name, o.status, max(a.created_at) as last_at,
               jsonb_agg(jsonb_build_object('action', a.action, 'note', a.note, 'at', a.created_at,
                                            'by', coalesce(p.name, 'System'), 'role', p.role)
                         order by a.created_at desc) as changes
          from audit_logs a
          join orders o on o.id = a.order_id
          left join profiles p on p.id = a.actor_id
         where v_q is null or o.order_id ilike '%' || v_q || '%' or o.customer_name ilike '%' || v_q || '%'
         group by o.id
         order by max(a.created_at) desc
         limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) x), '[]'::jsonb));
end $$;
revoke execute on function public.audit_by_order(text, int, int) from public, anon;
grant execute on function public.audit_by_order(text, int, int) to authenticated;

drop function if exists public.audit_stats();

notify pgrst, 'reload schema';


-- ════ Added Oct 2026: new-job alerts (same as update-2026-10-job-alerts.sql) ════
-- 1. Lets the database call the Edge Function
create extension if not exists pg_net with schema extensions;

-- 2. One row per phone that turned on alerts
create table if not exists public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  technician_id  uuid not null references public.technicians(id) on delete cascade,
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  app_url        text,
  user_agent     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists push_subs_tech_idx on public.push_subscriptions (technician_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and technician_id = (select public.my_technician_id()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- 3. When a job is assigned (or re-assigned) → ask the Edge Function to notify the technician
create or replace function public.notify_job_assigned() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.technician_id is not null and not new.is_deleted
     and new.status::text in ('PENDING', 'RESCHEDULED')
     and (tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id)
     and exists (select 1 from push_subscriptions where technician_id = new.technician_id) then
    perform net.http_post(
      url     := 'https://eqtdqqhnwfsmoamxvain.supabase.co/functions/v1/notify-assign',
      body    := jsonb_build_object('order_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  end if;
  return null;
exception when others then
  return null;   -- an alert problem must never block assigning a job
end $$;
drop trigger if exists notify_job_assigned on public.orders;
create trigger notify_job_assigned after insert or update of technician_id on public.orders
for each row execute function public.notify_job_assigned();

notify pgrst, 'reload schema';


-- ════ Added Nov 2026: technician status, rate config, payouts (same as update-2026-11-status-rates-payout.sql) ════
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

-- ── Nov 2026: order sheet in Hi-Tech model format (product_type, sheet STATUS) ──
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

-- ── Nov 2026: installed item on completed jobs (rate from Rate Config by installed item) ──
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

-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): "Cash Collect" amount on orders
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Run AFTER update-2026-11-installed-item.sql.
--
--  • Office enters the amount the technician must collect from the customer
--    (Orders → "Cash Collect ₹" column, or New / Edit order).
--  • HT Jobs → Mark Completed shows "You have to collect ₹1,000 from the customer"
--    and hides "Paid on Amazon" for that job. The server refuses Amazon for it too.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists collect_amount numeric(12,2);
do $$ begin
  alter table public.orders add constraint orders_collect_amount_check check (collect_amount is null or collect_amount >= 0);
exception when duplicate_object then null; end $$;

-- Technician app: same as before, plus — when the office set a Cash Collect amount,
-- "Paid on Amazon" is refused (the technician must collect from the customer)
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

  if p_status::text = 'COMPLETED' and v_mode = 'AMAZON' and coalesce(v_o.collect_amount, 0) > 0 then
    raise exception 'Collect ₹% from the customer — this order is not paid on Amazon', v_o.collect_amount;
  end if;
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

notify pgrst, 'reload schema';

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


-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): "Cancelled" status + STATE and VENDOR NAME on orders
--  (same as update-2026-11-cancel-state-vendor.sql)
--
--  • New order status CANCELLED: the owner installed it himself and cancelled the order.
--    When the office sets it, the technician is removed (job leaves HT Jobs and Payout)
--    and the Orders screen shows "Own Installation" as the technician.
--    The audit log keeps which technician it was taken from.
--  • New order columns STATE and VENDOR NAME (template, upload, Google Sheet, Orders, Export).
-- ════════════════════════════════════════════════════════════════════════════

alter type public.order_status add value if not exists 'CANCELLED';

alter table public.orders add column if not exists state       text;
alter table public.orders add column if not exists vendor_name text;

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

-- Upload / Google Sheet import: same as before, plus STATE and VENDOR NAME
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
                          pin_code, status, comments, technician_id, assigned_by, modified_by, modified_at, location_url, product_type, source_status,
                          state, vendor_name)
      values (v_order_id, v_date, v_name,
              nullif(trim(v_row->>'phone_no'), ''), nullif(trim(v_row->>'service'), ''),
              nullif(trim(v_row->>'brand'), ''),    nullif(trim(v_row->>'location'), ''),
              nullif(trim(v_row->>'address'), ''),  nullif(trim(v_row->>'pin_code'), ''),
              coalesce(v_status, 'PENDING'), nullif(trim(v_row->>'comments'), ''),
              v_tech_id, auth.uid(), auth.uid(), now(), nullif(trim(v_row->>'location_url'), ''),
              nullif(trim(v_row->>'product_type'), ''), nullif(trim(v_row->>'status'), ''),
              nullif(trim(v_row->>'state'), ''), nullif(trim(v_row->>'vendor_name'), ''))
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
          jsonb_build_object('file', p_filename, 'processed', v_processed, 'created', v_created,
                             'updated', v_updated, 'failed', v_failed),
          'Excel upload "' || coalesce(p_filename, '') || '": ' || v_created || ' new, ' || v_updated || ' updated, ' || v_failed || ' failed',
          auth.uid());

  return jsonb_build_object('processed', v_processed, 'created', v_created, 'updated', v_updated,
                            'failed', v_failed,
                            'errors', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_errors) e limit 50) s), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): installation photos (Cloudinary)
--  (same as update-2026-11-job-photos.sql)
--
--  • HT Jobs → Mark Completed: the technician takes photos with the camera or picks
--    them from the gallery (max 10). The phone compresses them and uploads them
--    straight to Cloudinary; only the photo links are saved here (orders.photos).
--  • Office sees the photos in the order drawer, a photo count in Orders, and the
--    links in Export.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists photos text[] not null default '{}';
do $$ begin
  alter table public.orders add constraint orders_photos_check check (cardinality(photos) <= 10);
exception when duplicate_object then null; end $$;

-- Technician saves the photo list of his own job (the full list: added and removed photos).
-- Same lock as tech_update_job: a job closed on an earlier day can only be changed by the office.
create or replace function public.tech_save_photos(p_order uuid, p_urls text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_tech uuid := my_technician_id();
  v_o    orders;
  v_urls text[] := coalesce(p_urls, '{}');
begin
  if v_tech is null then raise exception 'Only technicians can update jobs here' using errcode = '42501'; end if;
  select * into v_o from orders where id = p_order and not is_deleted for update;
  if not found or v_o.technician_id is distinct from v_tech then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_o.status::text not in ('PENDING','RESCHEDULED') and (v_o.closed_at at time zone 'Asia/Kolkata')::date < today_ist() then
    raise exception 'This job is locked. Please contact the office to change it.';
  end if;
  if cardinality(v_urls) > 10 then raise exception 'Maximum 10 photos per job'; end if;
  if exists (select 1 from unnest(v_urls) u where u !~ '^https://res\.cloudinary\.com/[A-Za-z0-9_-]+/image/upload/') then
    raise exception 'Invalid photo link';
  end if;

  update orders set photos = v_urls where id = p_order;
  if v_urls is distinct from v_o.photos then
    insert into audit_logs(action, entity_type, entity_id, note, actor_id, order_id)
    values ('PHOTOS_UPDATED', 'order', p_order::text,
            'Photos: ' || cardinality(v_urls) || ' (was ' || cardinality(coalesce(v_o.photos, '{}')) || ')', auth.uid(), p_order);
  end if;
  return cardinality(v_urls);
end $$;
revoke execute on function public.tech_save_photos(uuid, text[]) from public, anon;
grant execute on function public.tech_save_photos(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): REPAIRS (separate screen, rates, payout, HT Jobs)
--  (same as update-2026-11-repairs.sql)
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


-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): Petrol allowance + Salary advance per technician
--  (same as update-2026-11-tech-finance.sql)
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
