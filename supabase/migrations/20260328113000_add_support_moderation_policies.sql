drop policy if exists user_warnings_select_own_or_staff on public.user_warnings;
create policy user_warnings_select_own_or_staff
on public.user_warnings
for select
to authenticated
using (
  user_id = (auth.uid())::text
  or public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists user_bans_select_own_or_staff on public.user_bans;
create policy user_bans_select_own_or_staff
on public.user_bans
for select
to authenticated
using (
  user_id = (auth.uid())::text
  or public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists support_tickets_select_own_or_staff on public.support_tickets;
create policy support_tickets_select_own_or_staff
on public.support_tickets
for select
to authenticated
using (
  user_id = (auth.uid())::text
  or public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists support_tickets_insert_own on public.support_tickets;
create policy support_tickets_insert_own
on public.support_tickets
for insert
to authenticated
with check (
  user_id = (auth.uid())::text
);

drop policy if exists support_tickets_update_staff_only on public.support_tickets;
create policy support_tickets_update_staff_only
on public.support_tickets
for update
to authenticated
using (
  public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
)
with check (
  public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
);

drop policy if exists support_ticket_messages_select_own_or_staff on public.support_ticket_messages;
create policy support_ticket_messages_select_own_or_staff
on public.support_ticket_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.support_tickets as st
    where st.id = ticket_id
      and (
        st.user_id = (auth.uid())::text
        or public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
      )
  )
);

drop policy if exists support_ticket_messages_insert_own_or_staff on public.support_ticket_messages;
create policy support_ticket_messages_insert_own_or_staff
on public.support_ticket_messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.support_tickets as st
    where st.id = ticket_id
      and (
        st.user_id = (auth.uid())::text
        or public.check_user_role((auth.uid())::text, array['admin', 'moderator'])
      )
  )
);
