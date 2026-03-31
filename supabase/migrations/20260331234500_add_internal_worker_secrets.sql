create table if not exists public.internal_worker_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.internal_worker_secrets enable row level security;
