import { User, Favorite, ReadingProgress, Bookmark, ReaderSettings, LibraryCategory, Notification, MangaFollow, Manga } from './types';
import {
    isExpectedAccessControlError,
    isRetryableSupabaseBootstrapError,
    runWithSupabaseBootstrapRetry,
    supabase,
    waitForUsableSupabaseSession,
} from './supabase';
import { normalizeCommentNavigationLink } from './commentNavigation';
import { sortChapterBatchItems } from './chapterBatchOrdering';
import { cacheOfflineManga, getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import {
    addCachedBookmark,
    addCachedFollowedManga,
    areBookmarksInitialized,
    areFavoritesInitialized,
    areFollowsInitialized,
    createClientEntityId,
    getCachedBookmarksState,
    getCachedFavoritesState,
    getCachedFollowedMangaIds,
    isEffectivelyOnline,
    queueBookmarkAdd,
    queueBookmarkRemove,
    queueFavoriteRemove,
    queueFavoriteUpsert,
    queueFollowRemove,
    queueFollowUpsert,
    removeCachedBookmark,
    removeCachedFavorite,
    removeCachedFollowedManga,
    setCachedBookmarks,
    setCachedFavorites,
    setCachedFollowedMangaIds,
    upsertCachedFavorite,
    findCachedBookmark,
} from '@/lib/offline/userSync';

const STORAGE_KEYS = {
    READER_SETTINGS: 'manga_reader_settings',
    CHAPTER_READ_FALLBACK: 'toonparrot_chapter_read_progress_fallback',
    CHAPTER_READ_FALLBACK_SYNC: 'toonparrot_chapter_read_progress_fallback_sync',
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
    mangaTitle?: string;
    mangaCover?: string;
    mangaAlternativeTitles?: string[];
    chapterTitle?: string;
}

export interface ChapterHistoryEntry extends ChapterReadProgressEntry {
    mangaTitle?: string;
    mangaCover?: string;
    mangaAlternativeTitles?: string[];
    chapterTitle?: string;
}

const compareLastReadDesc = (a?: string | null, b?: string | null) => {
    const aTime = a ? new Date(a).getTime() : 0;
    const bTime = b ? new Date(b).getTime() : 0;

    if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
        return 0;
    }

    if (Number.isNaN(aTime)) {
        return 1;
    }

    if (Number.isNaN(bTime)) {
        return -1;
    }

    return bTime - aTime;
};

const sortByLastReadDesc = <T extends { lastRead?: string | null }>(entries: T[]) =>
    [...entries].sort((a, b) => compareLastReadDesc(a.lastRead, b.lastRead));

const withTimeout = async <T>(operation: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
    });

    try {
        return await Promise.race([operation, timeoutPromise]);
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
    if (items.length === 0) {
        return [];
    }

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
};

const existingChapterIdCache = new Set<string>();
const missingChapterIdCache = new Set<string>();
const pendingChapterExistenceChecks = new Map<string, Promise<boolean>>();

const cacheChapterExistence = (chapterId: string, exists: boolean) => {
    if (!chapterId) {
        return;
    }

    if (exists) {
        existingChapterIdCache.add(chapterId);
        missingChapterIdCache.delete(chapterId);
        return;
    }

    missingChapterIdCache.add(chapterId);
    existingChapterIdCache.delete(chapterId);
};

export const hasPersistedChapterRecord = async (chapterId?: string | null): Promise<boolean> => {
    if (!chapterId) {
        return false;
    }

    if (!isEffectivelyOnline()) {
        return true;
    }

    if (existingChapterIdCache.has(chapterId)) {
        return true;
    }

    if (missingChapterIdCache.has(chapterId)) {
        return false;
    }

    const pendingCheck = pendingChapterExistenceChecks.get(chapterId);
    if (pendingCheck) {
        return pendingCheck;
    }

    const checkPromise = (async () => {
        const { data, error } = await supabase
            .from('chapters')
            .select('id')
            .eq('id', chapterId)
            .maybeSingle();

        if (error) {
            console.error('Chapter existence check error:', error);
            return true;
        }

        const exists = Boolean(data?.id);
        cacheChapterExistence(chapterId, exists);
        return exists;
    })().finally(() => {
        pendingChapterExistenceChecks.delete(chapterId);
    });

    pendingChapterExistenceChecks.set(chapterId, checkPromise);
    return checkPromise;
};

const getExistingChapterIds = async (chapterIds: string[]): Promise<Set<string>> => {
    const existingIds = new Set<string>();
    const unresolvedIds = [...new Set(chapterIds.filter(Boolean))]
        .filter((chapterId) => !missingChapterIdCache.has(chapterId));

    unresolvedIds.forEach((chapterId) => {
        if (existingChapterIdCache.has(chapterId)) {
            existingIds.add(chapterId);
        }
    });

    const idsToQuery = unresolvedIds.filter((chapterId) => !existingChapterIdCache.has(chapterId));
    if (idsToQuery.length === 0) {
        return existingIds;
    }

    for (const chunk of chunkArray(idsToQuery, 100)) {
        const { data, error } = await supabase
            .from('chapters')
            .select('id')
            .in('id', chunk);

        if (error) {
            if (!isExpectedAccessControlError(error)) {
                console.error('Chapter batch existence check error:', error);
            }
            chunk.forEach((chapterId) => existingIds.add(chapterId));
            continue;
        }

        const foundIds = new Set((data || []).map((row: any) => row.id).filter(Boolean));

        chunk.forEach((chapterId) => {
            const exists = foundIds.has(chapterId);
            cacheChapterExistence(chapterId, exists);

            if (exists) {
                existingIds.add(chapterId);
            }
        });
    }

    return existingIds;
};

const getSafeChapterPageCount = (pageCount: number) =>
    Math.max(1, Number.isFinite(pageCount) ? Math.round(pageCount) : 1);

const getSafeChapterPage = (page: number, pageCount: number) => {
    const safePageCount = getSafeChapterPageCount(pageCount);
    return Math.max(1, Math.min(Number.isFinite(page) ? Math.round(page) : 1, safePageCount));
};

