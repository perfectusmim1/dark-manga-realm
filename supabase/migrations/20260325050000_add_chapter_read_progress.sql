create table if not exists public.chapter_read_progress (
    user_id uuid not null references public.users (id) on delete cascade,
    manga_id uuid not null references public.mangas (id) on delete cascade,
    chapter_id uuid not null references public.chapters (id) on delete cascade,
    chapter_number double precision not null,
    page integer not null default 1,
    page_count integer not null default 1,
    max_page integer not null default 1,
    read_progress_percent numeric(5,2) not null default 0,
    is_read boolean not null default false,
    last_read timestamp with time zone not null default now(),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint chapter_read_progress_pkey primary key (user_id, chapter_id),
    constraint chapter_read_progress_page_check check (page >= 1),
    constraint chapter_read_progress_page_count_check check (page_count >= 1),
    constraint chapter_read_progress_max_page_check check (max_page >= 1),
    constraint chapter_read_progress_percent_check check (read_progress_percent >= 0 and read_progress_percent <= 100)
);

create index if not exists idx_chapter_read_progress_user_last_read
    on public.chapter_read_progress (user_id, last_read desc);

create index if not exists idx_chapter_read_progress_user_manga
    on public.chapter_read_progress (user_id, manga_id, last_read desc);

create index if not exists idx_chapter_read_progress_user_is_read
    on public.chapter_read_progress (user_id, is_read, last_read desc);

alter table public.chapter_read_progress enable row level security;

drop policy if exists "Users can view own chapter read progress" on public.chapter_read_progress;
create policy "Users can view own chapter read progress"
    on public.chapter_read_progress
    for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "Users can insert own chapter read progress" on public.chapter_read_progress;
create policy "Users can insert own chapter read progress"
    on public.chapter_read_progress
    for insert
    to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "Users can update own chapter read progress" on public.chapter_read_progress;
create policy "Users can update own chapter read progress"
    on public.chapter_read_progress
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "Users can delete own chapter read progress" on public.chapter_read_progress;
create policy "Users can delete own chapter read progress"
    on public.chapter_read_progress
    for delete
    to authenticated
    using (auth.uid() = user_id);

create or replace function public.upsert_chapter_read_progress(
    p_manga_id uuid,
    p_chapter_id uuid,
    p_chapter_number double precision,
    p_page integer,
    p_page_count integer
)
returns public.chapter_read_progress
language plpgsql
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_safe_page_count integer := greatest(1, coalesce(p_page_count, 1));
    v_safe_page integer := greatest(1, least(coalesce(p_page, 1), v_safe_page_count));
    v_percent numeric(5,2) := least(100, round((v_safe_page::numeric / v_safe_page_count::numeric) * 100, 2));
    v_row public.chapter_read_progress;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '42501';
    end if;

    insert into public.chapter_read_progress (
        user_id,
        manga_id,
        chapter_id,
        chapter_number,
        page,
        page_count,
        max_page,
        read_progress_percent,
        is_read,
        last_read,
        created_at,
        updated_at
    )
    values (
        v_user_id,
        p_manga_id,
        p_chapter_id,
        p_chapter_number,
        v_safe_page,
        v_safe_page_count,
        v_safe_page,
        v_percent,
        v_percent >= 60,
        now(),
        now(),
        now()
    )
    on conflict (user_id, chapter_id) do update
    set
        manga_id = excluded.manga_id,
        chapter_number = excluded.chapter_number,
        page = greatest(public.chapter_read_progress.page, excluded.page),
        page_count = greatest(public.chapter_read_progress.page_count, excluded.page_count),
        max_page = greatest(public.chapter_read_progress.max_page, excluded.max_page),
        read_progress_percent = greatest(public.chapter_read_progress.read_progress_percent, excluded.read_progress_percent),
        is_read = public.chapter_read_progress.is_read or excluded.is_read,
        last_read = now(),
        updated_at = now()
    returning * into v_row;

    return v_row;
end;
$$;

grant execute on function public.upsert_chapter_read_progress(uuid, uuid, double precision, integer, integer) to authenticated;

create or replace function public.get_public_chapter_read_count(
    p_user_id uuid
)
returns bigint
language sql
stable
set search_path = ''
as $$
    select count(*)::bigint
    from public.chapter_read_progress
    where user_id = p_user_id
      and is_read = true;
$$;

grant execute on function public.get_public_chapter_read_count(uuid) to anon, authenticated;

create or replace function public.get_public_chapter_read_leaderboard_counts()
returns table (
    user_id uuid,
    read_count bigint
)
language sql
stable
set search_path = ''
as $$
    select
        chapter_read_progress.user_id,
        count(*)::bigint as read_count
    from public.chapter_read_progress
    where chapter_read_progress.is_read = true
    group by chapter_read_progress.user_id;
$$;

grant execute on function public.get_public_chapter_read_leaderboard_counts() to anon, authenticated;
