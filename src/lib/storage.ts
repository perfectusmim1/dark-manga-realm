import { User, Favorite, ReadingProgress, Bookmark, ReaderSettings, LibraryCategory, Notification, MangaFollow } from './types';
import { supabase } from './supabase';

const STORAGE_KEYS = {
    READER_SETTINGS: 'manga_reader_settings',
    CHAPTER_READ_FALLBACK: 'toonparrot_chapter_read_progress_fallback',
    // We still keep local reader settings because they are device-specific and often don't need to be in DB
};

export interface ReadingHistoryEntry extends ReadingProgress {
    mangaAlternativeTitles?: string[];
    chapterTitle?: string;
}

export interface ChapterReadProgressEntry {
    userId: string;
    mangaId: string;
    chapterId: string;
    chapterNumber: number;
    page: number;
    pageCount: number;
    maxPage: number;
    readProgressPercent: number;
    isRead: boolean;
    lastRead: string;
}

export interface ChapterHistoryEntry extends ChapterReadProgressEntry {
    mangaTitle?: string;
    mangaCover?: string;
    mangaAlternativeTitles?: string[];
    chapterTitle?: string;
}

let chapterReadTableFeatureState: 'unknown' | 'available' | 'unavailable' = 'unknown';
let chapterReadPublicFeatureState: 'unknown' | 'available' | 'unavailable' = 'unknown';

const isMissingChapterReadFeatureError = (error: any) => {
    const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    const code = `${error?.code || ''}`.toLowerCase();

    return (
        code === '42p01'
        || code === '42883'
        || code === 'pgrst202'
        || message.includes('chapter_read_progress')
        || message.includes('upsert_chapter_read_progress')
        || message.includes('does not exist')
        || message.includes('could not find')
    );
};

const handleChapterReadTableFeatureError = (error: any) => {
    if (isMissingChapterReadFeatureError(error)) {
        chapterReadTableFeatureState = 'unavailable';
        return true;
    }

    console.error('Chapter read progress error:', error);
    return false;
};

const handleChapterReadPublicFeatureError = (error: any) => {
    if (isMissingChapterReadFeatureError(error)) {
        chapterReadPublicFeatureState = 'unavailable';
        return true;
    }

    console.error('Chapter read progress error:', error);
    return false;
};

const mapAlternativeTitles = (manga: any): string[] =>
    Array.isArray(manga?.alternative_titles)
        ? manga.alternative_titles.filter((title: unknown): title is string => typeof title === 'string' && Boolean(title))
        : [];

const normalizeChapterReadProgress = (row: any): ChapterReadProgressEntry => ({
    userId: row.user_id,
    mangaId: row.manga_id,
    chapterId: row.chapter_id,
    chapterNumber: Number(row.chapter_number),
    page: row.page || 1,
    pageCount: row.page_count || 1,
    maxPage: row.max_page || 1,
    readProgressPercent: Number(row.read_progress_percent || 0),
    isRead: Boolean(row.is_read),
    lastRead: row.last_read,
});

type LocalChapterReadStore = Record<string, Record<string, ChapterReadProgressEntry>>;

const getLocalChapterReadStore = (): LocalChapterReadStore => {
    if (typeof window === 'undefined') {
        return {};
    }

    const raw = window.localStorage.getItem(STORAGE_KEYS.CHAPTER_READ_FALLBACK);
    if (!raw) {
        return {};
    }

    try {
        return JSON.parse(raw) as LocalChapterReadStore;
    } catch {
        return {};
    }
};

const setLocalChapterReadStore = (store: LocalChapterReadStore) => {
    if (typeof window === 'undefined') {
        return;
    }

    window.localStorage.setItem(STORAGE_KEYS.CHAPTER_READ_FALLBACK, JSON.stringify(store));
};

