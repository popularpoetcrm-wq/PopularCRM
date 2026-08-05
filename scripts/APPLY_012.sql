-- Apply in Supabase SQL Editor if migrations are not auto-run.
-- File: supabase/migrations/012_notification_center.sql

alter table notifications
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists dedupe_key text;

create index if not exists notifications_recipient_inbox_idx
  on notifications(tenant_id, recipient_person_id, created_at desc)
  where archived_at is null;

create unique index if not exists notifications_dedupe_uidx
  on notifications(tenant_id, recipient_person_id, dedupe_key)
  where dedupe_key is not null and status <> 'cancelled';
