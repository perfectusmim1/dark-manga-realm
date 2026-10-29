-- Migration: 20261029193500_decouple_catalog_and_clean_manga_data.sql
-- Description: Decouple manga catalog from user interaction tables (R2 Hybrid Architecture) and clean legacy catalog/interaction data.

-- 1. Drop Foreign Key constraints from user interaction tables referencing mangas, chapters, characters, authors, artists, and tags
ALTER TABLE IF EXISTS public.bookmarks DROP CONSTRAINT IF EXISTS bookmarks_manga_id_fkey;
ALTER TABLE IF EXISTS public.chapter_read_progress DROP CONSTRAINT IF EXISTS chapter_read_progress_manga_id_fkey;
ALTER TABLE IF EXISTS public.chapter_read_progress DROP CONSTRAINT IF EXISTS chapter_read_progress_chapter_id_fkey;
ALTER TABLE IF EXISTS public.comments DROP CONSTRAINT IF EXISTS comments_manga_id_fkey;
ALTER TABLE IF EXISTS public.external_sync_state DROP CONSTRAINT IF EXISTS external_sync_state_manga_id_fkey;
ALTER TABLE IF EXISTS public.favorites DROP CONSTRAINT IF EXISTS favorites_manga_id_fkey;
ALTER TABLE IF EXISTS public.follows DROP CONSTRAINT IF EXISTS follows_manga_id_fkey;
ALTER TABLE IF EXISTS public.manga_reactions DROP CONSTRAINT IF EXISTS manga_reactions_manga_id_fkey;
ALTER TABLE IF EXISTS public.manga_reports DROP CONSTRAINT IF EXISTS manga_reports_manga_id_fkey;
ALTER TABLE IF EXISTS public.ratings DROP CONSTRAINT IF EXISTS ratings_manga_id_fkey;
ALTER TABLE IF EXISTS public.reading_activity_log DROP CONSTRAINT IF EXISTS reading_activity_log_manga_id_fkey;
ALTER TABLE IF EXISTS public.reading_activity_log DROP CONSTRAINT IF EXISTS reading_activity_log_chapter_id_fkey;
ALTER TABLE IF EXISTS public.reading_list_items DROP CONSTRAINT IF EXISTS reading_list_items_manga_id_fkey;
ALTER TABLE IF EXISTS public.reading_progress DROP CONSTRAINT IF EXISTS reading_progress_manga_id_fkey;
ALTER TABLE IF EXISTS public.reviews DROP CONSTRAINT IF EXISTS reviews_manga_id_fkey;

-- Character / Author / Artist / Tag interaction Foreign Keys
ALTER TABLE IF EXISTS public.artist_comments DROP CONSTRAINT IF EXISTS artist_comments_artist_id_fkey;
ALTER TABLE IF EXISTS public.artist_likes DROP CONSTRAINT IF EXISTS artist_likes_artist_id_fkey;
ALTER TABLE IF EXISTS public.artist_reactions DROP CONSTRAINT IF EXISTS artist_reactions_artist_id_fkey;
ALTER TABLE IF EXISTS public.author_comments DROP CONSTRAINT IF EXISTS author_comments_author_id_fkey;
ALTER TABLE IF EXISTS public.author_likes DROP CONSTRAINT IF EXISTS author_likes_author_id_fkey;
ALTER TABLE IF EXISTS public.author_reactions DROP CONSTRAINT IF EXISTS author_reactions_author_id_fkey;
ALTER TABLE IF EXISTS public.character_comments DROP CONSTRAINT IF EXISTS character_comments_character_id_fkey;
ALTER TABLE IF EXISTS public.character_likes DROP CONSTRAINT IF EXISTS character_likes_character_id_fkey;
ALTER TABLE IF EXISTS public.character_reactions DROP CONSTRAINT IF EXISTS character_reactions_character_id_fkey;
ALTER TABLE IF EXISTS public.tag_votes DROP CONSTRAINT IF EXISTS tag_votes_tag_id_fkey;

-- 2. Truncate legacy test interaction data
TRUNCATE TABLE
    public.reading_progress,
    public.chapter_read_progress,
    public.reading_activity_log,
    public.favorites,
    public.bookmarks,
    public.follows,
    public.reading_list_items,
    public.ratings,
    public.review_likes,
    public.review_dislikes,
    public.review_reports,
    public.reviews,
    public.comment_likes,
    public.comment_dislikes,
    public.comment_reports,
    public.comments,
    public.manga_reactions,
    public.manga_reports,
    public.external_sync_state,
    public.character_comment_likes,
    public.character_comment_dislikes,
    public.character_comments,
    public.character_likes,
    public.character_reactions,
    public.author_comment_likes,
    public.author_comment_dislikes,
    public.author_comments,
    public.author_likes,
    public.author_reactions,
    public.artist_comment_likes,
    public.artist_comment_dislikes,
    public.artist_comments,
    public.artist_likes,
    public.artist_reactions,
    public.tag_votes
CASCADE;

-- 3. Truncate legacy catalog data (moved to Cloudflare R2 toonparrot-archive)
TRUNCATE TABLE
    public.chapter_automation_runs,
    public.chapter_automations,
    public.manga_characters,
    public.manga_authors,
    public.manga_artists,
    public.manga_relations,
    public.manga_tags,
    public.character_tags,
    public.author_tags,
    public.artist_tags,
    public.chapters,
    public.characters,
    public.authors,
    public.artists,
    public.tags,
    public.mangas
CASCADE;
