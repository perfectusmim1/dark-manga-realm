create or replace function public.current_session_satisfies_mfa_requirement()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when auth.uid() is null then false
      when exists (
        select 1
        from auth.mfa_factors as factors
        where factors.user_id = auth.uid()
          and factors.factor_type = 'totp'
          and factors.status = 'verified'
      ) then coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      else true
    end;
$$;

revoke all on function public.current_session_satisfies_mfa_requirement() from public;
grant execute on function public.current_session_satisfies_mfa_requirement() to authenticated;

create or replace function public.sync_user_two_factor_state(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users as users_table
  set two_factor_enabled = exists (
    select 1
    from auth.mfa_factors as factors
    where factors.user_id = p_user_id
      and factors.factor_type = 'totp'
      and factors.status = 'verified'
  )
  where users_table.id = p_user_id::text;
end;
$$;

revoke all on function public.sync_user_two_factor_state(uuid) from public;

create or replace function public.handle_auth_mfa_factor_state_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_user_two_factor_state(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

revoke all on function public.handle_auth_mfa_factor_state_sync() from public;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.handle_auth_mfa_factor_state_sync() to supabase_auth_admin;

drop trigger if exists on_auth_mfa_factor_state_sync on auth.mfa_factors;

create trigger on_auth_mfa_factor_state_sync
  after insert or update or delete on auth.mfa_factors
  for each row execute function public.handle_auth_mfa_factor_state_sync();

update public.users as users_table
set two_factor_enabled = exists (
  select 1
  from auth.mfa_factors as factors
  where factors.user_id = users_table.id::uuid
    and factors.factor_type = 'totp'
    and factors.status = 'verified'
);

create or replace function public.admin_set_user_role(
  p_user_id text,
  p_role text
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.users%rowtype;
begin
  if not public.check_user_role((select auth.uid())::text, array['admin']) then
    raise exception 'Not authorized';
  end if;

  if p_role not in ('user', 'moderator') then
    raise exception 'Only user and moderator roles are allowed';
  end if;

  update public.users
  set role = p_role
  where id = p_user_id
  returning * into v_target;

  if not found then
    raise exception 'User not found';
  end if;

  return v_target;
end;
$$;

revoke all on function public.admin_set_user_role(text, text) from public;
grant execute on function public.admin_set_user_role(text, text) to authenticated;

revoke all on public.users from anon, authenticated;
grant select (id, username, avatar, role, created_at, preferences, two_factor_enabled, last_seen_at)
  on public.users
  to anon, authenticated;
grant update (avatar, preferences)
  on public.users
  to authenticated;
grant delete
  on public.users
  to authenticated;

drop policy if exists users_update on public.users;
create policy users_update
on public.users
for update
using (
  (((select auth.uid())::text = id) or public.check_user_role((select auth.uid())::text, array['admin', 'moderator']))
)
with check (
  (((select auth.uid())::text = id) or public.check_user_role((select auth.uid())::text, array['admin', 'moderator']))
);

drop policy if exists users_delete on public.users;
create policy users_delete
on public.users
for delete
using (
  public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

do $$
declare
  v_table_name text;
begin
  for v_table_name in
    select c.relname
    from pg_class as c
    join pg_namespace as n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
  loop
    execute format('drop policy if exists %I on public.%I', 'mfa_opt_in_enforcement', v_table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.current_session_satisfies_mfa_requirement())) with check ((select public.current_session_satisfies_mfa_requirement()))',
      'mfa_opt_in_enforcement',
      v_table_name
    );
  end loop;
end;
$$;
