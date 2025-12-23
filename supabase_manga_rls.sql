-- =============================================
-- MANGA TABLE RLS POLICIES - Allow public insert/update
-- Run this in Supabase SQL Editor
-- =============================================

-- Enable RLS on mangas table (if not already enabled)
ALTER TABLE public.mangas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public read mangas" ON public.mangas;
DROP POLICY IF EXISTS "Allow authenticated insert mangas" ON public.mangas;
DROP POLICY IF EXISTS "Allow authenticated update mangas" ON public.mangas;
DROP POLICY IF EXISTS "Allow authenticated delete mangas" ON public.mangas;

DROP POLICY IF EXISTS "Allow public read chapters" ON public.chapters;
DROP POLICY IF EXISTS "Allow authenticated insert chapters" ON public.chapters;
DROP POLICY IF EXISTS "Allow authenticated update chapters" ON public.chapters;
DROP POLICY IF EXISTS "Allow authenticated delete chapters" ON public.chapters;

-- MANGAS POLICIES

-- Everyone can read mangas
CREATE POLICY "Allow public read mangas" ON public.mangas
    FOR SELECT 
    USING (true);

-- Authenticated users can insert (for now - later we can restrict to admins)
CREATE POLICY "Allow authenticated insert mangas" ON public.mangas
    FOR INSERT 
    WITH CHECK (true);

-- Authenticated users can update
CREATE POLICY "Allow authenticated update mangas" ON public.mangas
    FOR UPDATE 
    USING (true)
    WITH CHECK (true);

-- Authenticated users can delete
CREATE POLICY "Allow authenticated delete mangas" ON public.mangas
    FOR DELETE 
    USING (true);

-- CHAPTERS POLICIES

-- Everyone can read chapters
CREATE POLICY "Allow public read chapters" ON public.chapters
    FOR SELECT 
    USING (true);

-- Anyone can insert chapters (for sync)
CREATE POLICY "Allow authenticated insert chapters" ON public.chapters
    FOR INSERT 
    WITH CHECK (true);

-- Anyone can update chapters
CREATE POLICY "Allow authenticated update chapters" ON public.chapters
    FOR UPDATE 
    USING (true)
    WITH CHECK (true);

-- Anyone can delete chapters
CREATE POLICY "Allow authenticated delete chapters" ON public.chapters
    FOR DELETE 
    USING (true);

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('mangas', 'chapters');
