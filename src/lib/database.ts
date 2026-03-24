// Supabase Database Integration
// Fully asynchronous operations replacing localStorage
import { supabase } from './supabase';
import { Manga, Chapter, User, MangaRating, Comment, ReadingList, ReadingListItem, Review, MangaReaction, Character, Author, Artist } from './types';
import { encodeCommentContent, parseCommentContent } from './commentContent';

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

    const [
        { data: reviewData },
        { data: authorData },
        { data: artistData }
    ] = await Promise.all([
        supabase.from('reviews').select('*').eq('manga_id', mangaId),
        data.author ? supabase.from('authors').select('*').eq('name', data.author).maybeSingle() : Promise.resolve({ data: null }),
        data.artist ? supabase.from('artists').select('*').eq('name', data.artist).maybeSingle() : Promise.resolve({ data: null })
    ]);

    const reviews = reviewData || [];
    let average = 0;
    const breakdown = { story: 0, characters: 0, art: 0, progression: 0, engagement: 0 };

    if (reviews.length > 0) {
        const totalPoints = reviews.reduce((sum, r) =>
            sum + (r.rating_story + r.rating_characters + r.rating_art + r.rating_progression + r.rating_engagement) / 5
            , 0);
        average = Math.round((totalPoints / reviews.length) * 10) / 10;

        // Calculate breakdown
        reviews.forEach(r => {
            breakdown.story += r.rating_story;
            breakdown.characters += r.rating_characters;
            breakdown.art += r.rating_art;
            breakdown.progression += r.rating_progression;
            breakdown.engagement += r.rating_engagement;
        });

        breakdown.story = Math.round((breakdown.story / reviews.length) * 10) / 10;
        breakdown.characters = Math.round((breakdown.characters / reviews.length) * 10) / 10;
        breakdown.art = Math.round((breakdown.art / reviews.length) * 10) / 10;
        breakdown.progression = Math.round((breakdown.progression / reviews.length) * 10) / 10;
        breakdown.engagement = Math.round((breakdown.engagement / reviews.length) * 10) / 10;
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
        ratingBreakdown: breakdown,
        reviewCount: reviews.length,
        authorDetails: authorData ? { ...authorData, imageUrl: authorData.image_url, likesCount: authorData.likes_count } : undefined,
        artistDetails: artistData ? { ...artistData, imageUrl: artistData.image_url, likesCount: artistData.likes_count } : undefined
    } as any;
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

    if (userError || !userData) {
        await supabase.auth.signOut();
        return null;
    }

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
    return getEntityCommentsV2('manga', mangaId, chapterId, sortBy);
};

