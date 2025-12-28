// Supabase Database Integration
// Fully asynchronous operations replacing localStorage
import { supabase } from './supabase';
import { Manga, Chapter, User, MangaRating, Comment, ReadingList, ReadingListItem, Review, MangaReaction } from './types';

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

            // Get all reviews to calculate averages
            const { data: revData } = await supabase.from('reviews').select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement');
            const allReviews = revData || [];

            // Get chapter counts and first chapters
            const { data: cData } = await supabase.from('chapters').select('id, manga_id, number').order('number', { ascending: true });
            const allChapters = cData || [];

            return data.map((m) => {
                const mangaChapters = allChapters.filter(c => c.manga_id === m.id);
                const mangaReviews = allReviews.filter(r => r.manga_id === m.id);

                let average = 0;
                if (mangaReviews.length > 0) {
                    const totalPoints = mangaReviews.reduce((sum, r) =>
                        sum + (r.rating_story + r.rating_characters + r.rating_art + r.rating_progression + r.rating_engagement) / 5
                        , 0);
                    average = Math.round((totalPoints / mangaReviews.length) * 10) / 10;
                }

                return {
                    ...m,
                    alternativeTitles: m.alternative_titles || [],
                    lastUpdated: m.last_updated,
                    createdAt: m.created_at,
                    releaseYear: m.release_year,
                    chapters: mangaChapters.map(c => ({ id: c.id, number: c.number })),
                    ratings: Array(mangaReviews.length).fill({ rating: average }), // Simplified for list view
                    averageRating: average,
                    reviewCount: mangaReviews.length
                } as any;
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

    const { data: reviewData } = await supabase
        .from('reviews')
        .select('*')
        .eq('manga_id', mangaId);

    const reviews = reviewData || [];
    let average = 0;
    if (reviews.length > 0) {
        const totalPoints = reviews.reduce((sum, r) =>
            sum + (r.rating_story + r.rating_characters + r.rating_art + r.rating_progression + r.rating_engagement) / 5
            , 0);
        average = Math.round((totalPoints / reviews.length) * 10) / 10;
    }

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
        ratings: reviews.map(r => ({
            userId: r.user_id,
            rating: Math.round((r.rating_story + r.rating_characters + r.rating_art + r.rating_progression + r.rating_engagement) / 5),
            createdAt: r.created_at
        })),
        averageRating: average,
        reviewCount: reviews.length
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

// ==================== REVIEW & RATING OPERATIONS ====================

export const rateManga = async (mangaId: string, userId: string, rating: number): Promise<boolean> => {
    // For backward compatibility, still update ratings table
    await supabase
        .from('ratings')
        .upsert({
            manga_id: mangaId,
            user_id: userId,
            rating,
            created_at: new Date().toISOString()
        }, { onConflict: 'manga_id,user_id' });

    // Also update/create a basic review if it doesn't exist
    const { data: existingReview } = await supabase
        .from('reviews')
        .select('id')
        .eq('manga_id', mangaId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!existingReview) {
        await supabase.from('reviews').insert({
            manga_id: mangaId,
            user_id: userId,
            content: 'Puan verildi',
            rating_story: rating,
            rating_characters: rating,
            rating_art: rating,
            rating_progression: rating,
            rating_engagement: rating,
        });
    }

    return true;
};

export const addReview = async (review: Omit<Review, 'id' | 'createdAt' | 'updatedAt' | 'likes' | 'likedBy'>): Promise<void> => {
    const { error } = await supabase.from('reviews').upsert({
        manga_id: review.mangaId,
        user_id: review.userId,
        content: review.content,
        rating_story: review.rating_story,
        rating_characters: review.rating_characters,
        rating_art: review.rating_art,
        rating_progression: review.rating_progression,
        rating_engagement: review.rating_engagement,
        updated_at: new Date().toISOString()
    }, { onConflict: 'manga_id,user_id' });

    if (error) throw error;
};

export const getReviewsForManga = async (mangaId: string): Promise<Review[]> => {
    const { data, error } = await supabase
        .from('reviews')
        .select(`
            *,
            user:users!user_id(username, avatar),
            likes_count:review_likes(count)
        `)
        .eq('manga_id', mangaId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Fetch reviews error:', error);
        return [];
    }

    // Get current user's likes if authenticated
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;

    let userLikes: string[] = [];
    if (userId) {
        const { data: likes } = await supabase
            .from('review_likes')
            .select('review_id')
            .eq('user_id', userId);
        userLikes = likes?.map(l => l.review_id) || [];
    }

    return (data || []).map(r => ({
        id: r.id,
        mangaId: r.manga_id,
        userId: r.user_id,
        username: (r as any).user?.username || 'Anonim',
        userAvatar: (r as any).user?.avatar,
        content: r.content,
        rating_story: r.rating_story,
        rating_characters: r.rating_characters,
        rating_art: r.rating_art,
        rating_progression: r.rating_progression,
        rating_engagement: r.rating_engagement,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        likes: (r as any).likes_count?.[0]?.count || 0,
        likedBy: userLikes.includes(r.id) ? [userId] : []
    })) as Review[];
};

export const toggleReviewLike = async (reviewId: string, userId: string): Promise<void> => {
    const { data: existing } = await supabase
        .from('review_likes')
        .select('*')
        .eq('review_id', reviewId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        await supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', userId);
    } else {
        await supabase.from('review_likes').insert({ review_id: reviewId, user_id: userId });
    }
};

export const getUserRating = async (mangaId: string, userId: string): Promise<number | undefined> => {
    // Return average of the 5 categories for the user's review
    const { data, error } = await supabase
        .from('reviews')
        .select('rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
        .eq('manga_id', mangaId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error || !data) return undefined;

    const avg = (data.rating_story + data.rating_characters + data.rating_art + data.rating_progression + data.rating_engagement) / 5;
    return Math.round(avg * 10) / 10;
};

export const getUserReview = async (mangaId: string, userId: string): Promise<Review | undefined> => {
    const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('manga_id', mangaId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error || !data) return undefined;
    return {
        id: data.id,
        mangaId: data.manga_id,
        userId: data.user_id,
        username: '', // Fill if needed
        content: data.content,
        rating_story: data.rating_story,
        rating_characters: data.rating_characters,
        rating_art: data.rating_art,
        rating_progression: data.rating_progression,
        rating_engagement: data.rating_engagement,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        likes: 0,
        likedBy: []
    } as Review;
};

export const getAverageRating = async (mangaId: string): Promise<{
    average: number;
    count: number;
    story: number;
    characters: number;
    art: number;
    progression: number;
    engagement: number;
}> => {
    const { data, error } = await supabase
        .from('reviews')
        .select('rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
        .eq('manga_id', mangaId);

    if (error || !data || data.length === 0) return {
        average: 0,
        count: 0,
        story: 0,
        characters: 0,
        art: 0,
        progression: 0,
        engagement: 0
    };

    const count = data.length;
    const sums = data.reduce((acc, r) => ({
        story: acc.story + r.rating_story,
        characters: acc.characters + r.rating_characters,
        art: acc.art + r.rating_art,
        progression: acc.progression + r.rating_progression,
        engagement: acc.engagement + r.rating_engagement,
    }), { story: 0, characters: 0, art: 0, progression: 0, engagement: 0 });

    const avgs = {
        story: Math.round((sums.story / count) * 10) / 10,
        characters: Math.round((sums.characters / count) * 10) / 10,
        art: Math.round((sums.art / count) * 10) / 10,
        progression: Math.round((sums.progression / count) * 10) / 10,
        engagement: Math.round((sums.engagement / count) * 10) / 10,
    };

    const totalAvg = Math.round(((avgs.story + avgs.characters + avgs.art + avgs.progression + avgs.engagement) / 5) * 10) / 10;

    return {
        average: totalAvg,
        count,
        ...avgs
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

export const getCommentsForManga = async (mangaId: string, chapterId?: string, sortBy: 'newest' | 'popular' = 'newest'): Promise<Comment[]> => {
    let query = supabase
        .from('comments')
        .select(`
            *,
            author:users!user_id(username, avatar),
            likes_count:comment_likes(count)
        `)
        .eq('manga_id', mangaId);

    if (chapterId) {
        query = query.eq('chapter_id', chapterId);
    } else {
        query = query.is('chapter_id', null);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Fetch comments error:', error);
        return [];
    }

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

    const mappedComments = (data || []).map(c => ({
        id: c.id,
        mangaId: c.manga_id,
        chapterId: c.chapter_id,
        userId: c.user_id,
        // Prioritize joined author data for real-time updates
        username: (c as any).author?.username || c.username,
        userAvatar: (c as any).author?.avatar || c.user_avatar,
        content: c.content,
        gifUrl: c.gif_url,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        parentId: c.parent_id,
        likes: (c as any).likes_count?.[0]?.count || 0,
        likedBy: userLikes.includes(c.id) ? [userId] : [],
    })) as Comment[];

    if (sortBy === 'popular') {
        return mappedComments.sort((a, b) => b.likes - a.likes);
    } else {
        return mappedComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
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
    const { error } = await supabase.from('comments').update({
        content,
        gif_url: gifUrl,
        updated_at: new Date().toISOString()
    }).eq('id', id);

    if (error) {
        console.error('Yorum güncelleme hatası:', error);
        throw error;
    }
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

// ==================== READING LIST OPERATIONS ====================

export const getReadingLists = async (userId: string, onlyPublic: boolean = false): Promise<ReadingList[]> => {
    let query = supabase
        .from('reading_lists')
        .select('*');

    if (onlyPublic) {
        query = query.eq('is_public', true);
    } else {
        query = query.eq('user_id', userId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) return [];

    return data.map(list => ({
        id: list.id,
        userId: list.user_id,
        name: list.name,
        description: list.description,
        isPublic: list.is_public,
        createdAt: list.created_at
    })) as ReadingList[];
};

export const getReadingListById = async (listId: string): Promise<ReadingList | undefined> => {
    const { data, error } = await supabase
        .from('reading_lists')
        .select(`
            *,
            items:reading_list_items(
                manga_id
            )
        `)
        .eq('id', listId)
        .maybeSingle();

    if (error || !data) return undefined;

    // Fetch manga details for items
    const mangaIds = data.items.map((item: any) => item.manga_id);
    let mangas: Manga[] = [];

    if (mangaIds.length > 0) {
        const { data: mangaData } = await supabase
            .from('mangas')
            .select('*')
            .in('id', mangaIds);

        mangas = (mangaData || []).map(m => ({
            ...m,
            alternativeTitles: m.alternative_titles || [],
            releaseYear: m.release_year,
            lastUpdated: m.last_updated,
            createdAt: m.created_at
        })) as Manga[];
    }

    return {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        description: data.description,
        isPublic: data.is_public,
        createdAt: data.created_at,
        items: mangas
    } as ReadingList;
};

export const createReadingList = async (list: Omit<ReadingList, 'id' | 'createdAt'>): Promise<ReadingList> => {
    const { data, error } = await supabase
        .from('reading_lists')
        .insert({
            user_id: list.userId,
            name: list.name,
            description: list.description,
            is_public: list.isPublic
        })
        .select()
        .single();

    if (error) throw error;

    return {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        description: data.description,
        isPublic: data.is_public,
        createdAt: data.created_at
    } as ReadingList;
};

export const updateReadingList = async (listId: string, updates: Partial<Pick<ReadingList, 'name' | 'description' | 'isPublic'>>): Promise<void> => {
    const { error } = await supabase
        .from('reading_lists')
        .update({
            name: updates.name,
            description: updates.description,
            is_public: updates.isPublic
        })
        .eq('id', listId);

    if (error) throw error;
};

export const deleteReadingList = async (listId: string): Promise<void> => {
    const { error } = await supabase
        .from('reading_lists')
        .delete()
        .eq('id', listId);

    if (error) throw error;
};

export const addMangaToReadingList = async (listId: string, mangaId: string): Promise<void> => {
    const { error } = await supabase
        .from('reading_list_items')
        .upsert({
            list_id: listId,
            manga_id: mangaId
        }, { onConflict: 'list_id,manga_id' });

    if (error) throw error;
};

export const removeMangaFromReadingList = async (listId: string, mangaId: string): Promise<void> => {
    const { error } = await supabase
        .from('reading_list_items')
        .delete()
        .eq('list_id', listId)
        .eq('manga_id', mangaId);

    if (error) throw error;
};

export const getMangasInReadingList = async (listId: string): Promise<Manga[]> => {
    const { data, error } = await supabase
        .from('reading_list_items')
        .select('manga_id')
        .eq('list_id', listId);

    if (error || !data) return [];

    const mangaIds = data.map(item => item.manga_id);
    if (mangaIds.length === 0) return [];

    const { data: mangaData, error: mangaError } = await supabase
        .from('mangas')
        .select('*')
        .in('id', mangaIds);

    if (mangaError) return [];

    return mangaData.map(m => ({
        ...m,
        alternativeTitles: m.alternative_titles || [],
        releaseYear: m.release_year,
        lastUpdated: m.last_updated,
        createdAt: m.created_at
    })) as Manga[];
};

export const checkIfMangaInList = async (listId: string, mangaId: string): Promise<boolean> => {
    const { data, error } = await supabase
        .from('reading_list_items')
        .select('id')
        .eq('list_id', listId)
        .eq('manga_id', mangaId)
        .maybeSingle();

    return !!data && !error;
};

// Migration Helper
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
// ==================== REACTION OPERATIONS ====================

export const getMangaReactions = async (mangaId: string, chapterId?: string): Promise<Record<string, number>> => {
    let query = supabase
        .from('manga_reactions')
        .select('reaction_type')
        .eq('manga_id', mangaId);

    if (chapterId) {
        query = query.eq('chapter_id', chapterId);
    } else {
        query = query.is('chapter_id', null);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Fetch reactions error:', error);
        return {};
    }

    const counts: Record<string, number> = {};
    data.forEach(r => {
        counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1;
    });

    return counts;
};

export const getUserMangaReaction = async (mangaId: string, userId: string, chapterId?: string): Promise<string | null> => {
    let query = supabase
        .from('manga_reactions')
        .select('reaction_type')
        .eq('manga_id', mangaId)
        .eq('user_id', userId);

    if (chapterId) {
        query = query.eq('chapter_id', chapterId);
    } else {
        query = query.is('chapter_id', null);
    }

    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return data.reaction_type;
};

export const addMangaReaction = async (mangaId: string, userId: string, reactionType: string, chapterId?: string): Promise<void> => {
    // If it's the same reaction, delete it (toggle off)
    const current = await getUserMangaReaction(mangaId, userId, chapterId);
    if (current === reactionType) {
        let deleteQuery = supabase
            .from('manga_reactions')
            .delete()
            .eq('manga_id', mangaId)
            .eq('user_id', userId);

        if (chapterId) {
            deleteQuery = deleteQuery.eq('chapter_id', chapterId);
        } else {
            deleteQuery = deleteQuery.is('chapter_id', null);
        }

        await deleteQuery;
        return;
    }

    const { error } = await supabase
        .from('manga_reactions')
        .upsert({
            manga_id: mangaId,
            chapter_id: chapterId || null,
            user_id: userId,
            reaction_type: reactionType,
            created_at: new Date().toISOString()
        }, { onConflict: 'user_id,manga_id,chapter_id' }); // Note: onConflict depends on how the index was created, but upsert with multiple cols usually requires them in unique index

    if (error) throw error;
};

// ==================== SIMILAR MANGA RECOMMENDATIONS ====================

/**
 * Get similar mangas based on matching genres
 * @param mangaId - Current manga ID to exclude
 * @param genres - Array of genres to match
 * @param limit - Maximum number of results (default 6)
 */
export const getSimilarMangas = async (
    mangaId: string,
    genres: string[],
    limit: number = 6
): Promise<Manga[]> => {
    try {
        if (!genres || genres.length === 0) return [];

        // Fetch all mangas except the current one
        const { data, error } = await supabase
            .from('mangas')
            .select('*')
            .neq('id', mangaId);

        if (error || !data) return [];

        // Get reviews for average ratings
        const { data: revData } = await supabase
            .from('reviews')
            .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement');
        const allReviews = revData || [];

        // Get chapter counts
        const { data: cData } = await supabase.from('chapters').select('manga_id');
        const chapterCounts = cData || [];

        // Calculate similarity score and map data
        const scoredMangas = data.map(m => {
            const mangaGenres = m.genres || [];
            // Count matching genres
            const matchingGenres = genres.filter(g =>
                mangaGenres.some((mg: string) => mg.toLowerCase() === g.toLowerCase())
            ).length;

            // Calculate average rating
            const mangaReviews = allReviews.filter(r => r.manga_id === m.id);
            let average = 0;
            if (mangaReviews.length > 0) {
                const totalPoints = mangaReviews.reduce((sum, r) =>
                    sum + (r.rating_story + r.rating_characters + r.rating_art + r.rating_progression + r.rating_engagement) / 5
                    , 0);
                average = Math.round((totalPoints / mangaReviews.length) * 10) / 10;
            }

            const mangaChapters = chapterCounts.filter(c => c.manga_id === m.id);

            return {
                manga: {
                    ...m,
                    alternativeTitles: m.alternative_titles || [],
                    lastUpdated: m.last_updated,
                    createdAt: m.created_at,
                    releaseYear: m.release_year,
                    chapters: Array(mangaChapters.length).fill({}),
                    ratings: Array(mangaReviews.length).fill({ rating: average }),
                    averageRating: average,
                    reviewCount: mangaReviews.length
                } as Manga,
                score: matchingGenres,
                views: m.views || 0
            };
        });

        // Filter mangas with at least 1 matching genre
        const filtered = scoredMangas.filter(item => item.score > 0);

        // Sort by matching genres (desc), then by views (desc)
        filtered.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.views - a.views;
        });

        // Return top results
        return filtered.slice(0, limit).map(item => item.manga);
    } catch (err) {
        console.error('getSimilarMangas error:', err);
        return [];
    }
};
