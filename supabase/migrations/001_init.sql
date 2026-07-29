-- Studio CRM — core schema (tenant-ready)
create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ─── tenants ───────────────────────────────────────────────
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Warsaw',
  locale text not null default 'pl-PL',
  currency char(3) not null default 'PLN',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ─── persons & identity ────────────────────────────────────
create table persons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  full_name text not null,
  phone text,
  email citext,
  birth_date date,
  tshirt_size text,
  is_minor boolean not null default false,
  status text not null default 'completed'
    check (status in ('started','completed','cancelled','expired','suspended','archived')),
  auth_user_id uuid unique,
  created_at timestamptz not null default now()
);
create index persons_tenant_idx on persons(tenant_id);
create index persons_email_idx on persons(tenant_id, email);

create table telegram_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  person_id uuid not null references persons(id),
  telegram_user_id bigint not null,
  chat_id bigint,
  username text,
  language_code text,
  verified_at timestamptz,
  allows_write_to_pm boolean default true,
  blocked_at timestamptz,
  last_seen_at timestamptz,
  unique (tenant_id, telegram_user_id)
);

create table person_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  person_id uuid not null references persons(id),
  role text not null check (role in ('student','parent','payer','teacher','admin','owner','accounting')),
  scope_type text not null default 'tenant' check (scope_type in ('tenant','group','student')),
  scope_id uuid,
  granted_by uuid references persons(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index person_roles_person_idx on person_roles(person_id) where revoked_at is null;

create table student_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  student_person_id uuid not null references persons(id),
  contact_person_id uuid not null references persons(id),
  relation_type text not null default 'parent'
    check (relation_type in ('parent','guardian','payer','self')),
  is_primary boolean not null default false,
  can_pay boolean not null default true,
  can_receive_notifications boolean not null default true,
  unique (student_person_id, contact_person_id, relation_type)
);

create table magic_login_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email citext not null,
  code text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── groups & schedule ─────────────────────────────────────
create table package_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  lessons_count int not null default 4 check (lessons_count > 0),
  validity_days int not null default 60,
  price_gross numeric(12,2) not null,
  currency char(3) not null default 'PLN',
  start_policy text not null default 'on_payment'
    check (start_policy in ('on_payment','on_first_attendance','custom_start_date')),
  makeup_policy text not null default 'ALWAYS_CREATE_ON_ABSENCE'
    check (makeup_policy in ('ALWAYS_CREATE_ON_ABSENCE','ONLY_IF_NOTIFIED','NEVER')),
  makeup_validity_days int not null default 30,
  booking_cutoff_minutes int not null default 120,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  title text not null,
  direction text,
  level text,
  age_band text,
  teacher_person_id uuid references persons(id),
  capacity int not null default 12,
  status text not null default 'active' check (status in ('active','archived')),
  default_plan_id uuid references package_plans(id),
  telegram_chat_id bigint,
  created_at timestamptz not null default now()
);

create table group_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_minutes int not null default 90,
  valid_from date,
  valid_to date,
  room text
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  group_id uuid not null references groups(id),
  teacher_person_id uuid references persons(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','completed','cancelled_by_studio')),
  capacity_override int,
  notes text,
  unique (group_id, starts_at)
);
create index sessions_group_starts_idx on sessions(group_id, starts_at);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  student_person_id uuid not null references persons(id),
  group_id uuid not null references groups(id),
  plan_id uuid references package_plans(id),
  status text not null default 'active'
    check (status in ('active','paused','ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  tags text[] default '{}',
  unique (student_person_id, group_id, status)
);

-- ─── packages & credits ────────────────────────────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  provider text not null default 'przelewy24'
    check (provider in ('przelewy24','cash','transfer','other')),
  payer_person_id uuid references persons(id),
  enrollment_id uuid references enrollments(id),
  student_package_id uuid,
  amount numeric(12,2) not null,
  currency char(3) not null default 'PLN',
  status text not null default 'pending'
    check (status in ('pending','paid','failed','refunded','cancelled','partial')),
  amount_paid numeric(12,2) not null default 0,
  payment_method text check (payment_method in ('online','cash','transfer','invoice')),
  description text,
  provider_session_id text,
  provider_order_id text,
  provider_token text,
  payment_url text,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create unique index payments_provider_session_uidx
  on payments(tenant_id, provider_session_id)
  where provider_session_id is not null;

create table student_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  enrollment_id uuid not null references enrollments(id),
  plan_snapshot jsonb not null,
  payment_id uuid references payments(id),
  activated_at timestamptz,
  expires_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','active','expired','cancelled')),
  created_at timestamptz not null default now()
);

alter table payments
  add constraint payments_student_package_fk
  foreign key (student_package_id) references student_packages(id);

