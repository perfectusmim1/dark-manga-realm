begin;

alter table public.announcements
  alter column created_by set default (auth.uid())::text;

drop policy if exists "Admins can insert announcements" on public.announcements;
drop policy if exists "Admins can update announcements" on public.announcements;
drop policy if exists "Admins can delete announcements" on public.announcements;

create policy "Admins and moderators can insert announcements"
on public.announcements
for insert
to authenticated
with check (
  created_by = (select auth.uid())::text
  and public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Admins and moderators can update announcements"
on public.announcements
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

create policy "Admins and moderators can delete announcements"
on public.announcements
for delete
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

drop policy if exists "artist_tags_authenticated" on public.artist_tags;
drop policy if exists "author_tags_authenticated" on public.author_tags;
drop policy if exists "character_tags_authenticated" on public.character_tags;
drop policy if exists "manga_tags_authenticated" on public.manga_tags;

create policy "Authenticated users can insert manga tags"
on public.manga_tags
for insert
to authenticated
with check (
  added_by = (select auth.uid())::text
);

create policy "Users or staff can delete manga tags"
on public.manga_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  or public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Authenticated users can insert character tags"
on public.character_tags
for insert
to authenticated
with check (
  added_by = (select auth.uid())::text
);

create policy "Users or staff can delete character tags"
on public.character_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  or public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Authenticated users can insert author tags"
on public.author_tags
for insert
to authenticated
with check (
  added_by = (select auth.uid())::text
);

create policy "Users or staff can delete author tags"
on public.author_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  or public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Authenticated users can insert artist tags"
on public.artist_tags
for insert
to authenticated
with check (
  added_by = (select auth.uid())::text
);

create policy "Users or staff can delete artist tags"
on public.artist_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  or public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

drop policy if exists "Admins can manage tags" on public.tags;
drop policy if exists "Admins manage tags" on public.tags;

alter table public.tags
  alter column created_by set default (auth.uid())::text;

create policy "Authenticated users can create community tags"
on public.tags
for insert
to authenticated
with check (
  (
    created_by = (select auth.uid())::text
    and coalesce(is_official, false) = false
  )
  or public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create policy "Admins and moderators can update tags"
on public.tags
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

create policy "Admins and moderators can delete tags"
on public.tags
for delete
to authenticated
using (
  public.check_user_role(
    (select auth.uid())::text,
    array['admin', 'moderator']
  )
);

create index if not exists idx_announcements_created_by
  on public.announcements (created_by);

create index if not exists idx_announcement_reads_user_id
  on public.announcement_reads (user_id);

create index if not exists idx_tags_created_by
  on public.tags (created_by);

create index if not exists idx_manga_tags_added_by
  on public.manga_tags (added_by);

create index if not exists idx_character_tags_added_by
  on public.character_tags (added_by);

create index if not exists idx_author_tags_added_by
  on public.author_tags (added_by);

create index if not exists idx_artist_tags_added_by
  on public.artist_tags (added_by);

create index if not exists idx_character_tags_tag_id
  on public.character_tags (tag_id);

create index if not exists idx_author_tags_tag_id
  on public.author_tags (tag_id);

create index if not exists idx_artist_tags_tag_id
  on public.artist_tags (tag_id);

commit;
