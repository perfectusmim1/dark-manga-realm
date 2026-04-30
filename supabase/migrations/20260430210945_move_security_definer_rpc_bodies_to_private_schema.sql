-- Keep SECURITY DEFINER code out of the exposed public API schema while
-- preserving existing public RPC names, signatures, and role grants.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

do $$
declare
  target_function_names constant text[] := array[
    'admin_set_adblock_warning_enabled',
    'admin_set_devtools_protection',
    'admin_set_user_role',
    'can_access_manga',
    'current_authenticated_user_is_not_banned',
    'current_session_satisfies_mfa_requirement',
    'current_user_allows_adult_content',
    'decrement_artist_likes',
    'decrement_author_likes',
    'decrement_character_likes',
    'get_admin_user_directory',
    'get_profile_access_context',
    'get_profile_route_bundle',
    'get_public_chapter_read_count',
    'get_public_chapter_read_leaderboard_counts',
    'get_public_user_presence_counts',
    'get_site_security_settings',
    'get_unread_announcement_count',
    'increment_artist_likes',
    'increment_author_likes',
    'increment_chapter_views',
    'increment_character_likes',
    'increment_manga_views',
    'sync_current_auth_profile',
    'sync_tag_moderation',
    'update_current_user_preferences',
    'update_current_user_username',
    'update_user_presence'
  ];
  r record;
  private_definition text;
  call_args text;
  wrapper_body text;
  wrapper_volatility text;
begin
  for r in
    select
      p.oid,
      p.proname,
      p.pronargs,
      p.provolatile,
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_get_function_result(p.oid) as result_type,
      pg_get_functiondef(p.oid) as definition,
      has_function_privilege('anon', p.oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
      has_function_privilege('service_role', p.oid, 'execute') as service_execute
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(target_function_names)
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
    order by p.proname, p.oid::regprocedure::text
  loop
    select coalesce(string_agg('$' || arg_index::text, ', ' order by arg_index), '')
      into call_args
    from generate_series(1, r.pronargs) as arg_index;

    private_definition := regexp_replace(
      r.definition,
      'CREATE OR REPLACE FUNCTION public\.',
      'CREATE OR REPLACE FUNCTION private.',
      'i'
    );

    execute private_definition;
    execute format(
      'revoke all on function private.%I(%s) from public',
      r.proname,
      r.identity_arguments
    );
    execute format(
      'grant execute on function private.%I(%s) to anon, authenticated, service_role',
      r.proname,
      r.identity_arguments
    );

    wrapper_volatility := case r.provolatile
      when 'i' then 'immutable'
      when 's' then 'stable'
      else 'volatile'
    end;

    if r.result_type ilike 'TABLE(%' or r.result_type ilike 'SETOF %' then
      wrapper_body := format('select * from private.%I(%s)', r.proname, call_args);
    else
      wrapper_body := format('select private.%I(%s)', r.proname, call_args);
    end if;

    execute format(
      'create or replace function public.%I(%s)
       returns %s
       language sql
       %s
       security invoker
       set search_path = ''''
       as $function$ %s $function$',
      r.proname,
      r.arguments,
      r.result_type,
      wrapper_volatility,
      wrapper_body
    );

    execute format('revoke all on function public.%I(%s) from public', r.proname, r.identity_arguments);
    execute format('revoke all on function public.%I(%s) from anon', r.proname, r.identity_arguments);
    execute format('revoke all on function public.%I(%s) from authenticated', r.proname, r.identity_arguments);

    if r.anon_execute then
      execute format('grant execute on function public.%I(%s) to anon', r.proname, r.identity_arguments);
    end if;

    if r.authenticated_execute then
      execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.identity_arguments);
    end if;

    if r.service_execute then
      execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.identity_arguments);
    end if;
  end loop;
end $$;
