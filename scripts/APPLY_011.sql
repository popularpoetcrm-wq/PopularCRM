-- Apply in Supabase SQL Editor if migrations are not auto-run.
-- File: supabase/migrations/011_invoice_billing.sql

alter table persons
  add column if not exists invoice_street text,
  add column if not exists invoice_post_code text,
  add column if not exists invoice_city text,
  add column if not exists invoice_country text default 'PL',
  add column if not exists invoice_nip text,
  add column if not exists invoice_company_name text;
