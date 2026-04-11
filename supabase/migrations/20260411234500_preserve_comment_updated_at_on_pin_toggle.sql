create or replace function public.set_comment_pinned(
    p_comment_id text,
    p_is_pinned boolean,
    p_entity_type text default 'manga'
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
    perform set_config('toonparrot.preserve_updated_at', 'on', true);

    case p_entity_type
        when 'manga' then
            update public.comments
            set is_pinned = p_is_pinned
            where id::text = p_comment_id;
        when 'character' then
            update public.character_comments
            set is_pinned = p_is_pinned
            where id::text = p_comment_id;
        when 'author' then
            update public.author_comments
            set is_pinned = p_is_pinned
            where id::text = p_comment_id;
        when 'artist' then
            update public.artist_comments
            set is_pinned = p_is_pinned
            where id::text = p_comment_id;
        else
            raise exception 'Unsupported comment entity type: %', p_entity_type;
    end case;
end;
$function$;

revoke all on function public.set_comment_pinned(text, boolean, text) from public;
grant execute on function public.set_comment_pinned(text, boolean, text) to authenticated;
grant execute on function public.set_comment_pinned(text, boolean, text) to service_role;
