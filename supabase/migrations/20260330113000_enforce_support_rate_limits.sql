create index if not exists support_tickets_user_id_created_at_idx
  on public.support_tickets(user_id, created_at desc)
  where user_id is not null;

create index if not exists support_tickets_contact_email_created_at_idx
  on public.support_tickets((lower(btrim(contact_email))), created_at desc)
  where contact_email is not null
    and btrim(contact_email) <> '';

create index if not exists support_ticket_messages_user_author_created_at_idx
  on public.support_ticket_messages(author_id, created_at desc)
  where author_id is not null
    and author_role = 'user';

create or replace function public.enforce_support_ticket_create_cooldown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference_time timestamptz := coalesce(new.created_at, now());
  v_normalized_contact_email text := case
    when nullif(btrim(coalesce(new.contact_email, '')), '') is null then null
    else lower(btrim(new.contact_email))
  end;
  v_lock_identity text := coalesce(v_normalized_contact_email, case when new.user_id is null then null else 'user:' || new.user_id end);
  v_recent_ticket_id uuid;
begin
  if new.user_id is null and v_normalized_contact_email is null then
    return new;
  end if;

  if v_lock_identity is not null then
    perform pg_advisory_xact_lock(hashtextextended('support-ticket-create:' || v_lock_identity, 0));
  end if;

  select st.id
  into v_recent_ticket_id
  from public.support_tickets as st
  where st.created_at > (v_reference_time - interval '3 hours')
    and (
      (new.user_id is not null and st.user_id = new.user_id)
      or (
        v_normalized_contact_email is not null
        and st.contact_email is not null
        and btrim(st.contact_email) <> ''
        and lower(btrim(st.contact_email)) = v_normalized_contact_email
      )
    )
  order by st.created_at desc
  limit 1;

  if v_recent_ticket_id is not null then
    raise exception 'Her 3 saatte yalnızca 1 destek bileti oluşturabilirsin.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_support_ticket_reply_cooldown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference_time timestamptz := coalesce(new.created_at, now());
  v_ticket_has_existing_message boolean := false;
  v_last_user_reply_at timestamptz;
begin
  if new.author_role <> 'user' or new.author_id is null then
    return new;
  end if;

  select exists(
    select 1
    from public.support_ticket_messages as existing_message
    where existing_message.ticket_id = new.ticket_id
    limit 1
  )
  into v_ticket_has_existing_message;

  if not v_ticket_has_existing_message then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support-ticket-reply:' || new.author_id, 0));

  select existing_message.created_at
  into v_last_user_reply_at
  from public.support_ticket_messages as existing_message
  where existing_message.author_id = new.author_id
    and existing_message.author_role = 'user'
  order by existing_message.created_at desc
  limit 1;

  if v_last_user_reply_at is not null
    and v_last_user_reply_at > (v_reference_time - interval '10 seconds') then
    raise exception 'Yanıtlar arasında en az 10 saniye beklemelisin.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_support_ticket_create_cooldown on public.support_tickets;
create trigger enforce_support_ticket_create_cooldown
before insert on public.support_tickets
for each row
execute function public.enforce_support_ticket_create_cooldown();

drop trigger if exists enforce_support_ticket_reply_cooldown on public.support_ticket_messages;
create trigger enforce_support_ticket_reply_cooldown
before insert on public.support_ticket_messages
for each row
execute function public.enforce_support_ticket_reply_cooldown();

revoke all on function public.enforce_support_ticket_create_cooldown() from public;
revoke all on function public.enforce_support_ticket_reply_cooldown() from public;
