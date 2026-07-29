-- Operational seed for LK/admin against Supabase (valid UUIDs only)
-- Tenant aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa already from 002

update persons
set onboarding_status = 'complete',
    accepted_rules_at = coalesce(accepted_rules_at, now())
where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and email in ('admin@studio.local', 'anna@example.com', 'jan@example.com');

-- Teacher
insert into persons (id, tenant_id, full_name, email, status, onboarding_status, accepted_rules_at)
values (
  '11111111-1111-1111-1111-111111111110',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Teacher Impro',
  'teacher@studio.local',
  'completed',
  'complete',
  now()
)
on conflict (id) do update set email = excluded.email, onboarding_status = 'complete';

insert into person_roles (tenant_id, person_id, role)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111110', 'teacher'
where not exists (
  select 1 from person_roles
  where person_id = '11111111-1111-1111-1111-111111111110'
    and role = 'teacher' and revoked_at is null
);

-- Parent Maria
insert into persons (id, tenant_id, full_name, email, phone, status, onboarding_status, accepted_rules_at)
values (
  '11111111-1111-1111-1111-111111111109',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Maria Nowak',
  'maria@example.com',
  '+48444444444',
  'completed',
  'complete',
  now()
)
on conflict (id) do update set email = excluded.email, onboarding_status = 'complete';

insert into person_roles (tenant_id, person_id, role)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111109', x.role
from (values ('parent'), ('payer')) as x(role)
where not exists (
  select 1 from person_roles
  where person_id = '11111111-1111-1111-1111-111111111109'
    and role = x.role and revoked_at is null
);

update persons set is_minor = true
where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

insert into student_contacts (
  tenant_id, student_person_id, contact_person_id, relation_type, is_primary, can_pay
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '11111111-1111-1111-1111-111111111109',
  'parent',
  true,
  true
)
on conflict (student_person_id, contact_person_id, relation_type) do nothing;

-- Kids group
insert into groups (
  id, tenant_id, title, direction, teacher_person_id, capacity, default_plan_id, brand_id, status
)
values (
  '11111111-1111-1111-1111-111111111108',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Sobota 16:00 — Kids Scene',
  'kids',
  '11111111-1111-1111-1111-111111111110',
  10,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'kids',
  'active'
)
on conflict (id) do update set brand_id = 'kids', title = excluded.title;

insert into enrollments (
  id, tenant_id, student_person_id, group_id, plan_id, status, brand_id
)
values (
  '11111111-1111-1111-1111-111111111107',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '11111111-1111-1111-1111-111111111108',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'active',
  'kids'
)
on conflict (id) do nothing;

update enrollments set brand_id = coalesce(brand_id, 'poet')
where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

update groups set brand_id = coalesce(brand_id, 'poet')
where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Upcoming poet session (+2 days 18:00)
insert into sessions (
  id, tenant_id, group_id, teacher_person_id, starts_at, ends_at, status
)
values (
  '11111111-1111-1111-1111-111111111106',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  date_trunc('day', now() + interval '2 days') + interval '18 hours',
  date_trunc('day', now() + interval '2 days') + interval '19 hours 30 minutes',
  'scheduled'
)
on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = excluded.status;

-- Kids session (+3 days 16:00)
insert into sessions (
  id, tenant_id, group_id, teacher_person_id, starts_at, ends_at, status
)
values (
  '11111111-1111-1111-1111-11111111110a',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111108',
  '11111111-1111-1111-1111-111111111110',
  date_trunc('day', now() + interval '3 days') + interval '16 hours',
  date_trunc('day', now() + interval '3 days') + interval '17 hours 30 minutes',
  'scheduled'
)
on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = excluded.status;

-- Anna package + 4 credits (3 available after we mark one consumed? keep 3 available / 4 total)
insert into student_packages (
  id, tenant_id, enrollment_id, plan_snapshot, activated_at, expires_at, status
)
values (
  '11111111-1111-1111-1111-111111111105',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  jsonb_build_object(
    'id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'name', 'Pakiet 4 zajęć',
    'lessons_count', 4,
    'validity_days', 60,
    'price_gross', 400
  ),
  now() - interval '10 days',
  now() + interval '45 days',
  'active'
)
on conflict (id) do nothing;

insert into lesson_credits (tenant_id, student_package_id, credit_index, status)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111105',
  g,
  case when g = 1 then 'consumed' else 'available' end
from generate_series(1, 4) as g
where not exists (
  select 1 from lesson_credits
  where student_package_id = '11111111-1111-1111-1111-111111111105'
    and credit_index = g
);

-- Payments
insert into payments (
  id, tenant_id, provider, payer_person_id, enrollment_id, amount, amount_paid,
  status, payment_method, description, brand_id, product_kind, created_at, paid_at
)
values
  (
    '11111111-1111-1111-1111-111111111104',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'przelewy24',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    '11111111-1111-1111-1111-111111111111',
    400, 400, 'paid', 'online',
    'Pakiet 4 zajęć — Środa 18:00',
    'poet', 'package',
    now() - interval '10 days',
    now() - interval '10 days'
  ),
  (
    '11111111-1111-1111-1111-111111111103',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'cash',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '22222222-2222-2222-2222-222222222222',
    400, 200, 'partial', 'cash',
    'Pakiet 4 zajęć — częściowa wpłata',
    'poet', 'package',
    now() - interval '2 days',
    null
  ),
  (
    '11111111-1111-1111-1111-111111111102',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'przelewy24',
    '11111111-1111-1111-1111-111111111109',
    '11111111-1111-1111-1111-111111111107',
    320, 0, 'pending', 'online',
    'Kids — pakiet 4 zajęć',
    'kids', 'package',
    now(),
    null
  )
on conflict (id) do nothing;
