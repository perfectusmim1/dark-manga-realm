create or replace function public.get_profile_access_context(
  p_target_user_id text
)
returns table (
  id text,
  username text,
  avatar text,
  role text,
  created_at timestamptz,
  is_following boolean,
  is_followed_by boolean,
  is_mutual_follow boolean,
  is_blocked boolean,
  is_blocked_by_owner boolean,
  can_view_profile boolean,
  can_view_reading_history boolean,
  can_view_comments boolean,
  can_view_reading_lists boolean,
  can_view_tier_lists boolean,
  can_view_followed_manga boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer_id text := (select auth.uid())::text;
  v_user public.users%rowtype;
  v_privacy jsonb := '{}'::jsonb;
  v_is_following boolean := false;
  v_is_followed_by boolean := false;
  v_is_mutual_follow boolean := false;
  v_is_blocked boolean := false;
  v_is_blocked_by_owner boolean := false;
  v_can_view_profile boolean := false;
  v_can_view_reading_history boolean := false;
  v_can_view_comments boolean := false;
  v_can_view_reading_lists boolean := false;
  v_can_view_tier_lists boolean := false;
  v_can_view_followed_manga boolean := false;
begin
  select *
  into v_user
  from public.users as u
  where u.id = p_target_user_id;

  if not found then
    return;
  end if;

  v_privacy := coalesce(v_user.preferences -> 'privacy', '{}'::jsonb);

  if v_viewer_id is not null and v_viewer_id <> p_target_user_id then
    select exists(
      select 1
      from public.user_follows
      where follower_id = v_viewer_id
        and followed_id = p_target_user_id
    )
    into v_is_following;

    select exists(
      select 1
      from public.user_follows
      where follower_id = p_target_user_id
        and followed_id = v_viewer_id
    )
    into v_is_followed_by;

    select exists(
      select 1
      from public.user_blocks
      where blocker_id = v_viewer_id
        and blocked_id = p_target_user_id
    )
    into v_is_blocked;

    select exists(
      select 1
      from public.user_blocks
      where blocker_id = p_target_user_id
        and blocked_id = v_viewer_id
    )
    into v_is_blocked_by_owner;
  end if;

  v_is_mutual_follow := v_is_following and v_is_followed_by;

  v_can_view_profile := case
    when v_viewer_id is not null and v_viewer_id = p_target_user_id then true
    when coalesce(v_privacy ->> 'visibility', 'public') = 'public' then true
    when coalesce(v_privacy ->> 'visibility', 'public') = 'members' then v_viewer_id is not null
    when coalesce(v_privacy ->> 'visibility', 'public') = 'mutuals' then v_viewer_id is not null and v_is_mutual_follow
    else false
  end;

  if v_can_view_profile then
    v_can_view_reading_history := case
      when v_viewer_id is not null and v_viewer_id = p_target_user_id then true
      when coalesce(v_privacy ->> 'reading_history_visibility', 'public') = 'public' then true
      when coalesce(v_privacy ->> 'reading_history_visibility', 'public') = 'members' then v_viewer_id is not null
      when coalesce(v_privacy ->> 'reading_history_visibility', 'public') = 'mutuals' then v_viewer_id is not null and v_is_mutual_follow
      else false
    end;

    v_can_view_comments := case
      when v_viewer_id is not null and v_viewer_id = p_target_user_id then true
      when coalesce(v_privacy ->> 'comments_visibility', 'public') = 'public' then true
      when coalesce(v_privacy ->> 'comments_visibility', 'public') = 'members' then v_viewer_id is not null
      when coalesce(v_privacy ->> 'comments_visibility', 'public') = 'mutuals' then v_viewer_id is not null and v_is_mutual_follow
      else false
    end;

    v_can_view_reading_lists := case
      when v_viewer_id is not null and v_viewer_id = p_target_user_id then true
      when coalesce(v_privacy ->> 'reading_lists_visibility', 'public') = 'public' then true
      when coalesce(v_privacy ->> 'reading_lists_visibility', 'public') = 'members' then v_viewer_id is not null
      when coalesce(v_privacy ->> 'reading_lists_visibility', 'public') = 'mutuals' then v_viewer_id is not null and v_is_mutual_follow
      else false
    end;

    v_can_view_tier_lists := case
      when v_viewer_id is not null and v_viewer_id = p_target_user_id then true
      when coalesce(v_privacy ->> 'tier_lists_visibility', 'public') = 'public' then true
      when coalesce(v_privacy ->> 'tier_lists_visibility', 'public') = 'members' then v_viewer_id is not null
      when coalesce(v_privacy ->> 'tier_lists_visibility', 'public') = 'mutuals' then v_viewer_id is not null and v_is_mutual_follow
      else false
    end;

    v_can_view_followed_manga := case
      when v_viewer_id is not null and v_viewer_id = p_target_user_id then true
      when coalesce(v_privacy ->> 'followed_manga_visibility', 'public') = 'public' then true
      when coalesce(v_privacy ->> 'followed_manga_visibility', 'public') = 'members' then v_viewer_id is not null
      when coalesce(v_privacy ->> 'followed_manga_visibility', 'public') = 'mutuals' then v_viewer_id is not null and v_is_mutual_follow
      else false
    end;
  end if;

  return query
  select
    v_user.id::text,
    v_user.username::text,
    v_user.avatar::text,
    v_user.role::text,
    v_user.created_at,
    v_is_following,
    v_is_followed_by,
    v_is_mutual_follow,
    v_is_blocked,
    v_is_blocked_by_owner,
    v_can_view_profile,
    v_can_view_reading_history,
    v_can_view_comments,
    v_can_view_reading_lists,
    v_can_view_tier_lists,
    v_can_view_followed_manga;
end;
$$;

revoke all on function public.get_profile_access_context(text) from public;
grant execute on function public.get_profile_access_context(text) to anon;
grant execute on function public.get_profile_access_context(text) to authenticated;
