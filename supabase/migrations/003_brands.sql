-- Brands under one org (Popular)
-- poet: public domain popularpoet.pl
-- kids: no public domain yet (admin tab + soft path)
-- tickets: populartickets.pl — trials & events checkout (P24)

create table if not exists brands (
  id text primary key check (id in ('poet','kids','tickets')),
  tenant_id uuid not null references tenants(id),
  name text not null,
  hosts text[] not null default '{}',
  product_line text not null,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table groups add column if not exists brand_id text references brands(id);
alter table package_plans add column if not exists brand_id text references brands(id);
alter table payments add column if not exists brand_id text references brands(id);
alter table payments add column if not exists product_kind text
  check (product_kind in ('package','trial','event'));
alter table enrollments add column if not exists brand_id text references brands(id);

insert into brands (id, tenant_id, name, hosts, product_line, settings) values
  (
    'poet',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Popular Poet',
    array['popularpoet.pl','www.popularpoet.pl'],
    'theater',
    '{"locale":"ru"}'::jsonb
  ),
  (
    'kids',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Popular Kids',
    array[]::text[],
    'kids',
    '{"locale":"ru","public_domain":false,"soft_path":"/kids"}'::jsonb
  ),
  (
    'tickets',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Popular Tickets',
    array['populartickets.pl','www.populartickets.pl'],
    'checkout',
    '{"p24_bound":true,"sells":["trial","event"]}'::jsonb
  )
on conflict (id) do update set
  hosts = excluded.hosts,
  settings = excluded.settings,
  product_line = excluded.product_line;

update groups set brand_id = 'poet' where brand_id is null;
update package_plans set brand_id = 'poet' where brand_id is null;
update payments set product_kind = coalesce(product_kind, 'package');
