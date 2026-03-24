create or replace function public.generate_unique_public_username(
  p_base_username text,
  p_current_user_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := lower(coalesce(nullif(trim(p_base_username), ''), 'user'));
  v_candidate text;
  v_suffix integer := 0;
begin
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

    exit when not exists (
      select 1
      from public.users
      where username = v_candidate
        and coalesce(id, '') <> coalesce(p_current_user_id, '')
    );

    v_suffix := v_suffix + 1;

    if v_suffix > 9999 then
      raise exception 'Unable to create a unique username';
    end if;
  end loop;

  return v_candidate;
end;
$$;

revoke all on function public.generate_unique_public_username(text, text) from public;

create or replace function public.upsert_public_user_from_auth(
  p_auth_user_id uuid,
  p_email text,
  p_avatar text default null,
  p_base_username text default null
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_id text := p_auth_user_id::text;
  v_email text := lower(coalesce(nullif(trim(p_email), ''), ''));
  v_avatar text := nullif(trim(coalesce(p_avatar, '')), '');
  v_profile public.users%rowtype;
  v_username text;
begin
  select *
  into v_profile
  from public.users
  where public.users.id = v_auth_id
  limit 1;

  if found then
    update public.users
    set
      email = case when v_email <> '' then v_email else email end,
      avatar = coalesce(v_avatar, avatar)
    where public.users.id = v_auth_id
    returning * into v_profile;

    return v_profile;
  end if;

  if v_email <> '' then
    update public.users
    set
      id = v_auth_id,
      email = v_email,
      avatar = coalesce(v_avatar, avatar)
    where lower(coalesce(public.users.email, '')) = v_email
    returning * into v_profile;

    if found then
      return v_profile;
    end if;
  end if;

  v_username := public.generate_unique_public_username(
    coalesce(nullif(p_base_username, ''), split_part(v_email, '@', 1), 'user'),
    v_auth_id
  );

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
    v_username,
    nullif(v_email, ''),
    v_avatar,
    'user',
    'managed_by_supabase_auth'
  )
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.upsert_public_user_from_auth(uuid, text, text, text) from public;

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

create or replace function public.handle_auth_user_profile_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.upsert_public_user_from_auth(
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(lower(coalesce(new.email, '')), '@', 1)
    )
  );

  return new;
end;
$$;

revoke all on function public.handle_auth_user_profile_sync() from public;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.handle_auth_user_profile_sync() to supabase_auth_admin;

drop trigger if exists on_auth_user_created_sync_profile on auth.users;
create trigger on_auth_user_created_sync_profile
  after insert on auth.users
  for each row execute function public.handle_auth_user_profile_sync();

drop trigger if exists on_auth_user_updated_sync_profile on auth.users;
create trigger on_auth_user_updated_sync_profile
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_profile_sync();

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
    coalesce(u.id, au.id::text) as id,
    coalesce(
      u.username,
      nullif(au.raw_user_meta_data ->> 'username', ''),
      nullif(au.raw_user_meta_data ->> 'preferred_username', ''),
      split_part(lower(coalesce(au.email, '')), '@', 1),
      'user'
    ) as username,
    coalesce(u.email, au.email) as email,
    coalesce(
      u.avatar,
      nullif(au.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(au.raw_user_meta_data ->> 'picture', '')
    ) as avatar,
    coalesce(u.role, 'user') as role,
    coalesce(u.created_at, au.created_at) as created_at
  from auth.users as au
  left join public.users as u
    on u.id = au.id::text
  order by coalesce(u.created_at, au.created_at) desc;
end;
$$;

revoke all on function public.get_admin_user_directory() from public;
grant execute on function public.get_admin_user_directory() to authenticated;

select public.upsert_public_user_from_auth(
  au.id,
  au.email,
  coalesce(
    nullif(au.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(au.raw_user_meta_data ->> 'picture', '')
  ),
  coalesce(
    nullif(au.raw_user_meta_data ->> 'username', ''),
    nullif(au.raw_user_meta_data ->> 'preferred_username', ''),
    nullif(au.raw_user_meta_data ->> 'full_name', ''),
    split_part(lower(coalesce(au.email, '')), '@', 1)
  )
)
from auth.users as au;
