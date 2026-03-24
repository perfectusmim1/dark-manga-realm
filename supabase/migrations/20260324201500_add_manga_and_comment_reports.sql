create or replace function public.touch_report_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.manga_reports (
  id uuid primary key default gen_random_uuid(),
  manga_id text not null references public.mangas(id) on delete cascade,
  reporter_id text not null references public.users(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint manga_reports_reason_length check (char_length(trim(reason)) between 3 and 80)
);

create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id text not null,
  comment_entity_type text not null check (comment_entity_type in ('manga', 'character', 'author', 'artist')),
  target_entity_id text not null,
  reporter_id text not null references public.users(id) on delete cascade,
  reported_user_id text not null references public.users(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint comment_reports_reason_length check (char_length(trim(reason)) between 3 and 80),
  constraint comment_reports_not_self check (reporter_id <> reported_user_id)
);

create unique index if not exists idx_manga_reports_unique_reporter_target
  on public.manga_reports (reporter_id, manga_id);

create unique index if not exists idx_comment_reports_unique_reporter_target
  on public.comment_reports (reporter_id, comment_entity_type, comment_id);

create index if not exists idx_manga_reports_status_created_at
  on public.manga_reports (status, created_at desc);

create index if not exists idx_manga_reports_manga_id
  on public.manga_reports (manga_id);

create index if not exists idx_comment_reports_status_created_at
  on public.comment_reports (status, created_at desc);

create index if not exists idx_comment_reports_target
  on public.comment_reports (comment_entity_type, comment_id);

create index if not exists idx_comment_reports_target_entity_id
  on public.comment_reports (target_entity_id);

alter table public.manga_reports enable row level security;
alter table public.comment_reports enable row level security;

drop policy if exists "Authenticated users can create manga reports" on public.manga_reports;
drop policy if exists "Admins and moderators can view manga reports" on public.manga_reports;
drop policy if exists "Admins and moderators can update manga reports" on public.manga_reports;
drop policy if exists "Admins and moderators can delete manga reports" on public.manga_reports;

create policy "Authenticated users can create manga reports"
on public.manga_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())::text
);

create policy "Admins and moderators can view manga reports"
on public.manga_reports
for select
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Admins and moderators can update manga reports"
on public.manga_reports
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

create policy "Admins and moderators can delete manga reports"
on public.manga_reports
for delete
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

drop policy if exists "Authenticated users can create comment reports" on public.comment_reports;
drop policy if exists "Admins and moderators can view comment reports" on public.comment_reports;
drop policy if exists "Admins and moderators can update comment reports" on public.comment_reports;
drop policy if exists "Admins and moderators can delete comment reports" on public.comment_reports;

create policy "Authenticated users can create comment reports"
on public.comment_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())::text
  and reported_user_id <> (select auth.uid())::text
);

create policy "Admins and moderators can view comment reports"
on public.comment_reports
for select
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Admins and moderators can update comment reports"
on public.comment_reports
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

create policy "Admins and moderators can delete comment reports"
on public.comment_reports
for delete
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

drop trigger if exists trg_touch_manga_reports_updated_at on public.manga_reports;
create trigger trg_touch_manga_reports_updated_at
before update on public.manga_reports
for each row
execute function public.touch_report_updated_at();

drop trigger if exists trg_touch_comment_reports_updated_at on public.comment_reports;
create trigger trg_touch_comment_reports_updated_at
before update on public.comment_reports
for each row
execute function public.touch_report_updated_at();
