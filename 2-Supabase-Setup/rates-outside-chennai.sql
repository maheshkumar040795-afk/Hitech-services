-- Outside Chennai technician rates (Nov 2026). Run in Supabase → SQL Editor after update-2026-11-status-rates-payout.sql.
-- Safe to re-run: updates only the Outside Chennai rate, keeps Within Chennai rates.
insert into public.service_rates (service, rate_outside) values
  ('TV Installation (32 - 49 inch)', 200),
  ('TV Installation (50 - 55 inch)', 225),
  ('TV Installation (Above 55 inch)', 250),
  ('Washing Machine Installation', 200),
  ('Refrigerator Installation', 200),
  ('AC Installation', 900),
  ('Window AC Installation', 500)
on conflict ((lower(trim(service)))) do update set rate_outside = excluded.rate_outside, updated_at = now();
