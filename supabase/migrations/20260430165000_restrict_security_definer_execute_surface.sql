-- Remove accidental browser-callable EXECUTE grants from SECURITY DEFINER
-- helpers. Keep only the RPCs that are intentionally part of the public or
-- authenticated browser contract.

alter function public.check_user_role(text, text[]) security invoker;
revoke all on function public.check_user_role(text, text[]) from public, anon, authenticated;
grant execute on function public.check_user_role(text, text[]) to anon, authenticated, service_role;

do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_set_adblock_warning_enabled',
        'admin_set_devtools_protection',
        'admin_set_user_role',
        'current_authenticated_user_is_not_banned',
        'current_session_satisfies_mfa_requirement',
        'decrement_artist_likes',
        'decrement_author_likes',
        'decrement_character_likes',
        'enforce_site_access_request',
        'enforce_support_ticket_create_cooldown',
        'enforce_support_ticket_reply_cooldown',
        'generate_unique_public_username',
        'get_admin_user_directory',
        'handle_auth_mfa_factor_state_sync',
        'handle_auth_user_profile_sync',
        'increment_artist_likes',
        'increment_author_likes',
        'increment_character_likes',
        'protect_user_role',
        'refresh_user_ban_state_trigger',
        'refresh_user_warning_summary_trigger',
        'set_series_requests_updated_at',
        'sync_current_auth_profile',
        'sync_tag_moderation',
        'touch_support_ticket_from_message',
        'update_current_user_preferences',
        'update_current_user_username',
        'update_tag_usage_count'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
  end loop;
end;
$$;

grant execute on function public.admin_set_adblock_warning_enabled(boolean) to authenticated, service_role;
grant execute on function public.admin_set_devtools_protection(boolean) to authenticated, service_role;
grant execute on function public.admin_set_user_role(text, text) to authenticated, service_role;
grant execute on function public.current_authenticated_user_is_not_banned() to authenticated, service_role;
grant execute on function public.current_session_satisfies_mfa_requirement() to authenticated, service_role;
grant execute on function public.decrement_artist_likes(uuid) to authenticated, service_role;
grant execute on function public.decrement_author_likes(uuid) to authenticated, service_role;
grant execute on function public.decrement_character_likes(uuid) to authenticated, service_role;
grant execute on function public.get_admin_user_directory() to authenticated, service_role;
grant execute on function public.increment_artist_likes(uuid) to authenticated, service_role;
grant execute on function public.increment_author_likes(uuid) to authenticated, service_role;
grant execute on function public.increment_character_likes(uuid) to authenticated, service_role;
grant execute on function public.sync_current_auth_profile(text, text) to authenticated, service_role;
grant execute on function public.sync_tag_moderation(uuid, text, text) to authenticated, service_role;
grant execute on function public.update_current_user_preferences(jsonb) to authenticated, service_role;
grant execute on function public.update_current_user_username(text) to authenticated, service_role;

drop policy if exists "support_ticket_public_rate_limits_service_role"
on public.support_ticket_public_rate_limits;

create policy "support_ticket_public_rate_limits_service_role"
on public.support_ticket_public_rate_limits
for all
to service_role
using (true)
with check (true);
