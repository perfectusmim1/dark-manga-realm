alter table public.users
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by text references public.users(id) on delete set null;

create table if not exists public.user_access_fingerprints (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  ip_hash text,
  device_hash text not null,
  installation_id_hash text,
  user_agent text,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_user_access_fingerprints_unique
  on public.user_access_fingerprints (user_id, ip_hash, device_hash);

create table if not exists public.banned_ip_hashes (
  ip_hash text primary key,
  user_id text references public.users(id) on delete set null,
  reason text,
  banned_by text references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.banned_device_hashes (
  device_hash text primary key,
  user_id text references public.users(id) on delete set null,
  reason text,
  banned_by text references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.user_access_fingerprints enable row level security;
alter table public.banned_ip_hashes enable row level security;
alter table public.banned_device_hashes enable row level security;

revoke all on public.user_access_fingerprints from anon, authenticated;
revoke all on public.banned_ip_hashes from anon, authenticated;
revoke all on public.banned_device_hashes from anon, authenticated;

create or replace function public.prevent_username_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.username is distinct from old.username then
    raise exception 'Username is immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_username_change on public.users;

create trigger trg_prevent_username_change
before update of username on public.users
for each row
execute function public.prevent_username_change();

drop function if exists public.get_admin_user_directory();

create or replace function public.get_admin_user_directory()
returns table (
  id text,
  username text,
  email text,
  avatar text,
  role text,
  is_banned boolean,
  ban_reason text,
  banned_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.check_user_role((select auth.uid())::text, array['admin', 'moderator']) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    u.id,
    u.username,
    u.email,
    u.avatar,
    u.role,
    u.is_banned,
    u.ban_reason,
    u.banned_at,
    u.created_at
  from public.users as u
  order by u.created_at desc;
end;
$$;

revoke all on function public.get_admin_user_directory() from public;
grant execute on function public.get_admin_user_directory() to authenticated;
