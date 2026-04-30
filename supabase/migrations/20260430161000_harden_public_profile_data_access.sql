-- Keep public profile summaries available through get_profile_route_bundle(),
-- but stop direct table/API reads of private reading, preference and MFA state.

revoke select (preferences, two_factor_enabled, last_seen_at) on table public.users
  from anon, authenticated;
revoke update (preferences) on table public.users from authenticated;
grant select (id, username, username_last_changed_at, avatar, role, created_at)
  on table public.users to anon, authenticated;
grant update (avatar) on table public.users to authenticated;

revoke select on table public.reading_progress from anon;
revoke select on table public.reading_activity_log from anon;
revoke all on table public.chapter_read_progress from anon;
grant select, insert, update, delete on table public.reading_progress to authenticated;
grant select, insert, update, delete on table public.reading_activity_log to authenticated;
grant select, insert, update, delete on table public.chapter_read_progress to authenticated;

drop policy if exists "reading_progress_select" on public.reading_progress;
drop policy if exists "reading_progress_insert" on public.reading_progress;
drop policy if exists "reading_progress_update" on public.reading_progress;
drop policy if exists "reading_progress_delete" on public.reading_progress;

create policy "reading_progress_select_own_or_staff"
on public.reading_progress
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

create policy "reading_progress_insert_own"
on public.reading_progress
for insert
to authenticated
with check (user_id = (select auth.uid())::text);

create policy "reading_progress_update_own_or_staff"
on public.reading_progress
for update
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
)
with check (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

create policy "reading_progress_delete_own_or_staff"
on public.reading_progress
for delete
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists "Anyone can view activity if profile is public (app logic)" on public.reading_activity_log;
drop policy if exists "Users can insert their own activity" on public.reading_activity_log;
drop policy if exists "Users can update their own activity" on public.reading_activity_log;

create policy "reading_activity_log_select_own_or_staff"
on public.reading_activity_log
for select
to authenticated
using (
  user_id = (select auth.uid())::text
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

create policy "reading_activity_log_insert_own"
on public.reading_activity_log
for insert
to authenticated
with check (user_id = (select auth.uid())::text);

create policy "reading_activity_log_update_own"
on public.reading_activity_log
for update
to authenticated
using (user_id = (select auth.uid())::text)
with check (user_id = (select auth.uid())::text);

revoke insert, update, delete on table public.tier_lists from anon;
grant select on table public.tier_lists to anon, authenticated;
grant insert, update, delete on table public.tier_lists to authenticated;

drop policy if exists "Public profiles are viewable by everyone" on public.tier_lists;
drop policy if exists "Public tier lists viewing ON tier_lists" on public.tier_lists;
drop policy if exists "Users own viewing ON tier_lists" on public.tier_lists;
drop policy if exists "Users can create their own tier lists" on public.tier_lists;
drop policy if exists "Users inserting ON tier_lists" on public.tier_lists;
drop policy if exists "Consolidated Tier List Insert" on public.tier_lists;
drop policy if exists "Users can update their own tier lists" on public.tier_lists;
drop policy if exists "Users updating ON tier_lists" on public.tier_lists;
drop policy if exists "Consolidated Tier List Update" on public.tier_lists;
drop policy if exists "Users can delete their own tier lists" on public.tier_lists;
drop policy if exists "Users deleting ON tier_lists" on public.tier_lists;
drop policy if exists "Consolidated Tier List Delete" on public.tier_lists;

create policy "tier_lists_select_public_or_owner_or_staff"
on public.tier_lists
for select
to public
using (
  is_public = true
  or user_id = (select auth.uid())
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

create policy "tier_lists_insert_owner"
on public.tier_lists
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "tier_lists_update_owner_or_staff"
on public.tier_lists
for update
to authenticated
using (
  user_id = (select auth.uid())
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
)
with check (
  user_id = (select auth.uid())
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

create policy "tier_lists_delete_owner_or_staff"
on public.tier_lists
for delete
to authenticated
using (
  user_id = (select auth.uid())
  or public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);

-- Remove RLS-bypassing TRUNCATE/maintenance privileges from browser-facing roles.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
