alter table public.external_sync_state
add column if not exists last_synced_favorite boolean;
