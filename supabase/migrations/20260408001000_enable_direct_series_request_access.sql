drop policy if exists series_requests_insert_own on public.series_requests;
create policy series_requests_insert_own
on public.series_requests
for insert
to authenticated
with check (
  user_id = (auth.uid())::text
  and public.current_authenticated_user_is_not_banned()
);

create unique index if not exists series_requests_user_reference_active_idx
  on public.series_requests(user_id, reference_url)
  where status in ('pending', 'in_review', 'approved');

revoke all on table public.series_requests from anon;
grant select, insert, update on table public.series_requests to authenticated;
revoke delete on table public.series_requests from authenticated;
