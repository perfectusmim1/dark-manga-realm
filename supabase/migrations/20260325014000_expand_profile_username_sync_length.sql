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
  v_base := left(v_base, 32);

  if v_base = '' then
    v_base := 'user';
  end if;

  loop
    v_candidate := case
      when v_suffix = 0 then v_base
      else left(v_base, greatest(3, 32 - length(v_suffix::text))) || v_suffix::text
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

update public.users as u
set username = public.generate_unique_public_username(au.raw_user_meta_data ->> 'username', u.id)
from auth.users as au
where au.id::text = u.id
  and u.role = 'user'
  and nullif(au.raw_user_meta_data ->> 'username', '') is not null
  and u.username <> au.raw_user_meta_data ->> 'username'
  and length(u.username) = 15
  and length(au.raw_user_meta_data ->> 'username') > 15;
