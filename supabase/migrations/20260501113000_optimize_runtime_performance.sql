-- Reduce homepage/profile query scans and remove per-row auth.uid() work from
-- active RLS policies that are hit during normal app bootstrap.

create index if not exists idx_mangas_public_adult_views_desc
  on public.mangas (is_public, is_adult, views desc);

create index if not exists idx_mangas_public_views_desc
  on public.mangas (is_public, views desc);

create index if not exists idx_tags_visible_usage_count_desc
  on public.tags (usage_count desc)
  where is_official = true or community_approved = true;

create index if not exists idx_comments_created_manga_id
  on public.comments (created_at desc, manga_id)
  where manga_id is not null;

create index if not exists idx_comments_created_chapter_id
  on public.comments (created_at desc, chapter_id)
  where chapter_id is not null;

create index if not exists idx_comments_user_created_at_desc
  on public.comments (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_character_comments_user_created_at_desc
  on public.character_comments (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_author_comments_user_created_at_desc
  on public.author_comments (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_artist_comments_user_created_at_desc
  on public.artist_comments (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_manga_reactions_created_manga_id
  on public.manga_reactions (created_at desc, manga_id)
  where manga_id is not null;

create index if not exists idx_manga_reactions_created_chapter_id
  on public.manga_reactions (created_at desc, chapter_id)
  where chapter_id is not null;

create index if not exists idx_reviews_created_manga_id
  on public.reviews (created_at desc, manga_id)
  where manga_id is not null;

create index if not exists idx_reviews_manga_id
  on public.reviews (manga_id)
  where manga_id is not null;

create index if not exists idx_reviews_user_created_at_desc
  on public.reviews (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_reading_activity_log_read_at_manga_id
  on public.reading_activity_log (read_at desc, manga_id)
  where manga_id is not null;

create index if not exists idx_reading_activity_log_read_at_chapter_id
  on public.reading_activity_log (read_at desc, chapter_id)
  where chapter_id is not null;

create index if not exists idx_chapter_read_progress_read_user_id
  on public.chapter_read_progress (user_id)
  where is_read = true;

create index if not exists idx_support_tickets_user_updated_at_desc
  on public.support_tickets (user_id, updated_at desc);

create index if not exists idx_series_requests_reviewed_by
  on public.series_requests (reviewed_by)
  where reviewed_by is not null;

drop policy if exists user_warnings_select_own_or_staff on public.user_warnings;
create policy user_warnings_select_own_or_staff
on public.user_warnings
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists user_bans_select_own_or_staff on public.user_bans;
create policy user_bans_select_own_or_staff
on public.user_bans
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists support_tickets_select_own_or_staff on public.support_tickets;
create policy support_tickets_select_own_or_staff
on public.support_tickets
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists support_tickets_insert_own on public.support_tickets;
create policy support_tickets_insert_own
on public.support_tickets
for insert
to authenticated
with check (
  user_id = (select auth.uid())::text
);

drop policy if exists support_tickets_update_staff_only on public.support_tickets;
create policy support_tickets_update_staff_only
on public.support_tickets
for update
to authenticated
using (
  public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
)
with check (
  public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists support_ticket_messages_select_own_or_staff on public.support_ticket_messages;
create policy support_ticket_messages_select_own_or_staff
on public.support_ticket_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.support_tickets as st
    where st.id = ticket_id
      and (
        st.user_id = (select auth.uid())::text
        or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
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
    from public.support_tickets as st
    where st.id = ticket_id
      and (
        st.user_id = (select auth.uid())::text
        or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
      )
  )
);

drop policy if exists series_requests_select_own_or_staff on public.series_requests;
create policy series_requests_select_own_or_staff
on public.series_requests
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists series_requests_insert_own on public.series_requests;
create policy series_requests_insert_own
on public.series_requests
for insert
to authenticated
with check (
  user_id = (select auth.uid())::text
  and public.current_authenticated_user_is_not_banned()
);

drop policy if exists series_requests_update_staff_only on public.series_requests;
create policy series_requests_update_staff_only
on public.series_requests
for update
to authenticated
using (
  public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
)
with check (
  public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists "Users can view own chapter read progress" on public.chapter_read_progress;
create policy "Users can view own chapter read progress"
on public.chapter_read_progress
for select
to authenticated
using ((select auth.uid())::text = user_id);

drop policy if exists "Users can insert own chapter read progress" on public.chapter_read_progress;
create policy "Users can insert own chapter read progress"
on public.chapter_read_progress
for insert
to authenticated
with check ((select auth.uid())::text = user_id);

drop policy if exists "Users can update own chapter read progress" on public.chapter_read_progress;
create policy "Users can update own chapter read progress"
on public.chapter_read_progress
for update
to authenticated
using ((select auth.uid())::text = user_id)
with check ((select auth.uid())::text = user_id);

drop policy if exists "Users can delete own chapter read progress" on public.chapter_read_progress;
create policy "Users can delete own chapter read progress"
on public.chapter_read_progress
for delete
to authenticated
using ((select auth.uid())::text = user_id);
