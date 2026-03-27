// Supabase Database Integration
// Fully asynchronous operations replacing localStorage
import { supabase } from './supabase';
import { Manga, Chapter, User, MangaRating, Comment, ReadingList, ReadingListItem, Review, MangaReaction, Character, Author, Artist } from './types';
import { encodeCommentContent, parseCommentContent } from './commentContent';
import { normalizeGenres } from './mockData';
import { cacheOfflineManga, getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import {
    areReadingListsInitialized,
    createClientEntityId,
    getCachedReadingListRecord,
    getCachedReadingListsState,
    findCachedReadingListRecord,
    isEffectivelyOnline,
    mapCachedReadingListItemToManga,
    mapCachedReadingListToReadingList,
    mapMangaToCachedReadingListItem,
    queueReadingListAddItem,
    queueReadingListCreate,
    queueReadingListDelete,
    queueReadingListRemoveItem,
    queueReadingListUpdate,
    removeCachedReadingList,
    setCachedReadingLists,
    updateCachedReadingList,
    upsertCachedReadingList,
} from '@/lib/offline/userSync';
import { warmPersistentImageUrls } from '@/lib/offline/persistentImageWarmup';

const normalizeNamedEntityValue = (value?: string | null) =>
    value?.split(/[,，]/)[0]?.trim().replace(/\s+/g, ' ') || '';

const normalizeNamedEntityKey = (value?: string | null) =>
    normalizeNamedEntityValue(value).toLocaleLowerCase('tr-TR');

const PERSON_PLACEHOLDER_KEYS = new Set(['', 'bilinmiyor', 'unknown', 'n/a', '-']);

const isMeaningfulNamedEntity = (value?: string | null) =>
    !PERSON_PLACEHOLDER_KEYS.has(normalizeNamedEntityKey(value));

const mapAuthorRow = (row: any): Author => ({
    ...row,
    imageUrl: row.image_url,
    likesCount: row.likes_count ?? 0,
});

const mapArtistRow = (row: any): Artist => ({
    ...row,
    imageUrl: row.image_url,
    likesCount: row.likes_count ?? 0,
});

export interface LatestChapterFeedItem {
    chapterId: string;
    mangaId: string;
    mangaTitle: string;
    mangaCover: string;
    mangaType?: Manga['type'];
    chapterNumber: number;
    chapterTitle?: string;
    addedAt: string;
    releaseDate?: string;
}

export interface LikedReadingListPreview extends ReadingList {
    ownerUsername?: string;
    likesCount: number;
    itemsCount: number;
    likedAt: string;
}

export type ReportStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed';

export interface MangaReport {
    id: string;
    mangaId: string;
    mangaTitle: string;
    mangaCover?: string;
    reporterId: string;
    reporterUsername?: string;
    reason: string;
    details?: string;
    status: ReportStatus;
    createdAt: string;
    updatedAt: string;
}

export interface CommentReport {
    id: string;
    commentId: string;
    commentEntityType: 'manga' | 'character' | 'author' | 'artist';
    targetEntityId: string;
    targetTitle?: string;
    reporterId: string;
    reporterUsername?: string;
    reportedUserId: string;
    reportedUsername?: string;
    commentPreview?: string;
    commentCreatedAt?: string;
    reason: string;
    details?: string;
    status: ReportStatus;
    createdAt: string;
    updatedAt: string;
}

export interface ProfileReport {
    id: string;
    reporterId: string;
    reporterUsername?: string;
    reportedUserId: string;
    reportedUsername?: string;
    reportedUserAvatar?: string;
    reason: string;
    details?: string;
    status: ReportStatus;
    createdAt: string;
    updatedAt: string;
}

export interface AdminCommentsPage {
    comments: Comment[];
    total: number;
}

export interface AdminAccessContext {
    userId?: string;
    role?: User['role'];
    canAccessAdminPanel: boolean;
    isPrimaryAdmin: boolean;
}

const PRIMARY_ADMIN_EMAIL = 'caganherdil@gmail.com';
let adminAccessContextCache:
    | { authUserId: string | null; value: AdminAccessContext }
    | null = null;
let adminAccessContextPromise: Promise<AdminAccessContext> | null = null;
const ALL_MANGAS_CACHE_TTL_MS = 60_000;
let allMangasCache: { fetchedAt: number; value: Manga[] } | null = null;
let allMangasPromise: Promise<Manga[]> | null = null;
let mangaSummariesCache: { fetchedAt: number; value: Manga[] } | null = null;
let mangaSummariesPromise: Promise<Manga[]> | null = null;

const invalidateAllMangasCache = () => {
    allMangasCache = null;
    allMangasPromise = null;
    mangaSummariesCache = null;
    mangaSummariesPromise = null;
};

export const getCachedAdminAccessContext = (authUserId?: string | null): AdminAccessContext | null => {
    if (!authUserId || adminAccessContextCache?.authUserId !== authUserId) {
        return null;
    }

    return adminAccessContextCache.value;
};

const hasUserBlockRelationship = async (viewerId?: string, ownerId?: string): Promise<boolean> => {
    if (!viewerId || !ownerId || viewerId === ownerId) {
        return false;
    }

    const [
        { count: viewerBlocksOwner, error: viewerBlocksOwnerError },
        { count: ownerBlocksViewer, error: ownerBlocksViewerError },
    ] = await Promise.all([
        supabase
            .from('user_blocks')
            .select('*', { count: 'exact', head: true })
            .eq('blocker_id', viewerId)
            .eq('blocked_id', ownerId),
        supabase
            .from('user_blocks')
            .select('*', { count: 'exact', head: true })
            .eq('blocker_id', ownerId)
            .eq('blocked_id', viewerId),
    ]);

    if (viewerBlocksOwnerError || ownerBlocksViewerError) {
        console.error('User block relationship check error:', viewerBlocksOwnerError || ownerBlocksViewerError);
        return false;
    }

    return (viewerBlocksOwner || 0) > 0 || (ownerBlocksViewer || 0) > 0;
};

export const canAccessOwnedContent = async (
    ownerId: string,
    isPublic: boolean,
    viewerId?: string
): Promise<boolean> => {
    if (viewerId && viewerId === ownerId) {
        return true;
    }

    if (!isPublic) {
        return false;
    }

    return !(await hasUserBlockRelationship(viewerId, ownerId));
};

const buildReviewStatsByMangaId = (reviews: any[] = []) => {
    const reviewStatsByMangaId = new Map<string, { average: number; reviewCount: number }>();
    const reviewBuckets = new Map<string, { total: number; count: number }>();

    for (const review of reviews) {
        const rating =
            (review.rating_story +
                review.rating_characters +
                review.rating_art +
                review.rating_progression +
                review.rating_engagement) / 5;

        const currentBucket = reviewBuckets.get(review.manga_id) || { total: 0, count: 0 };
        currentBucket.total += rating;
        currentBucket.count += 1;
        reviewBuckets.set(review.manga_id, currentBucket);
    }

    for (const [mangaId, bucket] of reviewBuckets.entries()) {
        reviewStatsByMangaId.set(mangaId, {
            average: Math.round((bucket.total / bucket.count) * 10) / 10,
            reviewCount: bucket.count,
        });
    }

    return reviewStatsByMangaId;
};

const buildChapterCountByMangaId = (chapters: any[] = []) => {
    const chapterCountByMangaId = new Map<string, number>();

    for (const chapter of chapters) {
        chapterCountByMangaId.set(
            chapter.manga_id,
            (chapterCountByMangaId.get(chapter.manga_id) || 0) + 1,
        );
    }

    return chapterCountByMangaId;
};

// ==================== MANGA OPERATIONS ====================

/**
 * Fetch all mangas from Supabase
 */
export const getAllMangas = async (): Promise<Manga[]> => {
    if (allMangasCache && Date.now() - allMangasCache.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        return allMangasCache.value;
    }

    if (allMangasPromise) {
        return allMangasPromise;
    }

    // Add a safety timeout
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Manga fetch timeout')), 8000)
    );

    try {
        const fetchManga = async () => {
            const [
                { data, error },
                { data: revData, error: reviewsError },
                { data: cData, error: chaptersError },
            ] = await Promise.all([
                supabase
                    .from('mangas')
                    .select('*')
                    .order('last_updated', { ascending: false }),
                supabase
                    .from('reviews')
                    .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement'),
                supabase
                    .from('chapters')
                    .select('id, manga_id, number')
                    .order('number', { ascending: true }),
            ]);

            if (error) throw error;
            if (reviewsError) console.error('Manga list review aggregate fetch error:', reviewsError);
            if (chaptersError) console.error('Manga list chapter aggregate fetch error:', chaptersError);

            const chaptersByMangaId = new Map<string, { id: string; number: number }[]>();
            for (const chapter of cData || []) {
                const mangaChapters = chaptersByMangaId.get(chapter.manga_id) || [];
                mangaChapters.push({ id: chapter.id, number: chapter.number });
                chaptersByMangaId.set(chapter.manga_id, mangaChapters);
            }

            const reviewStatsByMangaId = new Map<string, { average: number; reviewCount: number }>();
            const reviewBuckets = new Map<string, { total: number; count: number }>();
            for (const review of revData || []) {
                const rating =
                    (review.rating_story +
                        review.rating_characters +
                        review.rating_art +
                        review.rating_progression +
                        review.rating_engagement) / 5;

                const currentBucket = reviewBuckets.get(review.manga_id) || { total: 0, count: 0 };
                currentBucket.total += rating;
                currentBucket.count += 1;
                reviewBuckets.set(review.manga_id, currentBucket);
            }

            for (const [mangaId, bucket] of reviewBuckets.entries()) {
                reviewStatsByMangaId.set(mangaId, {
                    average: Math.round((bucket.total / bucket.count) * 10) / 10,
                    reviewCount: bucket.count,
                });
            }

            return (data || []).map((m) => {
                const mangaChapters = chaptersByMangaId.get(m.id) || [];
                const reviewStats = reviewStatsByMangaId.get(m.id);
                const average = reviewStats?.average || 0;
                const reviewCount = reviewStats?.reviewCount || 0;

                return {
                    ...m,
                    alternativeTitles: m.alternative_titles || [],
                    lastUpdated: m.last_updated,
                    createdAt: m.created_at,
                    releaseYear: m.release_year,
                    chapters: mangaChapters,
                    ratings: Array(reviewCount).fill({ rating: average }), // Simplified for list view
                    averageRating: average,
                    reviewCount,
                } as any;
            });
        };

        allMangasPromise = Promise.race([fetchManga(), timeout]) as Promise<Manga[]>;
        const mangas = await allMangasPromise;
        allMangasCache = {
            fetchedAt: Date.now(),
            value: mangas,
        };

        return mangas;
    } catch (error) {
        invalidateAllMangasCache();
        console.error('Manga fetch global error:', error);
        return [];
    } finally {
        allMangasPromise = null;
    }
};

