create or replace function public.chapter_automation_times_are_valid(p_times text[])
returns boolean
language sql
immutable
as $$
  select
    coalesce(array_length(p_times, 1), 0) > 0
    and not exists (
      select 1
      from unnest(p_times) as time_value
      where time_value !~ '^(?:[01]\d|2[0-3]):[0-5]\d$'
    );
$$;

create table if not exists public.chapter_automations (
  id uuid primary key default gen_random_uuid(),
  automation_type text not null default 'chapter'
    check (automation_type = 'chapter'),
  manga_id text not null references public.mangas(id) on delete cascade,
  source text not null
    check (source in ('hayalistic', 'webtoonhatti')),
  source_url text not null
    check (char_length(btrim(source_url)) > 0),
  proxy_provider text not null default 'cloudflare'
    check (proxy_provider = 'cloudflare'),
  check_times text[] not null default array['13:00']::text[]
    check (public.chapter_automation_times_are_valid(check_times)),
  schedule_timezone text not null default 'Europe/Istanbul'
    check (char_length(btrim(schedule_timezone)) > 0),
  is_active boolean not null default true,
  validation_snapshot jsonb not null default '{}'::jsonb,
  next_run_at timestamptz,
  last_run_status text not null default 'idle'
    check (last_run_status in ('idle', 'running', 'success', 'no_changes', 'error')),
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_run_error text,
  last_added_chapter_count integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists chapter_automations_active_source_unique_idx
  on public.chapter_automations (manga_id, source, source_url)
  where is_active = true;

create index if not exists chapter_automations_active_next_run_idx
  on public.chapter_automations (is_active, next_run_at asc);

create index if not exists chapter_automations_manga_id_idx
  on public.chapter_automations (manga_id);

create table if not exists public.chapter_automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.chapter_automations(id) on delete cascade,
  status text not null
    check (status in ('running', 'success', 'no_changes', 'error')),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  chapters_added integer not null default 0,
  source_chapter_count integer not null default 0,
  new_chapter_count integer not null default 0,
  error_message text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists chapter_automation_runs_automation_started_idx
  on public.chapter_automation_runs (automation_id, started_at desc);

create index if not exists chapter_automation_runs_status_started_idx
  on public.chapter_automation_runs (status, started_at desc);

alter table public.chapter_automations enable row level security;
alter table public.chapter_automation_runs enable row level security;

drop policy if exists chapter_automations_no_client_access on public.chapter_automations;
create policy chapter_automations_no_client_access
on public.chapter_automations
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists chapter_automation_runs_no_client_access on public.chapter_automation_runs;
create policy chapter_automation_runs_no_client_access
on public.chapter_automation_runs
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.touch_chapter_automation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_chapter_automations_updated_at on public.chapter_automations;
create trigger trg_touch_chapter_automations_updated_at
before update on public.chapter_automations
for each row
execute function public.touch_chapter_automation_updated_at();

create or replace function public.claim_due_chapter_automations(
  p_now timestamptz default timezone('utc', now()),
  p_runner text default null,
  p_limit integer default 5
)
returns setof public.chapter_automations
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due_rows as (
    select automation.id
    from public.chapter_automations as automation
    where automation.is_active = true
      and automation.next_run_at is not null
      and automation.next_run_at <= coalesce(p_now, timezone('utc', now()))
      and (
        automation.locked_at is null
        or automation.locked_at < coalesce(p_now, timezone('utc', now())) - interval '30 minutes'
      )
    order by automation.next_run_at asc, automation.created_at asc
    limit greatest(coalesce(p_limit, 5), 1)
    for update skip locked
  ),
  updated_rows as (
    update public.chapter_automations as automation
    set
      locked_at = coalesce(p_now, timezone('utc', now())),
      locked_by = nullif(btrim(coalesce(p_runner, '')), ''),
      last_run_status = 'running',
      last_run_started_at = coalesce(p_now, timezone('utc', now())),
      last_run_finished_at = null,
      last_run_error = null,
      last_added_chapter_count = 0
    where automation.id in (select due_rows.id from due_rows)
    returning automation.*
  )
  select *
  from updated_rows
  order by next_run_at asc, created_at asc;
end;
$$;

revoke all on function public.claim_due_chapter_automations(timestamptz, text, integer) from public;
revoke all on function public.claim_due_chapter_automations(timestamptz, text, integer) from anon;
revoke all on function public.claim_due_chapter_automations(timestamptz, text, integer) from authenticated;
grant execute on function public.claim_due_chapter_automations(timestamptz, text, integer) to service_role;
