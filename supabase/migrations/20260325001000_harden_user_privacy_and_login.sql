create table if not exists public.auth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  identifier_hash text not null,
  ip_hash text not null,
  success boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_auth_login_attempts_identifier_created_at
  on public.auth_login_attempts (identifier_hash, created_at desc);

create index if not exists idx_auth_login_attempts_ip_created_at
  on public.auth_login_attempts (ip_hash, created_at desc);

alter table public.auth_login_attempts enable row level security;

revoke select on public.users from anon, authenticated;
grant select (id, username, avatar, role, created_at, preferences, two_factor_enabled, last_seen_at)
  on public.users
  to anon, authenticated;

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
  v_auth_id text := (select auth.uid())::text;
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  v_profile public.users%rowtype;
  v_base text;
  v_candidate text;
  v_suffix integer := 0;
begin
  if v_auth_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.users
  where public.users.id = v_auth_id
  limit 1;

  if found then
    return query
    select
      v_profile.id,
      v_profile.username,
      v_profile.avatar,
      v_profile.role,
      v_profile.created_at,
      v_profile.preferences,
      v_profile.two_factor_enabled,
      v_profile.last_seen_at;
    return;
  end if;

  if v_email <> '' then
    update public.users
    set
      id = v_auth_id,
      avatar = coalesce(nullif(p_avatar, ''), avatar)
    where lower(coalesce(email, '')) = v_email
    returning * into v_profile;

    if found then
      return query
      select
        v_profile.id,
        v_profile.username,
        v_profile.avatar,
        v_profile.role,
        v_profile.created_at,
        v_profile.preferences,
        v_profile.two_factor_enabled,
        v_profile.last_seen_at;
      return;
    end if;
  end if;

  v_base := lower(coalesce(nullif(p_base_username, ''), split_part(v_email, '@', 1), 'user'));
  v_base := regexp_replace(v_base, '\s+', '_', 'g');
  v_base := regexp_replace(v_base, '[^a-z0-9_]', '', 'g');
  v_base := left(v_base, 15);

  if v_base = '' then
    v_base := 'user';
  end if;

  loop
    v_candidate := case
      when v_suffix = 0 then v_base
      else left(v_base, greatest(3, 15 - length(v_suffix::text))) || v_suffix::text
    end;

    begin
      insert into public.users (
        id,
        username,
        email,
        avatar,
        role,
        password_hash
      )
      values (
        v_auth_id,
        v_candidate,
        nullif((select auth.jwt() ->> 'email'), ''),
        nullif(p_avatar, ''),
        'user',
        'oauth_user'
      )
      returning * into v_profile;

      exit;
    exception
      when unique_violation then
        v_suffix := v_suffix + 1;

        if v_suffix > 9999 then
          raise exception 'Unable to create a unique username';
        end if;
    end;
  end loop;

  return query
  select
    v_profile.id,
    v_profile.username,
    v_profile.avatar,
    v_profile.role,
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
    u.created_at
  from public.users as u
  order by u.created_at desc;
end;
$$;

revoke all on function public.get_admin_user_directory() from public;
grant execute on function public.get_admin_user_directory() to authenticated;

create or replace function public.enforce_primary_admin_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  primary_admin_email constant text := 'caganherdil@gmail.com';
begin
  if tg_op = 'INSERT' then
    if new.role = 'admin' and lower(coalesce(new.email, '')) <> primary_admin_email then
      raise exception 'Only the primary admin account can hold admin role';
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if lower(coalesce(old.email, '')) = primary_admin_email then
      if lower(coalesce(new.email, '')) <> primary_admin_email or new.role <> 'admin' then
        raise exception 'Primary admin cannot be demoted, reassigned, or removed';
      end if;
    end if;

    if new.role = 'admin' and lower(coalesce(new.email, '')) <> primary_admin_email then
      raise exception 'Only the primary admin account can hold admin role';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if lower(coalesce(old.email, '')) = primary_admin_email then
      raise exception 'Primary admin cannot be deleted';
    end if;

    return old;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.touch_report_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