export const getMangaSummaries = async (): Promise<Manga[]> => {
    if (mangaSummariesCache && Date.now() - mangaSummariesCache.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        return mangaSummariesCache.value;
    }

    if (allMangasCache && Date.now() - allMangasCache.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        const summarized = allMangasCache.value.map((manga) => ({
            ...manga,
            chapters: [],
            ratings: [],
            chapterCount: typeof manga.chapterCount === 'number' ? manga.chapterCount : manga.chapters.length,
        }));
        mangaSummariesCache = {
            fetchedAt: allMangasCache.fetchedAt,
            value: summarized,
        };
        return summarized;
    }

    if (mangaSummariesPromise) {
        return mangaSummariesPromise;
    }

    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Manga summary fetch timeout')), 8000)
    );

    try {
        const fetchSummaries = async () => {
            const [
                { data: mangaRows, error: mangaError },
                { data: reviewRows, error: reviewError },
                { data: chapterRows, error: chapterError },
            ] = await Promise.all([
                supabase
                    .from('mangas')
                    .select('id, title, alternative_titles, cover, banner, author, artist, status, genres, description, views, last_updated, created_at, type, release_year')
                    .order('last_updated', { ascending: false }),
                supabase
                    .from('reviews')
                    .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement'),
                supabase
                    .from('chapters')
                    .select('manga_id'),
            ]);

            if (mangaError) {
                throw mangaError;
            }

            if (reviewError) {
                console.error('Manga summary review aggregate fetch error:', reviewError);
            }

            if (chapterError) {
                console.error('Manga summary chapter aggregate fetch error:', chapterError);
            }

            const reviewStatsByMangaId = buildReviewStatsByMangaId(reviewRows || []);
            const chapterCountByMangaId = buildChapterCountByMangaId(chapterRows || []);

            return (mangaRows || []).map((manga: any) => {
                const reviewStats = reviewStatsByMangaId.get(manga.id);

                return {
                    ...manga,
                    alternativeTitles: manga.alternative_titles || [],
                    lastUpdated: manga.last_updated,
                    createdAt: manga.created_at,
                    releaseYear: manga.release_year,
                    chapters: [],
                    ratings: [],
                    chapterCount: chapterCountByMangaId.get(manga.id) || 0,
                    averageRating: reviewStats?.average || 0,
                    reviewCount: reviewStats?.reviewCount || 0,
                } as Manga;
            });
        };

        mangaSummariesPromise = Promise.race([fetchSummaries(), timeout]) as Promise<Manga[]>;
        const summaries = await mangaSummariesPromise;
        mangaSummariesCache = {
            fetchedAt: Date.now(),
            value: summaries,
        };

        return summaries;
    } catch (error) {
        mangaSummariesCache = null;
        mangaSummariesPromise = null;
        console.error('Manga summary fetch global error:', error);
        return [];
    } finally {
        mangaSummariesPromise = null;
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
        genres: normalizeGenres(manga.genres),
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
    invalidateAllMangasCache();

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
    invalidateAllMangasCache();
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
    invalidateAllMangasCache();
    return true;
};

export const deleteChapter = async (mangaId: string, chapterId: string): Promise<boolean> => {
    const { error } = await supabase
        .from('chapters')
        .delete()
        .eq('id', chapterId)
        .eq('manga_id', mangaId);

    if (!error) {
        invalidateAllMangasCache();
    }

    return !error;
};

export const getLatestChapters = async (limit?: number, offset: number = 0): Promise<LatestChapterFeedItem[]> => {
    const end = typeof limit === 'number' ? offset + limit - 1 : undefined;

    let query = supabase
        .from('chapters')
        .select(`
            id,
            manga_id,
            number,
            title,
            created_at,
            release_date,
            mangas:manga_id(id, title, cover, type)
        `)
        .order('created_at', { ascending: false });

    if (typeof end === 'number') {
        query = query.range(offset, end);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Latest chapters fetch error:', error);
        return [];
    }

    return (data || [])
        .map((chapter: any) => {
            const manga = Array.isArray(chapter.mangas) ? chapter.mangas[0] : chapter.mangas;

            if (!manga?.id) {
                return null;
            }

            return {
                chapterId: chapter.id,
                mangaId: manga.id,
                mangaTitle: manga.title,
                mangaCover: manga.cover,
                mangaType: manga.type,
                chapterNumber: Number(chapter.number),
                chapterTitle: chapter.title || undefined,
                addedAt: chapter.created_at || chapter.release_date,
                releaseDate: chapter.release_date || undefined,
            } satisfies LatestChapterFeedItem;
        })
        .filter(Boolean) as LatestChapterFeedItem[];
};

export const getLatestChaptersCountLast24Hours = async (): Promise<number> => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
        .from('chapters')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);

    if (error) {
        console.error('Latest chapters 24h count error:', error);
        return 0;
    }

    return count || 0;
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
            user:users!user_id(username, avatar, role),
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
        userRole: (r as any).user?.role,
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

const mapAdminDirectoryUser = (user: any): User => ({
    id: user.id,
    username: user.username,
    email: user.email || '',
    avatar: user.avatar,
    role: user.role,
    isBanned: user.is_banned || false,
    banReason: user.ban_reason || undefined,
    bannedAt: user.banned_at || undefined,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at || undefined,
});

const ensureAuthenticatedAdminSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
        throw error;
    }

    const session = data.session;
    if (!session?.user || !session.access_token) {
        throw new Error('ADMIN_SESSION_REQUIRED');
    }

    return session;
};

const buildPrimaryAdminFallback = (
    sessionEmail?: string | null,
    role?: User['role']
) => Boolean(
    role === 'admin'
    && sessionEmail
    && sessionEmail.toLowerCase() === PRIMARY_ADMIN_EMAIL
);

const isMissingTableInSchemaCache = (error: any, tableName: string) =>
    error?.code === 'PGRST205'
    && String(error?.message || '').includes(`public.${tableName}`);

const getAdminDirectoryViaEdgeFunction = async (): Promise<User[]> => {
    const session = await ensureAuthenticatedAdminSession();

    const { data, error } = await supabase.functions.invoke('admin-user-directory', {
        body: {},
    });

    if (error) {
        throw error;
    }

    if (!data?.success || !Array.isArray(data?.users)) {
        throw new Error(data?.message || 'ADMIN_DIRECTORY_FAILED');
    }

    return data.users.map(mapAdminDirectoryUser);
};

export const getAdminAccessContext = async (): Promise<AdminAccessContext> => {
    if (adminAccessContextPromise) {
        return adminAccessContextPromise;
    }

    adminAccessContextPromise = (async () => {
        const { data: authData, error: authError } = await supabase.auth.getUser();

        if (authError || !authData.user) {
            return {
                canAccessAdminPanel: false,
                isPrimaryAdmin: false,
            };
        }

        const authUserId = authData.user.id;

        if (adminAccessContextCache?.authUserId === authUserId) {
            return adminAccessContextCache.value;
        }

        const persist = (value: AdminAccessContext) => {
            adminAccessContextCache = {
                authUserId,
                value,
            };

            return value;
        };

        const { data: ownProfile, error: ownProfileError } = await supabase
            .from('users')
            .select('role')
            .eq('id', authUserId)
            .maybeSingle();

        if (ownProfileError) {
            console.error('Admin access context profile error:', ownProfileError);
            return persist({
                canAccessAdminPanel: false,
                isPrimaryAdmin: false,
            });
        }

        const role = ownProfile?.role as User['role'] | undefined;

        if (role !== 'admin' && role !== 'moderator') {
            return persist({
                userId: authUserId,
                role,
                canAccessAdminPanel: false,
                isPrimaryAdmin: false,
            });
        }

        try {
            await getAdminDirectoryViaEdgeFunction();

            return persist({
                userId: authUserId,
                role,
                canAccessAdminPanel: true,
                isPrimaryAdmin: buildPrimaryAdminFallback(authData.user.email, role),
            });
        } catch (edgeError) {
            console.warn('Admin access context edge fallback error:', edgeError);
        }

        try {
            const { error: rpcFallbackError } = await supabase.rpc('get_admin_user_directory');

            if (!rpcFallbackError) {
                return persist({
                    userId: authUserId,
                    role,
                    canAccessAdminPanel: true,
                    isPrimaryAdmin: buildPrimaryAdminFallback(authData.user.email, role),
                });
            }

            console.error('Admin access context legacy RPC fallback error:', rpcFallbackError);
        } catch (legacyError) {
            console.error('Admin access context legacy RPC fallback exception:', legacyError);
        }

        return persist({
            canAccessAdminPanel: false,
            isPrimaryAdmin: false,
        });
    })();

    try {
        return await adminAccessContextPromise;
    } finally {
        adminAccessContextPromise = null;
    }
};

