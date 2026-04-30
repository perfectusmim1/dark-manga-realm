-- Browser-facing anonymous clients should only see public aggregate profile
-- data through RPCs, never mutate per-user reading history tables directly.

revoke insert, update, delete on table public.reading_progress from anon;
revoke insert, update, delete on table public.reading_activity_log from anon;
revoke all on table public.chapter_read_progress from anon;