const cacheOfflineMangaMetadata = async (mangaIds: string[]) => {
    const uniqueMangaIds = [...new Set(mangaIds.filter(Boolean))];
    if (uniqueMangaIds.length === 0 || !isEffectivelyOnline()) {
        return;
    }

    const [{ data: mangaRows, error: mangaError }, { data: chapterRows, error: chapterError }] = await Promise.all([
        supabase
            .from('mangas')
            .select('id, title, alternative_titles, cover, banner, author, artist, status, genres, description, type, views, last_updated, created_at')
            .in('id', uniqueMangaIds),
        supabase
            .from('chapters')
            .select('id, manga_id, number, title, pages, views, release_date')
            .in('manga_id', uniqueMangaIds),
    ]);

    if (mangaError || !mangaRows) {
        if (mangaError) {
            console.error('Offline manga metadata cache error:', mangaError);
        }
        return;
    }

    if (chapterError) {
        console.error('Offline manga chapter metadata cache error:', chapterError);
    }

    const chaptersByMangaId = (chapterRows || []).reduce<Record<string, Manga['chapters']>>((map, chapter: any) => {
        if (!map[chapter.manga_id]) {
            map[chapter.manga_id] = [];
        }

        map[chapter.manga_id].push({
            id: chapter.id,
            number: Number(chapter.number),
            title: chapter.title,
            pages: Array.isArray(chapter.pages) ? chapter.pages : [],
            releaseDate: chapter.release_date,
            views: Number(chapter.views || 0),
        });
        return map;
    }, {});

    await Promise.all(
        mangaRows.map(async (mangaRow: any) => {
            const manga: Manga = {
                id: mangaRow.id,
                title: mangaRow.title,
                alternativeTitles: mangaRow.alternative_titles || [],
                cover: mangaRow.cover,
                banner: mangaRow.banner,
                author: mangaRow.author,
                artist: mangaRow.artist,
                status: mangaRow.status,
                genres: mangaRow.genres || [],
                description: mangaRow.description || '',
                ratings: [],
                views: Number(mangaRow.views || 0),
                chapters: [...(chaptersByMangaId[mangaRow.id] || [])].sort((left, right) => right.number - left.number),
                lastUpdated: mangaRow.last_updated,
                createdAt: mangaRow.created_at,
                type: mangaRow.type,
                averageRating: 0,
                reviewCount: 0,
            };

            await cacheOfflineManga(manga);
        }),
    );
};

export const calculateChapterReadProgressPercent = (page: number, pageCount: number) => {
    const safePageCount = getSafeChapterPageCount(pageCount);
    const safePage = getSafeChapterPage(page, safePageCount);

    if (safePageCount <= 1) {
        return 100;
    }

    return Math.min(
        100,
        Math.max(0, Number((((safePage - 1) / (safePageCount - 1)) * 100).toFixed(2))),
    );
};

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
    if (isExpectedAccessControlError(error)) {
        return true;
    }

    if (isMissingChapterReadFeatureError(error)) {
        chapterReadTableFeatureState = 'unavailable';
        return true;
    }

    console.error('Chapter read progress error:', error);
    return false;
};

const handleChapterReadPublicFeatureError = (error: any) => {
    if (isExpectedAccessControlError(error)) {
        return true;
    }

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
    readProgressPercent: Number(
        row.read_progress_percent
        ?? calculateChapterReadProgressPercent(row.max_page || row.page || 1, row.page_count || 1),
    ),
    isRead: Boolean(row.is_read),
    lastRead: row.last_read,
});

type LocalChapterReadStore = Record<string, Record<string, ChapterReadProgressEntry>>;
type LocalChapterReadSyncStore = Record<string, string>;

const getLocalChapterReadStore = (): LocalChapterReadStore => {
    if (typeof window === 'undefined') {
        return {};
    }

    const raw = window.localStorage.getItem(STORAGE_KEYS.CHAPTER_READ_FALLBACK);
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw) as LocalChapterReadStore;
        let hasChanges = false;

        const normalized = Object.fromEntries(
            Object.entries(parsed || {}).map(([userId, entries]) => {
                const normalizedEntries = Object.fromEntries(
                    Object.entries(entries || {}).map(([chapterId, entry]) => {
                        const pageCount = getSafeChapterPageCount(entry?.pageCount || 1);
                        const page = getSafeChapterPage(entry?.page || 1, pageCount);
                        const maxPage = Math.max(getSafeChapterPage(entry?.maxPage || page, pageCount), page);
                        const readProgressPercent = calculateChapterReadProgressPercent(maxPage, pageCount);
                        const normalizedEntry: ChapterReadProgressEntry = {
                            ...entry,
                            userId,
                            chapterId,
                            page,
                            pageCount,
                            maxPage,
                            readProgressPercent,
                            isRead: readProgressPercent >= 60,
                            lastRead: entry?.lastRead || new Date().toISOString(),
                        };

                        if (
                            normalizedEntry.page !== entry?.page
                            || normalizedEntry.pageCount !== entry?.pageCount
                            || normalizedEntry.maxPage !== entry?.maxPage
                            || normalizedEntry.readProgressPercent !== entry?.readProgressPercent
                            || normalizedEntry.isRead !== entry?.isRead
                        ) {
                            hasChanges = true;
                        }

                        return [chapterId, normalizedEntry];
                    }),
                );

                return [userId, normalizedEntries];
            }),
        ) as LocalChapterReadStore;

        if (hasChanges) {
            setLocalChapterReadStore(normalized);
        }

        return normalized;
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
    return sortByLastReadDesc(Object.values(store[userId] || {}));
};

const getLocalChapterReadSyncStore = (): LocalChapterReadSyncStore => {
    if (typeof window === 'undefined') {
        return {};
    }

    const raw = window.localStorage.getItem(STORAGE_KEYS.CHAPTER_READ_FALLBACK_SYNC);
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
        return {};
    }
};

const setLocalChapterReadSyncStore = (store: LocalChapterReadSyncStore) => {
    if (typeof window === 'undefined') {
        return;
    }

    window.localStorage.setItem(STORAGE_KEYS.CHAPTER_READ_FALLBACK_SYNC, JSON.stringify(store));
};

const getLocalChapterReadSyncCursor = (userId: string) =>
    getLocalChapterReadSyncStore()[userId];

const parseTimestamp = (value?: string | null) => {
    if (!value) {
        return Number.NaN;
    }

    return new Date(value).getTime();
};

const markLocalChapterReadSyncCursor = (
    userId: string,
    entries: Array<Partial<Pick<ChapterReadProgressEntry, 'lastRead'>>>,
) => {
    if (!userId || entries.length === 0) {
        return;
    }

    let latestTimestamp = Number.NaN;
    entries.forEach((entry) => {
        const candidate = parseTimestamp(entry.lastRead);
        if (Number.isNaN(candidate)) {
            return;
        }

        latestTimestamp = Number.isNaN(latestTimestamp)
            ? candidate
            : Math.max(latestTimestamp, candidate);
    });

    if (Number.isNaN(latestTimestamp)) {
        return;
    }

    const store = getLocalChapterReadSyncStore();
    store[userId] = new Date(latestTimestamp).toISOString();
    setLocalChapterReadSyncStore(store);
};

