import type { ReadingHistoryEntry } from '@/lib/storage';
import type { Manga } from '@/lib/types';

const CONTINUE_READING_SESSION_CACHE_KEY = 'toonparrot-home-continue-reading-session-v3';
const CONTINUE_READING_LOCAL_CACHE_KEY = 'toonparrot-home-continue-reading-local-v3';
const CONTINUE_READING_MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContinueReadingMangaSnapshot {
    id: string;
    title: string;
    alternativeTitles?: string[];
    cover: string;
    banner?: string;
    author: string;
    artist?: string;
    status: Manga['status'];
    genres: string[];
    description: string;
    lastUpdated: string;
    createdAt: string;
    type: Manga['type'];
    isAdult: boolean;
}

export interface ContinueReadingCacheEntry extends ReadingHistoryEntry {
    mangaSnapshot?: ContinueReadingMangaSnapshot | null;
}

interface PersistedContinueReadingCache {
    userId: string;
    entries: ContinueReadingCacheEntry[];
    updatedAt: string;
}

const parsePersistedContinueReadingCache = (raw: string | null): PersistedContinueReadingCache | null => {
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as PersistedContinueReadingCache;
        if (!parsed || typeof parsed.userId !== 'string' || !Array.isArray(parsed.entries)) {
            return null;
        }

        const updatedAt = new Date(parsed.updatedAt || '').getTime();
        if (Number.isNaN(updatedAt) || Date.now() - updatedAt > CONTINUE_READING_MAX_CACHE_AGE_MS) {
            return null;
        }

        return {
            userId: parsed.userId,
            entries: parsed.entries,
            updatedAt: parsed.updatedAt,
        };
    } catch {
        return null;
    }
};

export const buildContinueReadingEntrySignature = (
    entry: Pick<ContinueReadingCacheEntry, 'mangaId' | 'chapterId' | 'chapterNumber' | 'page' | 'lastRead'>,
) => `${entry.mangaId}::${entry.chapterId}::${entry.chapterNumber}::${entry.page}::${entry.lastRead}`;

export const areContinueReadingEntriesEquivalent = (
    left: ContinueReadingCacheEntry[] | undefined,
    right: ContinueReadingCacheEntry[] | undefined,
) => {
    const leftEntries = left || [];
    const rightEntries = right || [];

    if (leftEntries.length !== rightEntries.length) {
        return false;
    }

    return leftEntries.every((entry, index) => (
        buildContinueReadingEntrySignature(entry) === buildContinueReadingEntrySignature(rightEntries[index])
    ));
};

export const areContinueReadingMangaSnapshotsEquivalent = (
    left?: ContinueReadingMangaSnapshot | null,
    right?: ContinueReadingMangaSnapshot | null,
) => {
    if (!left && !right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    return (
        left.id === right.id
        && left.title === right.title
        && left.cover === right.cover
        && left.banner === right.banner
        && left.description === right.description
        && left.type === right.type
        && left.isAdult === right.isAdult
        && left.author === right.author
        && left.artist === right.artist
        && left.status === right.status
        && left.lastUpdated === right.lastUpdated
        && left.createdAt === right.createdAt
        && left.alternativeTitles?.join('||') === right.alternativeTitles?.join('||')
        && left.genres.join('||') === right.genres.join('||')
    );
};

export const extractContinueReadingMangaSnapshot = (manga: Manga): ContinueReadingMangaSnapshot => ({
    id: manga.id,
    title: manga.title,
    alternativeTitles: manga.alternativeTitles || [],
    cover: manga.cover,
    banner: manga.banner,
    author: manga.author,
    artist: manga.artist,
    status: manga.status,
    genres: manga.genres || [],
    description: manga.description || '',
    lastUpdated: manga.lastUpdated,
    createdAt: manga.createdAt,
    type: manga.type,
    isAdult: manga.isAdult === true,
});

export const buildContinueReadingMangaFromSnapshot = (
    snapshot: ContinueReadingMangaSnapshot,
): Manga => ({
    id: snapshot.id,
    title: snapshot.title,
    alternativeTitles: snapshot.alternativeTitles || [],
    cover: snapshot.cover,
    banner: snapshot.banner,
    author: snapshot.author,
    artist: snapshot.artist,
    status: snapshot.status,
    genres: snapshot.genres || [],
    description: snapshot.description || '',
    ratings: [],
    views: 0,
    chapters: [],
    lastUpdated: snapshot.lastUpdated,
    createdAt: snapshot.createdAt,
    type: snapshot.type,
    isAdult: snapshot.isAdult,
    averageRating: 0,
    reviewCount: 0,
});

export const readPersistedContinueReadingCache = (expectedUserId?: string | null): PersistedContinueReadingCache | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const sessionCache = parsePersistedContinueReadingCache(
        window.sessionStorage.getItem(CONTINUE_READING_SESSION_CACHE_KEY),
    );
    const localCache = parsePersistedContinueReadingCache(
        window.localStorage.getItem(CONTINUE_READING_LOCAL_CACHE_KEY),
    );

    const candidates = [sessionCache, localCache]
        .filter((cache): cache is PersistedContinueReadingCache => Boolean(cache))
        .filter((cache) => !expectedUserId || cache.userId === expectedUserId)
        .sort((left, right) => (
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        ));

    if (candidates.length === 0) {
        return null;
    }

    return candidates[0];
};

export const writePersistedContinueReadingCache = (userId: string, entries: ContinueReadingCacheEntry[]) => {
    if (typeof window === 'undefined') {
        return;
    }

    const payload: PersistedContinueReadingCache = {
        userId,
        entries: entries.slice(0, 6),
        updatedAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(payload);
    window.sessionStorage.setItem(CONTINUE_READING_SESSION_CACHE_KEY, serialized);
    window.localStorage.setItem(CONTINUE_READING_LOCAL_CACHE_KEY, serialized);
};

export const clearPersistedContinueReadingCache = () => {
    if (typeof window === 'undefined') {
        return;
    }

    window.sessionStorage.removeItem(CONTINUE_READING_SESSION_CACHE_KEY);
    window.localStorage.removeItem(CONTINUE_READING_LOCAL_CACHE_KEY);
};
