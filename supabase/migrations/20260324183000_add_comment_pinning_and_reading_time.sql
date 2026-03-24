alter table public.comments
    add column if not exists is_pinned boolean not null default false;

alter table public.character_comments
    add column if not exists is_pinned boolean not null default false;

alter table public.author_comments
    add column if not exists is_pinned boolean not null default false;

alter table public.artist_comments
    add column if not exists is_pinned boolean not null default false;

alter table public.reading_activity_log
    add column if not exists seconds_spent integer not null default 0;

alter table public.reading_activity_log
    drop constraint if exists reading_activity_log_seconds_spent_check;

alter table public.reading_activity_log
    add constraint reading_activity_log_seconds_spent_check
    check (seconds_spent >= 0);

create index if not exists idx_comments_pinned_created
    on public.comments (manga_id, chapter_id, is_pinned desc, created_at desc);

create index if not exists idx_character_comments_pinned_created
    on public.character_comments (character_id, is_pinned desc, created_at desc);

create index if not exists idx_author_comments_pinned_created
    on public.author_comments (author_id, is_pinned desc, created_at desc);

create index if not exists idx_artist_comments_pinned_created
    on public.artist_comments (artist_id, is_pinned desc, created_at desc);

create index if not exists idx_reading_activity_log_user_read_at
    on public.reading_activity_log (user_id, read_at desc);