export const getEntityCommentsV2 = async (entityType: 'manga' | 'character' | 'author' | 'artist', entityId: string, chapterId?: string, sortBy: 'newest' | 'popular' = 'newest'): Promise<Comment[]> => {
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const colName = entityType === 'manga' ? 'manga_id' : `${entityType}_id`;
    const likesTableName = entityType === 'manga' ? 'comment_likes' : `${entityType}_comment_likes`;

    let query = supabase
        .from(tableName as any)
        .select(`
            *,
            author:users!user_id(username, avatar),
            likes_count:${likesTableName}(count)
        ` as any)
        .eq(colName, entityId);

    if (entityType === 'manga') {
        if (chapterId) {
            query = query.eq('chapter_id', chapterId);
        } else {
            query = query.is('chapter_id', null);
        }
    }

    const { data, error } = await query;

    if (error) {
        console.error(`Fetch ${entityType} comments error:`, error);
        return [];
    }

    // Get current user's likes if authenticated
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    let userLikes: string[] = [];
    if (userId) {
        const { data: likes } = await supabase
            .from(likesTableName as any)
            .select('comment_id' as any)
            .eq('user_id', userId);
        userLikes = (likes as any[])?.map(l => l.comment_id) || [];
    }

    const mappedComments = (data as any[] || []).map(c => {
        const parsedContent = parseCommentContent(c.content || '');

        return {
            id: c.id,
            mangaId: entityType === 'manga' ? c.manga_id : undefined,
            entityId: entityType !== 'manga' ? c[colName] : undefined,
            entityType,
            chapterId: c.chapter_id,
            userId: c.user_id,
            username: c.author?.username || c.username || 'Anonim',
            userAvatar: c.author?.avatar || c.user_avatar,
            content: parsedContent.body,
            title: parsedContent.title,
            textColor: parsedContent.textColor,
            mediaUrl: parsedContent.mediaUrl,
            mediaUrls: parsedContent.mediaUrls,
            isSpoiler: parsedContent.isSpoiler,
            gifUrl: c.gif_url,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            parentId: c.parent_id,
            likes: c.likes_count?.[0]?.count || 0,
            likedBy: userLikes.includes(c.id) ? [userId || ''] : [],
        };
    }) as Comment[];

    if (sortBy === 'popular') {
        return mappedComments.sort((a, b) => b.likes - a.likes);
    } else {
        return mappedComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
};


export const addComment = async (comment: Omit<Comment, 'id' | 'likes' | 'likedBy' | 'createdAt' | 'updatedAt'>): Promise<Comment> => {
    return addCommentV2(comment);
};

export const addCommentV2 = async (comment: Omit<Comment, 'id' | 'likes' | 'likedBy' | 'createdAt' | 'updatedAt'>): Promise<Comment> => {
    const entityType = comment.entityType || 'manga';
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const colName = entityType === 'manga' ? 'manga_id' : `${entityType}_id`;
    const entityId = entityType === 'manga' ? comment.mangaId : comment.entityId;

    const insertData: any = {
        [colName]: entityId,
        user_id: comment.userId,
        username: comment.username,
        user_avatar: comment.userAvatar,
        content: encodeCommentContent({
            body: comment.content,
            title: comment.title,
            textColor: comment.textColor,
            mediaUrl: comment.mediaUrl,
            mediaUrls: comment.mediaUrls,
            isSpoiler: comment.isSpoiler,
        }),
        gif_url: comment.gifUrl,
        parent_id: comment.parentId
    };

    if (entityType === 'manga') {
        insertData.chapter_id = comment.chapterId;
    }

    const { data, error } = await supabase
        .from(tableName as any)
        .insert(insertData)
        .select()
        .single();

    if (error) throw error;
    return {
        mangaId: entityType === 'manga' ? data.manga_id : undefined,
        entityId: entityType !== 'manga' ? data[colName] : undefined,
        entityType,
        chapterId: data.chapter_id,
        userId: data.user_id,
        username: data.username,
        userAvatar: data.user_avatar,
        content: comment.content,
        title: comment.title,
        textColor: comment.textColor,
        mediaUrl: comment.mediaUrl,
        mediaUrls: comment.mediaUrls,
        isSpoiler: comment.isSpoiler,
        gifUrl: comment.gifUrl,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        parentId: data.parent_id,
        likes: 0,
        likedBy: []
    } as Comment;
};

export const updateComment = async (
    id: string,
    payload: Pick<Comment, 'content' | 'title' | 'textColor' | 'mediaUrl' | 'mediaUrls' | 'isSpoiler' | 'gifUrl'>,
    entityType: string = 'manga'
): Promise<void> => {
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const { error } = await supabase.from(tableName as any).update({
        content: encodeCommentContent({
            body: payload.content,
            title: payload.title,
            textColor: payload.textColor,
            mediaUrl: payload.mediaUrl,
            mediaUrls: payload.mediaUrls,
            isSpoiler: payload.isSpoiler,
        }),
        gif_url: payload.gifUrl,
        updated_at: new Date().toISOString()
    }).eq('id', id);

    if (error) {
        console.error('Yorum güncelleme hatası:', error);
        throw error;
    }
};

export const deleteComment = async (id: string, entityType: string = 'manga'): Promise<void> => {
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const { error } = await supabase.from(tableName as any).delete().eq('id', id);
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

    return data.map(c => {
        const parsedContent = parseCommentContent(c.content || '');

        return {
            id: c.id,
            mangaId: c.manga_id,
            chapterId: c.chapter_id,
            userId: c.user_id,
            username: c.username,
            userAvatar: c.user_avatar,
            content: parsedContent.body,
            title: parsedContent.title,
            textColor: parsedContent.textColor,
            mediaUrl: parsedContent.mediaUrl,
            mediaUrls: parsedContent.mediaUrls,
            isSpoiler: parsedContent.isSpoiler,
            gifUrl: c.gif_url,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            parentId: c.parent_id,
            likes: c.likes_count[0]?.count || 0,
            likedBy: [],
        };
    }) as Comment[];
};

export const toggleCommentLike = async (commentId: string, userId: string, entityType: string = 'manga'): Promise<void> => {
    const likesTableName = entityType === 'manga' ? 'comment_likes' : `${entityType}_comment_likes`;
    const { data: existing } = await supabase
        .from(likesTableName as any)
        .select('*')
        .eq('comment_id', commentId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        await supabase
            .from(likesTableName as any)
            .delete()
            .eq('comment_id', commentId)
            .eq('user_id', userId);
    } else {
        await supabase
            .from(likesTableName as any)
            .insert({
                comment_id: commentId,
                user_id: userId
            });
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
        imageUrl: list.image_url,
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
        imageUrl: data.image_url,
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
            image_url: list.imageUrl,
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
        imageUrl: data.image_url,
        isPublic: data.is_public,
        createdAt: data.created_at
    } as ReadingList;
};

export const updateReadingList = async (listId: string, updates: Partial<Pick<ReadingList, 'name' | 'description' | 'imageUrl' | 'isPublic'>>): Promise<void> => {
    const { error } = await supabase
        .from('reading_lists')
        .update({
            name: updates.name,
            description: updates.description,
            image_url: updates.imageUrl,
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
    return getEntityReactions('manga', mangaId, chapterId);
};

export const getEntityReactions = async (entityType: 'manga' | 'character' | 'author' | 'artist', entityId: string, chapterId?: string): Promise<Record<string, number>> => {
    const tableName = `${entityType}_reactions`;
    const colName = `${entityType}_id`;

    let query = supabase
        .from(tableName as any)
        .select('reaction_type')
        .eq(colName, entityId);

    if (entityType === 'manga') {
        if (chapterId) {
            query = query.eq('chapter_id', chapterId);
        } else {
            query = query.is('chapter_id', null);
        }
    }

    const { data, error } = await query;

    if (error) return {};

    const counts: Record<string, number> = {};
    data.forEach(r => {
        counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1;
    });

    return counts;
};

export const getUserMangaReaction = async (mangaId: string, userId: string, chapterId?: string): Promise<string | null> => {
    return getUserEntityReaction('manga', mangaId, userId, chapterId);
};

export const getUserEntityReaction = async (entityType: 'manga' | 'character' | 'author' | 'artist', entityId: string, userId: string, chapterId?: string): Promise<string | null> => {
    const tableName = `${entityType}_reactions`;
    const colName = `${entityType}_id`;

    let query = supabase
        .from(tableName as any)
        .select('reaction_type')
        .eq(colName, entityId)
        .eq('user_id', userId);

    if (entityType === 'manga') {
        if (chapterId) {
            query = query.eq('chapter_id', chapterId);
        } else {
            query = query.is('chapter_id', null);
        }
    }

    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;
    return data.reaction_type;
};

export const addMangaReaction = async (mangaId: string, userId: string, reactionType: string, chapterId?: string): Promise<void> => {
    return addEntityReactionV2('manga', mangaId, userId, reactionType, chapterId);
};

export const addEntityReactionV2 = async (entityType: 'manga' | 'character' | 'author' | 'artist', entityId: string, userId: string, reactionType: string, chapterId?: string): Promise<void> => {
    const tableName = `${entityType}_reactions`;
    const colName = `${entityType}_id`;

    // If it's the same reaction, delete it (toggle off)
    const current = await getUserEntityReaction(entityType, entityId, userId, chapterId);
    if (current === reactionType) {
        let deleteQuery = supabase
            .from(tableName as any)
            .delete()
            .eq(colName, entityId)
            .eq('user_id', userId);

        if (entityType === 'manga') {
            if (chapterId) {
                deleteQuery = deleteQuery.eq('chapter_id', chapterId);
            } else {
                deleteQuery = deleteQuery.is('chapter_id', null);
            }
        }

        await deleteQuery;
        return;
    }

    const insertData: any = {
        [colName]: entityId,
        user_id: userId,
        reaction_type: reactionType,
        created_at: new Date().toISOString()
    };

    let onConflictCols = ['user_id', colName];

    if (entityType === 'manga') {
        insertData.chapter_id = chapterId || null;
        onConflictCols.push('chapter_id');
    }

    const { error } = await supabase
        .from(tableName as any)
        .upsert(insertData, { onConflict: onConflictCols.join(',') });

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

// ==================== CHARACTER, AUTHOR, ARTIST OPERATIONS ====================

export const getCharacters = async (): Promise<Character[]> => {
    const { data, error } = await supabase
        .from('characters')
        .select('*')
        .order('likes_count', { ascending: false });

    if (error) return [];
    return data.map((c, index) => ({
        id: c.id,
        name: c.name,
        imageUrl: c.image_url,
        description: c.description,
        likesCount: c.likes_count,
        createdAt: c.created_at,
        rank: index + 1
    }));
};

export const getCharacterById = async (id: string): Promise<Character | undefined> => {
    const { data, error } = await supabase
        .from('characters')
        .select(`
            *,
            mangas:manga_characters(manga:mangas(*))
        `)
        .eq('id', id)
        .maybeSingle();

    if (error || !data) return undefined;

    // Get rank
    const { count } = await supabase
        .from('characters')
        .select('*', { count: 'exact', head: true })
        .gt('likes_count', data.likes_count);

    return {
        id: data.id,
        name: data.name,
        imageUrl: data.image_url,
        description: data.description,
        likesCount: data.likes_count,
        createdAt: data.created_at,
        rank: (count || 0) + 1,
        series: (data as any).mangas.map((m: any) => m.manga).filter(Boolean)
    };
};

export const saveCharacter = async (character: Partial<Character>): Promise<string> => {
    const data = {
        name: character.name,
        image_url: character.imageUrl,
        description: character.description,
    };

    if (character.id) {
        const { error } = await supabase.from('characters').update(data).eq('id', character.id);
        if (error) throw error;
        return character.id;
    } else {
        const { data: inserted, error } = await supabase.from('characters').insert(data).select().single();
        if (error) throw error;
        return inserted.id;
    }
};

export const deleteCharacter = async (id: string): Promise<void> => {
    const { error } = await supabase.from('characters').delete().eq('id', id);
    if (error) throw error;
};

export const linkMangaToCharacter = async (mangaId: string, characterId: string): Promise<void> => {
    await supabase.from('manga_characters').upsert({ manga_id: mangaId, character_id: characterId });
};

export const unlinkMangaFromCharacter = async (mangaId: string, characterId: string): Promise<void> => {
    await supabase.from('manga_characters').delete().eq('manga_id', mangaId).eq('character_id', characterId);
};

export const getMangaCharacters = async (mangaId: string): Promise<Character[]> => {
    const { data, error } = await supabase
        .from('manga_characters')
        .select('character:characters(*)')
        .eq('manga_id', mangaId);

    if (error) return [];
    return data.map((d: any) => ({
        id: d.character.id,
        name: d.character.name,
        imageUrl: d.character.image_url,
        description: d.character.description,
        likesCount: d.character.likes_count,
        createdAt: d.character.created_at
    }));
};

// Same for Authors/Artists (shorter versions)
export const getAuthors = async () => {
    const { data } = await supabase.from('authors').select('*').order('name');
    return (data || []).map(d => ({ ...d, imageUrl: d.image_url, likesCount: d.likes_count }));
};

export const getArtists = async () => {
    const { data } = await supabase.from('artists').select('*').order('name');
    return (data || []).map(d => ({ ...d, imageUrl: d.image_url, likesCount: d.likes_count }));
};

export const getAuthorById = async (id: string): Promise<Author | undefined> => {
    const { data, error } = await supabase
        .from('authors')
        .select(`*, mangas:manga_authors(manga:mangas(*))`)
        .eq('id', id)
        .maybeSingle();
    if (error || !data) return undefined;
    return { ...data, imageUrl: data.image_url, likesCount: data.likes_count, series: (data as any).mangas.map((m: any) => m.manga) };
};

export const getArtistById = async (id: string): Promise<Artist | undefined> => {
    const { data, error } = await supabase
        .from('artists')
        .select(`*, mangas:manga_artists(manga:mangas(*))`)
        .eq('id', id)
        .maybeSingle();
    if (error || !data) return undefined;
    return { ...data, imageUrl: data.image_url, likesCount: data.likes_count, series: (data as any).mangas.map((m: any) => m.manga) };
};

export const saveAuthor = async (author: Partial<Author>) => {
    const data = { name: author.name, image_url: author.imageUrl, description: author.description };
    if (author.id) {
        await supabase.from('authors').update(data).eq('id', author.id);
        return author.id;
    } else {
        const { data: inserted } = await supabase.from('authors').insert(data).select().single();
        return inserted.id;
    }
};

export const deleteAuthor = async (id: string): Promise<void> => {
    const { error } = await supabase.from('authors').delete().eq('id', id);
    if (error) throw error;
};

export const saveArtist = async (artist: Partial<Artist>) => {
    const data = { name: artist.name, image_url: artist.imageUrl, description: artist.description };
    if (artist.id) {
        await supabase.from('artists').update(data).eq('id', artist.id);
        return artist.id;
    } else {
        const { data: inserted } = await supabase.from('artists').insert(data).select().single();
        return inserted.id;
    }
};

export const deleteArtist = async (id: string): Promise<void> => {
    const { error } = await supabase.from('artists').delete().eq('id', id);
    if (error) throw error;
};

export const linkMangaToAuthor = async (mangaId: string, authorId: string) => {
    await supabase.from('manga_authors').upsert({ manga_id: mangaId, author_id: authorId });
};

export const linkMangaToArtist = async (mangaId: string, artistId: string) => {
    await supabase.from('manga_artists').upsert({ manga_id: mangaId, artist_id: artistId });
};

// Generic Like Toggle for Entities
export const toggleEntityLike = async (entityType: 'character' | 'author' | 'artist', entityId: string, userId: string): Promise<void> => {
    const tableName = `${entityType}_likes`;
    const colName = `${entityType}_id`;

    const { data: existing } = await supabase
        .from(tableName as any)
        .select('*')
        .eq(colName, entityId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        await supabase.from(tableName as any).delete().eq(colName, entityId).eq('user_id', userId);
        // Decrement likes_count
        await supabase.rpc(`decrement_${entityType}_likes`, { entity_id_param: entityId });
    } else {
        await supabase.from(tableName as any).insert({ [colName]: entityId, user_id: userId });
        // Increment likes_count
        await supabase.rpc(`increment_${entityType}_likes`, { entity_id_param: entityId });
    }
};

// ==================== WRAPPERS FOR COMPATIBILITY ====================

export const getEntityComments = async (entityType: 'character' | 'author' | 'artist', entityId: string): Promise<Comment[]> => {
    return getEntityCommentsV2(entityType, entityId);
};

export const addEntityComment = async (entityType: 'character' | 'author' | 'artist', entityId: string, userId: string, content: string): Promise<void> => {
    await addCommentV2({
        entityId,
        entityType,
        userId,
        username: '',
        content,
    });
};

// ==================== SMART TAG OPERATIONS ====================

import { Tag, TagCategory, TagVote } from './types';

export const getAllTags = async (): Promise<Tag[]> => {
    const { data, error } = await supabase
        .from('tags')
        .select('*')
        .order('usage_count', { ascending: false });

    if (error) return [];
    return data.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        category: t.category as TagCategory,
        description: t.description,
        usageCount: t.usage_count,
        isOfficial: t.is_official,
        createdBy: t.created_by,
        createdAt: t.created_at
    }));
};

export const getTagsByCategory = async (category: TagCategory): Promise<Tag[]> => {
    const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('category', category)
        .order('usage_count', { ascending: false });

    if (error) return [];
    return data.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        category: t.category as TagCategory,
        description: t.description,
        usageCount: t.usage_count,
        isOfficial: t.is_official,
        createdBy: t.created_by,
        createdAt: t.created_at
    }));
};