create table lesson_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  student_package_id uuid not null references student_packages(id) on delete cascade,
  credit_index smallint not null,
  status text not null default 'available'
    check (status in ('available','consumed','expired','void')),
  consumed_session_id uuid references sessions(id),
  consumed_attendance_id uuid,
  expires_at timestamptz,
  unique (student_package_id, credit_index)
);

-- ─── attendance & makeups ──────────────────────────────────
create table attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  session_id uuid not null references sessions(id),
  enrollment_id uuid not null references enrollments(id),
  student_person_id uuid not null references persons(id),
  attendance_type text not null default 'regular'
    check (attendance_type in ('regular','makeup')),
  status text not null
    check (status in ('present','absent','absent_notified','cancelled_by_studio')),
  marked_by uuid references persons(id),
  marked_at timestamptz not null default now(),
  comment text,
  unique (session_id, enrollment_id)
);

alter table lesson_credits
  add constraint lesson_credits_attendance_fk
  foreign key (consumed_attendance_id) references attendance(id);

create table makeup_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  student_person_id uuid not null references persons(id),
  source_attendance_id uuid not null references attendance(id),
  source_package_id uuid references student_packages(id),
  status text not null default 'available'
    check (status in ('available','booked','used','expired','burned')),
  valid_until timestamptz not null,
  rules_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table makeup_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  makeup_credit_id uuid not null references makeup_credits(id),
  target_session_id uuid not null references sessions(id),
  status text not null default 'booked'
    check (status in ('booked','cancelled','used','no_show')),
  booked_by uuid references persons(id),
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (makeup_credit_id, target_session_id)
);

-- ─── payment events / invoices / notifications ─────────────
create table payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  payment_id uuid references payments(id),
  provider_event_key text not null,
  payload_hash text not null,
  raw_payload jsonb not null,
  is_duplicate boolean not null default false,
  processed_at timestamptz,
  verify_result jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider_event_key)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  payment_id uuid not null references payments(id),
  buyer_person_id uuid references persons(id),
  buyer_type text not null default 'person'
    check (buyer_type in ('person','company')),
  company_name text,
  nip text,
  requested boolean not null default true,
  saldeo_invoice_id text,
  invoice_number text,
  ksef_number text,
  pdf_url text,
  status text not null default 'requested'
    check (status in ('requested','queued','sent_to_saldeo','issued','failed','cancelled')),
  issued_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  recipient_person_id uuid references persons(id),
  channel text not null check (channel in ('telegram','email')),
  template_code text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','sent','failed','cancelled')),
  provider_message_id text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index notifications_status_idx on notifications(status, scheduled_at);

create table outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','processing','done','failed')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index outbox_pending_idx on outbox(status, available_at);

create table exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  type text not null,
  format text not null check (format in ('csv','xlsx')),
  requested_by uuid references persons(id),
  status text not null default 'pending'
    check (status in ('pending','ready','failed')),
  storage_path text,
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  actor_person_id uuid references persons(id),
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_created_idx on audit_log(tenant_id, created_at desc);

-- ─── helper: remaining credits view ────────────────────────
create or replace view v_package_balances as
select
  sp.id as student_package_id,
  sp.tenant_id,
  sp.enrollment_id,
  sp.status as package_status,
  sp.expires_at,
  count(*) filter (where lc.status = 'available')::int as credits_available,
  count(*) filter (where lc.status = 'consumed')::int as credits_consumed,
  count(*)::int as credits_total
from student_packages sp
join lesson_credits lc on lc.student_package_id = sp.id
group by sp.id;

-- ─── RLS (basic tenant isolation; refine with JWT claims later) ─
alter table tenants enable row level security;
alter table persons enable row level security;
alter table telegram_identities enable row level security;
alter table person_roles enable row level security;
alter table student_contacts enable row level security;
alter table groups enable row level security;
alter table group_schedule_rules enable row level security;
alter table sessions enable row level security;
alter table package_plans enable row level security;
alter table enrollments enable row level security;
alter table student_packages enable row level security;
alter table lesson_credits enable row level security;
alter table attendance enable row level security;
alter table makeup_credits enable row level security;
alter table makeup_bookings enable row level security;
alter table payments enable row level security;
alter table payment_events enable row level security;
alter table invoices enable row level security;
alter table notifications enable row level security;
alter table outbox enable row level security;
alter table exports enable row level security;
alter table audit_log enable row level security;
alter table magic_login_codes enable row level security;

-- Service role bypasses RLS. Client policies use auth.jwt() ->> 'tenant_id'
-- Placeholder permissive policies for authenticated users within tenant claim:
create policy tenant_select_persons on persons for select to authenticated
  using (tenant_id::text = coalesce(auth.jwt() ->> 'tenant_id', tenant_id::text));
create policy tenant_all_persons_service on persons for all to service_role using (true) with check (true);
