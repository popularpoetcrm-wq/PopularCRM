-- One attendance row may consume at most one lesson and create at most one makeup.
-- These constraints make repeated saves and webhook/API retries safe.

create unique index if not exists lesson_credits_consumed_attendance_uidx
  on lesson_credits(consumed_attendance_id)
  where consumed_attendance_id is not null;

create unique index if not exists makeup_credits_source_attendance_uidx
  on makeup_credits(source_attendance_id);

create unique index if not exists invoices_active_payment_uidx
  on invoices(payment_id)
  where status <> 'cancelled';