export const getAllUsers = async (): Promise<User[]> => {
    try {
        return await getAdminDirectoryViaEdgeFunction();
    } catch (edgeError) {
        console.error('Admin directory edge error:', edgeError);
    }

    const { data, error } = await supabase.rpc('get_admin_user_directory');
    if (!error) {
        return (data || []).map(mapAdminDirectoryUser);
    }

    console.error('Admin directory RPC error:', error);
    return [];
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
    await ensureAuthenticatedAdminSession();

    const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: {
            targetUserId: userId,
        },
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'DELETE_USER_FAILED');
    }
};

// Admin Management
export type AdminUser = User; // Reuse User type for now

export const getAdminUsers = async (): Promise<AdminUser[]> => {
    try {
        const allUsers = await getAdminDirectoryViaEdgeFunction();
        return allUsers.filter((user) => ['admin', 'moderator'].includes(user.role || 'user')) as AdminUser[];
    } catch (edgeError) {
        console.error('Admin staff edge error:', edgeError);
    }

    const { data, error } = await supabase.rpc('get_admin_user_directory');
    if (!error) {
        return (data || [])
            .filter((user: any) => ['admin', 'moderator'].includes(user.role))
            .map(mapAdminDirectoryUser) as AdminUser[];
    }

    console.error('Admin staff RPC error:', error);
    return [];
};

export const addAdminUser = async (admin: any): Promise<void> => {
    if (!admin?.userId) {
        throw new Error('USER_ID_REQUIRED');
    }

    if (admin?.role && admin.role !== 'moderator') {
        throw new Error('ONLY_MODERATOR_ALLOWED');
    }

    const { data: targetUser, error: targetUserError } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', admin.userId)
        .single();

    if (targetUserError || !targetUser) {
        throw targetUserError || new Error('USER_NOT_FOUND');
    }

    if (targetUser.role === 'admin') {
        throw new Error('ADMIN_PROMOTION_BLOCKED');
    }

    const { error } = await supabase.rpc('admin_set_user_role', {
        p_role: 'moderator',
        p_user_id: admin.userId,
    });

    if (error) {
        throw error;
    }
};

export const getMangasByIds = async (mangaIds: string[]): Promise<Manga[]> => {
    const uniqueIds = [...new Set(mangaIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
        return [];
    }

    try {
        const [
            { data: mangaData, error: mangaError },
            { data: chapterData },
            { data: reviewData },
        ] = await Promise.all([
            supabase
                .from('mangas')
                .select('*')
                .in('id', uniqueIds),
            supabase
                .from('chapters')
                .select('id, manga_id, number, title, pages, release_date, views')
                .in('manga_id', uniqueIds),
            supabase
                .from('reviews')
                .select('manga_id, user_id, created_at, rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
                .in('manga_id', uniqueIds),
        ]);

        if (mangaError) {
            throw mangaError;
        }

        const allChapters = chapterData || [];
        const allReviews = reviewData || [];

        const mangaMap = new Map(
            (mangaData || []).map((m) => {
                const mangaChapters = allChapters.filter((chapter: any) => chapter.manga_id === m.id);
                const mangaReviews = allReviews.filter((review: any) => review.manga_id === m.id);
                const normalizedRatings = mangaReviews.map((review: any) => ({
                    userId: review.user_id,
                    rating: Math.round((((review.rating_story + review.rating_characters + review.rating_art + review.rating_progression + review.rating_engagement) / 5) * 10)) / 10,
                    createdAt: review.created_at,
                }));
                const averageRating = normalizedRatings.length > 0
                    ? Math.round(((normalizedRatings.reduce((sum, rating) => sum + rating.rating, 0) / normalizedRatings.length) * 10)) / 10
                    : 0;

                return [m.id, {
                    ...m,
                    alternativeTitles: m.alternative_titles || [],
                    releaseYear: m.release_year,
                    lastUpdated: m.last_updated,
                    createdAt: m.created_at,
                    chapters: mangaChapters.map((chapter: any) => ({
                        id: chapter.id,
                        number: chapter.number,
                        title: chapter.title || '',
                        pages: chapter.pages || [],
                        releaseDate: chapter.release_date || '',
                        views: chapter.views || 0,
                    })),
                    ratings: normalizedRatings,
                    averageRating,
                    reviewCount: normalizedRatings.length,
                } as Manga];
            }),
        );

        return uniqueIds
            .map((id) => mangaMap.get(id))
            .filter(Boolean) as Manga[];
    } catch (error) {
        console.error('Manga by ids fetch error:', error);
        return [];
    }
};

export const deleteAdminUser = async (adminId: string): Promise<void> => {
    const { data: staffUser, error: staffError } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', adminId)
        .single();

    if (staffError || !staffUser) {
        throw staffError || new Error('STAFF_NOT_FOUND');
    }

    if (staffUser.role === 'admin') {
        throw new Error('PRIMARY_ADMIN_PROTECTED');
    }

    const { error } = await supabase.rpc('admin_set_user_role', {
        p_role: 'user',
        p_user_id: adminId,
    });

    if (error) {
        throw error;
    }
};

export type UserBanMode = 'user' | 'hard';

export interface BanUserAccessOptions {
    reason?: string;
    mode?: UserBanMode;
}

export interface BanUserAccessResult {
    mode: UserBanMode;
    ipBanCount: number;
    deviceBanCount: number;
    message?: string;
}

export const banUserAccess = async (
    userId: string,
    reasonOrOptions: string | BanUserAccessOptions = {}
): Promise<BanUserAccessResult> => {
    const session = await ensureAuthenticatedAdminSession();

    const options = typeof reasonOrOptions === 'string'
        ? { reason: reasonOrOptions }
        : reasonOrOptions;

    const mode = options.mode ?? 'hard';
    const reason = options.reason ?? 'Yönetici tarafından banlandı.';

    const { data, error } = await supabase.functions.invoke('admin-ban-user', {
        body: {
            targetUserId: userId,
            reason,
            mode,
        },
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'BAN_FAILED');
    }

    return {
        mode,
        ipBanCount: Number(data?.ipBanCount) || 0,
        deviceBanCount: Number(data?.deviceBanCount) || 0,
        message: typeof data?.message === 'string' ? data.message : undefined,
    };
};

export const unbanUserAccess = async (userId: string): Promise<void> => {
    const session = await ensureAuthenticatedAdminSession();
    const { data, error } = await supabase.functions.invoke('admin-unban-user', {
        body: {
            targetUserId: userId,
        },
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'UNBAN_FAILED');
    }
};

export const authenticateAdmin = async (email: string, password: string): Promise<User | null> => {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (authError || !authData.user) return null;

    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, username, avatar, role, created_at')
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
        avatar: userData.avatar,
        email: authData.user.email || '',
    } as User;
};

// ==================== STATISTICS ====================

export const getStatistics = async () => {
    const { count: mangaCount } = await supabase.from('mangas').select('*', { count: 'exact', head: true });
    const { count: chapterCount } = await supabase.from('chapters').select('*', { count: 'exact', head: true });
    const { count: commentCount } = await supabase.from('comments').select('*', { count: 'exact', head: true });
    const { count: userCount } = await supabase.from('users').select('id', { count: 'exact', head: true });

    const { data: mangaData } = await supabase.from('mangas').select('type, status, views');

    const totalViews = mangaData?.reduce((sum, m) => sum + (m.views || 0), 0) || 0;

    const mangasByType = {
        manga: mangaData?.filter(m => m.type === 'manga').length || 0,
        manhwa: mangaData?.filter(m => m.type === 'manhwa').length || 0,
        manhua: mangaData?.filter(m => m.type === 'manhua').length || 0,
        webtoon: mangaData?.filter(m => m.type === 'webtoon').length || 0,
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

interface MangaCommentQueryOptions {
    pageNumber?: number | null;
}

let mangaCommentPageNumberFeatureState: 'unknown' | 'available' | 'unavailable' = 'unknown';

const isMissingMangaCommentPageNumberError = (error: unknown) => {
    const message = typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : '';

    return message.includes("'page_number' column")
        || message.includes('"page_number"')
        || message.includes('page_number');
};

export const getCommentsForManga = async (
    mangaId: string,
    chapterId?: string,
    sortBy: 'newest' | 'popular' = 'newest',
    options?: MangaCommentQueryOptions
): Promise<Comment[]> => {
    return getEntityCommentsV2('manga', mangaId, chapterId, sortBy, options);
};

export const getEntityCommentsV2 = async (
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string,
    chapterId?: string,
    sortBy: 'newest' | 'popular' = 'newest',
    options?: MangaCommentQueryOptions
): Promise<Comment[]> => {
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const colName = entityType === 'manga' ? 'manga_id' : `${entityType}_id`;
    const likesTableName = entityType === 'manga' ? 'comment_likes' : `${entityType}_comment_likes`;

    const createQuery = (includePageNumberFilter: boolean) => {
        let query = supabase
            .from(tableName as any)
            .select(`
                *,
                author:users!user_id(username, username_last_changed_at, avatar, role),
                likes_count:${likesTableName}(count)
            ` as any)
            .eq(colName, entityId);

        if (entityType === 'manga') {
            if (chapterId) {
                query = query.eq('chapter_id', chapterId);

                if (includePageNumberFilter) {
                    if (typeof options?.pageNumber === 'number') {
                        query = query.eq('page_number', options.pageNumber);
                    } else {
                        query = query.is('page_number', null);
                    }
                }
            } else {
                query = query.is('chapter_id', null);
            }
        }

        return query;
    };

    const shouldUsePageNumberFilter = entityType === 'manga'
        && Boolean(chapterId)
        && mangaCommentPageNumberFeatureState !== 'unavailable';

    let { data, error } = await createQuery(shouldUsePageNumberFilter);

    if (error && shouldUsePageNumberFilter && isMissingMangaCommentPageNumberError(error)) {
        mangaCommentPageNumberFeatureState = 'unavailable';
        ({ data, error } = await createQuery(false));
    }

    if (error) {
        console.error(`Fetch ${entityType} comments error:`, error);
        return [];
    }

    if (shouldUsePageNumberFilter && mangaCommentPageNumberFeatureState === 'unknown') {
        mangaCommentPageNumberFeatureState = 'available';
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
            pageNumber: c.page_number ?? undefined,
            userId: c.user_id,
            username: c.author?.username || c.username || 'Anonim',
            usernameChangedAt: c.author?.username_last_changed_at || undefined,
            userAvatar: c.author?.avatar || c.user_avatar,
            userRole: c.author?.role,
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
            isPinned: Boolean(c.is_pinned),
        };
    }) as Comment[];

    return mappedComments.sort((a, b) => {
        const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinDiff !== 0) {
            return pinDiff;
        }

        if (sortBy === 'popular') {
            const likeDiff = b.likes - a.likes;
            if (likeDiff !== 0) {
                return likeDiff;
            }
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
};


export const addComment = async (comment: Omit<Comment, 'id' | 'likes' | 'likedBy' | 'createdAt' | 'updatedAt'>): Promise<Comment> => {
    return addCommentV2(comment);
};

export const addCommentV2 = async (comment: Omit<Comment, 'id' | 'likes' | 'likedBy' | 'createdAt' | 'updatedAt'>): Promise<Comment> => {
    const entityType = comment.entityType || 'manga';
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const colName = entityType === 'manga' ? 'manga_id' : `${entityType}_id`;
    const entityId = entityType === 'manga' ? comment.mangaId : comment.entityId;

    const createInsertData = (includePageNumber: boolean) => {
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
            parent_id: comment.parentId,
        };

        if (entityType === 'manga') {
            insertData.chapter_id = comment.chapterId ?? null;

            if (includePageNumber && typeof comment.pageNumber === 'number') {
                insertData.page_number = comment.pageNumber;
            }
        }

        return insertData;
    };

    const shouldIncludePageNumber = entityType === 'manga'
        && typeof comment.pageNumber === 'number'
        && mangaCommentPageNumberFeatureState !== 'unavailable';

    let { data, error } = await supabase
        .from(tableName as any)
        .insert(createInsertData(shouldIncludePageNumber))
        .select()
        .single();

    if (error && shouldIncludePageNumber && isMissingMangaCommentPageNumberError(error)) {
        mangaCommentPageNumberFeatureState = 'unavailable';
        ({ data, error } = await supabase
            .from(tableName as any)
            .insert(createInsertData(false))
            .select()
            .single());
    }

    if (error) throw error;

    if (shouldIncludePageNumber && mangaCommentPageNumberFeatureState === 'unknown') {
        mangaCommentPageNumberFeatureState = 'available';
    }

    return {
        id: data.id,
        mangaId: entityType === 'manga' ? data.manga_id : undefined,
        entityId: entityType !== 'manga' ? data[colName] : undefined,
        entityType,
        chapterId: data.chapter_id,
        pageNumber: data.page_number ?? undefined,
        userId: data.user_id,
        username: data.username,
        userAvatar: data.user_avatar,
        userRole: comment.userRole,
        content: comment.content,
        title: comment.title,
        textColor: comment.textColor,
        mediaUrl: comment.mediaUrl,
        mediaUrls: comment.mediaUrls,
        isSpoiler: comment.isSpoiler,
        gifUrl: comment.gifUrl,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        parentId: data.parent_id ?? comment.parentId,
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
    const { data: existingComment, error: existingCommentError } = await supabase
        .from(tableName as any)
        .select('created_at')
        .eq('id', id)
        .single();

    if (existingCommentError) {
        console.error('Yorum düzenleme ön kontrol hatası:', existingCommentError);
        throw existingCommentError;
    }

    const editDeadline = new Date(existingComment.created_at).getTime() + (24 * 60 * 60 * 1000);
    if (Date.now() > editDeadline) {
        throw new Error('Yorumlar yalnızca ilk 24 saat içinde düzenlenebilir');
    }

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
            pageNumber: c.page_number ?? undefined,
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
            isPinned: Boolean(c.is_pinned),
        };
    }).sort((a, b) => {
        const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinDiff !== 0) {
            return pinDiff;
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }) as Comment[];
};

