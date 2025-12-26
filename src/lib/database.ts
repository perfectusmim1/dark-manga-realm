// Supabase Database Integration
// Fully asynchronous operations replacing localStorage
import { supabase } from './supabase';
import { Manga, Chapter, User, MangaRating, Comment } from './types';

// ==================== MANGA OPERATIONS ====================

/**
 * Fetch all mangas from Supabase
 */
export const getAllMangas = async (): Promise<Manga[]> => {
    // Add a safety timeout
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Manga fetch timeout')), 8000)
    );

    try {
        const fetchManga = async () => {
            const { data, error } = await supabase
                .from('mangas')
                .select('*')
                .order('last_updated', { ascending: false });

            if (error) throw error;

            // Try to get chapter counts and ratings in bulk, but don't fail if they fail
            let chapterCounts: any[] = [];
            let allRatings: any[] = [];

            try {
                const { data: cData } = await supabase.from('chapters').select('manga_id');
                chapterCounts = cData || [];
                const { data: rData } = await supabase.from('ratings').select('manga_id, rating');
                allRatings = rData || [];
            } catch (innerErr) {
                console.warn('Non-critical bulk fetch error:', innerErr);
            }

            return data.map((m) => {
                const mangaChapters = chapterCounts.filter(c => c.manga_id === m.id);
                const mangaRatings = allRatings.filter(r => r.manga_id === m.id);

                return {
                    ...m,
                    alternativeTitles: m.alternative_titles || [],
                    lastUpdated: m.last_updated,
                    createdAt: m.created_at,
                    releaseYear: m.release_year,
                    chapters: Array(mangaChapters.length).fill({}),
                    ratings: mangaRatings.map(r => ({ rating: r.rating, userId: '', createdAt: '' })),
                } as Manga;
            });
        };

        return (await Promise.race([fetchManga(), timeout])) as Manga[];
    } catch (error) {
        console.error('Manga fetch global error:', error);
        return [];
    }
};

/**
 * Get a single manga by ID with all its chapters
 */
export const getMangaById = async (mangaId: string): Promise<Manga | undefined> => {
    const { data, error } = await supabase
        .from('mangas')
        .select(`
            *,
            chapters (*)
        `)
        .eq('id', mangaId)
        .maybeSingle();

    if (error || !data) {
        if (error && error.code !== 'PGRST116') console.error('Manga detail fetch error:', error);
        return undefined;
    }

    const { data: ratingData } = await supabase
        .from('ratings')
        .select('*')
        .eq('manga_id', mangaId);

    return {
        ...data,
        alternativeTitles: data.alternative_titles || [],
        lastUpdated: data.last_updated,
        createdAt: data.created_at,
        releaseYear: data.release_year,
        chapters: (data.chapters || []).sort((a: any, b: any) => b.number - a.number).map((c: any) => ({
            ...c,
            releaseDate: c.release_date
        })),
        ratings: ratingData?.map(r => ({
            userId: r.user_id,
            rating: r.rating,
            createdAt: r.created_at
        })) || [],
    } as Manga;
};

/**
 * Save or update a manga
 */
export const saveManga = async (manga: Manga): Promise<void> => {
    const mangaData = {
        id: manga.id,
        title: manga.title,
        author: manga.author,
        artist: manga.artist,
        description: manga.description,
        cover: manga.cover,
        banner: manga.banner,
        genres: manga.genres,
        status: manga.status,
        type: manga.type,
        views: manga.views || 0,
        release_year: manga.releaseYear,
        alternative_titles: manga.alternativeTitles || [],
        last_updated: new Date().toISOString(),
        created_at: manga.createdAt || new Date().toISOString(),
    };

    const { error } = await supabase
        .from('mangas')
        .upsert(mangaData);

    if (error) throw error;

    // Sync chapters as well
    if (manga.chapters && manga.chapters.length > 0) {
        const chaptersData = manga.chapters.map(c => ({
            id: c.id,
            manga_id: manga.id,
            number: c.number,
            title: c.title,
            pages: c.pages,
            views: c.views || 0,
            release_date: c.releaseDate,
        }));

        const { error: chError } = await supabase
            .from('chapters')
            .upsert(chaptersData);

        if (chError) console.error('Chapter sync error:', chError);
    }
};

/**
 * Delete a manga and its related data
 */
export const deleteManga = async (mangaId: string): Promise<void> => {
    const { error } = await supabase
        .from('mangas')
        .delete()
        .eq('id', mangaId);

    if (error) throw error;
};

// ==================== CHAPTER OPERATIONS ====================

export const addChapterToManga = async (mangaId: string, chapter: Chapter): Promise<boolean> => {
    const chapterData = {
        id: chapter.id,
        manga_id: mangaId,
        number: chapter.number,
        title: chapter.title,
        pages: chapter.pages,
        views: chapter.views || 0,
        release_date: chapter.releaseDate,
    };

    const { error } = await supabase
        .from('chapters')
        .insert(chapterData);

    if (error) {
        console.error('Add chapter error:', error);
        return false;
    }

    // Update manga last_updated
    await supabase.from('mangas').update({ last_updated: new Date().toISOString() }).eq('id', mangaId);
    return true;
};

