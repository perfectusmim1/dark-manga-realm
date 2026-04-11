create or replace function public.get_top_engaged_mangas_by_audience(
  time_filter text,
  target_audience text,
  result_limit integer default 10
)
returns setof jsonb
language plpgsql
set search_path to 'public'
as $function$
begin
  if target_audience not in ('visible', 'safe', 'adult') then
    raise exception 'Unsupported target_audience: %', target_audience
      using errcode = '22023';
  end if;

  return query
  with scores as (
    select
      coalesce(c.manga_id, ch.manga_id) as m_id,
      count(*) * 5.0 as score
    from comments c
    left join chapters ch on c.chapter_id = ch.id
    where (
      time_filter = 'all'
      or c.created_at >= (
        case
          when time_filter = 'today' then now() - interval '1 day'
          when time_filter = 'week' then now() - interval '7 days'
          else '1900-01-01'::timestamp
        end
      )
    )
    group by 1

    union all

    select
      coalesce(r.manga_id, ch.manga_id) as m_id,
      count(*) * 2.0 as score
    from manga_reactions r
    left join chapters ch on r.chapter_id = ch.id
    where (
      time_filter = 'all'
      or r.created_at >= (
        case
          when time_filter = 'today' then now() - interval '1 day'
          when time_filter = 'week' then now() - interval '7 days'
          else '1900-01-01'::timestamp
        end
      )
    )
    group by 1

    union all

    select manga_id as m_id, count(*) * 10.0 as score
    from reviews
    where (
      time_filter = 'all'
      or created_at >= (
        case
          when time_filter = 'today' then now() - interval '1 day'
          when time_filter = 'week' then now() - interval '7 days'
          else '1900-01-01'::timestamp
        end
      )
    )
    group by 1

    union all

    select
      coalesce(l.manga_id, ch.manga_id) as m_id,
      count(*) * 0.5 as score
    from reading_activity_log l
    left join chapters ch on l.chapter_id = ch.id
    where (
      time_filter = 'all'
      or l.read_at >= (
        case
          when time_filter = 'today' then now() - interval '1 day'
          when time_filter = 'week' then now() - interval '7 days'
          else '1900-01-01'::timestamp
        end
      )
    )
    group by 1
  ),
  global_ratings as (
    select
      manga_id,
      avg(
        (
          coalesce(rating_story, 0)
          + coalesce(rating_characters, 0)
          + coalesce(rating_art, 0)
          + coalesce(rating_progression, 0)
          + coalesce(rating_engagement, 0)
        ) / 5.0
      ) as avg_rating
    from reviews
    group by manga_id
  )
  select to_jsonb(t)
  from (
    select
      m.*,
      coalesce(s.total_score, 0) as engagement_score,
      round(coalesce(gr.avg_rating, 0)::numeric, 1) as average_rating
    from mangas m
    left join (
      select m_id, sum(score) as total_score
      from scores
      where m_id is not null
      group by m_id
    ) s on m.id = s.m_id
    left join global_ratings gr on m.id = gr.manga_id
    where (
      target_audience = 'visible'
      or (target_audience = 'adult' and coalesce(m.is_adult, false) = true)
      or (target_audience = 'safe' and coalesce(m.is_adult, false) = false)
    )
    order by engagement_score desc, m.views desc
    limit greatest(coalesce(result_limit, 10), 1)
  ) t;
end;
$function$;

grant execute on function public.get_top_engaged_mangas_by_audience(text, text, integer) to anon;
grant execute on function public.get_top_engaged_mangas_by_audience(text, text, integer) to authenticated;
grant execute on function public.get_top_engaged_mangas_by_audience(text, text, integer) to service_role;