export const getAdminCommentsPage = async (
    page: number,
    pageSize: number = 30,
    searchQuery: string = '',
): Promise<AdminCommentsPage> => {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const normalizedQuery = searchQuery.trim();

    let query = supabase
        .from('comments')
        .select(`
            *,
            likes_count:comment_likes(count)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

    if (normalizedQuery) {
        query = query.or(`content.ilike.%${normalizedQuery}%,username.ilike.%${normalizedQuery}%`);
    }

    const { data, error, count } = await query;

    if (error) {
        console.error('Admin comments page fetch error:', error);
        return { comments: [], total: 0 };
    }

    const comments = (data || []).map((c: any) => {
        const parsedContent = parseCommentContent(c.content || '');

        return {
            id: c.id,
            mangaId: c.manga_id,
            chapterId: c.chapter_id,
            pageNumber: c.page_number ?? undefined,
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
            likes: c.likes_count?.[0]?.count || 0,
            likedBy: [],
            isPinned: Boolean(c.is_pinned),
        };
    }) as Comment[];

    return {
        comments,
        total: count || 0,
    };
};

export const getMangaTitlesByIds = async (mangaIds: string[]): Promise<Record<string, string>> => {
    const uniqueIds = [...new Set(mangaIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
        return {};
    }

    const { data, error } = await supabase
        .from('mangas')
        .select('id, title')
        .in('id', uniqueIds);

    if (error) {
        console.error('Manga title batch fetch error:', error);
        return {};
    }

    return (data || []).reduce((acc, manga: any) => {
        acc[manga.id] = manga.title;
        return acc;
    }, {} as Record<string, string>);
};

export const setCommentPinned = async (id: string, isPinned: boolean, entityType: string = 'manga'): Promise<void> => {
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const { error } = await supabase
        .from(tableName as any)
        .update({ is_pinned: isPinned } as any)
        .eq('id', id);

    if (error) {
        console.error('Yorum sabitleme hatası:', error);
        throw error;
    }
};

// ==================== REPORT OPERATIONS ====================

export const createMangaReport = async (payload: {
    mangaId: string;
    reporterId: string;
    reason: string;
    details?: string;
}): Promise<void> => {
    const { error } = await supabase
        .from('manga_reports')
        .upsert({
            manga_id: payload.mangaId,
            reporter_id: payload.reporterId,
            reason: payload.reason.trim(),
            details: payload.details?.trim() || null,
            status: 'open',
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'reporter_id,manga_id',
        });

    if (error) {
        console.error('Manga report create error:', error);
        throw error;
    }
};

export const createCommentReport = async (payload: {
    commentId: string;
    commentEntityType: 'manga' | 'character' | 'author' | 'artist';
    targetEntityId: string;
    reporterId: string;
    reportedUserId: string;
    reason: string;
    details?: string;
}): Promise<void> => {
    const { error } = await supabase
        .from('comment_reports')
        .upsert({
            comment_id: payload.commentId,
            comment_entity_type: payload.commentEntityType,
            target_entity_id: payload.targetEntityId,
            reporter_id: payload.reporterId,
            reported_user_id: payload.reportedUserId,
            reason: payload.reason.trim(),
            details: payload.details?.trim() || null,
            status: 'open',
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'reporter_id,comment_entity_type,comment_id',
        });

    if (error) {
        console.error('Comment report create error:', error);
        throw error;
    }
};

export const createProfileReport = async (payload: {
    reporterId: string;
    reportedUserId: string;
    reason: string;
    details?: string;
}): Promise<void> => {
    const { error } = await supabase
        .from('profile_reports')
        .upsert({
            reporter_id: payload.reporterId,
            reported_user_id: payload.reportedUserId,
            reason: payload.reason.trim(),
            details: payload.details?.trim() || null,
            status: 'open',
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'reporter_id,reported_user_id',
        });

    if (error) {
        console.error('Profile report create error:', error);
        throw error;
    }
};

export const getMangaReports = async (): Promise<MangaReport[]> => {
    const { data, error } = await supabase
        .from('manga_reports')
        .select('id, manga_id, reporter_id, reason, details, status, created_at, updated_at')
        .order('created_at', { ascending: false });

    if (error || !data) {
        if (error) {
            console.error('Manga reports fetch error:', error);
        }
        return [];
    }

    const mangaIds = [...new Set(data.map((report: any) => report.manga_id).filter(Boolean))];
    const reporterIds = [...new Set(data.map((report: any) => report.reporter_id).filter(Boolean))];

    const [{ data: mangasData }, { data: reportersData }] = await Promise.all([
        mangaIds.length
            ? supabase.from('mangas').select('id, title, cover').in('id', mangaIds)
            : Promise.resolve({ data: [] as any[] }),
        reporterIds.length
            ? supabase.from('users').select('id, username').in('id', reporterIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const mangaMap = new Map((mangasData || []).map((manga: any) => [manga.id, manga]));
    const reporterMap = new Map((reportersData || []).map((user: any) => [user.id, user.username]));

    return data.map((report: any) => {
        const manga = mangaMap.get(report.manga_id);

        return {
            id: report.id,
            mangaId: report.manga_id,
            mangaTitle: manga?.title || 'Bilinmeyen seri',
            mangaCover: manga?.cover,
            reporterId: report.reporter_id,
            reporterUsername: reporterMap.get(report.reporter_id),
            reason: report.reason,
            details: report.details || undefined,
            status: report.status as ReportStatus,
            createdAt: report.created_at,
            updatedAt: report.updated_at,
        };
    });
};

export const getCommentReports = async (): Promise<CommentReport[]> => {
    const { data, error } = await supabase
        .from('comment_reports')
        .select('id, comment_id, comment_entity_type, target_entity_id, reporter_id, reported_user_id, reason, details, status, created_at, updated_at')
        .order('created_at', { ascending: false });

    if (error || !data) {
        if (error) {
            console.error('Comment reports fetch error:', error);
        }
        return [];
    }

    const reporterIds = [...new Set(data.flatMap((report: any) => [report.reporter_id, report.reported_user_id]).filter(Boolean))];
    const [{ data: usersData }] = await Promise.all([
        reporterIds.length
            ? supabase.from('users').select('id, username').in('id', reporterIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);
    const userMap = new Map((usersData || []).map((user: any) => [user.id, user.username]));

    const groupedIds = {
        manga: data.filter((report: any) => report.comment_entity_type === 'manga').map((report: any) => report.comment_id),
        character: data.filter((report: any) => report.comment_entity_type === 'character').map((report: any) => report.comment_id),
        author: data.filter((report: any) => report.comment_entity_type === 'author').map((report: any) => report.comment_id),
        artist: data.filter((report: any) => report.comment_entity_type === 'artist').map((report: any) => report.comment_id),
    };

    const [
        { data: mangaCommentsData },
        { data: characterCommentsData },
        { data: authorCommentsData },
        { data: artistCommentsData },
    ] = await Promise.all([
        groupedIds.manga.length
            ? supabase.from('comments').select('id, manga_id, user_id, username, content, created_at').in('id', groupedIds.manga)
            : Promise.resolve({ data: [] as any[] }),
        groupedIds.character.length
            ? supabase.from('character_comments').select('id, character_id, user_id, username, content, created_at').in('id', groupedIds.character)
            : Promise.resolve({ data: [] as any[] }),
        groupedIds.author.length
            ? supabase.from('author_comments').select('id, author_id, user_id, username, content, created_at').in('id', groupedIds.author)
            : Promise.resolve({ data: [] as any[] }),
        groupedIds.artist.length
            ? supabase.from('artist_comments').select('id, artist_id, user_id, username, content, created_at').in('id', groupedIds.artist)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const commentMap = new Map<string, any>();
    (mangaCommentsData || []).forEach((comment: any) => commentMap.set(`manga:${comment.id}`, comment));
    (characterCommentsData || []).forEach((comment: any) => commentMap.set(`character:${comment.id}`, comment));
    (authorCommentsData || []).forEach((comment: any) => commentMap.set(`author:${comment.id}`, comment));
    (artistCommentsData || []).forEach((comment: any) => commentMap.set(`artist:${comment.id}`, comment));

    const targetIds = {
        manga: [...new Set(data.filter((report: any) => report.comment_entity_type === 'manga').map((report: any) => report.target_entity_id).filter(Boolean))],
        character: [...new Set(data.filter((report: any) => report.comment_entity_type === 'character').map((report: any) => report.target_entity_id).filter(Boolean))],
        author: [...new Set(data.filter((report: any) => report.comment_entity_type === 'author').map((report: any) => report.target_entity_id).filter(Boolean))],
        artist: [...new Set(data.filter((report: any) => report.comment_entity_type === 'artist').map((report: any) => report.target_entity_id).filter(Boolean))],
    };

    const [
        { data: mangaTargetsData },
        { data: characterTargetsData },
        { data: authorTargetsData },
        { data: artistTargetsData },
    ] = await Promise.all([
        targetIds.manga.length
            ? supabase.from('mangas').select('id, title').in('id', targetIds.manga)
            : Promise.resolve({ data: [] as any[] }),
        targetIds.character.length
            ? supabase.from('characters').select('id, name').in('id', targetIds.character)
            : Promise.resolve({ data: [] as any[] }),
        targetIds.author.length
            ? supabase.from('authors').select('id, name').in('id', targetIds.author)
            : Promise.resolve({ data: [] as any[] }),
        targetIds.artist.length
            ? supabase.from('artists').select('id, name').in('id', targetIds.artist)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const targetTitleMap = new Map<string, string>();
    (mangaTargetsData || []).forEach((target: any) => targetTitleMap.set(`manga:${target.id}`, target.title));
    (characterTargetsData || []).forEach((target: any) => targetTitleMap.set(`character:${target.id}`, target.name));
    (authorTargetsData || []).forEach((target: any) => targetTitleMap.set(`author:${target.id}`, target.name));
    (artistTargetsData || []).forEach((target: any) => targetTitleMap.set(`artist:${target.id}`, target.name));

    return data.map((report: any) => {
        const commentKey = `${report.comment_entity_type}:${report.comment_id}`;
        const targetKey = `${report.comment_entity_type}:${report.target_entity_id}`;
        const comment = commentMap.get(commentKey);
        const parsedContent = comment?.content ? parseCommentContent(comment.content) : null;

        return {
            id: report.id,
            commentId: report.comment_id,
            commentEntityType: report.comment_entity_type,
            targetEntityId: report.target_entity_id,
            targetTitle: targetTitleMap.get(targetKey) || 'Bilinmeyen hedef',
            reporterId: report.reporter_id,
            reporterUsername: userMap.get(report.reporter_id),
            reportedUserId: report.reported_user_id,
            reportedUsername: comment?.username || userMap.get(report.reported_user_id),
            commentPreview: parsedContent?.body || undefined,
            commentCreatedAt: comment?.created_at,
            reason: report.reason,
            details: report.details || undefined,
            status: report.status as ReportStatus,
            createdAt: report.created_at,
            updatedAt: report.updated_at,
        };
    });
};

export const getProfileReports = async (): Promise<ProfileReport[]> => {
    const { data, error } = await supabase
        .from('profile_reports')
        .select('id, reporter_id, reported_user_id, reason, details, status, created_at, updated_at')
        .order('created_at', { ascending: false });

    if (error || !data) {
        if (error) {
            if (isMissingTableInSchemaCache(error, 'profile_reports')) {
                return [];
            }
            console.error('Profile reports fetch error:', error);
        }
        return [];
    }

    const userIds = [...new Set(
        data.flatMap((report: any) => [report.reporter_id, report.reported_user_id]).filter(Boolean)
    )];

    const { data: usersData } = userIds.length
        ? await supabase.from('users').select('id, username, avatar').in('id', userIds)
        : { data: [] as any[] };

    const userMap = new Map((usersData || []).map((user: any) => [user.id, user]));

    return data.map((report: any) => {
        const reporter = userMap.get(report.reporter_id);
        const reported = userMap.get(report.reported_user_id);

        return {
            id: report.id,
            reporterId: report.reporter_id,
            reporterUsername: reporter?.username,
            reportedUserId: report.reported_user_id,
            reportedUsername: reported?.username,
            reportedUserAvatar: reported?.avatar,
            reason: report.reason,
            details: report.details || undefined,
            status: report.status as ReportStatus,
            createdAt: report.created_at,
            updatedAt: report.updated_at,
        };
    });
};

export const updateMangaReportStatus = async (id: string, status: ReportStatus): Promise<void> => {
    const { error } = await supabase
        .from('manga_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error('Manga report status update error:', error);
        throw error;
    }
};

export const updateCommentReportStatus = async (id: string, status: ReportStatus): Promise<void> => {
    const { error } = await supabase
        .from('comment_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error('Comment report status update error:', error);
        throw error;
    }
};

export const updateProfileReportStatus = async (id: string, status: ReportStatus): Promise<void> => {
    const { error } = await supabase
        .from('profile_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error('Profile report status update error:', error);
        throw error;
    }
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

const mapReadingListRow = (row: any, mangaIds: string[] = [], itemSummaries: ReturnType<typeof mapMangaToCachedReadingListItem>[] = []) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    isPublic: row.is_public,
    createdAt: row.created_at,
    mangaIds,
    itemSummaries,
});

const fetchReadingListItemSummaries = async (mangaIds: string[]) => {
    const uniqueMangaIds = [...new Set(mangaIds.filter(Boolean))];
    if (uniqueMangaIds.length === 0 || !isEffectivelyOnline()) {
        return {} as Record<string, ReturnType<typeof mapMangaToCachedReadingListItem>>;
    }

    const [{ data: mangaRows, error: mangaError }, { data: chapterRows, error: chapterError }] = await Promise.all([
        supabase
            .from('mangas')
            .select('id, title, alternative_titles, cover, banner, author, artist, status, genres, description, type, views, last_updated, created_at')
            .in('id', uniqueMangaIds),
        supabase
            .from('chapters')
            .select('manga_id')
            .in('manga_id', uniqueMangaIds),
    ]);

    if (mangaError || !mangaRows) {
        if (mangaError) {
            console.error('Reading list manga summary fetch error:', mangaError);
        }
        return {} as Record<string, ReturnType<typeof mapMangaToCachedReadingListItem>>;
    }

    if (chapterError) {
        console.error('Reading list chapter count fetch error:', chapterError);
    }

    const chapterCountMap = (chapterRows || []).reduce<Record<string, number>>((map, chapter: any) => {
        map[chapter.manga_id] = (map[chapter.manga_id] || 0) + 1;
        return map;
    }, {});

    return mangaRows.reduce<Record<string, ReturnType<typeof mapMangaToCachedReadingListItem>>>((map, manga: any) => {
        map[manga.id] = mapMangaToCachedReadingListItem({
            id: manga.id,
            title: manga.title,
            alternativeTitles: manga.alternative_titles || [],
            cover: manga.cover,
            banner: manga.banner,
            author: manga.author,
            artist: manga.artist,
            status: manga.status,
            genres: manga.genres || [],
            description: manga.description || '',
            ratings: [],
            views: manga.views || 0,
            chapters: [],
            chapterCount: chapterCountMap[manga.id] || 0,
            lastUpdated: manga.last_updated,
            createdAt: manga.created_at,
            type: manga.type,
            averageRating: 0,
            reviewCount: 0,
        } satisfies Manga);
        return map;
    }, {});
};

const fetchRemoteReadingLists = async (userId: string): Promise<Array<ReturnType<typeof mapReadingListRow>>> => {
    const { data, error } = await supabase
        .from('reading_lists')
        .select('id, user_id, name, description, image_url, is_public, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error || !data) {
        return [];
    }

    const listIds = data.map((list: any) => list.id);
    const { data: itemsData } = listIds.length > 0
        ? await supabase.from('reading_list_items').select('list_id, manga_id').in('list_id', listIds)
        : { data: [] };

    const itemMap = (itemsData || []).reduce<Record<string, string[]>>((map, item: any) => {
        if (!map[item.list_id]) {
            map[item.list_id] = [];
        }
        map[item.list_id].push(item.manga_id);
        return map;
    }, {});
    const itemSummariesById = await fetchReadingListItemSummaries(
        Object.values(itemMap).flat(),
    );

    const remoteLists = data.map((list: any) => {
        const mangaIds = itemMap[list.id] || [];
        return mapReadingListRow(
            list,
            mangaIds,
            mangaIds
                .map((mangaId) => itemSummariesById[mangaId])
                .filter(Boolean),
        );
    });

    warmPersistentImageUrls(
        remoteLists.flatMap((list) => [
            list.imageUrl,
            ...list.itemSummaries.map((item) => item.cover),
        ]),
    );
    void Promise.all(
        Object.values(itemSummariesById)
            .map((itemSummary) => cacheOfflineManga(mapCachedReadingListItemToManga(itemSummary))),
    ).catch(() => undefined);

    return remoteLists;
};

const loadReadingListMangas = async (
    mangaIds: string[],
    offlineOnly: boolean,
    itemSummaries: ReturnType<typeof mapMangaToCachedReadingListItem>[] = [],
): Promise<Manga[]> => {
    const resolvedMangaIds = mangaIds.length > 0
        ? mangaIds
        : itemSummaries.map((item) => item.id);

    if (resolvedMangaIds.length === 0) {
        return [];
    }

    const itemSummaryMap = new Map(itemSummaries.map((item) => [item.id, item]));

    if (offlineOnly) {
        const offlineMangas = await Promise.all(resolvedMangaIds.map(async (mangaId) => (
            (await getOfflineMangaDetail(mangaId))
            || (itemSummaryMap.get(mangaId) ? mapCachedReadingListItemToManga(itemSummaryMap.get(mangaId)!) : undefined)
        )));
        return offlineMangas.filter(Boolean) as Manga[];
    }

    const mangas = await Promise.all(resolvedMangaIds.map(async (mangaId) => (
        (await getMangaById(mangaId))
        || (await getOfflineMangaDetail(mangaId))
        || (itemSummaryMap.get(mangaId) ? mapCachedReadingListItemToManga(itemSummaryMap.get(mangaId)!) : undefined)
    )));
    return mangas.filter(Boolean) as Manga[];
};

export const getReadingLists = async (userId: string, onlyPublic: boolean = false): Promise<ReadingList[]> => {
    if (!userId || onlyPublic) {
        return [];
    }

    const cachedLists = getCachedReadingListsState(userId);
    const shouldRefreshRemote = isEffectivelyOnline() && (
        !areReadingListsInitialized(userId)
        || cachedLists.some((list) => list.mangaIds.length === 0 && list.itemSummaries.length === 0)
    );

    if (shouldRefreshRemote) {
        const remoteLists = await fetchRemoteReadingLists(userId);
        setCachedReadingLists(userId, remoteLists);
        return remoteLists.map(mapCachedReadingListToReadingList);
    }

    return cachedLists.map(mapCachedReadingListToReadingList);
};

export const getReadingListById = async (listId: string, viewerId?: string): Promise<ReadingList | undefined> => {
    const offlineOnly = !isEffectivelyOnline();
    const cachedList = viewerId ? getCachedReadingListRecord(viewerId, listId) : undefined;
    const shouldUseRemoteForRepair = Boolean(
        !offlineOnly
        && cachedList
        && cachedList.mangaIds.length === 0
        && cachedList.itemSummaries.length === 0,
    );

    if (cachedList && viewerId === cachedList.userId && !shouldUseRemoteForRepair) {
        const mangas = await loadReadingListMangas(
            cachedList.mangaIds,
            offlineOnly,
            cachedList.itemSummaries,
        );

        return {
            ...mapCachedReadingListToReadingList(cachedList),
            items: mangas,
        };
    }

    if (offlineOnly) {
        return undefined;
    }

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

    const canAccess = await canAccessOwnedContent(data.user_id, Boolean(data.is_public), viewerId);
    if (!canAccess) {
        return undefined;
    }

    const mangaIds = (data.items || []).map((item: any) => item.manga_id);
    let mangas: Manga[] = [];

    if (mangaIds.length > 0) {
        const itemSummaries = Object.values(await fetchReadingListItemSummaries(mangaIds));
        mangas = await loadReadingListMangas(mangaIds, false, itemSummaries);
    }

    if (viewerId && data.user_id === viewerId) {
        const itemSummariesById = await fetchReadingListItemSummaries(mangaIds);
        upsertCachedReadingList(viewerId, mapReadingListRow(
            data,
            mangaIds,
            mangaIds.map((mangaId) => itemSummariesById[mangaId]).filter(Boolean),
        ));
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

export const getLikedReadingLists = async (userId: string): Promise<LikedReadingListPreview[]> => {
    if (!userId || !isEffectivelyOnline()) {
        return [];
    }

    const { data: likesData, error: likesError } = await supabase
        .from('reading_list_likes')
        .select('list_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (likesError || !likesData?.length) {
        if (likesError) {
            console.error('Liked reading lists fetch error:', likesError);
        }
        return [];
    }

    const listIds = [...new Set(likesData.map((entry: any) => entry.list_id).filter(Boolean))];

    const [{ data: listsData, error: listsError }, { data: itemsData }, { data: allLikesData }] = await Promise.all([
        supabase
            .from('reading_lists')
            .select('id, user_id, name, description, image_url, is_public, created_at')
            .in('id', listIds),
        supabase
            .from('reading_list_items')
            .select('list_id')
            .in('list_id', listIds),
        supabase
            .from('reading_list_likes')
            .select('list_id')
            .in('list_id', listIds),
    ]);

    if (listsError || !listsData?.length) {
        if (listsError) {
            console.error('Reading lists detail fetch error:', listsError);
        }
        return [];
    }

    const ownerIds = [...new Set(listsData.map((list: any) => list.user_id).filter(Boolean))];
    const { data: ownerData } = await supabase
        .from('users')
        .select('id, username')
        .in('id', ownerIds);

    const listMap = new Map(
        listsData.map((list: any) => [
            list.id,
            {
                id: list.id,
                userId: list.user_id,
                name: list.name,
                description: list.description,
                imageUrl: list.image_url,
                isPublic: list.is_public,
                createdAt: list.created_at,
            } satisfies ReadingList,
        ])
    );
    const ownerMap = new Map((ownerData || []).map((owner: any) => [owner.id, owner.username]));
    const itemCountMap = (itemsData || []).reduce<Record<string, number>>((accumulator, item: any) => {
        accumulator[item.list_id] = (accumulator[item.list_id] || 0) + 1;
        return accumulator;
    }, {});
    const likesCountMap = (allLikesData || []).reduce<Record<string, number>>((accumulator, like: any) => {
        accumulator[like.list_id] = (accumulator[like.list_id] || 0) + 1;
        return accumulator;
    }, {});

    return likesData
        .map((entry: any) => {
            const list = listMap.get(entry.list_id);

            if (!list) {
                return null;
            }

            return {
                ...list,
                ownerUsername: ownerMap.get(list.userId) || undefined,
                likesCount: likesCountMap[list.id] || 0,
                itemsCount: itemCountMap[list.id] || 0,
                likedAt: entry.created_at,
            } satisfies LikedReadingListPreview;
        })
        .filter(Boolean) as LikedReadingListPreview[];
};

export const createReadingList = async (list: Omit<ReadingList, 'id' | 'createdAt'>): Promise<ReadingList> => {
    const nextList = {
        id: createClientEntityId(),
        userId: list.userId,
        name: list.name,
        description: list.description,
        imageUrl: list.imageUrl,
        isPublic: list.isPublic,
        createdAt: new Date().toISOString(),
        mangaIds: [],
        itemSummaries: [],
    };

    upsertCachedReadingList(list.userId, nextList);
    warmPersistentImageUrls([list.imageUrl]);

    if (!isEffectivelyOnline()) {
        queueReadingListCreate(list.userId, nextList);
        return mapCachedReadingListToReadingList(nextList);
    }

    const { data, error } = await supabase
        .from('reading_lists')
        .insert({
            id: nextList.id,
            user_id: list.userId,
            name: list.name,
            description: list.description,
            image_url: list.imageUrl,
            is_public: list.isPublic
        })
        .select()
        .single();

    if (error) {
        queueReadingListCreate(list.userId, nextList);
        return mapCachedReadingListToReadingList(nextList);
    }

    const persistedList = mapReadingListRow(data, []);
    upsertCachedReadingList(list.userId, persistedList);
    return mapCachedReadingListToReadingList(persistedList);
};

export const getTierListById = async (tierListId: string, viewerId?: string) => {
    const { data, error } = await supabase
        .from('tier_lists')
        .select('*')
        .eq('id', tierListId)
        .maybeSingle();

    if (error || !data) {
        return undefined;
    }

    const canAccess = await canAccessOwnedContent(data.user_id, Boolean(data.is_public), viewerId);
    if (!canAccess) {
        return undefined;
    }

    return data;
};

export const updateReadingList = async (listId: string, updates: Partial<Pick<ReadingList, 'name' | 'description' | 'imageUrl' | 'isPublic'>>): Promise<void> => {
    const cachedEntry = findCachedReadingListRecord(listId);

    if (!cachedEntry) {
        throw new Error('READING_LIST_NOT_FOUND');
    }

    updateCachedReadingList(cachedEntry.userId, listId, (list) => ({
        ...list,
        name: updates.name ?? list.name,
        description: updates.description ?? list.description,
        imageUrl: updates.imageUrl ?? list.imageUrl,
        isPublic: updates.isPublic ?? list.isPublic,
    }));
    warmPersistentImageUrls([updates.imageUrl]);

    if (!isEffectivelyOnline()) {
        queueReadingListUpdate(cachedEntry.userId, listId, updates);
        return;
    }

    const { error } = await supabase
        .from('reading_lists')
        .update({
            name: updates.name,
            description: updates.description,
            image_url: updates.imageUrl,
            is_public: updates.isPublic
        })
        .eq('id', listId)
        .eq('user_id', cachedEntry.userId);

    if (error) {
        queueReadingListUpdate(cachedEntry.userId, listId, updates);
    }
};

export const deleteReadingList = async (listId: string): Promise<void> => {
    const cachedEntry = findCachedReadingListRecord(listId);

    if (!cachedEntry) {
        return;
    }

    removeCachedReadingList(cachedEntry.userId, listId);

    if (!isEffectivelyOnline()) {
        queueReadingListDelete(cachedEntry.userId, listId);
        return;
    }

    const { error } = await supabase
        .from('reading_lists')
        .delete()
        .eq('id', listId)
        .eq('user_id', cachedEntry.userId);

    if (error) {
        queueReadingListDelete(cachedEntry.userId, listId);
    }
};

export const addMangaToReadingList = async (listId: string, mangaId: string): Promise<void> => {
    const cachedEntry = findCachedReadingListRecord(listId);

    if (!cachedEntry) {
        throw new Error('READING_LIST_NOT_FOUND');
    }

    const summary = (
        (await getOfflineMangaDetail(mangaId))
        || (isEffectivelyOnline() ? await getMangaById(mangaId) : undefined)
    );
    const itemSummary = summary ? mapMangaToCachedReadingListItem(summary) : undefined;

    if (summary) {
        void cacheOfflineManga(summary).catch(() => undefined);
    }

    updateCachedReadingList(cachedEntry.userId, listId, (list) => ({
        ...list,
        mangaIds: list.mangaIds.includes(mangaId) ? list.mangaIds : [...list.mangaIds, mangaId],
        itemSummaries: itemSummary
            ? [
                itemSummary,
                ...list.itemSummaries.filter((item) => item.id !== mangaId),
            ]
            : list.itemSummaries,
    }));
    warmPersistentImageUrls([itemSummary?.cover]);

    if (!isEffectivelyOnline()) {
        queueReadingListAddItem(cachedEntry.userId, listId, mangaId);
        return;
    }

    const { error } = await supabase
        .from('reading_list_items')
        .upsert({
            list_id: listId,
            manga_id: mangaId
        }, { onConflict: 'list_id,manga_id' });

    if (error) {
        queueReadingListAddItem(cachedEntry.userId, listId, mangaId);
    }
};

export const removeMangaFromReadingList = async (listId: string, mangaId: string): Promise<void> => {
    const cachedEntry = findCachedReadingListRecord(listId);

    if (!cachedEntry) {
        return;
    }

    updateCachedReadingList(cachedEntry.userId, listId, (list) => ({
        ...list,
        mangaIds: list.mangaIds.filter((entry) => entry !== mangaId),
        itemSummaries: list.itemSummaries.filter((item) => item.id !== mangaId),
    }));

    if (!isEffectivelyOnline()) {
        queueReadingListRemoveItem(cachedEntry.userId, listId, mangaId);
        return;
    }

    const { error } = await supabase
        .from('reading_list_items')
        .delete()
        .eq('list_id', listId)
        .eq('manga_id', mangaId);

    if (error) {
        queueReadingListRemoveItem(cachedEntry.userId, listId, mangaId);
    }
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
    const cachedEntry = findCachedReadingListRecord(listId);

    if (cachedEntry) {
        return cachedEntry.list.mangaIds.includes(mangaId)
            || cachedEntry.list.itemSummaries.some((item) => item.id === mangaId);
    }

    if (!isEffectivelyOnline()) {
        return false;
    }

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

    const seriesIds = ((data as any).mangas || [])
        .map((item: any) => item.manga?.id)
        .filter(Boolean);

    const [{ count }, series] = await Promise.all([
        supabase
            .from('characters')
            .select('*', { count: 'exact', head: true })
            .gt('likes_count', data.likes_count),
        getMangasByIds(seriesIds),
    ]);

    return {
        id: data.id,
        name: data.name,
        imageUrl: data.image_url,
        description: data.description,
        likesCount: data.likes_count,
        createdAt: data.created_at,
        rank: (count || 0) + 1,
        series,
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
    return (data || []).map(mapAuthorRow);
};

export const getArtists = async () => {
    const { data } = await supabase.from('artists').select('*').order('name');
    return (data || []).map(mapArtistRow);
};

export const getAuthorById = async (id: string): Promise<Author | undefined> => {
    const { data, error } = await supabase
        .from('authors')
        .select(`*, mangas:manga_authors(manga:mangas(*))`)
        .eq('id', id)
        .maybeSingle();
    if (error || !data) return undefined;

    const seriesIds = ((data as any).mangas || [])
        .map((item: any) => item.manga?.id)
        .filter(Boolean);
    const series = await getMangasByIds(seriesIds);

    return { ...data, imageUrl: data.image_url, likesCount: data.likes_count, series };
};

export const getArtistById = async (id: string): Promise<Artist | undefined> => {
    const { data, error } = await supabase
        .from('artists')
        .select(`*, mangas:manga_artists(manga:mangas(*))`)
        .eq('id', id)
        .maybeSingle();
    if (error || !data) return undefined;

    const seriesIds = ((data as any).mangas || [])
        .map((item: any) => item.manga?.id)
        .filter(Boolean);
    const series = await getMangasByIds(seriesIds);

    return { ...data, imageUrl: data.image_url, likesCount: data.likes_count, series };
};

export const findAuthorByName = async (name: string): Promise<Author | null> => {
    const normalizedName = normalizeNamedEntityValue(name);
    if (!isMeaningfulNamedEntity(normalizedName)) {
        return null;
    }

    const { data, error } = await supabase
        .from('authors')
        .select('*')
        .ilike('name', normalizedName)
        .limit(1);

    if (error) throw error;
    return data?.[0] ? mapAuthorRow(data[0]) : null;
};

export const findArtistByName = async (name: string): Promise<Artist | null> => {
    const normalizedName = normalizeNamedEntityValue(name);
    if (!isMeaningfulNamedEntity(normalizedName)) {
        return null;
    }

    const { data, error } = await supabase
        .from('artists')
        .select('*')
        .ilike('name', normalizedName)
        .limit(1);

    if (error) throw error;
    return data?.[0] ? mapArtistRow(data[0]) : null;
};

export const saveAuthor = async (author: Partial<Author>) => {
    const normalizedName = normalizeNamedEntityValue(author.name);
    if (!normalizedName) {
        throw new Error('AUTHOR_NAME_REQUIRED');
    }

    const data = { name: normalizedName, image_url: author.imageUrl, description: author.description };
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
    const normalizedName = normalizeNamedEntityValue(artist.name);
    if (!normalizedName) {
        throw new Error('ARTIST_NAME_REQUIRED');
    }

    const data = { name: normalizedName, image_url: artist.imageUrl, description: artist.description };
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

export const ensureAuthorByName = async (name: string): Promise<Author | null> => {
    const normalizedName = normalizeNamedEntityValue(name);
    if (!isMeaningfulNamedEntity(normalizedName)) {
        return null;
    }

    const existing = await findAuthorByName(normalizedName);
    if (existing) {
        return existing;
    }

    const id = await saveAuthor({ name: normalizedName });
    return {
        id,
        name: normalizedName,
        imageUrl: undefined,
        description: undefined,
        likesCount: 0,
        createdAt: new Date().toISOString(),
    };
};

export const ensureArtistByName = async (name: string): Promise<Artist | null> => {
    const normalizedName = normalizeNamedEntityValue(name);
    if (!isMeaningfulNamedEntity(normalizedName)) {
        return null;
    }

    const existing = await findArtistByName(normalizedName);
    if (existing) {
        return existing;
    }

    const id = await saveArtist({ name: normalizedName });
    return {
        id,
        name: normalizedName,
        imageUrl: undefined,
        description: undefined,
        likesCount: 0,
        createdAt: new Date().toISOString(),
    };
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

const COMMUNITY_VISIBLE_TAG_FILTER = 'is_official.eq.true,community_approved.eq.true';

const isGloballyAvailableTag = (
    tag?: Pick<Tag, 'isOfficial' | 'communityApproved'>
    | { is_official?: boolean | null; community_approved?: boolean | null }
    | null
) => Boolean(
    tag
    && ('isOfficial' in tag ? tag.isOfficial : (tag as any).is_official)
    || (
        tag
        && ('communityApproved' in tag ? tag.communityApproved : (tag as any).community_approved)
    )
);

const filterGloballyAvailableTagRows = <TRow extends { is_official?: boolean | null; community_approved?: boolean | null }>(
    rows: TRow[] = [],
    includePending?: boolean
) => (
    includePending
        ? rows
        : rows.filter((row) => isGloballyAvailableTag(row))
);

export interface TagModerationSyncResult {
    tagDeleted: boolean;
    relationDeleted: boolean;
    communityApproved: boolean;
    relationDiscoverable: boolean;
    globalUp: number;
    globalDown: number;
    localUp: number;
    localDown: number;
}

const mapTagRow = (tag: any, relation?: { is_discoverable?: boolean } | null): Tag => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    category: tag.category as TagCategory,
    description: tag.description,
    usageCount: tag.usage_count,
    isOfficial: tag.is_official,
    communityApproved: tag.community_approved,
    isDiscoverable: relation?.is_discoverable ?? tag.is_official ?? false,
    createdBy: tag.created_by,
    createdAt: tag.created_at
});

export const getAllTags = async (options?: { includePending?: boolean }): Promise<Tag[]> => {
    let query = supabase
        .from('tags')
        .select('*')
        .order('usage_count', { ascending: false });

    if (!options?.includePending) {
        query = query.or(COMMUNITY_VISIBLE_TAG_FILTER);
    }

    const { data, error } = await query;

    if (error) return [];
    return filterGloballyAvailableTagRows(data || [], options?.includePending).map((tag) => mapTagRow(tag));
};

export const getTagsByCategory = async (
    category: TagCategory,
    options?: { includePending?: boolean }
): Promise<Tag[]> => {
    let query = supabase
        .from('tags')
        .select('*')
        .eq('category', category)
        .order('usage_count', { ascending: false });

    if (!options?.includePending) {
        query = query.or(COMMUNITY_VISIBLE_TAG_FILTER);
    }

    const { data, error } = await query;

    if (error) return [];
    return filterGloballyAvailableTagRows(data || [], options?.includePending).map((tag) => mapTagRow(tag));
};

export const searchTags = async (
    query: string,
    options?: { includePending?: boolean }
): Promise<Tag[]> => {
    let searchQuery = supabase
        .from('tags')
        .select('*')
        .ilike('name', `%${query}%`)
        .order('usage_count', { ascending: false })
        .limit(20);

    if (!options?.includePending) {
        searchQuery = searchQuery.or(COMMUNITY_VISIBLE_TAG_FILTER);
    }

    const { data, error } = await searchQuery;

    if (error) return [];
    return filterGloballyAvailableTagRows(data || [], options?.includePending).map((tag) => mapTagRow(tag));
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
        ...mapTagRow(data),
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
            is_discoverable,
            tag:tags(*)
        `)
        .eq(colName, entityId);

    if (error) return [];

    return (data as any[])
        .filter(d => d.tag)
        .map(d => mapTagRow(d.tag, d));
};

