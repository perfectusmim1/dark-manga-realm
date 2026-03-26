create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
    if coalesce(current_setting('toonparrot.preserve_updated_at', true), 'off') = 'on' then
        new.updated_at = old.updated_at;
    else
        new.updated_at = now();
    end if;

    return new;
end;
$function$;

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
  perform set_config('toonparrot.preserve_updated_at', 'on', true);

  update public.users as u
  set
    username = v_next_username,
    username_last_changed_at = v_now
  where u.id = v_user_id
  returning u.*
  into v_profile;

  update public.comments as c
  set username = v_next_username
  where c.user_id = v_user_id;

  update public.character_comments as c
  set username = v_next_username
  where c.user_id = v_user_id;

  update public.author_comments as c
  set username = v_next_username
  where c.user_id = v_user_id;

  update public.artist_comments as c
  set username = v_next_username
  where c.user_id = v_user_id;

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

update public.comments as c
set updated_at = null
from public.users as u
where u.id = c.user_id
  and u.username_last_changed_at is not null
  and c.updated_at is not null
  and c.created_at < u.username_last_changed_at
  and abs(extract(epoch from (c.updated_at - u.username_last_changed_at))) <= 15;
