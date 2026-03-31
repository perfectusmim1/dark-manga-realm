begin;

drop policy if exists "Users or staff can delete manga tags" on public.manga_tags;
create policy "Only relation owner can delete pending manga tags"
on public.manga_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  and coalesce(is_discoverable, false) = false
);

drop policy if exists "Users or staff can delete character tags" on public.character_tags;
create policy "Only relation owner can delete pending character tags"
on public.character_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  and coalesce(is_discoverable, false) = false
);

drop policy if exists "Users or staff can delete author tags" on public.author_tags;
create policy "Only relation owner can delete pending author tags"
on public.author_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  and coalesce(is_discoverable, false) = false
);

drop policy if exists "Users or staff can delete artist tags" on public.artist_tags;
create policy "Only relation owner can delete pending artist tags"
on public.artist_tags
for delete
to authenticated
using (
  added_by = (select auth.uid())::text
  and coalesce(is_discoverable, false) = false
);

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
  v_relation_was_discoverable boolean := false;
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

  case p_entity_type
    when 'manga' then
      select coalesce(is_discoverable, false) into v_relation_was_discoverable
      from public.manga_tags
      where manga_id = p_entity_id
        and tag_id = p_tag_id;
    when 'character' then
      select coalesce(is_discoverable, false) into v_relation_was_discoverable
      from public.character_tags
      where character_id::text = p_entity_id
        and tag_id = p_tag_id;
    when 'author' then
      select coalesce(is_discoverable, false) into v_relation_was_discoverable
      from public.author_tags
      where author_id::text = p_entity_id
        and tag_id = p_tag_id;
    when 'artist' then
      select coalesce(is_discoverable, false) into v_relation_was_discoverable
      from public.artist_tags
      where artist_id::text = p_entity_id
        and tag_id = p_tag_id;
  end case;

  if not v_relation_was_discoverable and v_local_down >= 5 then
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
  elsif v_relation_was_discoverable then
    v_relation_discoverable := true;
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
        update public.manga_tags
        set is_discoverable = false
        where manga_id = p_entity_id
          and tag_id = p_tag_id;
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.manga_tags
        where manga_id = p_entity_id
          and tag_id = p_tag_id;
      when 'character' then
        update public.character_tags
        set is_discoverable = false
        where character_id::text = p_entity_id
          and tag_id = p_tag_id;
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.character_tags
        where character_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'author' then
        update public.author_tags
        set is_discoverable = false
        where author_id::text = p_entity_id
          and tag_id = p_tag_id;
        select coalesce(is_discoverable, false) into v_relation_discoverable
        from public.author_tags
        where author_id::text = p_entity_id
          and tag_id = p_tag_id;
      when 'artist' then
        update public.artist_tags
        set is_discoverable = false
        where artist_id::text = p_entity_id
          and tag_id = p_tag_id;
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
    'relationDiscoverable', coalesce(v_relation_discoverable, false),
    'globalUp', v_global_up,
    'globalDown', v_global_down,
    'localUp', v_local_up,
    'localDown', v_local_down
  );
end;
$$;

grant execute on function public.sync_tag_moderation(uuid, text, text) to authenticated;

commit;
