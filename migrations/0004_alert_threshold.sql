alter table user_settings
  add column if not exists alert_threshold numeric(12, 2) not null default 0;
