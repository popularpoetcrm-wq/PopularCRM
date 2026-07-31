-- Bind CRM groups to Telegram group chats
alter table groups
  add column if not exists telegram_bind_token text,
  add column if not exists telegram_bind_expires_at timestamptz;

create index if not exists groups_tg_bind_token_idx
  on groups (telegram_bind_token)
  where telegram_bind_token is not null;

create index if not exists groups_telegram_chat_idx
  on groups (telegram_chat_id)
  where telegram_chat_id is not null;