const getLocalChapterReadEntries = (userId: string): ChapterReadProgressEntry[] => {
    const store = getLocalChapterReadStore();
    return Object.values(store[userId] || {}).sort(
        (a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime(),
    );
};

const upsertLocalChapterReadProgress = (
    userId: string,
    progress: {
        mangaId: string;
        chapterId: string;
        chapterNumber: number;
        page: number;
        pageCount: number;
    },
): ChapterReadProgressEntry => {
    const safePageCount = Math.max(1, progress.pageCount || 1);
    const safePage = Math.max(1, Math.min(progress.page || 1, safePageCount));
    const nextPercent = Math.min(100, (safePage / safePageCount) * 100);
    const now = new Date().toISOString();
    const store = getLocalChapterReadStore();
    const existing = store[userId]?.[progress.chapterId];

    const nextEntry: ChapterReadProgressEntry = {
        userId,
        mangaId: progress.mangaId,
        chapterId: progress.chapterId,
        chapterNumber: progress.chapterNumber,
        page: Math.max(existing?.page || 1, safePage),
        pageCount: Math.max(existing?.pageCount || 1, safePageCount),
        maxPage: Math.max(existing?.maxPage || 1, safePage),
        readProgressPercent: Math.max(existing?.readProgressPercent || 0, nextPercent),
        isRead: Boolean(existing?.isRead || nextPercent >= 60),
        lastRead: now,
    };

    store[userId] = {
        ...(store[userId] || {}),
        [progress.chapterId]: nextEntry,
    };

    setLocalChapterReadStore(store);
    return nextEntry;
};

const mergeChapterReadEntries = (
    primary: Record<string, ChapterReadProgressEntry>,
    fallbackEntries: ChapterReadProgressEntry[],
) => {
    const merged = { ...primary };

    fallbackEntries.forEach((entry) => {
        const current = merged[entry.chapterId];
        if (!current) {
            merged[entry.chapterId] = entry;
            return;
        }

        merged[entry.chapterId] = {
            ...current,
            page: Math.max(current.page, entry.page),
            pageCount: Math.max(current.pageCount, entry.pageCount),
            maxPage: Math.max(current.maxPage, entry.maxPage),
            readProgressPercent: Math.max(current.readProgressPercent, entry.readProgressPercent),
            isRead: current.isRead || entry.isRead,
            lastRead: new Date(current.lastRead) > new Date(entry.lastRead) ? current.lastRead : entry.lastRead,
        };
    });

    return merged;
};

// ==================== FAVORITES (USER-SPECIFIC) ====================

export const getFavorites = async (userId: string): Promise<Favorite[]> => {
    const { data, error } = await supabase
        .from('favorites')
        .select(`
            *,
            manga:mangas (*)
        `)
        .eq('user_id', userId);

    if (error) return [];
    return data.map(f => ({
        userId: f.user_id,
        mangaId: f.manga_id,
        category: f.category as LibraryCategory,
        addedAt: f.added_at,
        mangaTitle: f.manga?.title,
        mangaCover: f.manga?.cover
    }));
};

export const addFavorite = async (userId: string, mangaId: string, category: LibraryCategory = 'reading'): Promise<void> => {
    await supabase.from('favorites').upsert({
        user_id: userId,
        manga_id: mangaId,
        category,
        added_at: new Date().toISOString()
    });
};

export const updateFavoriteCategory = async (userId: string, mangaId: string, category: LibraryCategory): Promise<void> => {
    const { error } = await supabase
        .from('favorites')
        .update({ category })
        .eq('user_id', userId)
        .eq('manga_id', mangaId);

    if (error) {
        console.error('Failed to update favorite category:', error);
        throw error;
    }
};

export const removeFavorite = async (userId: string, mangaId: string): Promise<void> => {
    await supabase
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('manga_id', mangaId);
};

export const isFavorite = async (userId: string, mangaId: string): Promise<boolean> => {
    const { count } = await supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('manga_id', mangaId);
    return !!count;
};

// ==================== READING PROGRESS (USER-SPECIFIC) ====================

export const getReadingHistory = async (userId: string): Promise<ReadingProgress[]> => {
    const { data, error } = await supabase
        .from('reading_progress')
        .select(`
            *,
            manga:mangas (*)
        `)
        .eq('user_id', userId)
        .order('last_read', { ascending: false });

    if (error) return [];
    return data.map(p => ({
        userId: p.user_id,
        mangaId: p.manga_id,
        chapterId: p.chapter_id,
        chapterNumber: Number(p.chapter_number),
        page: p.page,
        lastRead: p.last_read,
        mangaTitle: p.manga?.title,
        mangaCover: p.manga?.cover
    }));
};

export const getReadingHistoryEntries = async (userId: string): Promise<ReadingHistoryEntry[]> => {
    const { data, error } = await supabase
        .from('reading_progress')
        .select(`
            user_id,
            manga_id,
            chapter_id,
            chapter_number,
            page,
            last_read,
            manga:mangas(id, title, cover, alternative_titles),
            chapter:chapters(title)
        `)
        .eq('user_id', userId)
        .order('last_read', { ascending: false });

    if (error) {
        console.error('Reading history entries fetch error:', error);
        const fallbackHistory = await getReadingHistory(userId);
        return fallbackHistory.map((entry) => ({
            ...entry,
            mangaAlternativeTitles: [],
            chapterTitle: undefined,
        }));
    }

    return (data || []).map((entry: any) => ({
        userId: entry.user_id,
        mangaId: entry.manga_id,
        chapterId: entry.chapter_id,
        chapterNumber: Number(entry.chapter_number),
        page: entry.page,
        lastRead: entry.last_read,
        mangaTitle: entry.manga?.title,
        mangaCover: entry.manga?.cover,
        mangaAlternativeTitles: mapAlternativeTitles(entry.manga),
        chapterTitle: entry.chapter?.title,
    }));
};

export const syncChapterReadProgress = async (
    userId: string,
    progress: {
        mangaId: string;
        chapterId: string;
        chapterNumber: number;
        page: number;
        pageCount: number;
    },
): Promise<ChapterReadProgressEntry | null> => {
    if (!userId) {
        return null;
    }

    const localEntry = upsertLocalChapterReadProgress(userId, progress);

    if (chapterReadTableFeatureState === 'unavailable') {
        return localEntry;
    }

    const { data, error } = await supabase.rpc('upsert_chapter_read_progress', {
        p_manga_id: progress.mangaId,
        p_chapter_id: progress.chapterId,
        p_chapter_number: progress.chapterNumber,
        p_page: progress.page,
        p_page_count: progress.pageCount,
    });

    if (error) {
        if (handleChapterReadTableFeatureError(error)) {
            return localEntry;
        }

        return localEntry;
    }

    chapterReadTableFeatureState = 'available';
    return normalizeChapterReadProgress(data);
};

export const getChapterReadProgressMap = async (
    userId: string,
    mangaId: string,
): Promise<Record<string, ChapterReadProgressEntry>> => {
    if (!userId) {
        return {};
    }

    const localEntries = getLocalChapterReadEntries(userId)
        .filter((entry) => entry.mangaId === mangaId);

    if (chapterReadTableFeatureState === 'unavailable') {
        return localEntries.reduce<Record<string, ChapterReadProgressEntry>>((map, entry) => {
            map[entry.chapterId] = entry;
            return map;
        }, {});
    }

    const { data, error } = await supabase
        .from('chapter_read_progress')
        .select(`
            user_id,
            manga_id,
            chapter_id,
            chapter_number,
            page,
            page_count,
            max_page,
            read_progress_percent,
            is_read,
            last_read
        `)
        .eq('user_id', userId)
        .eq('manga_id', mangaId);

    if (error) {
        if (handleChapterReadTableFeatureError(error)) {
            return localEntries.reduce<Record<string, ChapterReadProgressEntry>>((map, entry) => {
                map[entry.chapterId] = entry;
                return map;
            }, {});
        }

        return localEntries.reduce<Record<string, ChapterReadProgressEntry>>((map, entry) => {
            map[entry.chapterId] = entry;
            return map;
        }, {});
    }

    chapterReadTableFeatureState = 'available';
    const remoteEntries = (data || []).reduce<Record<string, ChapterReadProgressEntry>>((map, row: any) => {
        map[row.chapter_id] = normalizeChapterReadProgress(row);
        return map;
    }, {});

    return mergeChapterReadEntries(remoteEntries, localEntries);
};

export const getChapterHistoryEntries = async (userId: string): Promise<ChapterHistoryEntry[]> => {
    if (!userId) {
        return [];
    }

    const localEntries = getLocalChapterReadEntries(userId);

    const buildLocalFallbackHistory = async () => {
        if (localEntries.length === 0) {
            const fallbackHistory = await getReadingHistoryEntries(userId);
            return fallbackHistory.map((entry) => ({
                userId: entry.userId,
                mangaId: entry.mangaId,
                chapterId: entry.chapterId,
                chapterNumber: entry.chapterNumber,
                page: entry.page,
                pageCount: entry.page,
                maxPage: entry.page,
                readProgressPercent: 0,
                isRead: false,
                lastRead: entry.lastRead,
                mangaTitle: entry.mangaTitle,
                mangaCover: entry.mangaCover,
                mangaAlternativeTitles: entry.mangaAlternativeTitles,
                chapterTitle: entry.chapterTitle,
            }));
        }

        const mangaIds = [...new Set(localEntries.map((entry) => entry.mangaId))];
        const chapterIds = [...new Set(localEntries.map((entry) => entry.chapterId))];

        const [{ data: mangas }, { data: chapters }] = await Promise.all([
            supabase
                .from('mangas')
                .select('id, title, cover, alternative_titles')
                .in('id', mangaIds),
            supabase
                .from('chapters')
                .select('id, title')
                .in('id', chapterIds),
        ]);

        const mangaMap = (mangas || []).reduce<Record<string, any>>((map, manga: any) => {
            map[manga.id] = manga;
            return map;
        }, {});
        const chapterMap = (chapters || []).reduce<Record<string, any>>((map, chapter: any) => {
            map[chapter.id] = chapter;
            return map;
        }, {});

        return localEntries.map((entry) => ({
            ...entry,
            mangaTitle: mangaMap[entry.mangaId]?.title,
            mangaCover: mangaMap[entry.mangaId]?.cover,
            mangaAlternativeTitles: mapAlternativeTitles(mangaMap[entry.mangaId]),
            chapterTitle: chapterMap[entry.chapterId]?.title,
        }));
    };

    if (chapterReadTableFeatureState === 'unavailable') {
        return buildLocalFallbackHistory();
    }

    const { data, error } = await supabase
        .from('chapter_read_progress')
        .select(`
            user_id,
            manga_id,
            chapter_id,
            chapter_number,
            page,
            page_count,
            max_page,
            read_progress_percent,
            is_read,
            last_read,
            manga:mangas(id, title, cover, alternative_titles),
            chapter:chapters(title)
        `)
        .eq('user_id', userId)
        .order('last_read', { ascending: false });

    if (error) {
        if (handleChapterReadTableFeatureError(error)) {
            return buildLocalFallbackHistory();
        }

        return buildLocalFallbackHistory();
    }

    chapterReadTableFeatureState = 'available';
    const remoteEntries = (data || []).map((entry: any) => ({
        ...normalizeChapterReadProgress(entry),
        mangaTitle: entry.manga?.title,
        mangaCover: entry.manga?.cover,
        mangaAlternativeTitles: mapAlternativeTitles(entry.manga),
        chapterTitle: entry.chapter?.title,
    }));

    const mergedEntries = mergeChapterReadEntries(
        remoteEntries.reduce<Record<string, ChapterReadProgressEntry>>((map, entry) => {
            map[entry.chapterId] = entry;
            return map;
        }, {}),
        localEntries,
    );

    const remoteMetadataMap = remoteEntries.reduce<Record<string, ChapterHistoryEntry>>((map, entry) => {
        map[entry.chapterId] = entry;
        return map;
    }, {});

    return Object.values(mergedEntries)
        .map((entry) => ({
            ...entry,
            mangaTitle: remoteMetadataMap[entry.chapterId]?.mangaTitle,
            mangaCover: remoteMetadataMap[entry.chapterId]?.mangaCover,
            mangaAlternativeTitles: remoteMetadataMap[entry.chapterId]?.mangaAlternativeTitles || [],
            chapterTitle: remoteMetadataMap[entry.chapterId]?.chapterTitle,
        }))
        .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime());
};

