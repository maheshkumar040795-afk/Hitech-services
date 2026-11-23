-- ════════════════════════════════════════════════════════════════════════════
--  Hitech Services — update (Nov 2026): installation photos (Cloudinary)
--  Run ONCE in: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Run AFTER update-2026-11-cancel-state-vendor.sql.
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
