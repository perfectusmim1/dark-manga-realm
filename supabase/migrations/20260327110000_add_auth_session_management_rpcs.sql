create or replace function public.list_user_auth_sessions(
  p_user_id uuid
)
returns table (
  session_id uuid,
  user_agent text,
  created_at timestamptz,
  last_active_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    s.id as session_id,
    s.user_agent,
    s.created_at,
    coalesce(
      s.refreshed_at at time zone 'UTC',
      s.updated_at,
      s.created_at
    ) as last_active_at
  from auth.sessions as s
  where s.user_id = p_user_id
  order by
    coalesce(
      s.refreshed_at at time zone 'UTC',
      s.updated_at,
      s.created_at
    ) desc,
    s.created_at desc;
$$;

create or replace function public.revoke_user_auth_sessions(
  p_user_id uuid,
  p_session_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if coalesce(array_length(p_session_ids, 1), 0) = 0 then
    return 0;
  end if;

  delete from auth.sessions as s
  where s.user_id = p_user_id
    and s.id = any(p_session_ids);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.is_user_auth_session_active(
  p_user_id uuid,
  p_session_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from auth.sessions as s
    where s.user_id = p_user_id
      and s.id = p_session_id
  );
$$;

revoke all on function public.list_user_auth_sessions(uuid) from public;
revoke all on function public.revoke_user_auth_sessions(uuid, uuid[]) from public;
revoke all on function public.is_user_auth_session_active(uuid, uuid) from public;

grant execute on function public.list_user_auth_sessions(uuid) to service_role;
grant execute on function public.revoke_user_auth_sessions(uuid, uuid[]) to service_role;
grant execute on function public.is_user_auth_session_active(uuid, uuid) to service_role;
