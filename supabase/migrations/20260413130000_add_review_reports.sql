create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id text not null references public.users(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint review_reports_reason_length check (char_length(trim(reason)) between 3 and 80)
);

create unique index if not exists idx_review_reports_unique_reporter_target
  on public.review_reports (reporter_id, review_id);

create index if not exists idx_review_reports_status_created_at
  on public.review_reports (status, created_at desc);

create index if not exists idx_review_reports_review_id
  on public.review_reports (review_id);

alter table public.review_reports enable row level security;

drop policy if exists "Authenticated users can create review reports" on public.review_reports;
drop policy if exists "Authenticated users can view own review reports" on public.review_reports;
drop policy if exists "Authenticated users can update own review reports" on public.review_reports;
drop policy if exists "Admins and moderators can view review reports" on public.review_reports;
drop policy if exists "Admins and moderators can update review reports" on public.review_reports;
drop policy if exists "Admins and moderators can delete review reports" on public.review_reports;

create policy "Authenticated users can create review reports"
on public.review_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())::text
  and status = 'open'
  and exists (
    select 1
    from public.reviews as r
    where r.id = review_id
      and r.user_id <> (select auth.uid())::text
  )
);

create policy "Authenticated users can view own review reports"
on public.review_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())::text
);

create policy "Authenticated users can update own review reports"
on public.review_reports
for update
to authenticated
using (
  reporter_id = (select auth.uid())::text
)
with check (
  reporter_id = (select auth.uid())::text
  and status = 'open'
  and exists (
    select 1
    from public.reviews as r
    where r.id = review_id
      and r.user_id <> (select auth.uid())::text
  )
);

create policy "Admins and moderators can view review reports"
on public.review_reports
for select
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Admins and moderators can update review reports"
on public.review_reports
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

create policy "Admins and moderators can delete review reports"
on public.review_reports
for delete
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

drop trigger if exists trg_touch_review_reports_updated_at on public.review_reports;
create trigger trg_touch_review_reports_updated_at
before update on public.review_reports
for each row
execute function public.touch_report_updated_at();
