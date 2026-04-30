-- Close direct exploit paths while preserving the existing app-facing RPCs.

revoke execute on function public.upsert_public_user_from_auth(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_public_user_from_auth(uuid, text, text, text)
  to service_role;

revoke execute on function public.list_user_auth_sessions(uuid)
  from public, anon, authenticated;
revoke execute on function public.revoke_user_auth_sessions(uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.is_user_auth_session_active(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_user_auth_sessions(uuid) to service_role;
grant execute on function public.revoke_user_auth_sessions(uuid, uuid[]) to service_role;
grant execute on function public.is_user_auth_session_active(uuid, uuid) to service_role;

revoke execute on function public.refresh_user_ban_state(text)
  from public, anon, authenticated;
revoke execute on function public.refresh_user_warning_summary(text)
  from public, anon, authenticated;
grant execute on function public.refresh_user_ban_state(text) to service_role;
grant execute on function public.refresh_user_warning_summary(text) to service_role;

do $$
begin
  if to_regprocedure('public.sync_user_two_factor_state(uuid)') is not null then
    revoke execute on function public.sync_user_two_factor_state(uuid)
      from public, anon, authenticated;
    grant execute on function public.sync_user_two_factor_state(uuid) to service_role;
  end if;
end;
$$;

-- Do not let direct RPC callers ask for arbitrary users' roles.
create or replace function public.check_user_role(target_id text, required_roles text[])
returns boolean
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_current_user_id text := (select auth.uid())::text;
begin
  if v_current_user_id is null or target_id is null or target_id <> v_current_user_id then
    return false;
  end if;

  return exists (
    select 1
    from public.users
    where id = v_current_user_id
      and role = any(required_roles)
  );
end;
$$;

create or replace function public.update_user_presence(p_user_id text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_user_id text := (select auth.uid())::text;
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication required';
  end if;

  update public.users
  set last_seen_at = now()
  where id = v_user_id;
end;
$$;

create or replace function public.get_unread_announcement_count(p_user_id text)
returns bigint
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_user_id text := (select auth.uid())::text;
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication required';
  end if;

  return (
    select count(*)
    from public.announcements a
    where not exists (
      select 1
      from public.announcement_reads ar
      where ar.announcement_id = a.id
        and ar.user_id = v_user_id
    )
  );
end;
$$;

create or replace function public.get_public_user_presence_counts()
returns table(online_count bigint, offline_count bigint, total_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with counts as (
    select
      count(*) filter (where u.last_seen_at > now() - interval '1 minute')::bigint as online_count,
      count(*)::bigint as total_count
    from public.users as u
  )
  select
    counts.online_count,
    greatest(counts.total_count - counts.online_count, 0)::bigint as offline_count,
    counts.total_count
  from counts;
$$;

grant execute on function public.check_user_role(text, text[]) to anon, authenticated;
revoke execute on function public.update_user_presence(text) from public, anon;
grant execute on function public.update_user_presence(text) to authenticated;
revoke execute on function public.get_unread_announcement_count(text) from public, anon;
grant execute on function public.get_unread_announcement_count(text) to authenticated;
grant execute on function public.get_public_user_presence_counts() to anon, authenticated;

create table if not exists public.support_ticket_public_rate_limits (
  id uuid primary key default gen_random_uuid(),
  limiter_key text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists support_ticket_public_rate_limits_key_created_idx
  on public.support_ticket_public_rate_limits (limiter_key, created_at desc);

alter table public.support_ticket_public_rate_limits enable row level security;
revoke all on table public.support_ticket_public_rate_limits from public, anon, authenticated;
grant select, insert, delete on table public.support_ticket_public_rate_limits to service_role;