export const searchTags = async (query: string): Promise<Tag[]> => {
    const { data, error } = await supabase
        .from('tags')
        .select('*')
        .ilike('name', `%${query}%`)
        .order('usage_count', { ascending: false })
        .limit(20);

    if (error) return [];
    return data.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        category: t.category as TagCategory,
        description: t.description,
        usageCount: t.usage_count,
        isOfficial: t.is_official,
        createdBy: t.created_by,
        createdAt: t.created_at
    }));
};

export const createTag = async (
    name: string,
    category: TagCategory = 'general',
    description?: string,
    userId?: string
): Promise<Tag | null> => {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

    const { data, error } = await supabase
        .from('tags')
        .upsert({
            name,
            slug,
            category,
            description,
            created_by: userId,
            is_official: false
        }, { onConflict: 'slug' })
        .select()
        .single();

    if (error) {
        console.error('Create tag error:', error);
        return null;
    }

    return {
        id: data.id,
        name: data.name,
        slug: data.slug,
        category: data.category as TagCategory,
        description: data.description,
        usageCount: data.usage_count,
        isOfficial: data.is_official,
        createdBy: data.created_by,
        createdAt: data.created_at
    };
};

export const updateTag = async (tagId: string, updates: Partial<{ name: string; category: TagCategory; description: string; isOfficial: boolean }>): Promise<void> => {
    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.category !== undefined) updateData.category = updates.category;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.isOfficial !== undefined) updateData.is_official = updates.isOfficial;

    const { error } = await supabase.from('tags').update(updateData).eq('id', tagId);
    if (error) throw error;
};

