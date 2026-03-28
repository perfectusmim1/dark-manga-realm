create or replace function public.update_current_user_preferences(
  p_preferences jsonb
)
returns table (
  id text,
  username text,
  username_last_changed_at timestamptz,
  avatar text,
  role text,
  is_banned boolean,
  ban_reason text,
  banned_at timestamptz,
  active_ban_type text,
  ban_expires_at timestamptz,
  warning_count integer,
  unread_warning_count integer,
  created_at timestamptz,
  preferences jsonb,
  two_factor_enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text := (select auth.uid())::text;
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  v_avatar text := nullif((select auth.jwt() -> 'user_metadata' ->> 'avatar_url'), '');
  v_base_username text := nullif(
    trim(
      coalesce(
        (select auth.jwt() -> 'user_metadata' ->> 'username'),
        (select auth.jwt() -> 'user_metadata' ->> 'full_name'),
        split_part(v_email, '@', 1),
        'user'
      )
    ),
    ''
  );
  v_profile public.users%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select u.*
  into v_profile
  from public.users as u
  where u.id = v_user_id
  for update;

  if not found then
    select *
    into v_profile
    from public.upsert_public_user_from_auth(
      auth.uid(),
      nullif(v_email, ''),
      v_avatar,
      v_base_username
    );
  end if;

  update public.users as u
  set preferences = coalesce(p_preferences, v_profile.preferences, '{}'::jsonb)
  where u.id = v_user_id
  returning u.*
  into v_profile;

  return query
  select
    v_profile.id::text,
    v_profile.username::text,
    v_profile.username_last_changed_at,
    v_profile.avatar::text,
    v_profile.role::text,
    v_profile.is_banned,
    v_profile.ban_reason::text,
    v_profile.banned_at,
    v_profile.active_ban_type::text,
    v_profile.ban_expires_at,
    v_profile.warning_count,
    v_profile.unread_warning_count,
    v_profile.created_at,
    v_profile.preferences,
    v_profile.two_factor_enabled;
end;
$$;

revoke all on function public.update_current_user_preferences(jsonb) from public;
grant execute on function public.update_current_user_preferences(jsonb) to authenticated;
