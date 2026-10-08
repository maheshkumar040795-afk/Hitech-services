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
        select id into v_tech_id from technicians where lower(name) = lower(v_tech_name);
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
