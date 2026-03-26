alter table public.users enable row level security;

revoke insert on public.users from anon, authenticated;
revoke update on public.users from anon, authenticated;
revoke delete on public.users from anon, authenticated;

grant update (avatar, preferences)
  on public.users
  to authenticated;

drop policy if exists users_select_public on public.users;
create policy users_select_public
on public.users
for select
to anon, authenticated
using (true);

drop policy if exists users_update on public.users;
drop policy if exists users_update_self_profile on public.users;
create policy users_update_self_profile
on public.users
for update
to authenticated
using (
  (select auth.uid())::text = id
)
with check (
  (select auth.uid())::text = id
);

drop policy if exists users_delete on public.users;

create or replace function public.admin_delete_public_user(
  p_user_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.check_user_role((select auth.uid())::text, array['admin', 'moderator']) then
    raise exception 'Not authorized';
  end if;

  delete from public.users
  where id = p_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

revoke all on function public.admin_delete_public_user(text) from public;
grant execute on function public.admin_delete_public_user(text) to authenticated;