export const addTagToEntity = async (
    entityType: 'manga' | 'character' | 'author' | 'artist',
    entityId: string,
    tagId: string,
    userId?: string,
    options?: {
        discoverable?: boolean;
    }
): Promise<boolean> => {
    const tableName = `${entityType}_tags`;
    const colName = `${entityType}_id`;

    let discoverable = options?.discoverable;

    if (discoverable === undefined) {
        const { data: tagRow } = await supabase
            .from('tags')
            .select('is_official')
            .eq('id', tagId)
            .maybeSingle();

        discoverable = !!tagRow?.is_official;
    }

    const { error } = await supabase
        .from(tableName as any)
        .upsert({
            [colName]: entityId,
            tag_id: tagId,
            added_by: userId,
            is_discoverable: discoverable ?? false,
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
): Promise<TagModerationSyncResult | null> => {
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

    const { data, error } = await supabase.rpc('sync_tag_moderation', {
        p_tag_id: tagId,
        p_entity_type: entityType,
        p_entity_id: entityId,
    });

    if (error) {
        console.error('Sync tag moderation error:', error);
        return null;
    }

    return data as TagModerationSyncResult;
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

export const getTrendingTags = async (
    limit: number = 10,
    options?: { includePending?: boolean }
): Promise<Tag[]> => {
    let query = supabase
        .from('tags')
        .select('*')
        .order('usage_count', { ascending: false })
        .limit(limit);

    if (!options?.includePending) {
        query = query.or(COMMUNITY_VISIBLE_TAG_FILTER);
    }

    const { data, error } = await query;

    if (error) return [];
    return filterGloballyAvailableTagRows(data || [], options?.includePending).map((tag) => mapTagRow(tag));
};

export const getMangasByTag = async (tagSlug: string): Promise<Manga[]> => {
    const { data: tagData, error: tagError } = await supabase
        .from('tags')
        .select('id, is_official, community_approved')
        .eq('slug', tagSlug)
        .maybeSingle();

    if (tagError || !tagData || !isGloballyAvailableTag(tagData)) return [];

    const { data, error } = await supabase
        .from('manga_tags')
        .select('manga_id')
        .eq('tag_id', tagData.id)
        .eq('is_discoverable', true);

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
    const uniqueTagSlugs = [...new Set(tagSlugs.filter(Boolean))];

    if (uniqueTagSlugs.length === 0) return [];

    const { data: tagsData } = await supabase
        .from('tags')
        .select('id, slug, is_official, community_approved')
        .in('slug', uniqueTagSlugs);

    if (!tagsData || tagsData.length === 0) return [];

    const approvedTags = tagsData.filter((tag) => isGloballyAvailableTag(tag));
    if (approvedTags.length !== uniqueTagSlugs.length) {
        return [];
    }

    const tagIds = approvedTags.map(t => t.id);

    const { data: mangaTagData } = await supabase
        .from('manga_tags')
        .select('manga_id, tag_id')
        .in('tag_id', tagIds)
        .eq('is_discoverable', true);

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
        const summaries = await getMangaSummaries();
        const summaryMap = new Map(summaries.map((manga) => [manga.id, manga]));
        const { data: rawData, error } = await supabase.rpc('get_top_engaged_mangas', { time_filter: timeframe });

        if (error || !rawData || rawData.length === 0) {
            if (error) console.error('getTopTenMangas error:', error);
            // Return top 10 by views if engagement logic fails
            return summaries.sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10);
        }

        // Map results to Manga interface
        return rawData.map((m: any) => {
            const summary = summaryMap.get(m.id);

            return {
                ...m,
                alternativeTitles: m.alternative_titles || [],
                lastUpdated: m.last_updated,
                createdAt: m.created_at,
                releaseYear: m.release_year,
                chapters: [],
                ratings: [],
                chapterCount: summary?.chapterCount ?? 0,
                engagementScore: m.engagement_score,
                averageRating: m.average_rating || summary?.averageRating || 0,
                reviewCount: summary?.reviewCount || 0,
            };
        }) as Manga[];
    } catch (error) {
        console.error('getTopTenMangas exception:', error);
        return [];
    }
};

export interface UserSession {
    id: string;
    browser: string;
    os: string;
    deviceType: string;
    country: string | null;
    city: string | null;
    region: string | null;
    lastActiveAt: string;
    createdAt: string;
    isCurrent: boolean;
}

const invokeAuthenticatedUserSessionsFunction = async (
    body: Record<string, unknown>,
    accessTokenOverride?: string | null,
) => {
    let accessToken = accessTokenOverride ?? null;

    if (!accessToken) {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
            throw sessionError;
        }

        accessToken = sessionData.session?.access_token ?? null;
    }

    if (!accessToken) {
        throw new Error('SESSION_REQUIRED');
    }

    return supabase.functions.invoke('user-sessions', {
        body,
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
};

export const getUserSessions = async (): Promise<UserSession[]> => {
    const { data, error } = await invokeAuthenticatedUserSessionsFunction({
        action: 'list',
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'SESSIONS_FETCH_FAILED');
    }

    return (data.sessions || []) as UserSession[];
};

export const revokeUserSession = async (sessionId: string): Promise<void> => {
    const { data, error } = await invokeAuthenticatedUserSessionsFunction({
        action: 'revoke',
        sessionId,
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'SESSION_REVOKE_FAILED');
    }
};

export const revokeAllOtherSessions = async (): Promise<void> => {
    const { data, error } = await invokeAuthenticatedUserSessionsFunction({
        action: 'revoke-all-others',
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'REVOKE_ALL_FAILED');
    }
};

export const validateCurrentSession = async (accessTokenOverride?: string | null): Promise<boolean> => {
    const { data, error } = await invokeAuthenticatedUserSessionsFunction({
        action: 'validate-current',
    }, accessTokenOverride);

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'SESSION_VALIDATE_FAILED');
    }

    return data.isActive === true;
};
