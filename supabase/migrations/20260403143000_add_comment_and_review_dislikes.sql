create table if not exists public.review_dislikes (
  review_id uuid not null references public.reviews(id) on delete cascade,
  user_id text not null,
  primary key (review_id, user_id)
);

create table if not exists public.comment_dislikes (
  id text primary key default uuid_generate_v4(),
  comment_id text not null references public.comments(id) on delete cascade,
  user_id text not null,
  created_at timestamptz default now(),
  unique (comment_id, user_id)
);

create table if not exists public.character_comment_dislikes (
  id uuid primary key default uuid_generate_v4(),
  comment_id uuid not null references public.character_comments(id) on delete cascade,
  user_id text not null,
  created_at timestamptz default now(),
  unique (comment_id, user_id)
);

create table if not exists public.author_comment_dislikes (
  id uuid primary key default uuid_generate_v4(),
  comment_id uuid not null references public.author_comments(id) on delete cascade,
  user_id text not null,
  created_at timestamptz default now(),
  unique (comment_id, user_id)
);

create table if not exists public.artist_comment_dislikes (
  id uuid primary key default uuid_generate_v4(),
  comment_id uuid not null references public.artist_comments(id) on delete cascade,
  user_id text not null,
  created_at timestamptz default now(),
  unique (comment_id, user_id)
);

create index if not exists idx_review_dislikes_user_id on public.review_dislikes (user_id);
create index if not exists idx_comment_dislikes_user_id on public.comment_dislikes (user_id);
create index if not exists idx_character_comment_dislikes_user_id on public.character_comment_dislikes (user_id);
create index if not exists idx_author_comment_dislikes_user_id on public.author_comment_dislikes (user_id);
create index if not exists idx_artist_comment_dislikes_user_id on public.artist_comment_dislikes (user_id);

alter table public.review_dislikes enable row level security;
alter table public.comment_dislikes enable row level security;
alter table public.character_comment_dislikes enable row level security;
alter table public.author_comment_dislikes enable row level security;
alter table public.artist_comment_dislikes enable row level security;

drop policy if exists review_dislikes_select on public.review_dislikes;
create policy review_dislikes_select on public.review_dislikes for select using (true);
drop policy if exists review_dislikes_insert on public.review_dislikes;
create policy review_dislikes_insert on public.review_dislikes for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists review_dislikes_delete on public.review_dislikes;
create policy review_dislikes_delete on public.review_dislikes for delete using (
  (select auth.uid())::text = user_id
);

drop policy if exists comment_dislikes_select on public.comment_dislikes;
create policy comment_dislikes_select on public.comment_dislikes for select using (true);
drop policy if exists comment_dislikes_insert on public.comment_dislikes;
create policy comment_dislikes_insert on public.comment_dislikes for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists comment_dislikes_delete on public.comment_dislikes;
create policy comment_dislikes_delete on public.comment_dislikes for delete using (
  (select auth.uid())::text = user_id
);

drop policy if exists character_comment_dislikes_select on public.character_comment_dislikes;
create policy character_comment_dislikes_select on public.character_comment_dislikes for select using (true);
drop policy if exists character_comment_dislikes_insert on public.character_comment_dislikes;
create policy character_comment_dislikes_insert on public.character_comment_dislikes for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists character_comment_dislikes_delete on public.character_comment_dislikes;
create policy character_comment_dislikes_delete on public.character_comment_dislikes for delete using (
  (select auth.uid())::text = user_id
);

drop policy if exists author_comment_dislikes_select on public.author_comment_dislikes;
create policy author_comment_dislikes_select on public.author_comment_dislikes for select using (true);
drop policy if exists author_comment_dislikes_insert on public.author_comment_dislikes;
create policy author_comment_dislikes_insert on public.author_comment_dislikes for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists author_comment_dislikes_delete on public.author_comment_dislikes;
create policy author_comment_dislikes_delete on public.author_comment_dislikes for delete using (
  (select auth.uid())::text = user_id
);

drop policy if exists artist_comment_dislikes_select on public.artist_comment_dislikes;
create policy artist_comment_dislikes_select on public.artist_comment_dislikes for select using (true);
drop policy if exists artist_comment_dislikes_insert on public.artist_comment_dislikes;
create policy artist_comment_dislikes_insert on public.artist_comment_dislikes for insert with check (
  (select auth.uid())::text = user_id
);
drop policy if exists artist_comment_dislikes_delete on public.artist_comment_dislikes;
create policy artist_comment_dislikes_delete on public.artist_comment_dislikes for delete using (
  (select auth.uid())::text = user_id
);
