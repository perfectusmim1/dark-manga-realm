do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'support_ticket_category'
  ) then
    create type public.support_ticket_category as enum (
      'bug_report',
      'account',
      'content_issue',
      'ban_appeal',
      'other'
    );
  end if;

  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'support_ticket_status'
  ) then
    create type public.support_ticket_status as enum (
      'open',
      'waiting_staff',
      'waiting_user',
      'closed'
    );
  end if;

  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'user_ban_kind'
  ) then
    create type public.user_ban_kind as enum (
      'timed',
      'permanent',
      'hard'
    );
  end if;
end;
$$;

alter table public.users
  add column if not exists warning_count integer not null default 0,
  add column if not exists unread_warning_count integer not null default 0,
  add column if not exists last_warning_at timestamptz,
  add column if not exists active_ban_type public.user_ban_kind,
  add column if not exists ban_expires_at timestamptz;

create table if not exists public.user_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  issued_by text references public.users(id) on delete set null,
  title text not null default 'Yönetici uyarısı',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index if not exists user_warnings_user_id_created_at_idx
  on public.user_warnings(user_id, created_at desc);

create index if not exists user_warnings_unread_idx
  on public.user_warnings(user_id, acknowledged_at)
  where acknowledged_at is null;

create table if not exists public.user_bans (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  issued_by text references public.users(id) on delete set null,
  revoked_by text references public.users(id) on delete set null,
  warning_id uuid references public.user_warnings(id) on delete set null,
  kind public.user_ban_kind not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint user_bans_timed_requires_expiry check (
    (kind = 'timed' and expires_at is not null)
    or (kind <> 'timed' and expires_at is null)
  )
);

create index if not exists user_bans_user_id_created_at_idx
  on public.user_bans(user_id, created_at desc);

create index if not exists user_bans_active_idx
  on public.user_bans(user_id, kind, expires_at)
  where revoked_at is null;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  subject text not null,
  category public.support_ticket_category not null,
  status public.support_ticket_status not null default 'open',
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text references public.users(id) on delete set null,
  constraint support_ticket_subject_not_blank check (char_length(btrim(subject)) >= 3)
);

create index if not exists support_tickets_user_id_last_message_at_idx
  on public.support_tickets(user_id, last_message_at desc);

create index if not exists support_tickets_status_last_message_at_idx
  on public.support_tickets(status, last_message_at desc);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id text references public.users(id) on delete set null,
  author_name text not null,
  author_role text not null,
  content text not null,
  image_url text,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_author_role_check
    check (author_role in ('user', 'moderator', 'admin', 'system')),
  constraint support_ticket_messages_content_not_blank
    check (char_length(btrim(content)) >= 1)
);

create index if not exists support_ticket_messages_ticket_id_created_at_idx
  on public.support_ticket_messages(ticket_id, created_at asc);

alter table public.user_warnings enable row level security;
alter table public.user_bans enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

