alter table public.support_tickets
  alter column user_id drop not null;

alter table public.support_tickets
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists appeal_account_email text;

update public.support_tickets as st
set
  contact_name = coalesce(nullif(st.contact_name, ''), u.username),
  contact_email = coalesce(nullif(st.contact_email, ''), lower(nullif(u.email, '')))
from public.users as u
where st.user_id = u.id
  and (
    st.contact_name is null
    or st.contact_name = ''
    or st.contact_email is null
    or st.contact_email = ''
  );

update public.support_tickets as st
set
  appeal_account_email = coalesce(
    nullif(st.appeal_account_email, ''),
    lower(nullif(st.contact_email, '')),
    lower(nullif(u.email, ''))
  )
from public.users as u
where st.category = 'ban_appeal'
  and st.user_id = u.id
  and (
    st.appeal_account_email is null
    or st.appeal_account_email = ''
  );

drop index if exists support_tickets_contact_email_last_message_at_idx;
create index if not exists support_tickets_contact_email_last_message_at_idx
  on public.support_tickets(contact_email, last_message_at desc);

alter table public.support_tickets
  drop constraint if exists support_tickets_contact_identity_check;

alter table public.support_tickets
  add constraint support_tickets_contact_identity_check
  check (
    user_id is not null
    or (
      char_length(btrim(coalesce(contact_name, ''))) >= 2
      and char_length(btrim(coalesce(contact_email, ''))) >= 5
    )
  );

alter table public.support_tickets
  drop constraint if exists support_tickets_ban_appeal_email_required;

alter table public.support_tickets
  add constraint support_tickets_ban_appeal_email_required
  check (
    category <> 'ban_appeal'
    or char_length(btrim(coalesce(appeal_account_email, ''))) >= 5
  );
