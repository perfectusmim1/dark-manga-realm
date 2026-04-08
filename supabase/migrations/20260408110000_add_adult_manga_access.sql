alter table public.mangas
    add column if not exists is_adult boolean not null default false;

create index if not exists idx_mangas_public_adult_last_updated
    on public.mangas (is_public, is_adult, last_updated desc);

create index if not exists idx_mangas_public_adult_created_at
    on public.mangas (is_public, is_adult, created_at desc);

create or replace function public.current_user_allows_adult_content()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (
            select coalesce((users.preferences -> 'content' ->> 'adult_mode')::boolean, false)
            from public.users as users
            where users.id = (select auth.uid())::text
            limit 1
        ),
        false
    );
$$;

revoke all on function public.current_user_allows_adult_content() from public;
grant execute on function public.current_user_allows_adult_content() to anon, authenticated, service_role;

create or replace function public.can_access_manga(target_manga_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
        from public.mangas as manga
        where manga.id = target_manga_id
          and (
              public.check_user_role(
                  (select auth.uid())::text,
                  array['admin', 'moderator']
              )
              or (
                  manga.is_public = true
                  and (
                      coalesce(manga.is_adult, false) = false
                      or public.current_user_allows_adult_content()
                  )
              )
          )
    );
$$;

revoke all on function public.can_access_manga(text) from public;
grant execute on function public.can_access_manga(text) to anon, authenticated, service_role;

alter policy mangas_select
    on public.mangas
    using (
        public.check_user_role(
            (select auth.uid())::text,
            array['admin', 'moderator']
        )
        or (
            is_public = true
            and (
                coalesce(is_adult, false) = false
                or public.current_user_allows_adult_content()
            )
        )
    );

alter policy chapters_select
    on public.chapters
    using (public.can_access_manga(manga_id));

alter policy manga_characters_select
    on public.manga_characters
    using (public.can_access_manga(manga_id));

alter policy manga_authors_select
    on public.manga_authors
    using (public.can_access_manga(manga_id));

alter policy manga_artists_select
    on public.manga_artists
    using (public.can_access_manga(manga_id));

alter policy manga_relations_select
    on public.manga_relations
    using (
        public.can_access_manga(manga_id)
        and public.can_access_manga(related_manga_id)
    );
