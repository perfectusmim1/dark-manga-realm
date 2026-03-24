revoke all on public.auth_login_attempts from anon, authenticated;

drop policy if exists "No direct access to auth_login_attempts" on public.auth_login_attempts;

create policy "No direct access to auth_login_attempts"
on public.auth_login_attempts
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
