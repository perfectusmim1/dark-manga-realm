alter table public.mangas
    add column if not exists is_public boolean not null default true;

create index if not exists idx_mangas_public_last_updated
    on public.mangas (is_public, last_updated desc);

create index if not exists idx_mangas_public_created_at
    on public.mangas (is_public, created_at desc);
