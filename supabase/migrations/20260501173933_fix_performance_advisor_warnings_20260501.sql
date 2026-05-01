-- Fix Supabase Performance Advisor warnings without changing feature access semantics.

create index if not exists idx_banned_device_hashes_banned_by on public.banned_device_hashes (banned_by);
create index if not exists idx_banned_device_hashes_user_id on public.banned_device_hashes (user_id);
create index if not exists idx_banned_ip_hashes_banned_by on public.banned_ip_hashes (banned_by);
create index if not exists idx_banned_ip_hashes_user_id on public.banned_ip_hashes (user_id);
create index if not exists idx_chapter_read_progress_chapter_id on public.chapter_read_progress (chapter_id);
create index if not exists idx_chapter_read_progress_manga_id on public.chapter_read_progress (manga_id);
create index if not exists idx_comment_reports_reported_user_id on public.comment_reports (reported_user_id);
create index if not exists idx_reading_activity_log_chapter_id on public.reading_activity_log (chapter_id);
create index if not exists idx_reading_activity_log_manga_id on public.reading_activity_log (manga_id);
create index if not exists idx_series_requests_reviewed_by on public.series_requests (reviewed_by);
create index if not exists idx_support_tickets_closed_by on public.support_tickets (closed_by);
create index if not exists idx_tier_lists_user_id on public.tier_lists (user_id);
create index if not exists idx_user_bans_issued_by on public.user_bans (issued_by);
create index if not exists idx_user_bans_revoked_by on public.user_bans (revoked_by);
create index if not exists idx_user_bans_warning_id on public.user_bans (warning_id);
create index if not exists idx_user_blocks_blocked_id on public.user_blocks (blocked_id);
create index if not exists idx_user_follows_followed_id on public.user_follows (followed_id);
create index if not exists idx_user_warnings_issued_by on public.user_warnings (issued_by);
create index if not exists idx_users_banned_by on public.users (banned_by);

drop policy if exists "Users can mark announcements as read" on public.announcement_reads;
create policy "Users can mark announcements as read"
on public.announcement_reads
for insert
to authenticated
with check (((select auth.uid())::text = user_id));

drop policy if exists "Users can see their own read records" on public.announcement_reads;
create policy "Users can see their own read records"
on public.announcement_reads
for select
to authenticated
using (((select auth.uid())::text = user_id));

drop policy if exists "Users can view own chapter read progress" on public.chapter_read_progress;
create policy "Users can view own chapter read progress"
on public.chapter_read_progress
for select
to authenticated
using (((select auth.uid())::text = user_id));

drop policy if exists "Users can insert own chapter read progress" on public.chapter_read_progress;
create policy "Users can insert own chapter read progress"
on public.chapter_read_progress
for insert
to authenticated
with check (((select auth.uid())::text = user_id));

drop policy if exists "Users can update own chapter read progress" on public.chapter_read_progress;
create policy "Users can update own chapter read progress"
on public.chapter_read_progress
for update
to authenticated
using (((select auth.uid())::text = user_id))
with check (((select auth.uid())::text = user_id));

drop policy if exists "Users can delete own chapter read progress" on public.chapter_read_progress;
create policy "Users can delete own chapter read progress"
on public.chapter_read_progress
for delete
to authenticated
using (((select auth.uid())::text = user_id));

drop policy if exists "Users insert reading list likes" on public.reading_list_likes;
create policy "Users insert reading list likes"
on public.reading_list_likes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete reading list likes" on public.reading_list_likes;
create policy "Users delete reading list likes"
on public.reading_list_likes
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists series_requests_select_own_or_staff on public.series_requests;
create policy series_requests_select_own_or_staff
on public.series_requests
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists series_requests_insert_own on public.series_requests;
create policy series_requests_insert_own
on public.series_requests
for insert
to authenticated
with check (
  user_id = (select auth.uid())::text
  and (select public.current_authenticated_user_is_not_banned())
);

drop policy if exists series_requests_update_staff_only on public.series_requests;
create policy series_requests_update_staff_only
on public.series_requests
for update
to authenticated
using (public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text]))
with check (public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text]));

drop policy if exists support_tickets_select_own_or_staff on public.support_tickets;
create policy support_tickets_select_own_or_staff
on public.support_tickets
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists support_tickets_insert_own on public.support_tickets;
create policy support_tickets_insert_own
on public.support_tickets
for insert
to authenticated
with check (user_id = (select auth.uid())::text);

drop policy if exists support_tickets_update_staff_only on public.support_tickets;
create policy support_tickets_update_staff_only
on public.support_tickets
for update
to authenticated
using (public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text]))
with check (public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text]));

drop policy if exists support_ticket_messages_select_own_or_staff on public.support_ticket_messages;
create policy support_ticket_messages_select_own_or_staff
on public.support_ticket_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.support_tickets st
    where st.id = support_ticket_messages.ticket_id
      and (
        st.user_id = (select auth.uid())::text
        or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
      )
  )
);

drop policy if exists support_ticket_messages_insert_own_or_staff on public.support_ticket_messages;
create policy support_ticket_messages_insert_own_or_staff
on public.support_ticket_messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.support_tickets st
    where st.id = support_ticket_messages.ticket_id
      and (
        st.user_id = (select auth.uid())::text
        or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
      )
  )
);

