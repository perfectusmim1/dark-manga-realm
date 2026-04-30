-- Anonymous profile viewers may see the public reading-time summary, but not
-- detailed reading history rows, recent reads, or activity calendar buckets.

create or replace function public.get_profile_route_bundle(
  p_target_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_target_user_uuid uuid := p_target_user_id::uuid;
  v_viewer_id text := (select auth.uid())::text;
  v_is_owner boolean := ((select auth.uid()) = v_target_user_uuid);
  v_can_view_reading_details boolean := false;
  v_stats jsonb := jsonb_build_object(
    'totalSeries', 0,
    'totalChapters', 0,
    'totalReadingSeconds', 0,
    'totalComments', 0,
    'followersCount', 0,
    'followingCount', 0
  );
  v_recent_reads jsonb := '[]'::jsonb;
  v_recent_comments jsonb := '[]'::jsonb;
  v_recent_reviews jsonb := '[]'::jsonb;
  v_followed_manga jsonb := '[]'::jsonb;
  v_reading_activity jsonb := '[]'::jsonb;
  v_reading_lists jsonb := '[]'::jsonb;
  v_tier_lists jsonb := '[]'::jsonb;
begin
  select *
  into v_context
  from public.get_profile_access_context(p_target_user_id)
  limit 1;

  if not found then
    return null;
  end if;

  v_can_view_reading_details := v_context.can_view_reading_history and v_viewer_id is not null;

  if v_context.can_view_profile then
    v_stats := jsonb_build_object(
      'totalSeries',
        case
          when v_can_view_reading_details then
            coalesce((
              select count(distinct rp.manga_id)
              from public.reading_progress as rp
              where rp.user_id = p_target_user_id
            ), 0)
          else 0
        end,
      'totalChapters',
        case
          when v_can_view_reading_details then coalesce(public.get_public_chapter_read_count(p_target_user_id), 0)
          else 0
        end,
      'totalReadingSeconds',
        case
          when v_context.can_view_reading_history then
            coalesce((
              select sum(coalesce(log.seconds_spent, 0))::bigint
              from public.reading_activity_log as log
              where log.user_id = p_target_user_id
            ), 0)
          else 0
        end,
      'totalComments',
        case
          when v_context.can_view_comments then
            coalesce((select count(*) from public.comments where user_id = p_target_user_id), 0)
            + coalesce((select count(*) from public.character_comments where user_id = p_target_user_id), 0)
            + coalesce((select count(*) from public.author_comments where user_id = p_target_user_id), 0)
            + coalesce((select count(*) from public.artist_comments where user_id = p_target_user_id), 0)
          else 0
        end,
      'followersCount', coalesce((select count(*) from public.user_follows where followed_id = p_target_user_id), 0),
      'followingCount', coalesce((select count(*) from public.user_follows where follower_id = p_target_user_id), 0)
    );

    if v_can_view_reading_details then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'manga_id', x.manga_id,
            'chapter_number', x.chapter_number,
            'page', x.page,
            'last_read', x.last_read,
            'mangas', jsonb_build_object(
              'id', x.manga_id,
              'title', x.title,
              'cover', x.cover
            )
          )
          order by x.last_read desc
        ),
        '[]'::jsonb
      )
      into v_recent_reads
      from (
        select rp.manga_id, rp.chapter_number, rp.page, rp.last_read, m.title, m.cover
        from public.reading_progress as rp
        left join public.mangas as m on m.id = rp.manga_id
        where rp.user_id = p_target_user_id
        order by rp.last_read desc
        limit 4
      ) as x;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'date', to_char(x.activity_date, 'YYYY-MM-DD'),
            'count', x.read_count
          )
          order by x.activity_date
        ),
        '[]'::jsonb
      )
      into v_reading_activity
      from (
        select
          (log.read_at at time zone 'utc')::date as activity_date,
          count(*)::int as read_count
        from public.reading_activity_log as log
        where log.user_id = p_target_user_id
          and log.read_at >= (timezone('utc', now()) - interval '365 days')
        group by (log.read_at at time zone 'utc')::date
        order by activity_date
      ) as x;
    end if;

    if v_context.can_view_reviews then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'entityType', x.entity_type,
            'entityId', x.entity_id,
            'targetName', x.target_name,
            'targetHref', x.target_href,
            'content', x.content,
            'gifUrl', x.gif_url,
            'parentId', x.parent_id,
            'likes', x.likes,
            'createdAt', x.created_at
          )
          order by x.created_at desc
        ),
        '[]'::jsonb
      )
      into v_recent_comments
      from (
        select *
        from (
          select
            c.id::text as id,
            'manga'::text as entity_type,
            c.manga_id::text as entity_id,
            coalesce(m.title, 'Seri')::text as target_name,
            ('/manga/' || c.manga_id)::text as target_href,
            c.content::text as content,
            c.gif_url::text as gif_url,
            c.parent_id::text as parent_id,
            coalesce(c.likes, 0)::int as likes,
            c.created_at
          from public.comments as c
          left join public.mangas as m on m.id = c.manga_id
          where c.user_id = p_target_user_id

          union all

          select
            c.id::text as id,
            'character'::text as entity_type,
            c.character_id::text as entity_id,
            coalesce(ch.name, 'Karakter')::text as target_name,
            ('/character/' || c.character_id)::text as target_href,
            c.content::text as content,
            null::text as gif_url,
            null::text as parent_id,
            coalesce(c.likes, 0)::int as likes,
            c.created_at
          from public.character_comments as c
          left join public.characters as ch on ch.id = c.character_id
          where c.user_id = p_target_user_id

          union all

          select
            c.id::text as id,
            'author'::text as entity_type,
            c.author_id::text as entity_id,
            coalesce(a.name, 'Yazar')::text as target_name,
            ('/author/' || c.author_id)::text as target_href,
            c.content::text as content,
            null::text as gif_url,
            null::text as parent_id,
            coalesce(c.likes, 0)::int as likes,
            c.created_at
          from public.author_comments as c
          left join public.authors as a on a.id = c.author_id
          where c.user_id = p_target_user_id

          union all

          select
            c.id::text as id,
            'artist'::text as entity_type,
            c.artist_id::text as entity_id,
            coalesce(ar.name, 'Cizer')::text as target_name,
            ('/artist/' || c.artist_id)::text as target_href,
            c.content::text as content,
            null::text as gif_url,
            null::text as parent_id,
            coalesce(c.likes, 0)::int as likes,
            c.created_at
          from public.artist_comments as c
          left join public.artists as ar on ar.id = c.artist_id
          where c.user_id = p_target_user_id
        ) as unioned_comments
        order by created_at desc
        limit 8
      ) as x;
    end if;

    if v_context.can_view_comments then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'mangaId', x.manga_id,
            'mangaTitle', x.manga_title,
            'mangaCover', x.manga_cover,
            'mangaType', x.manga_type,
            'mangaStatus', x.manga_status,
            'targetHref', x.target_href,
            'content', x.content,
            'ratingStory', x.rating_story,
            'ratingCharacters', x.rating_characters,
            'ratingArt', x.rating_art,
            'ratingProgression', x.rating_progression,
            'ratingEngagement', x.rating_engagement,
            'createdAt', x.created_at,
            'updatedAt', x.updated_at,
            'likes', x.likes,
            'dislikes', x.dislikes
          )
          order by x.created_at desc
        ),
        '[]'::jsonb
      )
      into v_recent_reviews
      from (
        select
          r.id::text as id,
          r.manga_id::text as manga_id,
          coalesce(m.title, 'Seri')::text as manga_title,
          m.cover::text as manga_cover,
          m.type::text as manga_type,
          m.status::text as manga_status,
          ('/manga/' || r.manga_id::text)::text as target_href,
          r.content::text as content,
          coalesce(r.rating_story, 0)::int as rating_story,
          coalesce(r.rating_characters, 0)::int as rating_characters,
          coalesce(r.rating_art, 0)::int as rating_art,
          coalesce(r.rating_progression, 0)::int as rating_progression,
          coalesce(r.rating_engagement, 0)::int as rating_engagement,
          r.created_at,
          coalesce(r.updated_at, r.created_at) as updated_at,
          coalesce((
            select count(*)
            from public.review_likes as rl
            where rl.review_id = r.id
          ), 0)::int as likes,
          coalesce((
            select count(*)
            from public.review_dislikes as rd
            where rd.review_id = r.id
          ), 0)::int as dislikes
        from public.reviews as r
        left join public.mangas as m on m.id = r.manga_id
        where r.user_id = p_target_user_id
        order by r.created_at desc
        limit 12
      ) as x;
    end if;

    if v_context.can_view_followed_manga then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'title', x.title,
            'cover', x.cover,
            'type', x.type,
            'status', x.status,
            'followedAt', x.followed_at,
            'href', '/manga/' || x.id
          )
          order by x.followed_at desc
        ),
        '[]'::jsonb
      )
      into v_followed_manga
      from (
        select m.id, m.title, m.cover, m.type, m.status, f.followed_at
        from public.follows as f
        join public.mangas as m on m.id = f.manga_id
        where f.user_id = p_target_user_id
        order by f.followed_at desc
        limit 18
      ) as x;
    end if;

    if v_context.can_view_reading_lists then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'user_id', x.user_id,
            'name', x.name,
            'description', x.description,
            'image_url', x.image_url,
            'is_public', x.is_public,
            'created_at', x.created_at
          )
          order by x.created_at desc
        ),
        '[]'::jsonb
      )
      into v_reading_lists
      from (
        select rl.id, rl.user_id, rl.name, rl.description, rl.image_url, rl.is_public, rl.created_at
        from public.reading_lists as rl
        where rl.user_id = p_target_user_id
          and (v_is_owner or rl.is_public = true)
        order by rl.created_at desc
      ) as x;
    end if;

    if v_context.can_view_tier_lists then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'user_id', x.user_id,
            'title', x.title,
            'type', x.type,
            'is_public', x.is_public,
            'created_at', x.created_at
          )
          order by x.created_at desc
        ),
        '[]'::jsonb
      )
      into v_tier_lists
      from (
        select tl.id, tl.user_id, tl.title, tl.type, tl.is_public, tl.created_at
        from public.tier_lists as tl
        where tl.user_id = v_target_user_uuid
          and (v_is_owner or tl.is_public = true)
        order by tl.created_at desc
      ) as x;
    end if;
  end if;

  return jsonb_build_object(
    'stats', v_stats,
    'recentReads', v_recent_reads,
    'recentComments', v_recent_comments,
    'recentReviews', v_recent_reviews,
    'followedManga', v_followed_manga,
    'readingActivity', v_reading_activity,
    'readingLists', v_reading_lists,
    'tierLists', v_tier_lists
  );
end;
$$;

revoke all on function public.get_profile_route_bundle(text) from public;
grant execute on function public.get_profile_route_bundle(text) to anon;
grant execute on function public.get_profile_route_bundle(text) to authenticated;
