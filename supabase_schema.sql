-- =============================================
-- ToonParrot / MangaVerse Database Schema
-- Supabase PostgreSQL
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar TEXT,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view all users" ON public.users
    FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid()::text = id::text);

-- =============================================
-- MANGAS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.mangas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    author VARCHAR(100) NOT NULL,
    artist VARCHAR(100),
    description TEXT NOT NULL,
    cover TEXT NOT NULL,
    banner TEXT,
    genres TEXT[] DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed', 'hiatus')),
    type VARCHAR(20) DEFAULT 'manga' CHECK (type IN ('manga', 'manhwa', 'manhua')),
    views INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.mangas ENABLE ROW LEVEL SECURITY;

-- Manga policies (everyone can read, only admins can modify)
CREATE POLICY "Anyone can view mangas" ON public.mangas
    FOR SELECT USING (true);

CREATE POLICY "Admins can insert mangas" ON public.mangas
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE id::text = auth.uid()::text AND role IN ('admin', 'moderator'))
    );

CREATE POLICY "Admins can update mangas" ON public.mangas
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id::text = auth.uid()::text AND role IN ('admin', 'moderator'))
    );

CREATE POLICY "Admins can delete mangas" ON public.mangas
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id::text = auth.uid()::text AND role = 'admin')
    );

-- =============================================
-- CHAPTERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.chapters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manga_id UUID NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
    number DECIMAL(10,2) NOT NULL,
    title VARCHAR(255),
    pages TEXT[] DEFAULT '{}',
    views INTEGER DEFAULT 0,
    release_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;

-- Chapter policies
CREATE POLICY "Anyone can view chapters" ON public.chapters
    FOR SELECT USING (true);

CREATE POLICY "Admins can insert chapters" ON public.chapters
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE id::text = auth.uid()::text AND role IN ('admin', 'moderator'))
    );

CREATE POLICY "Admins can update chapters" ON public.chapters
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id::text = auth.uid()::text AND role IN ('admin', 'moderator'))
    );

CREATE POLICY "Admins can delete chapters" ON public.chapters
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id::text = auth.uid()::text AND role = 'admin')
    );

-- =============================================
-- RATINGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manga_id UUID NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(manga_id, user_id)
);

-- Enable RLS
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- Rating policies
CREATE POLICY "Anyone can view ratings" ON public.ratings
    FOR SELECT USING (true);

CREATE POLICY "Logged in users can rate" ON public.ratings
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own rating" ON public.ratings
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete own rating" ON public.ratings
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- =============================================
-- COMMENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manga_id UUID NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
    chapter_id UUID REFERENCES public.chapters(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    gif_url TEXT,
    parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Comment policies
CREATE POLICY "Anyone can view comments" ON public.comments
    FOR SELECT USING (true);

CREATE POLICY "Logged in users can comment" ON public.comments
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own comments" ON public.comments
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete own comments or admins" ON public.comments
    FOR DELETE USING (
        auth.uid()::text = user_id::text OR
        EXISTS (SELECT 1 FROM public.users WHERE id::text = auth.uid()::text AND role IN ('admin', 'moderator'))
    );

-- =============================================
-- COMMENT LIKES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.comment_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(comment_id, user_id)
);

-- Enable RLS
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

-- Comment likes policies
CREATE POLICY "Anyone can view comment likes" ON public.comment_likes
    FOR SELECT USING (true);

CREATE POLICY "Logged in users can like" ON public.comment_likes
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can unlike" ON public.comment_likes
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- =============================================
-- FAVORITES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id UUID NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
    category VARCHAR(20) DEFAULT 'reading' CHECK (category IN ('reading', 'completed', 'plan_to_read', 'on_hold', 'dropped')),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, manga_id)
);

-- Enable RLS
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Favorites policies
CREATE POLICY "Users can view own favorites" ON public.favorites
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can add favorites" ON public.favorites
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own favorites" ON public.favorites
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete own favorites" ON public.favorites
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- =============================================
-- READING PROGRESS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.reading_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id UUID NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
    page INTEGER DEFAULT 1,
    last_read TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, manga_id)
);

-- Enable RLS
ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;

-- Reading progress policies
CREATE POLICY "Users can view own progress" ON public.reading_progress
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert progress" ON public.reading_progress
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own progress" ON public.reading_progress
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete own progress" ON public.reading_progress
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- =============================================
-- BOOKMARKS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.bookmarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id UUID NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

-- Bookmarks policies
CREATE POLICY "Users can view own bookmarks" ON public.bookmarks
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can add bookmarks" ON public.bookmarks
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own bookmarks" ON public.bookmarks
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete own bookmarks" ON public.bookmarks
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- =============================================
-- FOLLOWS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.follows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id UUID NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
    followed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, manga_id)
);

-- Enable RLS
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- Follows policies
CREATE POLICY "Users can view own follows" ON public.follows
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can follow" ON public.follows
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can unfollow" ON public.follows
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- =============================================
-- NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    read BOOLEAN DEFAULT FALSE,
    manga_id UUID REFERENCES public.mangas(id) ON DELETE CASCADE,
    chapter_id UUID REFERENCES public.chapters(id) ON DELETE CASCADE,
    from_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Notifications policies
CREATE POLICY "Users can view own notifications" ON public.notifications
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "System can create notifications" ON public.notifications
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own notifications" ON public.notifications
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete own notifications" ON public.notifications
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- =============================================
-- ADMIN USERS TABLE (Separate from regular users)
-- =============================================
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'admin' CHECK (role IN ('admin', 'moderator')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Admin can only be accessed by other admins
CREATE POLICY "Admins can view admin users" ON public.admin_users
    FOR SELECT USING (true);

-- Insert default admin (password: admin123)
INSERT INTO public.admin_users (username, email, password, role)
VALUES ('admin', 'admin@mangaverse.com', 'admin123', 'admin')
ON CONFLICT (username) DO NOTHING;

-- =============================================
-- INDEXES for better performance
-- =============================================
CREATE INDEX IF NOT EXISTS idx_chapters_manga_id ON public.chapters(manga_id);
CREATE INDEX IF NOT EXISTS idx_comments_manga_id ON public.comments(manga_id);
CREATE INDEX IF NOT EXISTS idx_comments_chapter_id ON public.comments(chapter_id);
CREATE INDEX IF NOT EXISTS idx_ratings_manga_id ON public.ratings(manga_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_user_id ON public.reading_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON public.bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_user_id ON public.follows(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_mangas_title ON public.mangas(title);
CREATE INDEX IF NOT EXISTS idx_mangas_genres ON public.mangas USING GIN(genres);

-- =============================================
-- FUNCTIONS for updating timestamps
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for comments updated_at
CREATE TRIGGER update_comments_updated_at
    BEFORE UPDATE ON public.comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for mangas last_updated
CREATE OR REPLACE FUNCTION update_manga_last_updated()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.mangas SET last_updated = NOW() WHERE id = NEW.manga_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_manga_on_chapter_insert
    AFTER INSERT ON public.chapters
    FOR EACH ROW
    EXECUTE FUNCTION update_manga_last_updated();

-- =============================================
-- SUCCESS MESSAGE
-- =============================================
DO $$
BEGIN
    RAISE NOTICE 'Database schema created successfully!';
END $$;
