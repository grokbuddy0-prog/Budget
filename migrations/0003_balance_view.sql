alter table user_settings
  add column if not exists balance_view text not null default 'every_day';
