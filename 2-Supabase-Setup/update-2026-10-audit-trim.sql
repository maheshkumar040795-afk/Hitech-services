-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Oct 2026): crisp Audit Log
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run.
--
--  • Keeps only the 3 most recent changes per order (and per technician / user).
--    Older entries are deleted automatically every time a new change is recorded.
--  • Excel upload history keeps the last 20 uploads.
--  • audit_by_order(): order-wise view for the Audit Log page (who changed what, last 3).
--  • The old statistics function (audit_stats) is removed.
-- ════════════════════════════════════════════════════════════════════════════

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
