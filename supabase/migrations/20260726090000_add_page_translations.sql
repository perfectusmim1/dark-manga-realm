create table if not exists public.page_translations (
    chapter_id text not null references public.chapters (id) on delete cascade,
    page_index integer not null,
    lang text not null,
    blocks jsonb not null,
    created_by text default (auth.uid()::text),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint page_translations_pkey primary key (chapter_id, page_index, lang),
    constraint page_translations_page_index_check check (page_index >= 0),
    constraint page_translations_lang_check check (char_length(lang) between 2 and 12),
    constraint page_translations_blocks_check check (jsonb_typeof(blocks) = 'array')
);

create index if not exists idx_page_translations_chapter_lang
    on public.page_translations (chapter_id, lang);

alter table public.page_translations enable row level security;

drop policy if exists "Anyone can view page translations" on public.page_translations;
create policy "Anyone can view page translations"
    on public.page_translations
    for select
    to anon, authenticated
    using (true);

drop policy if exists "Authenticated users can insert page translations" on public.page_translations;
create policy "Authenticated users can insert page translations"
    on public.page_translations
    for insert
    to authenticated
    with check (auth.uid() is not null);

drop policy if exists "Authenticated users can update page translations" on public.page_translations;
create policy "Authenticated users can update page translations"
    on public.page_translations
    for update
    to authenticated
    using (auth.uid() is not null)
    with check (auth.uid() is not null);