export const deleteTag = async (tagId: string): Promise<void> => {
    const { error } = await supabase.from('tags').delete().eq('id', tagId);
    if (error) throw error;
};

export const getTagsForEntity = async (
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string
): Promise<Tag[]> => {
    const tableName = `${entityType}_tags`;
    const colName = `${entityType}_id`;

    const { data, error } = await supabase
        .from(tableName as any)
        .select(`
            tag_id,
            tag:tags(*)
        `)
        .eq(colName, entityId);

    if (error) return [];

    return (data as any[])
        .filter(d => d.tag)
        .map(d => ({
            id: d.tag.id,
            name: d.tag.name,
            slug: d.tag.slug,
            category: d.tag.category as TagCategory,
            description: d.tag.description,
            usageCount: d.tag.usage_count,
            isOfficial: d.tag.is_official,
            createdBy: d.tag.created_by,
            createdAt: d.tag.created_at
        }));
};

export const addTagToEntity = async (
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string,
    tagId: string,
    userId?: string
): Promise<boolean> => {
    const tableName = `${entityType}_tags`;
    const colName = `${entityType}_id`;

    const { error } = await supabase
        .from(tableName as any)
        .upsert({
            [colName]: entityId,
            tag_id: tagId,
            added_by: userId
        });

    if (error) {
        console.error('Add tag to entity error:', error);
        return false;
    }
    return true;
};

