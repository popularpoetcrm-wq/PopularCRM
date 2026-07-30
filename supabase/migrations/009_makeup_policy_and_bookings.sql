-- Oтработка только если предупредил; бронь на группу или пробное (Tickets).

update package_plans
set makeup_policy = 'ONLY_IF_NOTIFIED'
where makeup_policy = 'ALWAYS_CREATE_ON_ABSENCE';

update student_packages
set plan_snapshot = jsonb_set(
  coalesce(plan_snapshot, '{}'::jsonb),
  '{makeup_policy}',
  '"ONLY_IF_NOTIFIED"'::jsonb,
  true
)
where coalesce(plan_snapshot->>'makeup_policy', '') = 'ALWAYS_CREATE_ON_ABSENCE';

alter table makeup_bookings
  alter column target_session_id drop not null;

alter table makeup_bookings
  add column if not exists target_kind text not null default 'group_session'
    check (target_kind in ('group_session', 'trial_event'));

alter table makeup_bookings
  add column if not exists tickets_event_id text;

alter table makeup_bookings
  add column if not exists tickets_ticket_id text;

alter table makeup_bookings
  add column if not exists tickets_order_id text;

alter table makeup_bookings
  add column if not exists tickets_starts_at timestamptz;

-- Drop old unique that required session id; replace with partial uniques.
alter table makeup_bookings
  drop constraint if exists makeup_bookings_makeup_credit_id_target_session_id_key;

create unique index if not exists makeup_bookings_credit_session_uidx
  on makeup_bookings (makeup_credit_id, target_session_id)
  where target_session_id is not null and status = 'booked';

create unique index if not exists makeup_bookings_credit_trial_uidx
  on makeup_bookings (makeup_credit_id, tickets_event_id)
  where tickets_event_id is not null and status = 'booked';

alter table makeup_bookings
  drop constraint if exists makeup_bookings_target_check;

alter table makeup_bookings
  add constraint makeup_bookings_target_check check (
    (
      target_kind = 'group_session'
      and target_session_id is not null
      and tickets_event_id is null
      and tickets_ticket_id is null
    )
    or (
      target_kind = 'trial_event'
      and target_session_id is null
      and tickets_event_id is not null
    )
  );