drop policy if exists user_bans_select_own_or_staff on public.user_bans;
create policy user_bans_select_own_or_staff
on public.user_bans
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists user_warnings_select_own_or_staff on public.user_warnings;
create policy user_warnings_select_own_or_staff
on public.user_warnings
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists "Blocks are viewable by the blocker" on public.user_blocks;
create policy "Blocks are viewable by the blocker"
on public.user_blocks
for select
to authenticated
using (((select auth.uid())::text = blocker_id));

drop policy if exists "Users can block others" on public.user_blocks;
create policy "Users can block others"
on public.user_blocks
for insert
to authenticated
with check (((select auth.uid())::text = blocker_id) and blocker_id <> blocked_id);

drop policy if exists "Users can unblock" on public.user_blocks;
create policy "Users can unblock"
on public.user_blocks
for delete
to authenticated
using (((select auth.uid())::text = blocker_id));

drop policy if exists "Users can follow others" on public.user_follows;
create policy "Users can follow others"
on public.user_follows
for insert
to authenticated
with check (((select auth.uid())::text = follower_id) and follower_id <> followed_id);

drop policy if exists "Users can unfollow" on public.user_follows;
create policy "Users can unfollow"
on public.user_follows
for delete
to authenticated
using (((select auth.uid())::text = follower_id));

drop policy if exists tag_votes_authenticated on public.tag_votes;
drop policy if exists tag_votes_insert_own on public.tag_votes;
drop policy if exists tag_votes_update_own on public.tag_votes;
drop policy if exists tag_votes_delete_own on public.tag_votes;

create policy tag_votes_insert_own
on public.tag_votes
for insert
to authenticated
with check (user_id = (select auth.uid())::text);

create policy tag_votes_update_own
on public.tag_votes
for update
to authenticated
using (user_id = (select auth.uid())::text)
with check (user_id = (select auth.uid())::text);

create policy tag_votes_delete_own
on public.tag_votes
for delete
to authenticated
using (user_id = (select auth.uid())::text);

drop policy if exists "System/Users can update their achievements" on public.user_achievements;
drop policy if exists "Users can insert their achievements" on public.user_achievements;
drop policy if exists "Users can update their achievements" on public.user_achievements;
drop policy if exists "Users can delete their achievements" on public.user_achievements;

create policy "Users can insert their achievements"
on public.user_achievements
for insert
to authenticated
with check (user_id = (select auth.uid())::text);

create policy "Users can update their achievements"
on public.user_achievements
for update
to authenticated
using (user_id = (select auth.uid())::text)
with check (user_id = (select auth.uid())::text);

create policy "Users can delete their achievements"
on public.user_achievements
for delete
to authenticated
using (user_id = (select auth.uid())::text);

drop policy if exists "Admins and moderators can view manga reports" on public.manga_reports;
drop policy if exists "Authenticated users can view own manga reports" on public.manga_reports;
drop policy if exists "Authenticated users can view own or staff manga reports" on public.manga_reports;

create policy "Authenticated users can view own or staff manga reports"
on public.manga_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists "Admins and moderators can update manga reports" on public.manga_reports;
drop policy if exists "Authenticated users can update own manga reports" on public.manga_reports;
drop policy if exists "Authenticated users can update own or staff manga reports" on public.manga_reports;

create policy "Authenticated users can update own or staff manga reports"
on public.manga_reports
for update
to authenticated
using (
  reporter_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
)
with check (
  public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
  or (reporter_id = (select auth.uid())::text and status = 'open'::text)
);

drop policy if exists "Admins and moderators can view comment reports" on public.comment_reports;
drop policy if exists "Authenticated users can view own comment reports" on public.comment_reports;
drop policy if exists "Authenticated users can view own or staff comment reports" on public.comment_reports;

create policy "Authenticated users can view own or staff comment reports"
on public.comment_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists "Admins and moderators can update comment reports" on public.comment_reports;
drop policy if exists "Authenticated users can update own comment reports" on public.comment_reports;
drop policy if exists "Authenticated users can update own or staff comment reports" on public.comment_reports;

create policy "Authenticated users can update own or staff comment reports"
on public.comment_reports
for update
to authenticated
using (
  reporter_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
)
with check (
  public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
  or (
    reporter_id = (select auth.uid())::text
    and reported_user_id <> (select auth.uid())::text
    and status = 'open'::text
  )
);

drop policy if exists "Admins and moderators can view review reports" on public.review_reports;
drop policy if exists "Authenticated users can view own review reports" on public.review_reports;
drop policy if exists "Authenticated users can view own or staff review reports" on public.review_reports;

create policy "Authenticated users can view own or staff review reports"
on public.review_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists "Admins and moderators can update review reports" on public.review_reports;
drop policy if exists "Authenticated users can update own review reports" on public.review_reports;
drop policy if exists "Authenticated users can update own or staff review reports" on public.review_reports;

create policy "Authenticated users can update own or staff review reports"
on public.review_reports
for update
to authenticated
using (
  reporter_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
)
with check (
  public.check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
  or (
    reporter_id = (select auth.uid())::text
    and status = 'open'::text
    and exists (
      select 1
      from public.reviews r
      where r.id = review_reports.review_id
        and r.user_id <> (select auth.uid())::text
    )
  )
);