const hasUnsyncedLocalChapterReadEntry = (
    entry: ChapterReadProgressEntry,
    syncCursor?: string,
) => {
    if (!syncCursor) {
        return true;
    }

    const entryTimestamp = parseTimestamp(entry.lastRead);
    const syncTimestamp = parseTimestamp(syncCursor);

    if (Number.isNaN(entryTimestamp) || Number.isNaN(syncTimestamp)) {
        return true;
    }

    return entryTimestamp > syncTimestamp + 1000;
};

export const getLocalChapterReadProgressEntry = (
    userId: string,
    chapterId: string,
): ChapterReadProgressEntry | undefined => {
    if (!userId || !chapterId) {
        return undefined;
    }

    const store = getLocalChapterReadStore();
    return store[userId]?.[chapterId];
};

const upsertLocalChapterReadProgress = (
    userId: string,
    progress: {
        mangaId: string;
        chapterId: string;
        chapterNumber: number;
        page: number;
        pageCount: number;
        mangaTitle?: string;
        mangaCover?: string;
        mangaAlternativeTitles?: string[];
        chapterTitle?: string;
    },
): ChapterReadProgressEntry => {
    const safePageCount = getSafeChapterPageCount(progress.pageCount || 1);
    const safePage = getSafeChapterPage(progress.page || 1, safePageCount);
    const now = new Date().toISOString();
    const store = getLocalChapterReadStore();
    const existing = store[userId]?.[progress.chapterId];
    const nextMaxPage = Math.max(existing?.maxPage || 1, safePage);
    const nextPercent = calculateChapterReadProgressPercent(nextMaxPage, safePageCount);

    const nextEntry: ChapterReadProgressEntry = {
        userId,
        mangaId: progress.mangaId,
        chapterId: progress.chapterId,
        chapterNumber: progress.chapterNumber,
        page: Math.max(existing?.page || 1, safePage),
        pageCount: Math.max(existing?.pageCount || 1, safePageCount),
        maxPage: nextMaxPage,
        readProgressPercent: Math.max(existing?.readProgressPercent || 0, nextPercent),
        isRead: Boolean(existing?.isRead || nextPercent >= 60),
        lastRead: now,
        mangaTitle: progress.mangaTitle || existing?.mangaTitle,
        mangaCover: progress.mangaCover || existing?.mangaCover,
        mangaAlternativeTitles: progress.mangaAlternativeTitles?.length
            ? [...progress.mangaAlternativeTitles]
            : existing?.mangaAlternativeTitles || [],
        chapterTitle: progress.chapterTitle || existing?.chapterTitle,
    };

    store[userId] = {
        ...(store[userId] || {}),
        [progress.chapterId]: nextEntry,
    };

    setLocalChapterReadStore(store);
    return nextEntry;
};

