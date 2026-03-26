create or replace function public.get_admin_access_context()
returns table (
  user_id text,
  role text,
  can_access_admin_panel boolean,
  is_primary_admin boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  primary_admin_email constant text := 'caganherdil@gmail.com';
begin
  select *
  into v_user
  from public.users
  where public.users.id = (select auth.uid())::text
  limit 1;

  if not found then
    return query
    select
      null::text,
      null::text,
      false,
      false;
    return;
  end if;

  return query
  select
    v_user.id,
    v_user.role,
    v_user.role in ('admin', 'moderator'),
    lower(coalesce(v_user.email, '')) = primary_admin_email
      and v_user.role = 'admin';
end;
$$;

revoke all on function public.get_admin_access_context() from public;
grant execute on function public.get_admin_access_context() to authenticated;

create table if not exists public.profile_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id text not null references public.users(id) on delete cascade,
  reported_user_id text not null references public.users(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profile_reports_reason_length check (char_length(trim(reason)) between 3 and 80),
  constraint profile_reports_not_self check (reporter_id <> reported_user_id)
);

create unique index if not exists idx_profile_reports_unique_reporter_target
on public.profile_reports (reporter_id, reported_user_id);

create index if not exists idx_profile_reports_status_created_at
on public.profile_reports (status, created_at desc);

create index if not exists idx_profile_reports_reported_user_id
on public.profile_reports (reported_user_id);

alter table public.profile_reports enable row level security;

drop policy if exists "Authenticated users can create profile reports" on public.profile_reports;
drop policy if exists "Authenticated users can view own profile reports" on public.profile_reports;
drop policy if exists "Authenticated users can update own profile reports" on public.profile_reports;
drop policy if exists "Admins and moderators can view profile reports" on public.profile_reports;
drop policy if exists "Admins and moderators can update profile reports" on public.profile_reports;
drop policy if exists "Admins and moderators can delete profile reports" on public.profile_reports;

create policy "Authenticated users can create profile reports"
on public.profile_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())::text
  and reported_user_id <> (select auth.uid())::text
);

create policy "Authenticated users can view own profile reports"
on public.profile_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())::text
);

create policy "Authenticated users can update own profile reports"
on public.profile_reports
for update
to authenticated
using (
  reporter_id = (select auth.uid())::text
)
with check (
  reporter_id = (select auth.uid())::text
  and reported_user_id <> (select auth.uid())::text
);

create policy "Admins and moderators can view profile reports"
on public.profile_reports
for select
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Admins and moderators can update profile reports"
on public.profile_reports
for update
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
)
with check (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Admins and moderators can delete profile reports"
on public.profile_reports
for delete
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

drop trigger if exists trg_touch_profile_reports_updated_at on public.profile_reports;
create trigger trg_touch_profile_reports_updated_at
before update on public.profile_reports
for each row
execute function public.touch_report_updated_at();