export const deleteChapter = async (mangaId: string, chapterId: string): Promise<boolean> => {
    const { error } = await supabase
        .from('chapters')
        .delete()
        .eq('id', chapterId)
        .eq('manga_id', mangaId);

    return !error;
};

// ==================== RATING OPERATIONS ====================

export const rateManga = async (mangaId: string, userId: string, rating: number): Promise<boolean> => {
    const { error } = await supabase
        .from('ratings')
        .upsert({
            manga_id: mangaId,
            user_id: userId,
            rating,
            created_at: new Date().toISOString()
        }, { onConflict: 'manga_id,user_id' });

    return !error;
};

export const getUserRating = async (mangaId: string, userId: string): Promise<number | undefined> => {
    const { data, error } = await supabase
        .from('ratings')
        .select('rating')
        .eq('manga_id', mangaId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error || !data) return undefined;
    return data.rating;
};

export const getAverageRating = async (mangaId: string): Promise<{ average: number; count: number }> => {
    const { data, error } = await supabase
        .from('ratings')
        .select('rating')
        .eq('manga_id', mangaId);

    if (error || !data || data.length === 0) return { average: 0, count: 0 };

    const total = data.reduce((sum, r) => sum + r.rating, 0);
    return {
        average: Math.round((total / data.length) * 10) / 10,
        count: data.length
    };
};

// ==================== VIEW TRACKING ====================

export const incrementMangaViews = async (mangaId: string): Promise<void> => {
    // In Supabase, we use an RPC to increment safely
    await supabase.rpc('increment_manga_views', { manga_id_param: mangaId });
};

export const incrementChapterViews = async (mangaId: string, chapterId: string): Promise<void> => {
    await supabase.rpc('increment_chapter_views', { chapter_id_param: chapterId });
};

// ==================== SEARCH OPERATIONS ====================

export const searchMangas = async (query: string): Promise<Manga[]> => {
    const { data, error } = await supabase
        .from('mangas')
        .select('*')
        .or(`title.ilike.%${query}%,author.ilike.%${query}%`);

    if (error) return [];
    return data.map(m => ({
        ...m,
        alternativeTitles: m.alternative_titles || [],
        releaseYear: m.release_year,
        lastUpdated: m.last_updated,
        createdAt: m.created_at
    })) as Manga[];
};

// ==================== USER OPERATIONS ====================

export const getAllUsers = async (): Promise<User[]> => {
    const { data, error } = await supabase.from('users').select('*');
    if (error) return [];
    return data.map(u => ({
        ...u,
        createdAt: u.created_at,
        avatar: u.avatar
    })) as User[];
};

export const saveUser = async (user: User): Promise<void> => {
    const { error } = await supabase.from('users').upsert({
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        created_at: user.createdAt
    });
    if (error) throw error;
};

export const deleteUser = async (userId: string): Promise<void> => {
    // Note: This only deletes from public.users. Deleting from auth.users requires service role key in Edge Functions
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) throw error;
};

// Admin Management
export type AdminUser = User; // Reuse User type for now

export const getAdminUsers = async (): Promise<AdminUser[]> => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .in('role', ['admin', 'moderator']);
    if (error) return [];

    return data.map(u => ({
        ...u,
        createdAt: u.created_at,
        avatar: u.avatar
    })) as AdminUser[];
};

export const addAdminUser = async (admin: any): Promise<void> => {
    // This is complex because we need to create an auth user.
    // For now, we'll just throw or log, as ID generation happens on auth signup.
    // In a real app, you would use an Edge Function to create an admin user.
    console.warn('Adding admin via direct DB insert is not fully supported without Auth sync.');
    // Mock implementation for UI stability if needed or just insert to public users
};

export const deleteAdminUser = async (adminId: string): Promise<void> => {
    await deleteUser(adminId);
};

export const authenticateAdmin = async (email: string, password: string): Promise<User | null> => {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (authError || !authData.user) return null;

    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authData.user.id)
        .in('role', ['admin', 'moderator'])
        .single();

    if (userError || !userData) return null;

    return {
        ...userData,
        createdAt: userData.created_at,
        avatar: userData.avatar
    } as User;
};

// ==================== STATISTICS ====================

