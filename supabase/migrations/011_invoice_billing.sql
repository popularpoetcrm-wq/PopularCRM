-- Apply in Supabase SQL Editor (or when migrations auto-run).
-- Billing / invoice buyer fields on persons

alter table persons
  add column if not exists invoice_street text,
  add column if not exists invoice_post_code text,
  add column if not exists invoice_city text,
  add column if not exists invoice_country text default 'PL',
  add column if not exists invoice_nip text,
  add column if not exists invoice_company_name text;

comment on column persons.invoice_street is 'Street for invoices (nabywca)';
comment on column persons.invoice_post_code is 'Post code for invoices';
comment on column persons.invoice_city is 'City for invoices';
comment on column persons.invoice_country is 'ISO country for invoices, default PL';
comment on column persons.invoice_nip is 'Optional NIP for B2B invoices';
comment on column persons.invoice_company_name is 'Optional company name for B2B invoices';
