-- Profile fields for self-serve onboarding
alter table persons
  add column if not exists telegram_username text;

comment on column persons.telegram_username is
  'Preferred @username from onboarding; real link lives in telegram_identities';
