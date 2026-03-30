alter table public.mangas
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists source_links jsonb not null default '[]'::jsonb;

alter table public.characters
  add column if not exists is_public boolean not null default true,
  add column if not exists alternative_names text[] not null default '{}'::text[],
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists gallery jsonb not null default '[]'::jsonb,
  add column if not exists source_links jsonb not null default '[]'::jsonb;

alter table public.authors
  add column if not exists is_public boolean not null default true,
  add column if not exists alternative_names text[] not null default '{}'::text[],
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists gallery jsonb not null default '[]'::jsonb,
  add column if not exists source_links jsonb not null default '[]'::jsonb;

alter table public.artists
  add column if not exists is_public boolean not null default true,
  add column if not exists alternative_names text[] not null default '{}'::text[],
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists gallery jsonb not null default '[]'::jsonb,
  add column if not exists source_links jsonb not null default '[]'::jsonb;

create table if not exists public.voice_actors (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  image_url text,
  description text,
  likes_count integer not null default 0,
  is_public boolean not null default true,
  alternative_names text[] not null default '{}'::text[],
  details jsonb not null default '{}'::jsonb,
  gallery jsonb not null default '[]'::jsonb,
  source_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_voice_actors_public_rank on public.voice_actors (is_public, likes_count desc, name asc);

create table if not exists public.voice_actor_likes (
  user_id text not null,
  voice_actor_id uuid not null references public.voice_actors(id) on delete cascade,
  primary key (user_id, voice_actor_id)
);

create index if not exists idx_voice_actor_likes_voice_actor_id on public.voice_actor_likes (voice_actor_id);

create table if not exists public.voice_actor_comments (
  id uuid primary key default uuid_generate_v4(),
  voice_actor_id uuid references public.voice_actors(id) on delete cascade,
  user_id text,
  content text not null,
  likes integer default 0,
  created_at timestamptz default now(),
  parent_id uuid,
  gif_url text,
  updated_at timestamptz default now(),
  username text,
  user_avatar text,
  is_pinned boolean not null default false
);

create index if not exists idx_voice_actor_comments_voice_actor_id on public.voice_actor_comments (voice_actor_id);

create table if not exists public.voice_actor_comment_likes (
  comment_id uuid not null references public.voice_actor_comments(id) on delete cascade,
  user_id text not null,
  primary key (comment_id, user_id)
);

create table if not exists public.voice_actor_reactions (
  id uuid primary key default uuid_generate_v4(),
  voice_actor_id uuid not null references public.voice_actors(id) on delete cascade,
  user_id text not null,
  reaction_type text not null,
  created_at timestamptz default now(),
  unique (voice_actor_id, user_id)
);

create index if not exists idx_voice_actor_reactions_voice_actor_id on public.voice_actor_reactions (voice_actor_id);
create index if not exists idx_voice_actor_reactions_user_id on public.voice_actor_reactions (user_id);

create table if not exists public.voice_actor_tags (
  voice_actor_id uuid not null references public.voice_actors(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  added_by text,
  created_at timestamptz not null default now(),
  is_discoverable boolean not null default false,
  primary key (voice_actor_id, tag_id)
);

create index if not exists idx_voice_actor_tags_voice_actor_id on public.voice_actor_tags (voice_actor_id);
create index if not exists idx_voice_actor_tags_tag_id on public.voice_actor_tags (tag_id);
create index if not exists idx_voice_actor_tags_added_by on public.voice_actor_tags (added_by);
create index if not exists idx_voice_actor_tags_discoverable on public.voice_actor_tags (tag_id, is_discoverable);

create table if not exists public.character_voice_actors (
  id uuid primary key default uuid_generate_v4(),
  character_id uuid not null references public.characters(id) on delete cascade,
  voice_actor_id uuid not null references public.voice_actors(id) on delete cascade,
  language text not null default '',
  locale_code text,
  role_label text,
  sort_order integer not null default 0,
  source_name text,
  source_url text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (character_id, voice_actor_id, language)
);

create index if not exists idx_character_voice_actors_character_id on public.character_voice_actors (character_id, sort_order asc, language asc);
create index if not exists idx_character_voice_actors_voice_actor_id on public.character_voice_actors (voice_actor_id);

create table if not exists public.manga_relations (
  id uuid primary key default uuid_generate_v4(),
  manga_id text not null references public.mangas(id) on delete cascade,
  related_manga_id text not null references public.mangas(id) on delete cascade,
  relation_type text not null default 'related',
  source_name text,
  source_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (manga_id, related_manga_id, relation_type)
);

create index if not exists idx_manga_relations_manga_id on public.manga_relations (manga_id, sort_order asc);
create index if not exists idx_manga_relations_related_manga_id on public.manga_relations (related_manga_id);

create or replace function public.increment_voice_actor_likes(entity_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.voice_actors
  set likes_count = likes_count + 1
  where id = entity_id_param;
end;
$function$;

create or replace function public.decrement_voice_actor_likes(entity_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.voice_actors
  set likes_count = greatest(0, likes_count - 1)
  where id = entity_id_param;
end;
$function$;

alter table public.voice_actors enable row level security;
alter table public.voice_actor_likes enable row level security;
alter table public.voice_actor_comments enable row level security;
alter table public.voice_actor_comment_likes enable row level security;
alter table public.voice_actor_reactions enable row level security;
alter table public.voice_actor_tags enable row level security;
alter table public.character_voice_actors enable row level security;
alter table public.manga_relations enable row level security;

drop policy if exists voice_actors_select on public.voice_actors;
create policy voice_actors_select on public.voice_actors for select using (true);
drop policy if exists voice_actors_insert_admin on public.voice_actors;
create policy voice_actors_insert_admin on public.voice_actors for insert with check (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists voice_actors_update_admin on public.voice_actors;
create policy voice_actors_update_admin on public.voice_actors for update using (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists voice_actors_delete_admin on public.voice_actors;
create policy voice_actors_delete_admin on public.voice_actors for delete using (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists voice_actor_likes_select on public.voice_actor_likes;
create policy voice_actor_likes_select on public.voice_actor_likes for select using (true);
drop policy if exists voice_actor_likes_insert on public.voice_actor_likes;
create policy voice_actor_likes_insert on public.voice_actor_likes for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists voice_actor_likes_delete on public.voice_actor_likes;
create policy voice_actor_likes_delete on public.voice_actor_likes for delete using (
  (select auth.uid())::text = user_id
);

drop policy if exists voice_actor_comments_select on public.voice_actor_comments;
create policy voice_actor_comments_select on public.voice_actor_comments for select using (true);
drop policy if exists voice_actor_comments_insert on public.voice_actor_comments;
create policy voice_actor_comments_insert on public.voice_actor_comments for insert with check (
  ((select auth.uid())::text = user_id)
  or check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists voice_actor_comments_update on public.voice_actor_comments;
create policy voice_actor_comments_update on public.voice_actor_comments for update using (
  ((select auth.uid())::text = user_id)
  or check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists voice_actor_comments_delete on public.voice_actor_comments;
create policy voice_actor_comments_delete on public.voice_actor_comments for delete using (
  ((select auth.uid())::text = user_id)
  or check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists voice_actor_comment_likes_select on public.voice_actor_comment_likes;
create policy voice_actor_comment_likes_select on public.voice_actor_comment_likes for select using (true);
drop policy if exists voice_actor_comment_likes_insert on public.voice_actor_comment_likes;
create policy voice_actor_comment_likes_insert on public.voice_actor_comment_likes for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists voice_actor_comment_likes_delete on public.voice_actor_comment_likes;
create policy voice_actor_comment_likes_delete on public.voice_actor_comment_likes for delete using (
  (select auth.uid())::text = user_id
);

drop policy if exists voice_actor_reactions_select on public.voice_actor_reactions;
create policy voice_actor_reactions_select on public.voice_actor_reactions for select using (true);
drop policy if exists voice_actor_reactions_insert on public.voice_actor_reactions;
create policy voice_actor_reactions_insert on public.voice_actor_reactions for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists voice_actor_reactions_update on public.voice_actor_reactions;
create policy voice_actor_reactions_update on public.voice_actor_reactions for update using (
  (select auth.uid())::text = user_id
);
drop policy if exists voice_actor_reactions_delete on public.voice_actor_reactions;
create policy voice_actor_reactions_delete on public.voice_actor_reactions for delete using (
  (select auth.uid())::text = user_id
);

drop policy if exists voice_actor_tags_select on public.voice_actor_tags;
create policy voice_actor_tags_select on public.voice_actor_tags for select using (true);
drop policy if exists voice_actor_tags_insert on public.voice_actor_tags;
create policy voice_actor_tags_insert on public.voice_actor_tags for insert to authenticated with check (
  added_by = (select auth.uid())::text
);
drop policy if exists voice_actor_tags_delete on public.voice_actor_tags;
create policy voice_actor_tags_delete on public.voice_actor_tags for delete to authenticated using (
  added_by = (select auth.uid())::text
  or check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists character_voice_actors_select on public.character_voice_actors;
create policy character_voice_actors_select on public.character_voice_actors for select using (true);
drop policy if exists character_voice_actors_insert_admin on public.character_voice_actors;
create policy character_voice_actors_insert_admin on public.character_voice_actors for insert with check (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists character_voice_actors_update_admin on public.character_voice_actors;
create policy character_voice_actors_update_admin on public.character_voice_actors for update using (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists character_voice_actors_delete_admin on public.character_voice_actors;
create policy character_voice_actors_delete_admin on public.character_voice_actors for delete using (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists manga_relations_select on public.manga_relations;
create policy manga_relations_select on public.manga_relations for select using (true);
drop policy if exists manga_relations_insert_admin on public.manga_relations;
create policy manga_relations_insert_admin on public.manga_relations for insert with check (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists manga_relations_update_admin on public.manga_relations;
create policy manga_relations_update_admin on public.manga_relations for update using (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);
drop policy if exists manga_relations_delete_admin on public.manga_relations;
create policy manga_relations_delete_admin on public.manga_relations for delete using (
  check_user_role((select auth.uid())::text, array['admin'::text, 'moderator'::text])
);

drop policy if exists mfa_opt_in_enforcement on public.voice_actors;
create policy mfa_opt_in_enforcement on public.voice_actors as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);

drop policy if exists mfa_opt_in_enforcement on public.voice_actor_likes;
create policy mfa_opt_in_enforcement on public.voice_actor_likes as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);

drop policy if exists mfa_opt_in_enforcement on public.voice_actor_comments;
create policy mfa_opt_in_enforcement on public.voice_actor_comments as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);

drop policy if exists mfa_opt_in_enforcement on public.voice_actor_comment_likes;
create policy mfa_opt_in_enforcement on public.voice_actor_comment_likes as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);

drop policy if exists mfa_opt_in_enforcement on public.voice_actor_reactions;
create policy mfa_opt_in_enforcement on public.voice_actor_reactions as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);

drop policy if exists mfa_opt_in_enforcement on public.voice_actor_tags;
create policy mfa_opt_in_enforcement on public.voice_actor_tags as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);

drop policy if exists mfa_opt_in_enforcement on public.character_voice_actors;
create policy mfa_opt_in_enforcement on public.character_voice_actors as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);

drop policy if exists mfa_opt_in_enforcement on public.manga_relations;
create policy mfa_opt_in_enforcement on public.manga_relations as restrictive for all to authenticated using (
  (select current_session_satisfies_mfa_requirement())
) with check (
  (select current_session_satisfies_mfa_requirement())
);
