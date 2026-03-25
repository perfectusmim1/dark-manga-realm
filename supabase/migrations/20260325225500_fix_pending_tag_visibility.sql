begin;

update public.manga_tags as relation
set is_discoverable = false
from public.tags tag
where tag.id = relation.tag_id
  and coalesce(tag.is_official, false) = false
  and coalesce(tag.community_approved, false) = false
  and relation.is_discoverable = true;

update public.character_tags as relation
set is_discoverable = false
from public.tags tag
where tag.id = relation.tag_id
  and coalesce(tag.is_official, false) = false
  and coalesce(tag.community_approved, false) = false
  and relation.is_discoverable = true;

update public.author_tags as relation
set is_discoverable = false
from public.tags tag
where tag.id = relation.tag_id
  and coalesce(tag.is_official, false) = false
  and coalesce(tag.community_approved, false) = false
  and relation.is_discoverable = true;

update public.artist_tags as relation
set is_discoverable = false
from public.tags tag
where tag.id = relation.tag_id
  and coalesce(tag.is_official, false) = false
  and coalesce(tag.community_approved, false) = false
  and relation.is_discoverable = true;

create or replace function public.sync_tag_moderation(
  p_tag_id uuid,
  p_entity_type text,
  p_entity_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag_exists boolean := false;
  v_is_official boolean := false;
  v_community_approved boolean := false;
  v_global_up integer := 0;
  v_global_down integer := 0;
  v_local_up integer := 0;
  v_local_down integer := 0;
  v_relation_discoverable boolean := false;
  v_relation_deleted boolean := false;
begin
  select true, is_official, community_approved
  into v_tag_exists, v_is_official, v_community_approved
  from public.tags
  where id = p_tag_id;

  if not v_tag_exists then
    return jsonb_build_object(
      'tagDeleted', true,
      'relationDeleted', true,
      'communityApproved', false,
      'relationDiscoverable', false,
      'globalUp', 0,
      'globalDown', 0,
      'localUp', 0,
      'localDown', 0
    );
  end if;

  select
    count(*) filter (where vote_type = 'up'),
    count(*) filter (where vote_type = 'down')
  into v_global_up, v_global_down
  from public.tag_votes
  where tag_id = p_tag_id;

  if not v_is_official and not v_community_approved and v_global_down >= 5 then
    delete from public.tag_votes where tag_id = p_tag_id;
    delete from public.manga_tags where tag_id = p_tag_id;
    delete from public.character_tags where tag_id = p_tag_id;
    delete from public.author_tags where tag_id = p_tag_id;
    delete from public.artist_tags where tag_id = p_tag_id;
    delete from public.tags where id = p_tag_id and is_official = false;

    return jsonb_build_object(
      'tagDeleted', true,
      'relationDeleted', true,
      'communityApproved', false,
      'relationDiscoverable', false,
      'globalUp', v_global_up,
      'globalDown', v_global_down,
      'localUp', 0,
      'localDown', 0
    );
  end if;

  if not v_is_official and not v_community_approved and v_global_up >= 5 then
    update public.tags
    set community_approved = true
    where id = p_tag_id;

    v_community_approved := true;
  end if;

  select
    count(*) filter (where vote_type = 'up'),
    count(*) filter (where vote_type = 'down')
  into v_local_up, v_local_down
  from public.tag_votes
  where tag_id = p_tag_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id;

  if v_local_down >= 5 then
    case p_entity_type
      when 'manga' then
        delete from public.manga_tags
        where manga_id = p_entity_id
          and tag_id = p_tag_id;
      when 'character' then
        delete from public.character_tags
        where character_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'author' then
        delete from public.author_tags
        where author_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'artist' then
        delete from public.artist_tags
        where artist_id::text = p_entity_id
          and tag_id = p_tag_id;
    end case;

    v_relation_deleted := true;
    v_relation_discoverable := false;
  elsif v_local_up >= 5 then
    case p_entity_type
      when 'manga' then
        update public.manga_tags
        set is_discoverable = true
        where manga_id = p_entity_id
          and tag_id = p_tag_id;
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.manga_tags
        where manga_id = p_entity_id
          and tag_id = p_tag_id;
      when 'character' then
        update public.character_tags
        set is_discoverable = true
        where character_id::text = p_entity_id
          and tag_id = p_tag_id;
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.character_tags
        where character_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'author' then
        update public.author_tags
        set is_discoverable = true
        where author_id::text = p_entity_id
          and tag_id = p_tag_id;
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.author_tags
        where author_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'artist' then
        update public.artist_tags
        set is_discoverable = true
        where artist_id::text = p_entity_id
          and tag_id = p_tag_id;
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.artist_tags
        where artist_id::text = p_entity_id
          and tag_id = p_tag_id;
    end case;
  else
    case p_entity_type
      when 'manga' then
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.manga_tags
        where manga_id = p_entity_id
          and tag_id = p_tag_id;
      when 'character' then
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.character_tags
        where character_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'author' then
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.author_tags
        where author_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'artist' then
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.artist_tags
        where artist_id::text = p_entity_id
          and tag_id = p_tag_id;
    end case;
  end if;

  return jsonb_build_object(
    'tagDeleted', false,
    'relationDeleted', v_relation_deleted,
    'communityApproved', v_is_official or v_community_approved,
    'relationDiscoverable', v_is_official or coalesce(v_relation_discoverable, false),
    'globalUp', v_global_up,
    'globalDown', v_global_down,
    'localUp', v_local_up,
    'localDown', v_local_down
  );
end;
$$;

grant execute on function public.sync_tag_moderation(uuid, text, text) to authenticated;

commit;
