-- Avatar + versioned consents

alter table persons
  add column if not exists avatar_path text;

create table if not exists person_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  person_id uuid not null references persons(id) on delete cascade,
  doc_key text not null
    check (doc_key in ('studio_offer', 'photo_marketing')),
  doc_version text not null,
  accepted_at timestamptz not null default now(),
  accepted_by_person_id uuid references persons(id),
  ip text,
  user_agent text,
  unique (person_id, doc_key, doc_version)
);
create index if not exists person_consents_person_idx on person_consents(person_id);

alter table person_consents enable row level security;

-- Private avatars bucket (idempotent)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