export const removeTagFromEntity = async (
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string,
    tagId: string
): Promise<boolean> => {
    const tableName = `${entityType}_tags`;
    const colName = `${entityType}_id`;

    const { error } = await supabase
        .from(tableName as any)
        .delete()
        .eq(colName, entityId)
        .eq('tag_id', tagId);

    return !error;
};

export const voteOnTag = async (
    tagId: string,
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string,
    userId: string,
    voteType: 'up' | 'down'
): Promise<void> => {
    const { data: existing } = await supabase
        .from('tag_votes')
        .select('id, vote_type')
        .eq('tag_id', tagId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        if (existing.vote_type === voteType) {
            await supabase.from('tag_votes').delete().eq('id', existing.id);
        } else {
            await supabase.from('tag_votes').update({ vote_type: voteType }).eq('id', existing.id);
        }
    } else {
        await supabase.from('tag_votes').insert({
            tag_id: tagId,
            entity_type: entityType,
            entity_id: entityId,
            user_id: userId,
            vote_type: voteType
        });
    }
};

export const getTagVotes = async (
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string
): Promise<Record<string, { up: number; down: number }>> => {
    const { data, error } = await supabase
        .from('tag_votes')
        .select('tag_id, vote_type')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId);

    if (error) return {};

    const votes: Record<string, { up: number; down: number }> = {};
    data.forEach(v => {
        if (!votes[v.tag_id]) votes[v.tag_id] = { up: 0, down: 0 };
        votes[v.tag_id][v.vote_type as 'up' | 'down']++;
    });
    return votes;
};

