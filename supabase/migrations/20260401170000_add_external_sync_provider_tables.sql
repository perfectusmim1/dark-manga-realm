create table if not exists public.external_provider_accounts (
  user_id text not null references public.users(id) on delete cascade,
  provider text not null,
  provider_user_id text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}'::text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error text,
  last_error_at timestamptz,
  primary key (user_id, provider),
  constraint external_provider_accounts_provider_check check (provider in ('myanimelist', 'anilist'))
);

create index if not exists idx_external_provider_accounts_provider on public.external_provider_accounts (provider);
create index if not exists idx_external_provider_accounts_updated_at on public.external_provider_accounts (updated_at desc);

create table if not exists public.external_sync_state (
  user_id text not null references public.users(id) on delete cascade,
  manga_id text not null references public.mangas(id) on delete cascade,
  provider text not null,
  remote_media_id text,
  remote_review_id text,
  last_synced_status text,
  last_synced_progress integer,
  last_synced_score numeric(6, 2),
  last_synced_started_at date,
  last_synced_completed_at date,
  last_review_hash text,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  primary key (user_id, manga_id, provider),
  constraint external_sync_state_provider_check check (provider in ('myanimelist', 'anilist'))
);

create index if not exists idx_external_sync_state_user_provider on public.external_sync_state (user_id, provider);
create index if not exists idx_external_sync_state_manga_provider on public.external_sync_state (manga_id, provider);
create index if not exists idx_external_sync_state_last_sync_at on public.external_sync_state (last_sync_at desc);

create table if not exists public.external_provider_auth_states (
  state text primary key,
  user_id text not null references public.users(id) on delete cascade,
  provider text not null,
  code_verifier text,
  redirect_path text not null default '/settings?tab=sync',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint external_provider_auth_states_provider_check check (provider in ('myanimelist', 'anilist'))
);

create index if not exists idx_external_provider_auth_states_user on public.external_provider_auth_states (user_id, provider);
create index if not exists idx_external_provider_auth_states_expires_at on public.external_provider_auth_states (expires_at asc);

alter table public.external_provider_accounts enable row level security;
alter table public.external_sync_state enable row level security;
alter table public.external_provider_auth_states enable row level security;