export const getStatistics = async () => {
    const { count: mangaCount } = await supabase.from('mangas').select('*', { count: 'exact', head: true });
    const { count: chapterCount } = await supabase.from('chapters').select('*', { count: 'exact', head: true });
    const { count: commentCount } = await supabase.from('comments').select('*', { count: 'exact', head: true });
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });

    const { data: mangaData } = await supabase.from('mangas').select('type, status, views');

    const totalViews = mangaData?.reduce((sum, m) => sum + (m.views || 0), 0) || 0;

    const mangasByType = {
        manga: mangaData?.filter(m => m.type === 'manga').length || 0,
        manhwa: mangaData?.filter(m => m.type === 'manhwa').length || 0,
        manhua: mangaData?.filter(m => m.type === 'manhua').length || 0,
    };

    const mangasByStatus = {
        ongoing: mangaData?.filter(m => m.status === 'ongoing').length || 0,
        completed: mangaData?.filter(m => m.status === 'completed').length || 0,
        hiatus: mangaData?.filter(m => m.status === 'hiatus').length || 0,
    };

    return {
        totalMangas: mangaCount || 0,
        totalChapters: chapterCount || 0,
        totalViews,
        totalComments: commentCount || 0,
        totalUsers: userCount || 0,
        mangasByType,
        mangasByStatus,
    };
};

// ==================== COMMENT OPERATIONS ====================

export const getCommentsForManga = async (mangaId: string, chapterId?: string): Promise<Comment[]> => {
    let query = supabase
        .from('comments')
        .select(`
            *,
            likes_count:comment_likes(count)
        `)
        .eq('manga_id', mangaId);

    if (chapterId) {
        query = query.eq('chapter_id', chapterId);
    } else {
        query = query.is('chapter_id', null);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) return [];

    // Get current user's likes if authenticated
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    let userLikes: string[] = [];
    if (userId) {
        const { data: likes } = await supabase
            .from('comment_likes')
            .select('comment_id')
            .eq('user_id', userId);
        userLikes = likes?.map(l => l.comment_id) || [];
    }

    return data.map(c => ({
        id: c.id,
        mangaId: c.manga_id,
        chapterId: c.chapter_id,
        userId: c.user_id,
        username: c.username,
        userAvatar: c.user_avatar,
        content: c.content,
        gifUrl: c.gif_url,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        parentId: c.parent_id,
        likes: c.likes_count[0]?.count || 0,
        likedBy: userLikes.includes(c.id) ? [userId] : [], // Simplified for local UI sync
    })) as Comment[];
};

export const addComment = async (comment: Omit<Comment, 'id' | 'likes' | 'likedBy' | 'createdAt' | 'updatedAt'>): Promise<Comment> => {
    const { data, error } = await supabase
        .from('comments')
        .insert({
            manga_id: comment.mangaId,
            chapter_id: comment.chapterId,
            user_id: comment.userId,
            username: comment.username,
            user_avatar: comment.userAvatar,
            content: comment.content,
            gif_url: comment.gifUrl,
            parent_id: comment.parentId
        })
        .select()
        .single();

    if (error) throw error;
    return {
        ...data,
        mangaId: data.manga_id,
        chapterId: data.chapter_id,
        userId: data.user_id,
        username: data.username,
        userAvatar: data.user_avatar,
        createdAt: data.created_at,
        parentId: data.parent_id,
        likes: 0,
        likedBy: []
    } as Comment;
};

export const updateComment = async (id: string, content: string, gifUrl?: string): Promise<void> => {
    await supabase.from('comments').update({
        content,
        gif_url: gifUrl,
        updated_at: new Date().toISOString()
    }).eq('id', id);
};

export const deleteComment = async (id: string): Promise<void> => {
    const { error } = await supabase.from('comments').delete().eq('id', id);
    if (error) {
        console.error('Yorum silme hatası:', error);
        throw error;
    }
};

export const getAllComments = async (): Promise<Comment[]> => {
    const { data, error } = await supabase
        .from('comments')
        .select(`
            *,
            likes_count:comment_likes(count)
        `)
        .order('created_at', { ascending: false });

    if (error) return [];

    return data.map(c => ({
        id: c.id,
        mangaId: c.manga_id,
        chapterId: c.chapter_id,
        userId: c.user_id,
        username: c.username,
        userAvatar: c.user_avatar,
        content: c.content,
        gif_url: c.gif_url,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        parentId: c.parent_id,
        likes: c.likes_count[0]?.count || 0,
        likedBy: [],
    })) as Comment[];
};

export const toggleCommentLike = async (commentId: string, userId: string): Promise<void> => {
    const { data: existing } = await supabase
        .from('comment_likes')
        .select('*')
        .eq('comment_id', commentId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', userId);
    } else {
        await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId });
    }
};

// Migration Helper (Still needed for the button)
export const syncAllToSupabase = async (): Promise<{ success: number; total: number }> => {
    const localMangasStr = localStorage.getItem('db_mangas');
    if (!localMangasStr) return { success: 0, total: 0 };

    const mangas: Manga[] = JSON.parse(localMangasStr);
    let successCount = 0;

    for (const manga of mangas) {
        try {
            await saveManga(manga);
            successCount++;
        } catch (err) {
            console.error(`Sync failed for ${manga.title}:`, err);
        }
    }

    return { success: successCount, total: mangas.length };
};

// Legacy stubs for Auth compatibility if needed temporarily
export const initializeDatabase = () => { };