export const getUserTagVotes = async (
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string,
    userId: string
): Promise<Record<string, 'up' | 'down'>> => {
    const { data, error } = await supabase
        .from('tag_votes')
        .select('tag_id, vote_type')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('user_id', userId);

    if (error) return {};

    const result: Record<string, 'up' | 'down'> = {};
    data.forEach(v => {
        result[v.tag_id] = v.vote_type as 'up' | 'down';
    });
    return result;
};

export const getTrendingTags = async (limit: number = 10): Promise<Tag[]> => {
    const { data, error } = await supabase
        .from('tags')
        .select('*')
        .order('usage_count', { ascending: false })
        .limit(limit);

    if (error) return [];
    return data.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        category: t.category as TagCategory,
        description: t.description,
        usageCount: t.usage_count,
        isOfficial: t.is_official,
        createdBy: t.created_by,
        createdAt: t.created_at
    }));
};

export const getMangasByTag = async (tagSlug: string): Promise<Manga[]> => {
    const { data: tagData, error: tagError } = await supabase
        .from('tags')
        .select('id')
        .eq('slug', tagSlug)
        .maybeSingle();

    if (tagError || !tagData) return [];

    const { data, error } = await supabase
        .from('manga_tags')
        .select('manga_id')
        .eq('tag_id', tagData.id);

    if (error || !data || data.length === 0) return [];

    const mangaIds = data.map(d => d.manga_id);

    const { data: mangaData } = await supabase
        .from('mangas')
        .select('*')
        .in('id', mangaIds);

    if (!mangaData) return [];

    return mangaData.map(m => ({
        ...m,
        alternativeTitles: m.alternative_titles || [],
        lastUpdated: m.last_updated,
        createdAt: m.created_at,
        releaseYear: m.release_year,
        chapters: [],
        ratings: [],
    })) as Manga[];
};

