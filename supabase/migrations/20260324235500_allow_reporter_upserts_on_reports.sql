drop policy if exists "Authenticated users can create manga reports" on public.manga_reports;
drop policy if exists "Authenticated users can view own manga reports" on public.manga_reports;
drop policy if exists "Authenticated users can update own manga reports" on public.manga_reports;

create policy "Authenticated users can create manga reports"
on public.manga_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())::text
  and status = 'open'
);

create policy "Authenticated users can view own manga reports"
on public.manga_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())::text
);

create policy "Authenticated users can update own manga reports"
on public.manga_reports
for update
to authenticated
using (
  reporter_id = (select auth.uid())::text
)
with check (
  reporter_id = (select auth.uid())::text
  and status = 'open'
);

drop policy if exists "Authenticated users can create comment reports" on public.comment_reports;
drop policy if exists "Authenticated users can view own comment reports" on public.comment_reports;
drop policy if exists "Authenticated users can update own comment reports" on public.comment_reports;

create policy "Authenticated users can create comment reports"
on public.comment_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())::text
  and reported_user_id <> (select auth.uid())::text
  and status = 'open'
);

create policy "Authenticated users can view own comment reports"
on public.comment_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())::text
);

create policy "Authenticated users can update own comment reports"
on public.comment_reports
for update
to authenticated
using (
  reporter_id = (select auth.uid())::text
)
with check (
  reporter_id = (select auth.uid())::text
  and reported_user_id <> (select auth.uid())::text
  and status = 'open'
);