create or replace function public.refresh_user_warning_summary(
  p_user_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users as u
  set
    warning_count = coalesce(summary.total_count, 0),
    unread_warning_count = coalesce(summary.unread_count, 0),
    last_warning_at = summary.last_warning_at
  from (
    select
      p_user_id as user_id,
      count(*)::integer as total_count,
      count(*) filter (where acknowledged_at is null)::integer as unread_count,
      max(created_at) as last_warning_at
    from public.user_warnings
    where user_id = p_user_id
  ) as summary
  where u.id = summary.user_id;
end;
$$;

create or replace function public.refresh_user_warning_summary_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_user_warning_summary(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_user_warning_summary_on_change on public.user_warnings;
create trigger refresh_user_warning_summary_on_change
after insert or update or delete on public.user_warnings
for each row
execute function public.refresh_user_warning_summary_trigger();

create or replace function public.refresh_user_ban_state(
  p_user_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.user_bans%rowtype;
begin
  update public.user_bans
  set revoked_at = now()
  where user_id = p_user_id
    and kind = 'timed'
    and revoked_at is null
    and expires_at is not null
    and expires_at <= now();

  select *
  into v_active
  from public.user_bans
  where user_id = p_user_id
    and revoked_at is null
    and (
      kind <> 'timed'
      or expires_at is null
      or expires_at > now()
    )
  order by created_at desc
  limit 1;

  update public.users
  set
    is_banned = found,
    ban_reason = case when found then v_active.reason else null end,
    banned_at = case when found then v_active.created_at else null end,
    banned_by = case when found then v_active.issued_by else null end,
    active_ban_type = case when found then v_active.kind else null end,
    ban_expires_at = case when found then v_active.expires_at else null end
  where id = p_user_id;
end;
$$;

create or replace function public.refresh_user_ban_state_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_user_ban_state(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_user_ban_state_on_change on public.user_bans;
create trigger refresh_user_ban_state_on_change
after insert or update or delete on public.user_bans
for each row
execute function public.refresh_user_ban_state_trigger();

create or replace function public.touch_support_ticket_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_tickets
  set
    updated_at = new.created_at,
    last_message_at = new.created_at
  where id = new.ticket_id;

  return new;
end;
$$;

drop trigger if exists touch_support_ticket_from_message on public.support_ticket_messages;
create trigger touch_support_ticket_from_message
after insert on public.support_ticket_messages
for each row
execute function public.touch_support_ticket_from_message();

create or replace function public.current_authenticated_user_is_not_banned()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id text := (select auth.uid())::text;
  v_is_banned boolean := false;
begin
  if v_user_id is null then
    return true;
  end if;

  perform public.refresh_user_ban_state(v_user_id);

  select coalesce(is_banned, false)
  into v_is_banned
  from public.users
  where id = v_user_id;

  return not v_is_banned;
end;
$$;

drop function if exists public.get_admin_user_directory();

create or replace function public.get_admin_user_directory()
returns table (
  id text,
  username text,
  email text,
  avatar text,
  role text,
  is_banned boolean,
  ban_reason text,
  banned_at timestamptz,
  created_at timestamptz,
  last_seen_at timestamptz,
  warning_count integer,
  unread_warning_count integer,
  active_ban_type text,
  ban_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.check_user_role((select auth.uid())::text, array['admin', 'moderator']) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    u.id::text,
    u.username::text,
    u.email::text,
    u.avatar::text,
    u.role::text,
    u.is_banned,
    u.ban_reason::text,
    u.banned_at,
    u.created_at,
    u.last_seen_at,
    u.warning_count,
    u.unread_warning_count,
    case when u.active_ban_type is null then null else u.active_ban_type::text end,
    u.ban_expires_at
  from public.users as u
  order by u.created_at desc;
end;
$$;

revoke all on function public.refresh_user_warning_summary(text) from public;
revoke all on function public.refresh_user_ban_state(text) from public;
revoke all on function public.current_authenticated_user_is_not_banned() from public;
revoke all on function public.get_admin_user_directory() from public;

grant execute on function public.current_authenticated_user_is_not_banned() to anon, authenticated;
grant execute on function public.get_admin_user_directory() to authenticated;
grant execute on function public.refresh_user_warning_summary(text) to service_role;
grant execute on function public.refresh_user_ban_state(text) to service_role;

insert into public.user_bans (user_id, issued_by, kind, reason, created_at)
select
  u.id,
  u.banned_by,
  case
    when exists (select 1 from public.banned_ip_hashes as iph where iph.user_id = u.id)
      or exists (select 1 from public.banned_device_hashes as dev where dev.user_id = u.id)
      then 'hard'::public.user_ban_kind
    else 'permanent'::public.user_ban_kind
  end,
  coalesce(u.ban_reason, 'Yönetici tarafından banlandı.'),
  coalesce(u.banned_at, now())
from public.users as u
where u.is_banned = true
  and not exists (
    select 1
    from public.user_bans as existing_ban
    where existing_ban.user_id = u.id
      and existing_ban.revoked_at is null
  );

do $$
declare
  v_user_id text;
begin
  for v_user_id in
    select id
    from public.users
  loop
    perform public.refresh_user_warning_summary(v_user_id);
    perform public.refresh_user_ban_state(v_user_id);
  end loop;
end;
$$;
