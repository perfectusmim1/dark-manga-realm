drop policy if exists external_provider_accounts_no_client_access
on public.external_provider_accounts;

create policy external_provider_accounts_no_client_access
on public.external_provider_accounts
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists external_provider_auth_states_no_client_access
on public.external_provider_auth_states;

create policy external_provider_auth_states_no_client_access
on public.external_provider_auth_states
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists external_sync_state_no_client_access
on public.external_sync_state;

create policy external_sync_state_no_client_access
on public.external_sync_state
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists reviews_delete
on public.reviews;

create policy reviews_delete
on public.reviews
for delete
to public
using (
  ((select auth.uid())::text = user_id)
  or public.check_user_role((select auth.uid())::text, array['admin'])
);

drop policy if exists ratings_delete
on public.ratings;

create policy ratings_delete
on public.ratings
for delete
to public
using (
  ((select auth.uid())::text = user_id)
  or public.check_user_role((select auth.uid())::text, array['admin'])
);
