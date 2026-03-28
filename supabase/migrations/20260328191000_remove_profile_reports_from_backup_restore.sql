create or replace function public.restore_site_backup(
  p_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables jsonb;
  v_table_name text;
  v_restore_order text[] := array[
    'users',
    'admin_users',
    'authors',
    'artists',
    'characters',
    'tags',
    'site_settings',
    'announcements',
    'mangas',
    'user_warnings',
    'user_bans',
    'support_tickets',
    'chapters',
    'comments',
    'favorites',
    'reading_progress',
    'bookmarks',
    'follows',
    'notifications',
    'reading_lists',
    'reviews',
    'manga_reactions',
    'manga_characters',
    'manga_authors',
    'manga_artists',
    'character_likes',
    'author_likes',
    'artist_likes',
    'character_comments',
    'author_comments',
    'artist_comments',
    'character_reactions',
    'author_reactions',
    'artist_reactions',
    'reading_activity_log',
    'user_achievements',
    'tier_lists',
    'reading_list_likes',
    'manga_tags',
    'character_tags',
    'author_tags',
    'artist_tags',
    'tag_votes',
    'user_follows',
    'user_blocks',
    'announcement_reads',
    'manga_reports',
    'comment_reports',
    'chapter_read_progress',
    'support_ticket_messages',
    'reading_list_items',
    'review_likes',
    'comment_likes',
    'character_comment_likes',
    'author_comment_likes',
    'artist_comment_likes',
    'ratings'
  ];
  v_delete_order text[] := array[
    'ratings',
    'artist_comment_likes',
    'author_comment_likes',
    'character_comment_likes',
    'comment_likes',
    'review_likes',
    'reading_list_items',
    'support_ticket_messages',
    'chapter_read_progress',
    'comment_reports',
    'manga_reports',
    'announcement_reads',
    'user_blocks',
    'user_follows',
    'tag_votes',
    'artist_tags',
    'author_tags',
    'character_tags',
    'manga_tags',
    'reading_list_likes',
    'tier_lists',
    'user_achievements',
    'reading_activity_log',
    'artist_reactions',
    'author_reactions',
    'character_reactions',
    'artist_comments',
    'author_comments',
    'character_comments',
    'artist_likes',
    'author_likes',
    'character_likes',
    'manga_artists',
    'manga_authors',
    'manga_characters',
    'manga_reactions',
    'reviews',
    'reading_lists',
    'notifications',
    'follows',
    'bookmarks',
    'reading_progress',
    'favorites',
    'comments',
    'chapters',
    'support_tickets',
    'user_bans',
    'user_warnings',
    'mangas',
    'announcements',
    'site_settings',
    'tags',
    'characters',
    'artists',
    'authors',
    'admin_users',
    'users'
  ];
begin
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'Manifest is required';
  end if;

  if coalesce((p_manifest ->> 'version')::integer, -1) <> 2 then
    raise exception 'Unsupported backup version: %', p_manifest ->> 'version';
  end if;

  v_tables := p_manifest -> 'tables';
  if v_tables is null or jsonb_typeof(v_tables) <> 'object' then
    raise exception 'Manifest tables payload is required';
  end if;

  foreach v_table_name in array v_restore_order loop
    if not (v_tables ? v_table_name) then
      raise exception 'Missing table payload: %', v_table_name;
    end if;

    if jsonb_typeof(v_tables -> v_table_name) <> 'array' then
      raise exception 'Table payload must be an array: %', v_table_name;
    end if;
  end loop;

  foreach v_table_name in array v_delete_order loop
    execute format('delete from public.%I', v_table_name);
  end loop;

  foreach v_table_name in array v_restore_order loop
    if jsonb_array_length(v_tables -> v_table_name) = 0 then
      continue;
    end if;

    execute format(
      'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1)',
      v_table_name
    ) using (v_tables -> v_table_name);
  end loop;

  return jsonb_build_object(
    'restoredAt', now(),
    'restoredTables', to_jsonb(v_restore_order)
  );
end;
$$;

revoke all on function public.restore_site_backup(jsonb) from public;
revoke all on function public.restore_site_backup(jsonb) from anon;
revoke all on function public.restore_site_backup(jsonb) from authenticated;
grant execute on function public.restore_site_backup(jsonb) to service_role;
