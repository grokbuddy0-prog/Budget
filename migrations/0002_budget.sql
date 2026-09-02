-- Forward Balance: per-user cash-flow settings, recurring items, occurrence edits.

create table if not exists user_settings (
  user_id text primary key,
  starting_balance numeric(12, 2) not null default 0,
  starting_balance_date date not null,
  currency text not null default 'USD',
  projection_months integer not null default 6,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cashflow_items (
  id text primary key,
  user_id text not null,
  name text not null,
  type text not null check (type in ('income', 'bill')),
  amount numeric(12, 2) not null check (amount > 0),
  frequency text not null check (frequency in (
    'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'yearly', 'one_time'
  )),
  start_date date not null,
  end_date date,
  due_day integer,
  semi_day_1 integer,
  semi_day_2 integer,
  weekday integer,
  anchor_date date,
  account_label text not null default 'Checking',
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cashflow_items_user_id_idx on cashflow_items (user_id);

create table if not exists occurrence_overrides (
  id text primary key,
  user_id text not null,
  item_id text not null references cashflow_items (id) on delete cascade,
  original_date date not null,
  kind text not null check (kind in ('skip', 'amount', 'move')),
  amount numeric(12, 2),
  moved_date date,
  created_at timestamptz not null default now(),
  unique (item_id, original_date)
);

create index if not exists occurrence_overrides_user_id_idx on occurrence_overrides (user_id);
