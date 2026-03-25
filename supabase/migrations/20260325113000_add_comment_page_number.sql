alter table public.comments
    add column if not exists page_number integer;

alter table public.comments
    drop constraint if exists comments_page_number_check;

alter table public.comments
    add constraint comments_page_number_check
    check (page_number is null or page_number > 0);

create index if not exists idx_comments_chapter_page_pinned_created
    on public.comments (manga_id, chapter_id, page_number, is_pinned desc, created_at desc);
