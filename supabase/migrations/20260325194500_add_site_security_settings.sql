create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by text
);

alter table public.site_settings enable row level security;

revoke all on public.site_settings from public, anon, authenticated;

insert into public.site_settings (key, value)
values (
  'security',
  jsonb_build_object('devtoolsProtectionEnabled', false)
)
on conflict (key) do nothing;

create or replace function public.get_site_security_settings()
returns table (
  devtools_protection_enabled boolean,
  updated_at timestamptz,
  updated_by text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((settings.value ->> 'devtoolsProtectionEnabled')::boolean, false) as devtools_protection_enabled,
    settings.updated_at,
    settings.updated_by
  from public.site_settings as settings
  where settings.key = 'security'
  union all
  select
    false as devtools_protection_enabled,
    null::timestamptz as updated_at,
    null::text as updated_by
  where not exists (
    select 1
    from public.site_settings as settings
    where settings.key = 'security'
  )
  limit 1;
$$;

revoke all on function public.get_site_security_settings() from public;
grant execute on function public.get_site_security_settings() to anon, authenticated;

create or replace function public.admin_set_devtools_protection(p_enabled boolean)
returns table (
  devtools_protection_enabled boolean,
  updated_at timestamptz,
  updated_by text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text := (select auth.uid())::text;
begin
  if v_user_id is null or not public.check_user_role(v_user_id, array['admin']) then
    raise exception 'Not authorized';
  end if;

  insert into public.site_settings as settings (
    key,
    value,
    updated_at,
    updated_by
  )
  values (
    'security',
    jsonb_build_object('devtoolsProtectionEnabled', p_enabled),
    timezone('utc', now()),
    v_user_id
  )
  on conflict (key) do update
  set
    value = coalesce(settings.value, '{}'::jsonb) || jsonb_build_object('devtoolsProtectionEnabled', p_enabled),
    updated_at = timezone('utc', now()),
    updated_by = v_user_id;

  return query
  select
    coalesce((settings.value ->> 'devtoolsProtectionEnabled')::boolean, false) as devtools_protection_enabled,
    settings.updated_at,
    settings.updated_by
  from public.site_settings as settings
  where settings.key = 'security'
  limit 1;
end;
$$;

revoke all on function public.admin_set_devtools_protection(boolean) from public;
grant execute on function public.admin_set_devtools_protection(boolean) to authenticated;
