import type { ReadingHistoryEntry } from '@/lib/storage';
import type { Manga } from '@/lib/types';

const CONTINUE_READING_SESSION_CACHE_KEY = 'toonparrot-home-continue-reading-v2';

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
}

export interface ContinueReadingCacheEntry extends ReadingHistoryEntry {
    mangaSnapshot?: ContinueReadingMangaSnapshot | null;
}

interface PersistedContinueReadingCache {
    userId: string;
    entries: ContinueReadingCacheEntry[];
    updatedAt: string;
}

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
    averageRating: 0,
    reviewCount: 0,
});

export const readPersistedContinueReadingCache = (): PersistedContinueReadingCache | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const raw = window.sessionStorage.getItem(CONTINUE_READING_SESSION_CACHE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as PersistedContinueReadingCache;
        if (!parsed || typeof parsed.userId !== 'string' || !Array.isArray(parsed.entries)) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
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

    window.sessionStorage.setItem(CONTINUE_READING_SESSION_CACHE_KEY, JSON.stringify(payload));
};

export const clearPersistedContinueReadingCache = () => {
    if (typeof window === 'undefined') {
        return;
    }

    window.sessionStorage.removeItem(CONTINUE_READING_SESSION_CACHE_KEY);
};
