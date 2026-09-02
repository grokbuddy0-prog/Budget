-- Per-user encrypted money fields. Dates, type, frequency, ids stay plaintext.
-- Existing rows stay as-is until that user signs in; migrate then writes ciphertext.

alter table user_settings
  add column if not exists starting_balance_enc text,
  add column if not exists alert_threshold_enc text,
  add column if not exists wrapped_dek text,
  add column if not exists wrapped_dek_recovery text,
  add column if not exists wrapped_dek_mcp text,
  add column if not exists kdf_salt text,
  add column if not exists kdf_n integer,
  add column if not exists kdf_r integer,
  add column if not exists kdf_p integer,
  add column if not exists crypto_migrated boolean not null default false;

alter table cashflow_items
  add column if not exists name_enc text,
  add column if not exists amount_enc text,
  add column if not exists account_label_enc text,
  add column if not exists notes_enc text;

alter table occurrence_overrides
  add column if not exists amount_enc text;

alter table cashflow_items drop constraint if exists cashflow_items_amount_check;
