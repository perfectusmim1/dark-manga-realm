-- PostgREST runs this pre-request guard as the internal authenticator role
-- before switching to anon/authenticated. Keep browser roles unable to call it
-- directly, but allow the internal hook to execute.

grant execute on function public.enforce_site_access_request() to authenticator, service_role;

notify pgrst, 'reload config';
