create or replace function public.backfill_chapter_read_progress(
    p_manga_id text,
    p_chapter_id text,
    p_chapter_number double precision,
    p_page integer,
    p_page_count integer,
    p_last_read timestamptz default now()
)
returns public.chapter_read_progress
language plpgsql
set search_path to ''
as $function$
declare
    v_user_id text := auth.uid()::text;
    v_safe_page_count integer := greatest(1, coalesce(p_page_count, 1));
    v_safe_page integer := greatest(1, least(coalesce(p_page, 1), v_safe_page_count));
    v_percent numeric(5,2) := case
        when v_safe_page_count <= 1 then 100
        else least(100, round((((v_safe_page - 1)::numeric / greatest(v_safe_page_count - 1, 1)::numeric) * 100), 2))
    end;
    v_last_read timestamptz := coalesce(p_last_read, now());
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
        v_last_read,
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
        last_read = case
            when public.chapter_read_progress.last_read is null then excluded.last_read
            when excluded.last_read > public.chapter_read_progress.last_read then excluded.last_read
            else public.chapter_read_progress.last_read
        end,
        updated_at = now()
    returning * into v_row;

    return v_row;
end;
$function$;

grant execute on function public.backfill_chapter_read_progress(text, text, double precision, integer, integer, timestamptz) to authenticated;

with reading_activity_sources as (
    select
        ral.user_id,
        ral.chapter_id,
        max(ral.read_at) as source_last_read
    from public.reading_activity_log ral
    inner join public.users u on u.id = ral.user_id
    group by ral.user_id, ral.chapter_id
),
reading_progress_sources as (
    select
        rp.user_id,
        rp.chapter_id,
        max(rp.last_read) as source_last_read
    from public.reading_progress rp
    inner join public.users u on u.id = rp.user_id
    where rp.chapter_id is not null
      and rp.last_read is not null
    group by rp.user_id, rp.chapter_id
),
merged_sources as (
    select
        source_rows.user_id,
        source_rows.chapter_id,
        max(source_rows.source_last_read) as source_last_read
    from (
        select * from reading_activity_sources
        union all
        select * from reading_progress_sources
    ) source_rows
    group by source_rows.user_id, source_rows.chapter_id
)
update public.chapter_read_progress crp
set
    last_read = merged_sources.source_last_read,
    updated_at = greatest(coalesce(crp.updated_at, merged_sources.source_last_read), merged_sources.source_last_read)
from merged_sources
where crp.user_id = merged_sources.user_id
  and crp.chapter_id = merged_sources.chapter_id
  and merged_sources.source_last_read is not null
  and crp.last_read is distinct from merged_sources.source_last_read;