const hydrateLocalChapterReadMetadata = (
    userId: string,
    entries: Array<Partial<ChapterReadProgressEntry> & Pick<ChapterReadProgressEntry, 'mangaId' | 'chapterId' | 'chapterNumber'>>,
) => {
    if (!userId || entries.length === 0) {
        return;
    }

    const store = getLocalChapterReadStore();
    const userEntries = { ...(store[userId] || {}) };
    let hasChanges = false;

    entries.forEach((entry) => {
        const current = userEntries[entry.chapterId];
        if (!current) {
            return;
        }

        const nextEntry: ChapterReadProgressEntry = {
            ...current,
            mangaTitle: entry.mangaTitle || current.mangaTitle,
            mangaCover: entry.mangaCover || current.mangaCover,
            mangaAlternativeTitles: entry.mangaAlternativeTitles?.length
                ? [...entry.mangaAlternativeTitles]
                : current.mangaAlternativeTitles || [],
            chapterTitle: entry.chapterTitle || current.chapterTitle,
        };

        if (
            nextEntry.mangaTitle !== current.mangaTitle
            || nextEntry.mangaCover !== current.mangaCover
            || JSON.stringify(nextEntry.mangaAlternativeTitles || []) !== JSON.stringify(current.mangaAlternativeTitles || [])
            || nextEntry.chapterTitle !== current.chapterTitle
        ) {
            userEntries[entry.chapterId] = nextEntry;
            hasChanges = true;
        }
    });

    if (!hasChanges) {
        return;
    }

    store[userId] = userEntries;
    setLocalChapterReadStore(store);
    markLocalChapterReadSyncCursor(userId, entries);
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

const getLocalCompletedChapterReadCount = (userId: string) =>
    getLocalChapterReadEntries(userId).filter((entry) => entry.isRead || entry.readProgressPercent >= 60).length;

const localChapterReadFallbackSyncQueue = new Map<string, Promise<void>>();

const triggerBackgroundChapterReadFallbackSync = (userId: string) => {
    if (!userId || chapterReadTableFeatureState === 'unavailable') {
        return;
    }

    void syncLocalChapterReadFallbackToRemote(userId).catch((error) => {
        console.error('Background chapter progress sync error:', error);
    });
};

export const syncLocalChapterReadFallbackToRemote = async (userId: string): Promise<void> => {
    if (!userId || typeof window === 'undefined' || chapterReadTableFeatureState === 'unavailable') {
        return;
    }

    const existingSync = localChapterReadFallbackSyncQueue.get(userId);
    if (existingSync) {
        return existingSync;
    }

    const localEntries = getLocalChapterReadEntries(userId);
    if (localEntries.length === 0) {
        return;
    }

    const syncCursor = getLocalChapterReadSyncCursor(userId);
    const pendingLocalEntries = localEntries.filter((entry) => hasUnsyncedLocalChapterReadEntry(entry, syncCursor));
    if (pendingLocalEntries.length === 0) {
        return;
    }

    const syncPromise = (async () => {
        const existingChapterIds = await getExistingChapterIds(pendingLocalEntries.map((entry) => entry.chapterId));
        const syncableLocalEntries = pendingLocalEntries.filter((entry) => existingChapterIds.has(entry.chapterId));

        if (syncableLocalEntries.length === 0) {
            return;
        }

        const remoteProgressMap = new Map<string, {
            chapter_id: string;
            last_read: string | null;
            max_page: number | null;
            read_progress_percent: number | null;
        }>();
        const chapterIdChunks = chunkArray(
            [...new Set(syncableLocalEntries.map((entry) => entry.chapterId))],
            100,
        );

        for (const chunk of chapterIdChunks) {
            const { data, error } = await supabase
                .from('chapter_read_progress')
                .select('chapter_id, last_read, max_page, read_progress_percent')
                .eq('user_id', userId)
                .in('chapter_id', chunk);

            if (error) {
                if (handleChapterReadTableFeatureError(error)) {
                    return;
                }

                if (!isExpectedAccessControlError(error)) {
                    console.error('Fallback chapter progress prefetch error:', error);
                }
                return;
            }

            (data || []).forEach((entry: any) => {
                remoteProgressMap.set(entry.chapter_id, entry);
            });
        }

        const entriesToSync = syncableLocalEntries.filter((entry) => {
            const remoteEntry = remoteProgressMap.get(entry.chapterId);
            if (!remoteEntry) {
                return true;
            }

            const remoteLastRead = remoteEntry.last_read ? new Date(remoteEntry.last_read).getTime() : 0;
            const localLastRead = entry.lastRead ? new Date(entry.lastRead).getTime() : 0;

            return (
                entry.maxPage > Number(remoteEntry.max_page || 0)
                || entry.readProgressPercent > Number(remoteEntry.read_progress_percent || 0)
                || localLastRead > remoteLastRead
            );
        });

        for (const entry of entriesToSync) {
            const { error } = await supabase.rpc('backfill_chapter_read_progress', {
                p_manga_id: entry.mangaId,
                p_chapter_id: entry.chapterId,
                p_chapter_number: entry.chapterNumber,
                p_page: entry.maxPage || entry.page,
                p_page_count: entry.pageCount,
                p_last_read: entry.lastRead,
            });

            if (error) {
                if (handleChapterReadTableFeatureError(error)) {
                    return;
                }

                console.error('Fallback chapter progress sync error:', error);
                return;
            }
        }

        markLocalChapterReadSyncCursor(userId, syncableLocalEntries);
        chapterReadTableFeatureState = 'available';
        chapterReadPublicFeatureState = 'available';
    })().finally(() => {
        localChapterReadFallbackSyncQueue.delete(userId);
    });

    localChapterReadFallbackSyncQueue.set(userId, syncPromise);
    return syncPromise;
};

// ==================== FAVORITES (USER-SPECIFIC) ====================

export const getFavorites = async (userId: string): Promise<Favorite[]> => {
    if (!userId) {
        return [];
    }

    if (!areFavoritesInitialized(userId) && isEffectivelyOnline()) {
        try {
            return await refreshFavoritesCache(userId);
        } catch {
            return getCachedFavoritesState(userId);
        }
    }

    return getCachedFavoritesState(userId);
};

export const refreshFavoritesCache = async (userId: string): Promise<Favorite[]> => {
    if (!userId) {
        return [];
    }

    if (!isEffectivelyOnline()) {
        return getCachedFavoritesState(userId);
    }

    const { data, error } = await supabase
        .from('favorites')
        .select(`
            *,
            manga:mangas (title, cover)
        `)
        .eq('user_id', userId)
        .order('added_at', { ascending: false });

    if (error) {
        throw error;
    }

    const favorites = (data || []).map(f => ({
        userId: f.user_id,
        mangaId: f.manga_id,
        category: f.category as LibraryCategory,
        addedAt: f.added_at,
        mangaTitle: f.manga?.title,
        mangaCover: f.manga?.cover
    }));

    setCachedFavorites(userId, favorites);
    return favorites;
};

export const addFavorite = async (
    userId: string,
    mangaId: string,
    category: LibraryCategory = 'reading',
    metadata?: { mangaTitle?: string; mangaCover?: string },
): Promise<void> => {
    const favorite: Favorite = {
        userId,
        mangaId,
        category,
        addedAt: new Date().toISOString(),
        mangaTitle: metadata?.mangaTitle,
        mangaCover: metadata?.mangaCover,
    };

    upsertCachedFavorite(userId, favorite);

    if (!isEffectivelyOnline()) {
        queueFavoriteUpsert(userId, favorite);
        return;
    }

    const { error } = await supabase.from('favorites').upsert({
        user_id: userId,
        manga_id: mangaId,
        category,
        added_at: favorite.addedAt,
    }, {
        onConflict: 'user_id,manga_id',
    });

    if (error) {
        queueFavoriteUpsert(userId, favorite);
        throw error;
    }
};

export const updateFavoriteCategory = async (userId: string, mangaId: string, category: LibraryCategory): Promise<void> => {
    const existing = getCachedFavoritesState(userId).find((favorite) => favorite.mangaId === mangaId);
    const nextFavorite: Favorite = {
        userId,
        mangaId,
        category,
        addedAt: existing?.addedAt || new Date().toISOString(),
        mangaTitle: existing?.mangaTitle,
        mangaCover: existing?.mangaCover,
    };

    upsertCachedFavorite(userId, nextFavorite);

    if (!isEffectivelyOnline()) {
        queueFavoriteUpsert(userId, nextFavorite);
        return;
    }

    const { error } = await supabase
        .from('favorites')
        .update({ category })
        .eq('user_id', userId)
        .eq('manga_id', mangaId);

    if (error) {
        console.error('Failed to update favorite category:', error);
        queueFavoriteUpsert(userId, nextFavorite);
        throw error;
    }
};

export const removeFavorite = async (userId: string, mangaId: string): Promise<void> => {
    removeCachedFavorite(userId, mangaId);

    if (!isEffectivelyOnline()) {
        queueFavoriteRemove(userId, mangaId);
        return;
    }

    const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('manga_id', mangaId);

    if (error) {
        queueFavoriteRemove(userId, mangaId);
        throw error;
    }
};

export const isFavorite = async (userId: string, mangaId: string): Promise<boolean> => {
    const favorites = await getFavorites(userId);
    return favorites.some((favorite) => favorite.mangaId === mangaId);
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

type RemoteReadingHistoryRow = {
    user_id: string;
    manga_id: string;
    chapter_id: string;
    chapter_number: number | string;
    page: number;
    last_read: string;
    manga?: {
        id?: string;
        title?: string;
        cover?: string;
        alternative_titles?: string[];
    } | null;
};

const buildLocalReadingHistoryEntries = async (userId: string): Promise<ReadingHistoryEntry[]> => {
    const latestEntriesByManga = getLocalChapterReadEntries(userId)
        .reduce<Record<string, ChapterReadProgressEntry>>((map, entry) => {
            const current = map[entry.mangaId];
            if (!current || compareLastReadDesc(entry.lastRead, current.lastRead) < 0) {
                map[entry.mangaId] = entry;
            }
            return map;
        }, {});

    const localEntries = await Promise.all(
        Object.values(latestEntriesByManga).map(async (entry) => {
            const offlineManga = await getOfflineMangaDetail(entry.mangaId);
            const offlineChapter = offlineManga?.chapters.find((chapter) => chapter.id === entry.chapterId);

            return {
                userId: entry.userId,
                mangaId: entry.mangaId,
                chapterId: entry.chapterId,
                chapterNumber: entry.chapterNumber,
                page: entry.page,
                lastRead: entry.lastRead,
                mangaTitle: offlineManga?.title || entry.mangaTitle,
                mangaCover: offlineManga?.cover || entry.mangaCover,
                mangaAlternativeTitles: offlineManga?.alternativeTitles || entry.mangaAlternativeTitles || [],
                chapterTitle: offlineChapter?.title || entry.chapterTitle,
            } satisfies ReadingHistoryEntry;
        }),
    );

    return sortByLastReadDesc(localEntries);
};

const buildFallbackReadingHistoryEntries = async (userId: string): Promise<ReadingHistoryEntry[]> => {
    const localEntries = await buildLocalReadingHistoryEntries(userId);
    if (localEntries.length > 0) {
        return localEntries;
    }

    const fallbackHistory = await getReadingHistory(userId);
    return sortByLastReadDesc(fallbackHistory.map((entry) => ({
        ...entry,
        mangaAlternativeTitles: [],
        chapterTitle: undefined,
    })));
};

const pickLatestReadingHistoryRowsByManga = (
    rows: RemoteReadingHistoryRow[],
    limit: number,
): RemoteReadingHistoryRow[] => {
    if (limit <= 0) {
        return [];
    }

    const selectedRows: RemoteReadingHistoryRow[] = [];
    const seenMangaIds = new Set<string>();

    for (const row of rows) {
        if (!row?.manga_id || seenMangaIds.has(row.manga_id)) {
            continue;
        }

        seenMangaIds.add(row.manga_id);
        selectedRows.push(row);

        if (selectedRows.length >= limit) {
            break;
        }
    }

    return selectedRows;
};

const pickLatestReadingHistoryEntriesByManga = (
    entries: ReadingHistoryEntry[],
    limit: number,
): ReadingHistoryEntry[] => {
    if (limit <= 0) {
        return [];
    }

    const selectedEntries: ReadingHistoryEntry[] = [];
    const seenMangaIds = new Set<string>();

    for (const entry of sortByLastReadDesc(entries)) {
        if (!entry?.mangaId || seenMangaIds.has(entry.mangaId)) {
            continue;
        }

        seenMangaIds.add(entry.mangaId);
        selectedEntries.push(entry);

        if (selectedEntries.length >= limit) {
            break;
        }
    }

    return selectedEntries;
};

const fetchRemoteReadingHistoryRows = async (
    userId: string,
    options?: {
        limit?: number;
        offset?: number;
        includeAlternativeTitles?: boolean;
    },
): Promise<{ data: RemoteReadingHistoryRow[] | null; error: unknown }> => {
    try {
        const response = await runWithSupabaseBootstrapRetry({
            run: async () => {
                const mangaSelect = options?.includeAlternativeTitles
                    ? 'manga:mangas(id, title, cover, alternative_titles)'
                    : 'manga:mangas(id, title, cover)';
                const query = supabase
                    .from('reading_progress')
                    .select(`
                        user_id,
                        manga_id,
                        chapter_id,
                        chapter_number,
                        page,
                        last_read,
                        ${mangaSelect}
                    `)
                    .eq('user_id', userId)
                    .order('last_read', { ascending: false });

                if (options?.limit && options.limit > 0) {
                    const start = Math.max(0, options.offset || 0);
                    const end = start + options.limit - 1;
                    return query.range(start, end);
                }

                return query;
            },
            timeoutMs: 6000,
            timeoutMessage: 'Reading history entries fetch timeout',
            shouldRetryResult: (response) => Boolean(response.error) && isRetryableSupabaseBootstrapError(response.error),
        });

        return {
            data: response.data as RemoteReadingHistoryRow[] | null,
            error: response.error,
        };
    } catch (error) {
        return {
            data: null,
            error,
        };
    }
};

const buildReadingHistoryEntriesFromRows = async (
    userId: string,
    rows: RemoteReadingHistoryRow[],
): Promise<ReadingHistoryEntry[]> => {
    const chapterIds = [...new Set(rows.map((entry) => entry.chapter_id).filter(Boolean))];
    const chapterTitleMap = new Map<string, string>();

    if (chapterIds.length > 0) {
        const { data: chapterRows, error: chapterError } = await runWithSupabaseBootstrapRetry({
            run: async () => await supabase
                .from('chapters')
                .select('id, title')
                .in('id', chapterIds),
            timeoutMs: 5000,
            timeoutMessage: 'Reading history chapter title fetch timeout',
            shouldRetryResult: (response) => Boolean(response.error) && isRetryableSupabaseBootstrapError(response.error),
        });

        if (chapterError) {
            console.error('Reading history chapter title fetch error:', chapterError);
        } else {
            (chapterRows || []).forEach((chapter: any) => {
                chapterTitleMap.set(chapter.id, chapter.title);
            });
        }
    }

    const remoteEntries = rows.map((entry) => ({
        userId: entry.user_id,
        mangaId: entry.manga_id,
        chapterId: entry.chapter_id,
        chapterNumber: Number(entry.chapter_number),
        page: entry.page,
        lastRead: entry.last_read,
        mangaTitle: entry.manga?.title,
        mangaCover: entry.manga?.cover,
        mangaAlternativeTitles: mapAlternativeTitles(entry.manga),
        chapterTitle: chapterTitleMap.get(entry.chapter_id),
    }));

    hydrateLocalChapterReadMetadata(userId, remoteEntries);
    return sortByLastReadDesc(remoteEntries);
};

export const getContinueReadingEntries = async (
    userId: string,
    uniqueMangaLimit: number = 6,
): Promise<ReadingHistoryEntry[]> => {
    if (!userId || uniqueMangaLimit <= 0) {
        return [];
    }

    await waitForUsableSupabaseSession({
        required: true,
        maxWaitMs: 5000,
    }).catch(() => null);

    const batchSize = uniqueMangaLimit;
    const maxScanRows = uniqueMangaLimit;
    const collectedRows: RemoteReadingHistoryRow[] = [];
    let offset = 0;

    while (offset < maxScanRows) {
        const remainingRowBudget = maxScanRows - offset;
        const currentBatchSize = Math.min(batchSize, remainingRowBudget);
        const { data, error } = await fetchRemoteReadingHistoryRows(userId, {
            limit: currentBatchSize,
            offset,
            includeAlternativeTitles: false,
        });

        if (error) {
            if (!isExpectedAccessControlError(error)) {
                console.error('Continue reading fetch error:', error);
            }
            return pickLatestReadingHistoryEntriesByManga(
                await buildFallbackReadingHistoryEntries(userId),
                uniqueMangaLimit,
            );
        }

        const batch = data || [];
        if (batch.length === 0) {
            break;
        }

        collectedRows.push(...batch);
        offset += batch.length;

        if (
            pickLatestReadingHistoryRowsByManga(collectedRows, uniqueMangaLimit).length >= uniqueMangaLimit
            || batch.length < currentBatchSize
        ) {
            break;
        }
    }

    if (collectedRows.length === 0) {
        return pickLatestReadingHistoryEntriesByManga(
            await buildFallbackReadingHistoryEntries(userId),
            uniqueMangaLimit,
        );
    }

    const selectedRows = pickLatestReadingHistoryRowsByManga(collectedRows, uniqueMangaLimit);
    return buildReadingHistoryEntriesFromRows(userId, selectedRows);
};

export const getReadingHistoryEntries = async (userId: string): Promise<ReadingHistoryEntry[]> => {
    await waitForUsableSupabaseSession({
        required: true,
        maxWaitMs: 5000,
    }).catch(() => null);

    const { data, error } = await fetchRemoteReadingHistoryRows(userId);

    if (error) {
        if (!isExpectedAccessControlError(error)) {
            console.error('Reading history entries fetch error:', error);
        }
        return buildFallbackReadingHistoryEntries(userId);
    }

    return buildReadingHistoryEntriesFromRows(userId, data || []);
};

export const syncChapterReadProgress = async (
    userId: string,
    progress: {
        mangaId: string;
        chapterId: string;
        chapterNumber: number;
        page: number;
        pageCount: number;
        mangaTitle?: string;
        mangaCover?: string;
        mangaAlternativeTitles?: string[];
        chapterTitle?: string;
    },
    options?: {
        skipRemote?: boolean;
    },
): Promise<ChapterReadProgressEntry | null> => {
    if (!userId) {
        return null;
    }

    const localEntry = upsertLocalChapterReadProgress(userId, progress);
    if (options?.skipRemote) {
        return localEntry;
    }

    if (!(await hasPersistedChapterRecord(progress.chapterId))) {
        return localEntry;
    }

    if (chapterReadTableFeatureState === 'unavailable') {
        return localEntry;
    }

    try {
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
    } catch {
        return localEntry;
    }
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

    if (localEntries.length > 0) {
        triggerBackgroundChapterReadFallbackSync(userId);
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

        const offlineEntries = await Promise.all(
            localEntries.map(async (entry) => {
                const offlineManga = await getOfflineMangaDetail(entry.mangaId);
                const offlineChapter = offlineManga?.chapters.find((chapter) => chapter.id === entry.chapterId);

                return {
                    ...entry,
                    mangaTitle: offlineManga?.title || entry.mangaTitle,
                    mangaCover: offlineManga?.cover || entry.mangaCover,
                    mangaAlternativeTitles: offlineManga?.alternativeTitles || entry.mangaAlternativeTitles || [],
                    chapterTitle: offlineChapter?.title || entry.chapterTitle,
                } satisfies ChapterHistoryEntry;
            }),
        );

        if (!isEffectivelyOnline()) {
            return offlineEntries;
        }

        const missingMangaIds = [...new Set(
            offlineEntries
                .filter((entry) => !entry.mangaTitle || !entry.mangaCover)
                .map((entry) => entry.mangaId),
        )];
        const missingChapterIds = [...new Set(
            offlineEntries
                .filter((entry) => !entry.chapterTitle)
                .map((entry) => entry.chapterId),
        )];

        if (missingMangaIds.length === 0 && missingChapterIds.length === 0) {
            return offlineEntries;
        }

        const [{ data: mangas }, { data: chapters }] = await Promise.all([
            missingMangaIds.length > 0
                ? supabase
                    .from('mangas')
                    .select('id, title, cover, alternative_titles')
                    .in('id', missingMangaIds)
                : Promise.resolve({ data: [] as any[] }),
            missingChapterIds.length > 0
                ? supabase
                    .from('chapters')
                    .select('id, title')
                    .in('id', missingChapterIds)
                : Promise.resolve({ data: [] as any[] }),
        ]);

        const mangaMap = (mangas || []).reduce<Record<string, any>>((map, manga: any) => {
            map[manga.id] = manga;
            return map;
        }, {});
        const chapterMap = (chapters || []).reduce<Record<string, any>>((map, chapter: any) => {
            map[chapter.id] = chapter;
            return map;
        }, {});

        return offlineEntries.map((entry) => ({
            ...entry,
            mangaTitle: entry.mangaTitle || mangaMap[entry.mangaId]?.title,
            mangaCover: entry.mangaCover || mangaMap[entry.mangaId]?.cover,
            mangaAlternativeTitles: entry.mangaAlternativeTitles?.length
                ? entry.mangaAlternativeTitles
                : mapAlternativeTitles(mangaMap[entry.mangaId]),
            chapterTitle: entry.chapterTitle || chapterMap[entry.chapterId]?.title,
        }));
    };

    if (chapterReadTableFeatureState === 'unavailable') {
        return buildLocalFallbackHistory();
    }

    if (localEntries.length > 0) {
        triggerBackgroundChapterReadFallbackSync(userId);
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

    hydrateLocalChapterReadMetadata(userId, remoteEntries);

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

    return sortByLastReadDesc(Object.values(mergedEntries)
        .map((entry) => ({
            ...entry,
            mangaTitle: remoteMetadataMap[entry.chapterId]?.mangaTitle,
            mangaCover: remoteMetadataMap[entry.chapterId]?.mangaCover,
            mangaAlternativeTitles: remoteMetadataMap[entry.chapterId]?.mangaAlternativeTitles || [],
            chapterTitle: remoteMetadataMap[entry.chapterId]?.chapterTitle,
        })));
};

export const getCompletedChapterCount = async (userId: string): Promise<number> => {
    if (!userId) {
        return 0;
    }

    const localCompletedCount = getLocalCompletedChapterReadCount(userId);

    if (localCompletedCount > 0 && chapterReadTableFeatureState !== 'unavailable') {
        triggerBackgroundChapterReadFallbackSync(userId);
    }

    if (chapterReadPublicFeatureState !== 'unavailable') {
        const { data, error } = await supabase.rpc('get_public_chapter_read_count', {
            p_user_id: userId,
        });

        if (!error) {
            chapterReadPublicFeatureState = 'available';
            return Math.max(Number(data || 0), localCompletedCount);
        }

        if (!handleChapterReadPublicFeatureError(error)) {
            return 0;
        }
    }

    return localCompletedCount;
};

export const getCompletedChapterCountsByUser = async (): Promise<Record<string, number>> => {
    if (chapterReadPublicFeatureState !== 'unavailable') {
        const { data, error } = await supabase.rpc('get_public_chapter_read_leaderboard_counts');

        if (!error) {
            chapterReadPublicFeatureState = 'available';
            const leaderboardMap: Record<string, number> = {};
            ((data as any) || []).forEach((row: any) => {
                leaderboardMap[row.user_id] = Number(row.read_count || 0);
            });
            return leaderboardMap;
        }

        handleChapterReadPublicFeatureError(error);
    }

    const { data } = await supabase.from('reading_activity_log').select('user_id, chapter_id');
    const seenPairs = new Set<string>();

    return (data || []).reduce<Record<string, number>>((counts, row: any) => {
        const pairKey = `${row.user_id}:${row.chapter_id}`;
        if (seenPairs.has(pairKey)) {
            return counts;
        }

        seenPairs.add(pairKey);
        counts[row.user_id] = (counts[row.user_id] || 0) + 1;
        return counts;
    }, {});
};

export const updateReadingProgress = async (userId: string, progress: Omit<ReadingProgress, 'lastRead' | 'userId'>): Promise<void> => {
    if (!(await hasPersistedChapterRecord(progress.chapterId))) {
        return;
    }

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
    const buildFallbackProgress = async () => {
        const chapterProgressMap = await getChapterReadProgressMap(userId, mangaId);
        const latestChapterProgress = sortByLastReadDesc(Object.values(chapterProgressMap))[0];

        if (!latestChapterProgress) {
            return undefined;
        }

        return {
            userId,
            mangaId,
            chapterId: latestChapterProgress.chapterId,
            chapterNumber: latestChapterProgress.chapterNumber,
            page: latestChapterProgress.page,
            lastRead: latestChapterProgress.lastRead,
        } satisfies ReadingProgress;
    };

    try {
        const { data, error } = await supabase
            .from('reading_progress')
            .select('*')
            .eq('user_id', userId)
            .eq('manga_id', mangaId)
            .maybeSingle();

        if (error || !data) {
            return buildFallbackProgress();
        }

        return {
            ...data,
            userId: data.user_id,
            mangaId: data.manga_id,
            chapterId: data.chapter_id,
            chapterNumber: Number(data.chapter_number),
            page: data.page,
            lastRead: data.last_read
        };
    } catch {
        return buildFallbackProgress();
    }
};

export const removeFromHistory = async (userId: string, mangaId: string): Promise<void> => {
    await supabase.from('reading_progress').delete().eq('user_id', userId).eq('manga_id', mangaId);
};

// ==================== BOOKMARKS (USER-SPECIFIC) ====================

export const getBookmarks = async (userId: string): Promise<Bookmark[]> => {
    if (!userId) {
        return [];
    }

    const cachedBookmarks = getCachedBookmarksState(userId);

    if (!areBookmarksInitialized(userId) && isEffectivelyOnline()) {
        try {
            const bookmarks = await withTimeout((async () => {
                const { data, error } = await supabase
                    .from('bookmarks')
                    .select('*')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });

                if (error) {
                    throw error;
                }

                const rawBookmarks = (data || []).map((bookmark: any) => ({
                    ...bookmark,
                    userId: bookmark.user_id,
                    mangaId: bookmark.manga_id,
                    chapterId: bookmark.chapter_id,
                    chapterNumber: Number(bookmark.chapter_number),
                    createdAt: bookmark.created_at,
                })) as Bookmark[];
                const mangaIds = [...new Set(rawBookmarks.map((bookmark) => bookmark.mangaId).filter(Boolean))];
                const chapterIds = [...new Set(rawBookmarks.map((bookmark) => bookmark.chapterId).filter(Boolean))];

                const [{ data: mangaRows }, { data: chapterRows }] = await withTimeout(
                    Promise.all([
                        mangaIds.length > 0
                            ? supabase
                                .from('mangas')
                                .select('id, title, cover, alternative_titles')
                                .in('id', mangaIds)
                            : Promise.resolve({ data: [] as any[] }),
                        chapterIds.length > 0
                            ? supabase
                                .from('chapters')
                                .select('id, title')
                                .in('id', chapterIds)
                            : Promise.resolve({ data: [] as any[] }),
                    ]),
                    4000,
                    'Bookmark enrichment timeout',
                );

                const mangaMap = (mangaRows || []).reduce<Record<string, any>>((map, manga: any) => {
                    map[manga.id] = manga;
                    return map;
                }, {});
                const chapterMap = (chapterRows || []).reduce<Record<string, any>>((map, chapter: any) => {
                    map[chapter.id] = chapter;
                    return map;
                }, {});
                const existingBookmarkMap = cachedBookmarks.reduce<Record<string, Bookmark>>((map, bookmark) => {
                    if (bookmark.id) {
                        map[bookmark.id] = bookmark;
                    }

                    map[`${bookmark.mangaId}:${bookmark.chapterId}:${bookmark.page}`] = bookmark;
                    return map;
                }, {});

                const mergedBookmarks = rawBookmarks.map((bookmark) => {
                    const existingBookmark = (bookmark.id && existingBookmarkMap[bookmark.id])
                        || existingBookmarkMap[`${bookmark.mangaId}:${bookmark.chapterId}:${bookmark.page}`];
                    const manga = mangaMap[bookmark.mangaId];
                    const chapter = chapterMap[bookmark.chapterId];

                    return {
                        ...bookmark,
                        mangaTitle: manga?.title || existingBookmark?.mangaTitle,
                        mangaCover: manga?.cover || existingBookmark?.mangaCover,
                        mangaAlternativeTitles: manga?.alternative_titles || existingBookmark?.mangaAlternativeTitles || [],
                        chapterTitle: chapter?.title || existingBookmark?.chapterTitle,
                    } satisfies Bookmark;
                });

                return mergedBookmarks;
            })(), 6000, 'Bookmark fetch timeout');

            setCachedBookmarks(userId, bookmarks);
            return bookmarks;
        } catch (error) {
            console.error('Bookmark fetch fallback triggered:', error);
        }
    }

    return cachedBookmarks;
};

export const addBookmark = async (userId: string, bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'userId'>): Promise<void> => {
    const existingBookmark = getCachedBookmarksState(userId).find((entry) => (
        entry.mangaId === bookmark.mangaId
        && entry.chapterId === bookmark.chapterId
        && entry.page === bookmark.page
    ));

    if (existingBookmark) {
        throw new Error('ALREADY_EXISTS');
    }

    const nextBookmark: Bookmark = {
        id: createClientEntityId(),
        userId,
        mangaId: bookmark.mangaId,
        chapterId: bookmark.chapterId,
        chapterNumber: bookmark.chapterNumber,
        page: bookmark.page,
        note: bookmark.note,
        createdAt: new Date().toISOString(),
        mangaTitle: bookmark.mangaTitle,
        mangaCover: bookmark.mangaCover,
        mangaAlternativeTitles: bookmark.mangaAlternativeTitles || [],
        chapterTitle: bookmark.chapterTitle,
    };

    addCachedBookmark(userId, nextBookmark);

    if (!isEffectivelyOnline()) {
        queueBookmarkAdd(userId, nextBookmark);
        return;
    }

    const { data: existing, error: existingError } = await supabase.from('bookmarks')
        .select('id')
        .eq('user_id', userId)
        .eq('manga_id', bookmark.mangaId)
        .eq('chapter_id', bookmark.chapterId)
        .eq('page', bookmark.page)
        .maybeSingle();

    if (existingError) {
        queueBookmarkAdd(userId, nextBookmark);
        throw existingError;
    }

    if (existing) {
        removeCachedBookmark(userId, nextBookmark.id || '');
        throw new Error('ALREADY_EXISTS');
    }

    const { error } = await supabase.from('bookmarks').insert({
        id: nextBookmark.id,
        user_id: userId,
        manga_id: bookmark.mangaId,
        chapter_id: bookmark.chapterId,
        chapter_number: bookmark.chapterNumber,
        page: bookmark.page,
        note: bookmark.note,
        created_at: nextBookmark.createdAt,
    });

    if (error) {
        queueBookmarkAdd(userId, nextBookmark);
        throw error;
    }
};

export const removeBookmark = async (userId: string, id: string): Promise<void> => {
    const bookmark = findCachedBookmark(userId, id);
    removeCachedBookmark(userId, id);

    if (!isEffectivelyOnline()) {
        if (bookmark) {
            queueBookmarkRemove(userId, bookmark);
        }
        return;
    }

    const { error } = await supabase.from('bookmarks').delete().eq('id', id).eq('user_id', userId);
    if (error) {
        if (bookmark) {
            queueBookmarkRemove(userId, bookmark);
        }
        throw error;
    }
};

// ==================== READER SETTINGS (KEEP LOCAL) ====================

const DEFAULT_READER_SETTINGS: ReaderSettings = {
    mode: 'vertical',
    fitWidth: true,
    showProgress: true,
    showPageComments: false,
    backgroundColor: 'dark',
    preloadPages: 3,
    prefetchNextChapter: true,
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
    const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('manga_id', { ascending: true })
        .order('chapter_number', { ascending: true })
        .order('id', { ascending: true });

    return sortChapterBatchItems(
        (data || []).map(n => ({
            ...n,
            userId: n.user_id,
            mangaId: n.manga_id,
            chapterId: n.chapter_id,
            chapterNumber: Number(n.chapter_number),
            createdAt: n.created_at,
            fromUserId: n.from_user_id,
            fromUsername: n.from_username
        })),
        (notification) => notification.createdAt,
        (notification) => notification.id
    );
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
    addCachedFollowedManga(userId, mangaId);

    if (!isEffectivelyOnline()) {
        queueFollowUpsert(userId, mangaId);
        return;
    }

    const { error } = await supabase.from('follows').upsert({ user_id: userId, manga_id: mangaId });
    if (error) {
        queueFollowUpsert(userId, mangaId);
        throw error;
    }
};

export const unfollowManga = async (userId: string, mangaId: string): Promise<void> => {
    removeCachedFollowedManga(userId, mangaId);

    if (!isEffectivelyOnline()) {
        queueFollowRemove(userId, mangaId);
        return;
    }

    const { error } = await supabase.from('follows').delete().eq('user_id', userId).eq('manga_id', mangaId);
    if (error) {
        queueFollowRemove(userId, mangaId);
        throw error;
    }
};

export const isFollowingManga = async (userId: string, mangaId: string): Promise<boolean> => {
    if (!userId) {
        return false;
    }

    if (!areFollowsInitialized(userId) && isEffectivelyOnline()) {
        const { data, error } = await supabase
            .from('follows')
            .select('manga_id')
            .eq('user_id', userId);

        if (!error) {
            setCachedFollowedMangaIds(userId, (data || []).map((entry: any) => entry.manga_id));
        }
    }

    return getCachedFollowedMangaIds(userId).includes(mangaId);
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
    entityType: string = 'manga',
    pageNumber?: number
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

    const rawLink = entityType === 'manga'
        ? (() => {
            if (!chapterId) {
                return `/manga/${entityId}?commentId=${encodeURIComponent(commentId)}`;
            }

            const params = new URLSearchParams({
                commentId: commentId,
            });

            if (pageNumber && pageNumber > 0) {
                params.set('commentScope', 'page');
                params.set('commentPage', String(pageNumber));
            }

            return `/manga/${entityId}/chapter/${chapterId}?${params.toString()}`;
        })()
        : `/${entityType}/${entityId}?commentId=${encodeURIComponent(commentId)}`;
    const link = normalizeCommentNavigationLink(rawLink) || rawLink;

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

export const createFollowNotification = async (
    targetUserId: string,
    fromUserId: string,
    fromUsername: string
) => {
    if (targetUserId === fromUserId) {
        return;
    }

    const { data: userData } = await supabase
        .from('users')
        .select('preferences')
        .eq('id', targetUserId)
        .single();

    const prefs = userData?.preferences;
    if (prefs?.notifications?.follows === false) return;

    const { error } = await supabase.from('notifications').insert({
        user_id: targetUserId,
        type: 'follow',
        title: 'Yeni Takipçi',
        message: `${fromUsername} sizi takip etmeye başladı.`,
        from_user_id: fromUserId,
        link: `/profile/${fromUserId}`,
        read: false,
        created_at: new Date().toISOString()
    });

    if (error) console.error('Follow notification error:', error);
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
