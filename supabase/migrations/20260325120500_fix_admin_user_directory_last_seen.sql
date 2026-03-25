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
    u.id,
    u.username,
    u.email,
    u.avatar,
    u.role,
    u.is_banned,
    u.ban_reason,
    u.banned_at,
    u.created_at,
    u.last_seen_at
  from public.users as u
  order by u.created_at desc;
end;
$$;

revoke all on function public.get_admin_user_directory() from public;
grant execute on function public.get_admin_user_directory() to authenticated;
