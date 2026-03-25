create or replace function public.get_public_chapter_read_count(
    p_user_id text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::bigint
    from public.chapter_read_progress
    where user_id = p_user_id
      and is_read = true;
$$;

revoke all on function public.get_public_chapter_read_count(text) from public;
grant execute on function public.get_public_chapter_read_count(text) to anon, authenticated;

create or replace function public.get_public_chapter_read_leaderboard_counts()
returns table (
    user_id text,
    read_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        chapter_read_progress.user_id,
        count(*)::bigint as read_count
    from public.chapter_read_progress
    where chapter_read_progress.is_read = true
    group by chapter_read_progress.user_id;
$$;

revoke all on function public.get_public_chapter_read_leaderboard_counts() from public;
grant execute on function public.get_public_chapter_read_leaderboard_counts() to anon, authenticated;