export const getMangasByMultipleTags = async (tagSlugs: string[]): Promise<Manga[]> => {
    if (tagSlugs.length === 0) return [];

    const { data: tagsData } = await supabase
        .from('tags')
        .select('id')
        .in('slug', tagSlugs);

    if (!tagsData || tagsData.length === 0) return [];

    const tagIds = tagsData.map(t => t.id);

    const { data: mangaTagData } = await supabase
        .from('manga_tags')
        .select('manga_id, tag_id')
        .in('tag_id', tagIds);

    if (!mangaTagData || mangaTagData.length === 0) return [];

    const mangaTagCounts: Record<string, number> = {};
    mangaTagData.forEach(mt => {
        mangaTagCounts[mt.manga_id] = (mangaTagCounts[mt.manga_id] || 0) + 1;
    });

    const matchingMangaIds = Object.entries(mangaTagCounts)
        .filter(([, count]) => count >= tagIds.length)
        .map(([id]) => id);

    if (matchingMangaIds.length === 0) return [];

    const { data: mangaData } = await supabase
        .from('mangas')
        .select('*')
        .in('id', matchingMangaIds);

    if (!mangaData) return [];

    return mangaData.map(m => ({
        ...m,
        alternativeTitles: m.alternative_titles || [],
        lastUpdated: m.last_updated,
        createdAt: m.created_at,
        releaseYear: m.release_year,
        chapters: [],
        ratings: [],
    })) as Manga[];
};


/**
 * Get Top 10 Mangas based on a score calculated from engagement
 * User Formula:
 * - 1 Comment = 5 pts
 * - 1 Reaction = 2 pts
 * - 1 Review = 10 pts
 * - 1 View (Chapter Read) = 0.5 pts
 * Uses get_top_engaged_mangas RPC
 */
export const getTopTenMangas = async (timeframe: 'today' | 'week' | 'all' = 'today'): Promise<Manga[]> => {
    try {
        const { data: rawData, error } = await supabase.rpc('get_top_engaged_mangas', { time_filter: timeframe });

        if (error || !rawData || rawData.length === 0) {
            if (error) console.error('getTopTenMangas error:', error);
            // Return top 10 by views if engagement logic fails
            const all = await getAllMangas();
            return all.sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10);
        }

        // Map results to Manga interface
        return rawData.map((m: any) => ({
            ...m,
            alternativeTitles: m.alternative_titles || [],
            lastUpdated: m.last_updated,
            createdAt: m.created_at,
            releaseYear: m.release_year,
            chapters: [],
            ratings: [],
            engagementScore: m.engagement_score,
            averageRating: m.average_rating || 0
        })) as Manga[];
    } catch (error) {
        console.error('getTopTenMangas exception:', error);
        return [];
    }
};
