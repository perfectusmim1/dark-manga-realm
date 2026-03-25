create or replace function public.sync_current_auth_profile(
  p_avatar text default null,
  p_base_username text default null
)
returns table (
  id text,
  username text,
  avatar text,
  role text,
  created_at timestamptz,
  preferences jsonb,
  two_factor_enabled boolean,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.upsert_public_user_from_auth(
    auth.uid(),
    nullif(auth.jwt() ->> 'email', ''),
    p_avatar,
    p_base_username
  );

  return query
  select
    v_profile.id::text,
    v_profile.username::text,
    v_profile.avatar::text,
    v_profile.role::text,
    v_profile.created_at,
    v_profile.preferences,
    v_profile.two_factor_enabled,
    v_profile.last_seen_at;
end;
$$;

revoke all on function public.sync_current_auth_profile(text, text) from public;
grant execute on function public.sync_current_auth_profile(text, text) to authenticated;

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
  created_at timestamptz,
  last_seen_at timestamptz
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
    u.id::text,
    u.username::text,
    u.email::text,
    u.avatar::text,
    u.role::text,
    u.is_banned,
    u.ban_reason::text,
    u.banned_at,
    u.created_at,
    u.last_seen_at
  from public.users as u
  order by u.created_at desc;
end;
$$;

revoke all on function public.get_admin_user_directory() from public;
grant execute on function public.get_admin_user_directory() to authenticated;
