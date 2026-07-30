-- Seed demo tenant + plan (run after 001_init.sql)
insert into tenants (id, name, settings)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Teatr Studio Demo',
  jsonb_build_object(
    'makeup_policy', 'ONLY_IF_NOTIFIED',
    'makeup_validity_days', 30,
    'booking_cutoff_minutes', 120,
    'payment_reminder_channels', jsonb_build_array('telegram_dm')
  )
);

insert into package_plans (
  id, tenant_id, name, lessons_count, validity_days, price_gross, start_policy, makeup_policy
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Pakiet 4 zajęć',
  4,
  60,
  400.00,
  'on_payment',
  'ONLY_IF_NOTIFIED'
);

insert into persons (id, tenant_id, full_name, email, phone, status)
values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Studio', 'admin@studio.local', '+48111111111', 'completed'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Anna Kowalska', 'anna@example.com', '+48222222222', 'completed'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Jan Nowak', 'jan@example.com', '+48333333333', 'completed');

insert into person_roles (tenant_id, person_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'teacher'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'student'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'payer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'student');

insert into groups (id, tenant_id, title, direction, teacher_person_id, capacity, default_plan_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Środa 18:00 — Impro',
  'impro',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  12,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

insert into group_schedule_rules (group_id, weekday, start_time, duration_minutes, room)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 3, '18:00', 90, 'Sala A');

insert into enrollments (id, tenant_id, student_person_id, group_id, plan_id, status)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'active');
