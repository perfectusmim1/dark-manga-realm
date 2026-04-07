do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'series_request_status'
  ) then
    create type public.series_request_status as enum (
      'pending',
      'in_review',
      'approved',
      'rejected'
    );
  end if;
end;
$$;

create table if not exists public.series_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  series_title text not null,
  reference_url text not null,
  reference_host text not null,
  note text,
  admin_note text,
  status public.series_request_status not null default 'pending',
  reviewed_at timestamptz,
  reviewed_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_requests_title_not_blank check (char_length(btrim(series_title)) >= 2),
  constraint series_requests_reference_url_not_blank check (char_length(btrim(reference_url)) >= 8)
);

alter table public.series_requests
  add column if not exists note text,
  add column if not exists admin_note text,
  add column if not exists status public.series_request_status not null default 'pending',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists series_requests_user_created_at_idx
  on public.series_requests(user_id, created_at desc);

create index if not exists series_requests_status_created_at_idx
  on public.series_requests(status, created_at desc);

create index if not exists series_requests_reference_host_created_at_idx
  on public.series_requests(reference_host, created_at desc);

alter table public.series_requests enable row level security;

drop policy if exists series_requests_select_own_or_staff on public.series_requests;
create policy series_requests_select_own_or_staff
on public.series_requests
for select
to authenticated
using (
  user_id = (auth.uid())::text
  or public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists series_requests_insert_own on public.series_requests;
create policy series_requests_insert_own
on public.series_requests
for insert
to authenticated
with check (
  user_id = (auth.uid())::text
);

drop policy if exists series_requests_update_staff_only on public.series_requests;
create policy series_requests_update_staff_only
on public.series_requests
for update
to authenticated
using (
  public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
)
with check (
  public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
);

create or replace function public.set_series_requests_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_series_requests_updated_at on public.series_requests;
create trigger set_series_requests_updated_at
before update on public.series_requests
for each row
execute function public.set_series_requests_updated_at();

revoke insert, update, delete
on table public.series_requests
from anon, authenticated;

revoke all on function public.set_series_requests_updated_at() from public;
