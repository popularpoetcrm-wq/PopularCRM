-- Client notification centre: read state, archive state and idempotent delivery.

alter table notifications
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists dedupe_key text,
  add column if not exists delivery_attempts integer not null default 0;

create index if not exists notifications_recipient_inbox_idx
  on notifications(tenant_id, recipient_person_id, created_at desc)
  where archived_at is null;

create unique index if not exists notifications_dedupe_uidx
  on notifications(tenant_id, recipient_person_id, dedupe_key)
  where dedupe_key is not null and status <> 'cancelled';

comment on column notifications.read_at is
  'When the recipient marked this cabinet notification as read.';
comment on column notifications.archived_at is
  'When the recipient hid this notification from the cabinet inbox.';
comment on column notifications.dedupe_key is
  'Business idempotency key, scoped to tenant and recipient.';
comment on column notifications.delivery_attempts is
  'Number of external delivery attempts; automatic retries stop after four.';
