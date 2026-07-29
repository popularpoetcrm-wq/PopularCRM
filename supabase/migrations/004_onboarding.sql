-- Onboarding: invites, onboarding_status, telegram link tokens

alter table persons
  add column if not exists onboarding_status text not null default 'draft'
    check (onboarding_status in ('draft', 'invited', 'activated', 'complete')),
  add column if not exists invited_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists accepted_rules_at timestamptz;

create table if not exists person_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  person_id uuid not null references persons(id),
  email citext not null,
  token text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references persons(id)
);
create index if not exists person_invites_person_idx on person_invites(person_id);
create index if not exists person_invites_token_idx on person_invites(token) where consumed_at is null;

create table if not exists telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  person_id uuid not null references persons(id),
  token text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table person_invites enable row level security;
alter table telegram_link_tokens enable row level security;
