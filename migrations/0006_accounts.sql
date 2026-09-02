-- Encrypted per-user bank accounts. Names and balances are ciphertext.
-- starting_balance_enc stays the total so the existing projection engine is unchanged.

alter table user_settings
  add column if not exists accounts_enc text;
