alter table public.users
  add column if not exists username_last_changed_at timestamptz;

grant select (username_last_changed_at)
  on public.users
  to anon, authenticated;

create or replace function public.prevent_username_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.username is distinct from old.username
    and coalesce(current_setting('toonparrot.allow_username_change', true), 'off') <> 'on' then
    raise exception 'Username is immutable';
  end if;

  return new;
end;
$$;

drop function if exists public.sync_current_auth_profile(text, text);

create function public.sync_current_auth_profile(
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
  username_last_changed_at timestamptz,
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
    v_profile.username_last_changed_at,
    v_profile.last_seen_at;
end;
$$;

revoke all on function public.sync_current_auth_profile(text, text) from public;
grant execute on function public.sync_current_auth_profile(text, text) to authenticated;

create or replace function public.update_current_user_username(
  p_username text
)
returns table (
  id text,
  username text,
  avatar text,
  role text,
  created_at timestamptz,
  preferences jsonb,
  two_factor_enabled boolean,
  username_last_changed_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text := (select auth.uid())::text;
  v_profile public.users%rowtype;
  v_requested_username text := nullif(trim(coalesce(p_username, '')), '');
  v_next_username text;
  v_now timestamptz := timezone('utc', now());
  v_next_available_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_requested_username is null then
    raise exception 'Kullanıcı adı boş olamaz';
  end if;

  select *
  into v_profile
  from public.users
  where id = v_user_id
  for update;

  if not found then
    select *
    into v_profile
    from public.upsert_public_user_from_auth(
      auth.uid(),
      nullif(auth.jwt() ->> 'email', ''),
      null,
      v_requested_username
    );
  end if;

  v_next_username := public.generate_unique_public_username(v_requested_username, v_user_id);

  if v_next_username = v_profile.username then
    return query
    select
      v_profile.id::text,
      v_profile.username::text,
      v_profile.avatar::text,
      v_profile.role::text,
      v_profile.created_at,
      v_profile.preferences,
      v_profile.two_factor_enabled,
      v_profile.username_last_changed_at,
      v_profile.last_seen_at;
    return;
  end if;

  if v_profile.username_last_changed_at is not null then
    v_next_available_at := v_profile.username_last_changed_at + interval '7 days';

    if v_next_available_at > v_now then
      raise exception 'Kullanıcı adı haftada bir değiştirilebilir. Sonraki değişiklik: %',
        to_char(v_next_available_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
    end if;
  end if;

  perform set_config('toonparrot.allow_username_change', 'on', true);

  update public.users
  set
    username = v_next_username,
    username_last_changed_at = v_now
  where id = v_user_id
  returning *
  into v_profile;

  update public.comments
  set username = v_next_username
  where user_id = v_user_id;

  update public.character_comments
  set username = v_next_username
  where user_id = v_user_id;

  update public.author_comments
  set username = v_next_username
  where user_id = v_user_id;

  update public.artist_comments
  set username = v_next_username
  where user_id = v_user_id;

  return query
  select
    v_profile.id::text,
    v_profile.username::text,
    v_profile.avatar::text,
    v_profile.role::text,
    v_profile.created_at,
    v_profile.preferences,
    v_profile.two_factor_enabled,
    v_profile.username_last_changed_at,
    v_profile.last_seen_at;
end;
$$;

revoke all on function public.update_current_user_username(text) from public;
grant execute on function public.update_current_user_username(text) to authenticated;