export const getCompletedChapterCount = async (userId: string): Promise<number> => {
    if (!userId) {
        return 0;
    }

    if (chapterReadPublicFeatureState !== 'unavailable') {
        const { data, error } = await supabase.rpc('get_public_chapter_read_count', {
            p_user_id: userId,
        });

        if (!error) {
            chapterReadPublicFeatureState = 'available';
            return Number(data || 0);
        }

        if (!handleChapterReadPublicFeatureError(error)) {
            return 0;
        }
    }

    const { count } = await supabase
        .from('reading_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

    return count || 0;
};

export const getCompletedChapterCountsByUser = async (): Promise<Record<string, number>> => {
    if (chapterReadPublicFeatureState !== 'unavailable') {
        const { data, error } = await supabase.rpc('get_public_chapter_read_leaderboard_counts');

        if (!error) {
            chapterReadPublicFeatureState = 'available';
            return (data || []).reduce<Record<string, number>>((counts, row: any) => {
                counts[row.user_id] = Number(row.read_count || 0);
                return counts;
            }, {});
        }

        handleChapterReadPublicFeatureError(error);
    }

    const { data } = await supabase.from('reading_activity_log').select('user_id');
    return (data || []).reduce<Record<string, number>>((counts, row: any) => {
        counts[row.user_id] = (counts[row.user_id] || 0) + 1;
        return counts;
    }, {});
};

export const updateReadingProgress = async (userId: string, progress: Omit<ReadingProgress, 'lastRead' | 'userId'>): Promise<void> => {
    await supabase.from('reading_progress').upsert({
        user_id: userId,
        manga_id: progress.mangaId,
        chapter_id: progress.chapterId,
        chapter_number: progress.chapterNumber,
        page: progress.page,
        last_read: new Date().toISOString()
    }, { onConflict: 'user_id,manga_id' });
};

export const getLatestProgress = async (userId: string, mangaId: string): Promise<ReadingProgress | undefined> => {
    const { data, error } = await supabase
        .from('reading_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('manga_id', mangaId)
        .maybeSingle();

    if (error || !data) return undefined;
    return {
        ...data,
        userId: data.user_id,
        mangaId: data.manga_id,
        chapterId: data.chapter_id,
        chapterNumber: Number(data.chapter_number),
        lastRead: data.last_read
    };
};

export const removeFromHistory = async (userId: string, mangaId: string): Promise<void> => {
    await supabase.from('reading_progress').delete().eq('user_id', userId).eq('manga_id', mangaId);
};

// ==================== BOOKMARKS (USER-SPECIFIC) ====================

export const getBookmarks = async (userId: string): Promise<Bookmark[]> => {
    const { data } = await supabase.from('bookmarks').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return (data || []).map(b => ({
        ...b,
        userId: b.user_id,
        mangaId: b.manga_id,
        chapterId: b.chapter_id,
        chapterNumber: Number(b.chapter_number),
        createdAt: b.created_at
    }));
};

export const addBookmark = async (userId: string, bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'userId'>): Promise<void> => {
    // Check existing bookmark
    const { data: existing } = await supabase.from('bookmarks')
        .select('id')
        .eq('user_id', userId)
        .eq('manga_id', bookmark.mangaId)
        .eq('chapter_id', bookmark.chapterId)
        .eq('page', bookmark.page)
        .maybeSingle();

    if (existing) {
        throw new Error('ALREADY_EXISTS');
    }

    const { error } = await supabase.from('bookmarks').insert({
        user_id: userId,
        manga_id: bookmark.mangaId,
        chapter_id: bookmark.chapterId,
        chapter_number: bookmark.chapterNumber,
        page: bookmark.page,
        note: bookmark.note,
        created_at: new Date().toISOString()
    });

    if (error) {
        throw error;
    }
};

export const removeBookmark = async (userId: string, id: string): Promise<void> => {
    await supabase.from('bookmarks').delete().eq('id', id).eq('user_id', userId);
};

// ==================== READER SETTINGS (KEEP LOCAL) ====================

const DEFAULT_READER_SETTINGS: ReaderSettings = {
    mode: 'vertical',
    fitWidth: true,
    showProgress: true,
    backgroundColor: 'dark',
    preloadPages: 3,
    zoom: 100,
    autoScrollSpeed: 30,
};

export const getReaderSettings = (): ReaderSettings => {
    const data = localStorage.getItem(STORAGE_KEYS.READER_SETTINGS);

    if (!data) {
        return DEFAULT_READER_SETTINGS;
    }

    try {
        return {
            ...DEFAULT_READER_SETTINGS,
            ...JSON.parse(data),
        };
    } catch {
        return DEFAULT_READER_SETTINGS;
    }
};

export const setReaderSettings = (settings: ReaderSettings): void => {
    localStorage.setItem(STORAGE_KEYS.READER_SETTINGS, JSON.stringify(settings));
};

// ==================== NOTIFICATIONS ====================

export const getNotifications = async (userId: string): Promise<Notification[]> => {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return (data || []).map(n => ({
        ...n,
        userId: n.user_id,
        mangaId: n.manga_id,
        chapterId: n.chapter_id,
        chapterNumber: Number(n.chapter_number),
        createdAt: n.created_at,
        fromUserId: n.from_user_id
    }));
};

export const markNotificationAsRead = async (userId: string, id: string): Promise<void> => {
    await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', userId);
};

export const getUnreadNotificationCount = async (userId: string): Promise<number> => {
    const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

    if (error) return 0;
    return count || 0;
};

export const markAllNotificationsAsRead = async (userId: string): Promise<void> => {
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId);
};

export const clearNotifications = async (userId: string): Promise<void> => {
    await supabase.from('notifications').delete().eq('user_id', userId);
};

// ==================== FOLLOWS ====================

export const followManga = async (userId: string, mangaId: string): Promise<void> => {
    await supabase.from('follows').upsert({ user_id: userId, manga_id: mangaId });
};

export const unfollowManga = async (userId: string, mangaId: string): Promise<void> => {
    await supabase.from('follows').delete().eq('user_id', userId).eq('manga_id', mangaId);
};

export const isFollowingManga = async (userId: string, mangaId: string): Promise<boolean> => {
    const { count } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('manga_id', mangaId);
    return !!count;
};

// Legacy auth functions - these are now in AuthContext but some components might still call them
export const getUserLocal = (): any => {
    const data = localStorage.getItem('manga_user');
    return data ? JSON.parse(data) : null;
};

export const createCommentNotification = async (
    targetUserId: string,
    type: 'reply' | 'like',
    fromUserId: string,
    fromUsername: string,
    entityId: string,
    entityTitle: string,
    commentId: string,
    chapterId?: string,
    entityType: string = 'manga'
) => {
    // Check user preferences
    const { data: userData } = await supabase
        .from('users')
        .select('preferences')
        .eq('id', targetUserId)
        .single();

    const prefs = userData?.preferences;
    if (type === 'reply' && prefs?.notifications?.replies === false) return;
    if (type === 'like' && prefs?.notifications?.likes === false) return;

    const title = type === 'reply' ? 'Yeni Yanıt' : 'Yorum Beğenisi';
    const message = type === 'reply'
        ? `${fromUsername} ${entityTitle} yorumunuza yanıt verdi.`
        : `${fromUsername} ${entityTitle} yorumunuzu beğendi.`;

    const link = entityType === 'manga'
        ? (chapterId ? `/manga/${entityId}/chapter/${chapterId}#comment-${commentId}` : `/manga/${entityId}#comment-${commentId}`)
        : `/${entityType}/${entityId}#comment-${commentId}`;

    const { error } = await supabase.from('notifications').insert({
        user_id: targetUserId,
        type,
        title,
        message,
        from_user_id: fromUserId,
        link,
        read: false,
        created_at: new Date().toISOString()
    });

    if (error) console.error('Notification error:', error);
};

export const createNotificationForFollowers = async (
    mangaId: string,
    mangaTitle: string,
    mangaCover: string,
    chapterId: string,
    chapterNumber: number
) => {
    try {
        // Get all followers for this manga
        const { data: followers, error: followError } = await supabase
            .from('follows')
            .select('user_id')
            .eq('manga_id', mangaId);

        if (followError || !followers || followers.length === 0) {
            if (followError) console.error('Follower fetch error:', followError);
            return;
        }

        // Get user preferences for each follower
        const userIds = followers.map(f => f.user_id);
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id, preferences')
            .in('id', userIds);

        if (usersError) {
            console.error('User preferences fetch error:', usersError);
            return;
        }

        // Create a map of user preferences
        const userPrefsMap = new Map<string, any>();
        usersData?.forEach(u => {
            userPrefsMap.set(u.id, u.preferences);
        });

        // Filter followers who want new chapter notifications
        const activeFollowers = followers.filter(f => {
            const prefs = userPrefsMap.get(f.user_id);
            return prefs?.notifications?.new_chapter !== false;
        });

        if (activeFollowers.length === 0) return;

        // Create notifications for each active follower
        const notifications = activeFollowers.map(f => ({
            user_id: f.user_id,
            type: 'new_chapter',
            title: 'Yeni Bölüm',
            message: `${mangaTitle} - Bölüm ${chapterNumber} yayınlandı.`,
            manga_id: mangaId,
            chapter_id: chapterId,
            link: `/manga/${mangaId}/chapter/${chapterId}`,
            read: false,
            created_at: new Date().toISOString()
        }));

        const { error } = await supabase.from('notifications').insert(notifications);
        if (error) console.error('Follower notification error:', error);
    } catch (err) {
        console.error('createNotificationForFollowers error:', err);
    }
};

// ==================== ADMIN SESSION (LOCAL) ====================

export const getAdminSession = () => {
    const data = localStorage.getItem('manga_admin_session');
    return data ? JSON.parse(data) : null;
};

export const setAdminSession = (session: any) => {
    localStorage.setItem('manga_admin_session', JSON.stringify(session));
};

export const removeAdminSession = () => {
    localStorage.removeItem('manga_admin_session');
};

