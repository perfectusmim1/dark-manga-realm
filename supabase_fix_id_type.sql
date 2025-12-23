-- =============================================
-- FIX: Change mangas.id and chapters.id to TEXT type
-- This allows custom IDs like "manga-123-abc" instead of UUIDs
-- Run this in Supabase SQL Editor
-- =============================================

-- First, drop foreign key constraints on chapters
ALTER TABLE public.chapters DROP CONSTRAINT IF EXISTS chapters_manga_id_fkey;

-- Change mangas.id from UUID to TEXT
ALTER TABLE public.mangas ALTER COLUMN id TYPE text USING id::text;

-- Change chapters.id from UUID to TEXT  
ALTER TABLE public.chapters ALTER COLUMN id TYPE text USING id::text;

-- Change chapters.manga_id from UUID to TEXT
ALTER TABLE public.chapters ALTER COLUMN manga_id TYPE text USING manga_id::text;

-- Re-add foreign key constraint
ALTER TABLE public.chapters 
ADD CONSTRAINT chapters_manga_id_fkey 
FOREIGN KEY (manga_id) REFERENCES public.mangas(id) ON DELETE CASCADE;

-- Also update users.id to TEXT for custom user IDs
ALTER TABLE public.users ALTER COLUMN id TYPE text USING id::text;

-- Verify the changes
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('mangas', 'chapters', 'users') AND column_name = 'id'
ORDER BY table_name;
