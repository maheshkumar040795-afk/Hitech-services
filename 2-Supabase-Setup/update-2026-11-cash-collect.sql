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
