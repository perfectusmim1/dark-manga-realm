// Supabase Database Integration
// Fully asynchronous operations replacing localStorage
import {
    invokeAuthenticatedFunction,
    isExpectedAccessControlError,
    isRetryableSupabaseBootstrapError,
    runWithSupabaseBootstrapRetry,
    supabase,
    waitForUsableSupabaseSession,
} from './supabase';
import {
    Manga,
    Chapter,
    User,
    MangaRating,
    Comment,
    ReadingList,
    ReadingListItem,
    Review,
    MangaReaction,
    Character,
    Author,
    Artist,
    MangaRelation,
    EntityMetadata,
    ExternalSourceLink,
    EntityGalleryImage,
} from './types';
import {
    CHAPTER_CARD_ADMIN_DIALOG_IMAGE_TRANSFORM,
    buildChapterCardImageDetails,
    getChapterCardImageMode,
    hydrateChaptersWithCardImageState,
    resolveChapterCardImageUrl,
} from './chapterCardImages';
import { encodeCommentContent, parseCommentContent } from './commentContent';
import {
    isStoredMediaUrl,
    materializeChapterPages,
    materializeRemoteImages,
    unwrapManagedMediaUrl,
} from './mediaStorage';
import { normalizeGenres } from './mockData';
import { slugifyCatalogTagName, type OfficialTagSeed } from './officialTagCatalog';
import { sortChapterBatchItems } from './chapterBatchOrdering';
import { cacheOfflineManga, getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import { sanitizeChapterPageUrls } from '@/lib/scraper/scrapeSources';
import {
    areReadingListsInitialized,
    createClientEntityId,
    getCachedPreferencesForUser,
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
import { clearHomeFeedCache } from '@/lib/homeFeedCache';
import {
    getCharacterListingRolePriority,
    normalizeCharacterListingRole,
    type CharacterListingRole,
} from '@/lib/characterRoles';
import { sanitizeCharacterDescription } from '@/lib/descriptionSanitizers';
import { sanitizeEntityImageUrl } from '@/lib/entityImages';
import { normalizeComparableText } from '@/lib/textMatching';
import { getReactionScore, type ReactionType } from './reactions';

const normalizeNamedEntityValue = (value?: string | null) =>
    value?.trim().replace(/\s+/g, ' ') || '';

const normalizeNamedEntityKey = (value?: string | null) =>
    normalizeComparableText(normalizeNamedEntityValue(value));

const buildNamedEntityLookupVariants = (value: string) => {
    const normalized = normalizeNamedEntityValue(value);

    return Array.from(
        new Set(
            [
                normalized,
                normalized.replace(/[İIıi]/g, 'i'),
                normalized.replace(/[İIıi]/g, 'I'),
                normalized.replace(/[İIıi]/g, 'İ'),
                normalized.replace(/[İIıi]/g, 'ı'),
            ].map((item) => normalizeNamedEntityValue(item)).filter(Boolean),
        ),
    );
};

const PERSON_PLACEHOLDER_KEYS = new Set(['', 'bilinmiyor', 'unknown', 'n/a', '-']);

const isMeaningfulNamedEntity = (value?: string | null) =>
    !PERSON_PLACEHOLDER_KEYS.has(normalizeNamedEntityKey(value));

type NamedEntityTableName = 'characters' | 'authors' | 'artists';

const NAMED_ENTITY_LIST_PAGE_SIZE = 1000;

const findNamedEntityRowByName = async <TRow extends { name: string }>(
    table: NamedEntityTableName,
    name: string,
): Promise<TRow | null> => {
    const normalizedName = normalizeNamedEntityValue(name);
    if (!isMeaningfulNamedEntity(normalizedName)) {
        return null;
    }

    for (const lookupName of buildNamedEntityLookupVariants(normalizedName)) {
        const { data, error } = await supabase
            .from(table)
            .select('*')
            .ilike('name', lookupName)
            .limit(1);

        if (error) {
            throw error;
        }

        if (data?.[0]) {
            return data[0] as TRow;
        }
    }

    return null;
};

const mapAuthorRow = (row: any): Author => ({
    ...row,
    imageUrl: sanitizeEntityImageUrl(row.image_url),
    likesCount: row.likes_count ?? 0,
    isPublic: row.is_public ?? true,
    alternativeNames: row.alternative_names || [],
    details: row.details || {},
    gallery: row.gallery || [],
    sourceLinks: row.source_links || [],
});

const mapArtistRow = (row: any): Artist => ({
    ...row,
    imageUrl: sanitizeEntityImageUrl(row.image_url),
    likesCount: row.likes_count ?? 0,
    isPublic: row.is_public ?? true,
    alternativeNames: row.alternative_names || [],
    details: row.details || {},
    gallery: row.gallery || [],
    sourceLinks: row.source_links || [],
});

const mapCharacterRow = (
    row: any,
    options?: { listingRole?: CharacterListingRole | null },
): Character => ({
    id: row.id,
    name: row.name,
    imageUrl: sanitizeEntityImageUrl(row.image_url),
    description: sanitizeCharacterDescription(row.description),
    likesCount: row.likes_count ?? 0,
    createdAt: row.created_at,
    isPublic: row.is_public ?? true,
    alternativeNames: row.alternative_names || [],
    details: row.details || {},
    gallery: row.gallery || [],
    sourceLinks: row.source_links || [],
    listingRole: options?.listingRole || undefined,
});

const mapMangaRelationRow = (row: any): MangaRelation => ({
    id: row.id,
    mangaId: row.manga_id,
    relatedMangaId: row.related_manga_id,
    relationType: row.relation_type,
    sourceName: row.source_name || undefined,
    sourceUrl: row.source_url || undefined,
    sortOrder: row.sort_order ?? 0,
    relatedManga: row.related_manga
        ? {
            ...row.related_manga,
            ...mapMangaBaseFields(row.related_manga),
            chapters: [],
            ratings: [],
            averageRating: row.related_manga.average_rating ?? 0,
            reviewCount: row.related_manga.review_count ?? 0,
            details: row.related_manga.details || {},
            sourceLinks: row.related_manga.source_links || [],
        } as Manga
        : undefined,
});

const normalizeEntityMetadata = (metadata?: EntityMetadata | Record<string, unknown> | null) => (
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata
        : {}
) as EntityMetadata;

const normalizeEntityGallery = (gallery?: EntityGalleryImage[] | unknown) => (
    Array.isArray(gallery)
        ? gallery.filter((item) => item && typeof item === 'object' && typeof (item as EntityGalleryImage).url === 'string')
        : []
) as EntityGalleryImage[];

const normalizeEntitySourceLinks = (sourceLinks?: ExternalSourceLink[] | unknown) => (
    Array.isArray(sourceLinks)
        ? sourceLinks
            .filter((item) => item && typeof item === 'object' && typeof (item as ExternalSourceLink).url === 'string')
            .map((item) => {
                const link = item as ExternalSourceLink;
                return {
                    ...link,
                    source: normalizeNamedEntityValue(link.source),
                    url: normalizeNamedEntityValue(link.url),
                    label: normalizeNamedEntityValue(link.label) || undefined,
                    kind: normalizeNamedEntityValue(link.kind) || undefined,
                    externalId: normalizeNamedEntityValue(link.externalId) || undefined,
                    externalSlug: normalizeNamedEntityValue(link.externalSlug) || undefined,
                } satisfies ExternalSourceLink;
            })
            .filter((item) => Boolean(item.url))
        : []
) as ExternalSourceLink[];

const normalizeSeriesGalleryUrls = (details?: EntityMetadata | Record<string, unknown> | null) => {
    const rawGallery = details && typeof details === 'object' && !Array.isArray(details)
        ? (details as EntityMetadata)?.extra?.seriesGallery
        : undefined;

    if (!Array.isArray(rawGallery)) {
        return [];
    }

    return rawGallery
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean);
};

const createRichEntityPayload = (entity: Partial<Character | Author | Artist>) => ({
    name: normalizeNamedEntityValue(entity.name),
    image_url: sanitizeEntityImageUrl(entity.imageUrl),
    description: entity.description,
    is_public: entity.isPublic ?? true,
    alternative_names: entity.alternativeNames || [],
    details: normalizeEntityMetadata(entity.details),
    gallery: normalizeEntityGallery(entity.gallery),
    source_links: normalizeEntitySourceLinks(entity.sourceLinks),
});

const materializeNamedEntityMedia = async (
    entityType: 'character' | 'author' | 'artist',
    entityId: string,
    media: { imageUrl?: string | null; gallery?: EntityGalleryImage[] | null },
) => {
    const normalizedImageUrl = sanitizeEntityImageUrl(media.imageUrl);
    const normalizedGallery = normalizeEntityGallery(media.gallery || []);

    const materialized = await materializeRemoteImages([
        ...(normalizedImageUrl ? [{
            id: `${entityType}:${entityId}:profile`,
            sourceUrl: normalizedImageUrl,
            entityType,
            entityId,
            variant: 'profile' as const,
        }] : []),
        ...normalizedGallery.map((image, index) => ({
            id: `${entityType}:${entityId}:gallery:${index}`,
            sourceUrl: sanitizeEntityImageUrl(image.url),
            entityType,
            entityId,
            variant: 'gallery' as const,
            objectKey: `${entityType}/${entityId}/gallery/${String(index + 1).padStart(3, '0')}.webp`,
        })),
    ]).catch((error) => {
        console.warn(`${entityType} media materialize failed:`, error);
        return new Map<string, string>();
    });

    return {
        imageUrl: normalizedImageUrl
            ? materialized.get(`${entityType}:${entityId}:profile`) || normalizedImageUrl
            : undefined,
        gallery: normalizedGallery.map((image, index) => ({
            ...image,
            url: materialized.get(`${entityType}:${entityId}:gallery:${index}`) || image.url,
        })),
    };
};

const getOrderedEntityRank = async (
    tableName: 'characters' | 'authors' | 'artists',
    entityId: string,
): Promise<number | undefined> => {
    let from = 0;

    while (true) {
        const to = from + NAMED_ENTITY_LIST_PAGE_SIZE - 1;
        const { data, error } = await (supabase as any)
            .from(tableName)
            .select('id')
            .order('likes_count', { ascending: false })
            .order('name', { ascending: true })
            .range(from, to);

        if (error || !Array.isArray(data)) {
            return undefined;
        }

        const rankIndex = data.findIndex((row: { id: string }) => row.id === entityId);
        if (rankIndex >= 0) {
            return from + rankIndex + 1;
        }

        if (data.length < NAMED_ENTITY_LIST_PAGE_SIZE) {
            return undefined;
        }

        from += NAMED_ENTITY_LIST_PAGE_SIZE;
    }
};

const applyPublicEntityFilter = <TQuery extends { eq: (column: string, value: any) => TQuery }>(
    query: TQuery,
    includePrivate?: boolean,
) => (
    includePrivate ? query : query.eq('is_public', true)
);

const fetchNamedEntityRows = async (
    table: NamedEntityTableName,
    includePrivate?: boolean,
) => {
    const rows: any[] = [];
    let from = 0;

    while (true) {
        const to = from + NAMED_ENTITY_LIST_PAGE_SIZE - 1;
        const query = applyPublicEntityFilter(
            (supabase.from(table) as any)
                .select('*')
                .order('likes_count', { ascending: false })
                .order('name', { ascending: true }),
            includePrivate,
        );
        const { data, error } = await query.range(from, to);

        if (error) {
            throw error;
        }

        const pageRows = data || [];
        rows.push(...pageRows);

        if (pageRows.length < NAMED_ENTITY_LIST_PAGE_SIZE) {
            break;
        }

        from += NAMED_ENTITY_LIST_PAGE_SIZE;
    }

    return rows;
};

const MANGA_VISIBILITY_COLUMN_NAME = 'is_public';
const MANGA_ADULT_COLUMN_NAME = 'is_adult';

const isMissingSchemaColumnError = (error: any, tableName: string, columnName: string) => {
    const normalizedCode = String(error?.code || '').toUpperCase();
    const normalizedMessage = String(error?.message || '').toLowerCase();
    const normalizedDetails = String(error?.details || '').toLowerCase();
    const normalizedHint = String(error?.hint || '').toLowerCase();
    const normalizedColumnName = columnName.toLowerCase();
    const normalizedTarget = `${tableName}.${columnName}`.toLowerCase();

    if (!['42703', 'PGRST204'].includes(normalizedCode)) {
        return false;
    }

    return normalizedMessage.includes(normalizedTarget)
        || normalizedMessage.includes(normalizedColumnName)
        || normalizedDetails.includes(normalizedColumnName)
        || normalizedHint.includes(normalizedColumnName);
};

const isMissingMangaVisibilityColumnError = (error: any) => (
    isMissingSchemaColumnError(error, 'mangas', MANGA_VISIBILITY_COLUMN_NAME)
);

const isMissingMangaAdultColumnError = (error: any) => (
    isMissingSchemaColumnError(error, 'mangas', MANGA_ADULT_COLUMN_NAME)
);

const applyPublicMangaFilter = <TQuery extends { eq: (column: string, value: any) => TQuery }>(
    query: TQuery,
    options?: {
        includePrivate?: boolean;
        includeAdult?: boolean;
        visibilityColumnAvailable?: boolean;
        adultColumnAvailable?: boolean;
    },
) => {
    let nextQuery = query;

    if (!options?.includePrivate && options?.visibilityColumnAvailable !== false) {
        nextQuery = nextQuery.eq(MANGA_VISIBILITY_COLUMN_NAME, true);
    }

    if (!options?.includePrivate && !options?.includeAdult && options?.adultColumnAvailable !== false) {
        nextQuery = nextQuery.eq(MANGA_ADULT_COLUMN_NAME, false);
    }

    return nextQuery;
};

const joinNamedEntityValues = (values: Array<string | null | undefined>) => (
    Array.from(
        new Set(
            values
                .map((value) => normalizeNamedEntityValue(value))
                .filter(Boolean)
                .map((value) => `${value}`),
        ),
    ).join(', ')
);

const mapMangaVisibilityFields = (row: any) => ({
    isPublic: row?.is_public ?? true,
    isAdult: row?.is_adult ?? false,
});

const mapMangaBaseFields = (row: any) => ({
    alternativeTitles: row?.alternative_titles || [],
    ...mapMangaVisibilityFields(row),
    lastUpdated: row?.last_updated,
    createdAt: row?.created_at,
    releaseYear: row?.release_year,
});

const LEGACY_MANGA_PERSON_LABEL_LIMIT = 100;

export interface MangaMediaRecord {
    id: string;
    title: string;
    cover?: string;
    banner?: string;
    galleryUrls: string[];
}

export interface NamedEntityMediaRecord {
    id: string;
    name: string;
    imageUrl?: string;
    gallery: EntityGalleryImage[];
}

const toLegacyMangaPersonLabel = (value?: string | null) => {
    const normalized = normalizeNamedEntityValue(value);
    if (!normalized) {
        return '';
    }

    if (normalized.length <= LEGACY_MANGA_PERSON_LABEL_LIMIT) {
        return normalized;
    }

    const parts = normalized
        .split(',')
        .map((part) => normalizeNamedEntityValue(part))
        .filter(Boolean);

    if (parts.length <= 1) {
        return `${normalized.slice(0, LEGACY_MANGA_PERSON_LABEL_LIMIT - 3).trimEnd()}...`;
    }

    const selected: string[] = [];

    for (let index = 0; index < parts.length; index += 1) {
        const nextSelected = [...selected, parts[index]];
        const remainingCount = parts.length - nextSelected.length;
        const suffix = remainingCount > 0 ? ` +${remainingCount}` : '';
        const candidate = `${nextSelected.join(', ')}${suffix}`;

        if (candidate.length > LEGACY_MANGA_PERSON_LABEL_LIMIT) {
            if (selected.length > 0) {
                return `${selected.join(', ')} +${parts.length - selected.length}`;
            }

            return `${parts[index].slice(0, LEGACY_MANGA_PERSON_LABEL_LIMIT - 3).trimEnd()}...`;
        }

        selected.push(parts[index]);
    }

    return selected.join(', ');
};

type RichEntityType = 'character' | 'author' | 'artist';
type CommentEntityType = 'manga' | RichEntityType;
type ReactionIdColumn = 'comment_id' | 'review_id';

const getCommentReactionTableNames = (entityType: CommentEntityType) => ({
    like: entityType === 'manga' ? 'comment_likes' : `${entityType}_comment_likes`,
    dislike: entityType === 'manga' ? 'comment_dislikes' : `${entityType}_comment_dislikes`,
});

const getReviewReactionTableNames = () => ({
    like: 'review_likes',
    dislike: 'review_dislikes',
});

const getUserReactionIds = async (
    tableName: string,
    idColumn: ReactionIdColumn,
    userId?: string,
): Promise<string[]> => {
    if (!userId) {
        return [];
    }

    const { data, error } = await supabase
        .from(tableName as any)
        .select(idColumn as any)
        .eq('user_id', userId);

    if (error) {
        console.error('Fetch user reactions error:', { tableName, idColumn, error });
        return [];
    }

    return ((data as any[]) || [])
        .map((row) => row?.[idColumn])
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
};

const toggleBinaryReaction = async (
    tableName: string,
    oppositeTableName: string,
    idColumn: ReactionIdColumn,
    itemId: string,
    userId: string,
): Promise<void> => {
    const { data: existing, error: fetchError } = await supabase
        .from(tableName as any)
        .select(idColumn as any)
        .eq(idColumn, itemId)
        .eq('user_id', userId)
        .maybeSingle();

    if (fetchError) {
        throw fetchError;
    }

    if (existing) {
        const { error: deleteError } = await supabase
            .from(tableName as any)
            .delete()
            .eq(idColumn, itemId)
            .eq('user_id', userId);

        if (deleteError) {
            throw deleteError;
        }

        return;
    }

    const { error: clearOppositeError } = await supabase
        .from(oppositeTableName as any)
        .delete()
        .eq(idColumn, itemId)
        .eq('user_id', userId);

    if (clearOppositeError) {
        throw clearOppositeError;
    }

    const { error: insertError } = await supabase
        .from(tableName as any)
        .insert({
            [idColumn]: itemId,
            user_id: userId,
        } as any);

    if (insertError) {
        throw insertError;
    }
};

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
    commentEntityType: CommentEntityType;
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

export interface ReviewReport {
    id: string;
    reviewId: string;
    mangaId: string;
    mangaTitle: string;
    mangaCover?: string;
    reporterId: string;
    reporterUsername?: string;
    reportedUserId: string;
    reportedUsername?: string;
    reviewPreview?: string;
    reviewCreatedAt?: string;
    ratingAverage: number;
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

export interface AdminReview extends Review {
    mangaTitle: string;
    mangaCover?: string;
    averageScore: number;
    targetHref: string;
}

export interface AdminReviewsPage {
    reviews: AdminReview[];
    total: number;
}

export interface HomePageMangaSections {
    trendingManga: Manga[];
    newlyAddedSeries: Manga[];
    recentlyUpdated: Manga[];
}

export interface AdminAccessContext {
    userId?: string;
    role?: User['role'];
    canAccessAdminPanel: boolean;
    isPrimaryAdmin: boolean;
}

type TopTenTimeframe = 'today' | 'week' | 'all';
type MangaAudienceCacheKey = 'safe' | 'adult';

const PRIMARY_ADMIN_EMAIL = 'caganherdil@gmail.com';
let adminAccessContextCache:
    | { authUserId: string | null; value: AdminAccessContext }
    | null = null;
let adminAccessContextPromise: Promise<AdminAccessContext> | null = null;
const ALL_MANGAS_CACHE_TTL_MS = 60_000;
const TOP_TEN_IDS_CACHE_TTL_MS = 60_000;
const STAFF_MANGA_ACCESS_ROLE_CACHE_TTL_MS = 60_000;
const MANGA_SUMMARY_BASE_SELECT_COLUMNS = 'id, title, alternative_titles, cover, banner, author, artist, status, genres, description, views, last_updated, created_at, type, release_year';
const HOME_PAGE_SECTION_LIMITS = Object.freeze({
    trending: 8,
    newlyAdded: 8,
    recentlyUpdated: 12,
});
let allMangasCache: Partial<Record<MangaAudienceCacheKey, { fetchedAt: number; value: Manga[] }>> = {};
let allMangasPromise: Partial<Record<MangaAudienceCacheKey, Promise<Manga[]>>> = {};
let mangaSummariesCache: Partial<Record<MangaAudienceCacheKey, { fetchedAt: number; value: Manga[] }>> = {};
let mangaSummariesPromise: Partial<Record<MangaAudienceCacheKey, Promise<Manga[]>>> = {};
let homePageMangaSectionsCache: Partial<Record<MangaAudienceCacheKey, { fetchedAt: number; value: HomePageMangaSections }>> = {};
let homePageMangaSectionsPromise: Partial<Record<MangaAudienceCacheKey, Promise<HomePageMangaSections>>> = {};
let mangaVisibilityColumnAvailableCache: boolean | null = null;
let mangaVisibilityColumnAvailablePromise: Promise<boolean> | null = null;
let mangaAdultColumnAvailableCache: boolean | null = null;
let mangaAdultColumnAvailablePromise: Promise<boolean> | null = null;
let currentViewerRoleCache:
    | { authUserId: string | null; fetchedAt: number; role?: User['role'] }
    | null = null;
let currentViewerRolePromise: Promise<User['role'] | undefined> | null = null;
const CHAPTER_META_BATCH_SIZE = 1000;
const topTenMangaIdsCache: Record<TopTenTimeframe, { fetchedAt: number; value: Set<string> } | null> = {
    today: null,
    week: null,
    all: null,
};
const topTenMangaIdsPromises: Record<TopTenTimeframe, Promise<Set<string>> | null> = {
    today: null,
    week: null,
    all: null,
};

const getMangaAudienceCacheKey = (includeAdult: boolean): MangaAudienceCacheKey => (
    includeAdult ? 'adult' : 'safe'
);

const invalidateAllMangasCache = () => {
    allMangasCache = {};
    allMangasPromise = {};
    mangaSummariesCache = {};
    mangaSummariesPromise = {};
    homePageMangaSectionsCache = {};
    homePageMangaSectionsPromise = {};
    topTenMangaIdsCache.today = null;
    topTenMangaIdsCache.week = null;
    topTenMangaIdsCache.all = null;
    topTenMangaIdsPromises.today = null;
    topTenMangaIdsPromises.week = null;
    topTenMangaIdsPromises.all = null;
    clearHomeFeedCache();
};

export const invalidateMangaVisibilityCaches = () => {
    currentViewerRoleCache = null;
    currentViewerRolePromise = null;
    invalidateAllMangasCache();
};

const getMangaSummarySelectColumns = (
    visibilityColumnAvailable: boolean,
    adultColumnAvailable: boolean,
) => (
    [
        MANGA_SUMMARY_BASE_SELECT_COLUMNS,
        visibilityColumnAvailable ? MANGA_VISIBILITY_COLUMN_NAME : null,
        adultColumnAvailable ? MANGA_ADULT_COLUMN_NAME : null,
    ].filter(Boolean).join(', ')
);

const getMangaVisibilityColumnAvailability = async (): Promise<boolean> => {
    if (mangaVisibilityColumnAvailableCache !== null) {
        return mangaVisibilityColumnAvailableCache;
    }

    if (!mangaVisibilityColumnAvailablePromise) {
        mangaVisibilityColumnAvailablePromise = (async () => {
            const { error } = await supabase
                .from('mangas')
                .select(`id, ${MANGA_VISIBILITY_COLUMN_NAME}`)
                .limit(1);

            if (error) {
                if (isMissingMangaVisibilityColumnError(error)) {
                    return false;
                }

                if (!isExpectedAccessControlError(error)) {
                    console.error('Manga visibility column check error:', error);
                }

                return true;
            }

            return true;
        })()
            .then((result) => {
                mangaVisibilityColumnAvailableCache = result;
                return result;
            })
            .finally(() => {
                mangaVisibilityColumnAvailablePromise = null;
            });
    }

    return mangaVisibilityColumnAvailablePromise;
};

const getMangaAdultColumnAvailability = async (): Promise<boolean> => {
    if (mangaAdultColumnAvailableCache !== null) {
        return mangaAdultColumnAvailableCache;
    }

    if (!mangaAdultColumnAvailablePromise) {
        mangaAdultColumnAvailablePromise = (async () => {
            const { error } = await supabase
                .from('mangas')
                .select(`id, ${MANGA_ADULT_COLUMN_NAME}`)
                .limit(1);

            if (error) {
                if (isMissingMangaAdultColumnError(error)) {
                    return false;
                }

                if (!isExpectedAccessControlError(error)) {
                    console.error('Manga adult column check error:', error);
                }

                return true;
            }

            return true;
        })()
            .then((result) => {
                mangaAdultColumnAvailableCache = result;
                return result;
            })
            .finally(() => {
                mangaAdultColumnAvailablePromise = null;
            });
    }

    return mangaAdultColumnAvailablePromise;
};

const getCurrentViewerAdultModePreference = async (): Promise<boolean> => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        if (!isExpectedAccessControlError(sessionError)) {
            console.error('Current viewer session fetch error:', sessionError);
        }
        return false;
    }

    const authUserId = sessionData.session?.user?.id;
    if (!authUserId) {
        return false;
    }

    const cachedPreferences = getCachedPreferencesForUser(authUserId);
    if (cachedPreferences) {
        return cachedPreferences.content?.adult_mode === true;
    }

    const { data: profile, error } = await supabase
        .from('users')
        .select('preferences')
        .eq('id', authUserId)
        .maybeSingle();

    if (error) {
        if (!isExpectedAccessControlError(error)) {
            console.error('Current viewer preferences fetch error:', error);
        }
        return false;
    }

    return profile?.preferences?.content?.adult_mode === true;
};

const getCurrentViewerRole = async (): Promise<User['role'] | undefined> => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        if (!isExpectedAccessControlError(sessionError)) {
            console.error('Current viewer session fetch error:', sessionError);
        }
        return undefined;
    }

    const authUserId = sessionData.session?.user?.id || null;
    const sessionRole = sessionData.session?.user?.user_metadata?.role as User['role'] | undefined;

    if (!authUserId) {
        currentViewerRoleCache = {
            authUserId: null,
            fetchedAt: Date.now(),
            role: undefined,
        };
        return undefined;
    }

    if (
        currentViewerRoleCache?.authUserId === authUserId
        && Date.now() - currentViewerRoleCache.fetchedAt < STAFF_MANGA_ACCESS_ROLE_CACHE_TTL_MS
    ) {
        return currentViewerRoleCache.role || sessionRole;
    }

    if (currentViewerRolePromise && currentViewerRoleCache?.authUserId === authUserId) {
        return currentViewerRolePromise;
    }

    currentViewerRolePromise = (async () => {
        const { data: profile, error } = await supabase
            .from('users')
            .select('role')
            .eq('id', authUserId)
            .maybeSingle();

        if (error) {
            if (!isExpectedAccessControlError(error)) {
                console.error('Current viewer role fetch error:', error);
            }
            return sessionRole;
        }

        return (profile?.role as User['role'] | undefined) || sessionRole;
    })()
        .then((role) => {
            currentViewerRoleCache = {
                authUserId,
                fetchedAt: Date.now(),
                role,
            };
            return role;
        })
        .finally(() => {
            currentViewerRolePromise = null;
        });

    return currentViewerRolePromise;
};

const resolveMangaVisibilityAccess = async (includePrivateOverride?: boolean) => {
    const [visibilityColumnAvailable, adultColumnAvailable, role, adultModeEnabled] = await Promise.all([
        getMangaVisibilityColumnAvailability(),
        getMangaAdultColumnAvailability(),
        getCurrentViewerRole(),
        getCurrentViewerAdultModePreference(),
    ]);
    const isStaff = role === 'admin' || role === 'moderator';
    const includePrivate = includePrivateOverride === true
        ? true
        : includePrivateOverride === false
            ? false
            : isStaff;
    const includeAdult = includePrivate || isStaff || adultModeEnabled;

    return {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
        summarySelectColumns: getMangaSummarySelectColumns(visibilityColumnAvailable, adultColumnAvailable),
    };
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

const calculateReviewAverage = (review?: {
    rating_story?: number | null;
    rating_characters?: number | null;
    rating_art?: number | null;
    rating_progression?: number | null;
    rating_engagement?: number | null;
} | null) => {
    if (!review) {
        return 0;
    }

    const scores = [
        review.rating_story,
        review.rating_characters,
        review.rating_art,
        review.rating_progression,
        review.rating_engagement,
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (scores.length === 0) {
        return 0;
    }

    return Math.round((scores.reduce((total, score) => total + score, 0) / scores.length) * 10) / 10;
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

const buildLatestChapterPreviewsByMangaId = (chapters: any[] = []) => {
    const latestChapterPreviewsByMangaId = new Map<string, { id: string; number: number }[]>();

    for (const chapter of chapters) {
        const mangaId = chapter.manga_id;
        const existing = latestChapterPreviewsByMangaId.get(mangaId) || [];

        if (!existing.some((item) => item.id === chapter.id)) {
            existing.push({ id: chapter.id, number: chapter.number });
            existing.sort((left, right) => right.number - left.number);

            if (existing.length > 2) {
                existing.length = 2;
            }

            latestChapterPreviewsByMangaId.set(mangaId, existing);
        }
    }

    return latestChapterPreviewsByMangaId;
};

const fetchAllChapterMetaRows = async (
    selectColumns: string,
    options?: {
        mangaIds?: string[];
        orderByNumberAscending?: boolean;
    },
) => {
    const uniqueMangaIds = [...new Set((options?.mangaIds || []).filter(Boolean))];

    let countQuery = supabase
        .from('chapters')
        .select('id', { count: 'exact', head: true });

    if (uniqueMangaIds.length > 0) {
        countQuery = countQuery.in('manga_id', uniqueMangaIds);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
        throw countError;
    }

    if (!count || count < 1) {
        return [] as any[];
    }

    const pageCount = Math.ceil(count / CHAPTER_META_BATCH_SIZE);
    const requests = Array.from({ length: pageCount }, (_, pageIndex) => {
        const rangeStart = pageIndex * CHAPTER_META_BATCH_SIZE;
        const rangeEnd = rangeStart + CHAPTER_META_BATCH_SIZE - 1;

        let query = supabase
            .from('chapters')
            .select(selectColumns)
            .order('manga_id', { ascending: true })
            .range(rangeStart, rangeEnd);

        if (selectColumns.includes('number')) {
            query = query.order('number', { ascending: options?.orderByNumberAscending ?? false });
        }

        if (uniqueMangaIds.length > 0) {
            query = query.in('manga_id', uniqueMangaIds);
        }

        return query;
    });

    const responses = await Promise.all(requests);
    const rows: any[] = [];

    for (const response of responses) {
        if (response.error) {
            throw response.error;
        }

        rows.push(...(response.data || []));
    }

    return rows;
};

// ==================== MANGA OPERATIONS ====================

/**
 * Fetch all mangas from Supabase
 */
export const getAllMangas = async (
    options?: { includePrivate?: boolean }
): Promise<Manga[]> => {
    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
    } = await resolveMangaVisibilityAccess(options?.includePrivate);
    const audienceCacheKey = getMangaAudienceCacheKey(includeAdult);
    const cachedAllMangas = allMangasCache[audienceCacheKey];
    const pendingAllMangas = allMangasPromise[audienceCacheKey];

    if (!includePrivate && cachedAllMangas && Date.now() - cachedAllMangas.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        return cachedAllMangas.value;
    }

    if (!includePrivate && pendingAllMangas) {
        return pendingAllMangas;
    }

    try {
        const fetchManga = async () => {
            const [
                { data, error },
                { data: revData, error: reviewsError },
                chapterRows,
            ] = await Promise.all([
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select('*')
                        .order('last_updated', { ascending: false }),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                supabase
                    .from('reviews')
                    .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement'),
                fetchAllChapterMetaRows('id, manga_id, number', { orderByNumberAscending: true })
                    .catch((chapterError) => {
                        console.error('Manga list chapter aggregate fetch error:', chapterError);
                        return [];
                    }),
            ]);

            if (error) throw error;
            if (reviewsError) console.error('Manga list review aggregate fetch error:', reviewsError);

            const chaptersByMangaId = new Map<string, { id: string; number: number }[]>();
            for (const chapter of chapterRows) {
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
                    ...mapMangaBaseFields(m),
                    chapters: mangaChapters,
                    ratings: Array(reviewCount).fill({ rating: average }), // Simplified for list view
                    averageRating: average,
                    reviewCount,
                } as any;
            });
        };

        const pendingRequest = runWithSupabaseBootstrapRetry({
            run: fetchManga,
            timeoutMs: 9000,
            timeoutMessage: 'Manga fetch timeout',
            shouldRetryResult: (result) => Array.isArray(result) && result.length === 0,
        });
        if (!includePrivate) {
            allMangasPromise[audienceCacheKey] = pendingRequest;
        }
        const mangas = await pendingRequest;

        if (!includePrivate && mangas.length > 0) {
            allMangasCache[audienceCacheKey] = {
                fetchedAt: Date.now(),
                value: mangas,
            };
        }

        return mangas;
    } catch (error) {
        if (!includePrivate) {
            invalidateAllMangasCache();
        }
        console.error('Manga fetch global error:', error);
        return [];
    } finally {
        if (!includePrivate) {
            delete allMangasPromise[audienceCacheKey];
        }
    }
};

export const getMangaSummaries = async (
    options?: { includePrivate?: boolean }
): Promise<Manga[]> => {
    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
        summarySelectColumns,
    } = await resolveMangaVisibilityAccess(options?.includePrivate);
    const audienceCacheKey = getMangaAudienceCacheKey(includeAdult);
    const cachedMangaSummaries = mangaSummariesCache[audienceCacheKey];
    const cachedAllMangas = allMangasCache[audienceCacheKey];
    const pendingMangaSummaries = mangaSummariesPromise[audienceCacheKey];

    if (!includePrivate && cachedMangaSummaries && Date.now() - cachedMangaSummaries.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        return cachedMangaSummaries.value;
    }

    if (!includePrivate && cachedAllMangas && Date.now() - cachedAllMangas.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        const summarized = cachedAllMangas.value.map((manga) => ({
            ...manga,
            chapters: manga.chapters.length > 1
                ? [manga.chapters[manga.chapters.length - 1], manga.chapters[manga.chapters.length - 2]]
                : manga.chapters.slice(),
            ratings: [],
            chapterCount: typeof manga.chapterCount === 'number' ? manga.chapterCount : manga.chapters.length,
        }));
        mangaSummariesCache[audienceCacheKey] = {
            fetchedAt: cachedAllMangas.fetchedAt,
            value: summarized,
        };
        return summarized;
    }

    if (!includePrivate && pendingMangaSummaries) {
        return pendingMangaSummaries;
    }

    try {
        const fetchSummaries = async () => {
            const [
                { data: mangaRows, error: mangaError },
                { data: reviewRows, error: reviewError },
                chapterRows,
            ] = await Promise.all([
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .order('last_updated', { ascending: false }),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                supabase
                    .from('reviews')
                    .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement'),
                fetchAllChapterMetaRows('id, manga_id, number', { orderByNumberAscending: false })
                    .catch((chapterError) => {
                        if (!isExpectedAccessControlError(chapterError)) {
                            console.error('Manga summary chapter aggregate fetch error:', chapterError);
                        }
                        return [];
                    }),
            ]);

            if (mangaError) {
                throw mangaError;
            }

            if (reviewError) {
                console.error('Manga summary review aggregate fetch error:', reviewError);
            }

            const reviewStatsByMangaId = buildReviewStatsByMangaId(reviewRows || []);
            const chapterCountByMangaId = buildChapterCountByMangaId(chapterRows);
            const latestChapterPreviewsByMangaId = buildLatestChapterPreviewsByMangaId(chapterRows);
            const mangaIds = (mangaRows || []).map((manga: any) => manga.id).filter(Boolean);
            const [nextAuthorsByMangaId, nextArtistsByMangaId] = await Promise.all([
                getMangaAuthorsByIds(mangaIds, { includePrivate }),
                getMangaArtistsByIds(mangaIds, { includePrivate }),
            ]);

            return (mangaRows || []).map((manga: any) => {
                const reviewStats = reviewStatsByMangaId.get(manga.id);
                const authorsDetails = nextAuthorsByMangaId.get(manga.id) || [];
                const artistsDetails = nextArtistsByMangaId.get(manga.id) || [];

                return {
                    ...manga,
                    author: joinNamedEntityValues(authorsDetails.map((author) => author.name)) || manga.author,
                    artist: joinNamedEntityValues(artistsDetails.map((artist) => artist.name)) || manga.artist,
                    ...mapMangaBaseFields(manga),
                    chapters: latestChapterPreviewsByMangaId.get(manga.id) || [],
                    ratings: [],
                    chapterCount: chapterCountByMangaId.get(manga.id) || 0,
                    averageRating: reviewStats?.average || 0,
                    reviewCount: reviewStats?.reviewCount || 0,
                    authorDetails: authorsDetails[0],
                    artistDetails: artistsDetails[0],
                    authorsDetails,
                    artistsDetails,
                } as Manga;
            });
        };

        const pendingRequest = runWithSupabaseBootstrapRetry({
            run: fetchSummaries,
            timeoutMs: 9000,
            timeoutMessage: 'Manga summary fetch timeout',
            shouldRetryResult: (result) => Array.isArray(result) && result.length === 0,
        });
        if (!includePrivate) {
            mangaSummariesPromise[audienceCacheKey] = pendingRequest;
        }
        const summaries = await pendingRequest;

        if (!includePrivate && summaries.length > 0) {
            mangaSummariesCache[audienceCacheKey] = {
                fetchedAt: Date.now(),
                value: summaries,
            };
        }

        return summaries;
    } catch (error) {
        if (!includePrivate) {
            delete mangaSummariesCache[audienceCacheKey];
            delete mangaSummariesPromise[audienceCacheKey];
        }
        if (!isExpectedAccessControlError(error)) {
            console.error('Manga summary fetch global error:', error);
        }
        return [];
    } finally {
        if (!includePrivate) {
            delete mangaSummariesPromise[audienceCacheKey];
        }
    }
};

export const getMangaSummariesByIds = async (
    mangaIds: string[],
    options?: { includePrivate?: boolean }
): Promise<Manga[]> => {
    const uniqueMangaIds = [...new Set(mangaIds.filter(Boolean))];
    if (uniqueMangaIds.length === 0) {
        return [];
    }

    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
        summarySelectColumns,
    } = await resolveMangaVisibilityAccess(options?.includePrivate);
    const audienceCacheKey = getMangaAudienceCacheKey(includeAdult);
    if (includePrivate) {
        const { data: mangaRows, error: mangaError } = await applyPublicMangaFilter(
            supabase
                .from('mangas')
                .select(summarySelectColumns)
                .in('id', uniqueMangaIds),
            { includePrivate: true, includeAdult: true, visibilityColumnAvailable, adultColumnAvailable },
        );

        if (mangaError) {
            if (!isExpectedAccessControlError(mangaError)) {
                console.error('Manga summary by ids fetch error:', mangaError);
            }
            return [];
        }

        const fetchedSummaries = await buildMangaSummariesForRows(
            mangaRows || [],
            { logContext: 'Manga summary by ids', includePrivate: true, includeAdult: true },
        );
        const summaryMap = new Map(fetchedSummaries.map((manga) => [manga.id, manga]));

        return uniqueMangaIds
            .map((mangaId) => summaryMap.get(mangaId))
            .filter(Boolean) as Manga[];
    }

    const requestedIdSet = new Set(uniqueMangaIds);
    const summaryMap = new Map<string, Manga>();
    const now = Date.now();

    const cachedMangaSummaries = mangaSummariesCache[audienceCacheKey];
    const cachedAllMangas = allMangasCache[audienceCacheKey];

    if (cachedMangaSummaries && now - cachedMangaSummaries.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        cachedMangaSummaries.value.forEach((manga) => {
            if (requestedIdSet.has(manga.id)) {
                summaryMap.set(manga.id, manga);
            }
        });
    }

    if (cachedAllMangas && now - cachedAllMangas.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        cachedAllMangas.value.forEach((manga) => {
            if (requestedIdSet.has(manga.id) && !summaryMap.has(manga.id)) {
                summaryMap.set(manga.id, manga);
            }
        });
    }

    const missingIds = uniqueMangaIds.filter((mangaId) => !summaryMap.has(mangaId));
    if (missingIds.length > 0) {
        const { data: mangaRows, error: mangaError } = await applyPublicMangaFilter(
            supabase
                .from('mangas')
                .select(summarySelectColumns)
                .in('id', missingIds),
            { includePrivate: false, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
        );

        if (mangaError) {
            if (!isExpectedAccessControlError(mangaError)) {
                console.error('Manga summary by ids fetch error:', mangaError);
            }
        } else {
            const fetchedSummaries = await buildMangaSummariesForRows(
                mangaRows || [],
                { logContext: 'Manga summary by ids', includePrivate: false, includeAdult },
            );

            fetchedSummaries.forEach((manga) => {
                summaryMap.set(manga.id, manga);
            });
        }
    }

    return uniqueMangaIds
        .map((mangaId) => summaryMap.get(mangaId))
        .filter(Boolean) as Manga[];
};

export const getHomePageMangaSections = async (): Promise<HomePageMangaSections> => {
    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
        summarySelectColumns,
    } = await resolveMangaVisibilityAccess();
    const audienceCacheKey = getMangaAudienceCacheKey(includeAdult);
    const cachedHomeSections = homePageMangaSectionsCache[audienceCacheKey];
    const cachedAllMangas = allMangasCache[audienceCacheKey];
    const cachedMangaSummaries = mangaSummariesCache[audienceCacheKey];
    const pendingHomeSections = homePageMangaSectionsPromise[audienceCacheKey];

    if (
        !includePrivate &&
        cachedHomeSections
        && Date.now() - cachedHomeSections.fetchedAt < ALL_MANGAS_CACHE_TTL_MS
    ) {
        return cachedHomeSections.value;
    }

    if (!includePrivate && cachedAllMangas && Date.now() - cachedAllMangas.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        const sections = buildHomePageSectionsFromCollection(cachedAllMangas.value);
        homePageMangaSectionsCache[audienceCacheKey] = {
            fetchedAt: cachedAllMangas.fetchedAt,
            value: sections,
        };
        return sections;
    }

    if (!includePrivate && cachedMangaSummaries && Date.now() - cachedMangaSummaries.fetchedAt < ALL_MANGAS_CACHE_TTL_MS) {
        const sections = buildHomePageSectionsFromCollection(cachedMangaSummaries.value);
        homePageMangaSectionsCache[audienceCacheKey] = {
            fetchedAt: cachedMangaSummaries.fetchedAt,
            value: sections,
        };
        return sections;
    }

    if (!includePrivate && pendingHomeSections) {
        return pendingHomeSections;
    }

    const mapRowsToSummaries = (rows: any[], summaryMap: Map<string, Manga>) => (
        rows
            .map((row) => summaryMap.get(row.id))
            .filter(Boolean) as Manga[]
    );

    try {
        const fetchSections = async () => {
            const [
                { data: newlyAddedRows, error: newlyAddedError },
                { data: recentlyUpdatedRows, error: recentlyUpdatedError },
                { data: trendingRows, error: trendingError },
            ] = await Promise.all([
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .order('created_at', { ascending: false })
                        .limit(HOME_PAGE_SECTION_LIMITS.newlyAdded),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .order('last_updated', { ascending: false })
                        .limit(HOME_PAGE_SECTION_LIMITS.recentlyUpdated),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .order('views', { ascending: false })
                        .limit(HOME_PAGE_SECTION_LIMITS.trending),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
            ]);

            if (newlyAddedError || recentlyUpdatedError || trendingError) {
                throw newlyAddedError || recentlyUpdatedError || trendingError;
            }

            const uniqueRowsById = new Map<string, any>();
            [...(newlyAddedRows || []), ...(recentlyUpdatedRows || []), ...(trendingRows || [])].forEach((row) => {
                const normalizedRow = row && typeof row === 'object' ? row as Record<string, unknown> : null;
                const rowId = typeof normalizedRow?.id === 'string' ? normalizedRow.id : null;
                if (rowId && !uniqueRowsById.has(rowId)) {
                    uniqueRowsById.set(rowId, normalizedRow);
                }
            });

            const summaries = await buildMangaSummariesForRows(
                [...uniqueRowsById.values()],
                { logContext: 'Homepage manga', includePrivate, includeAdult }
            );
            const summaryMap = new Map(summaries.map((manga) => [manga.id, manga]));

            return {
                trendingManga: mapRowsToSummaries(trendingRows || [], summaryMap),
                newlyAddedSeries: mapRowsToSummaries(newlyAddedRows || [], summaryMap),
                recentlyUpdated: mapRowsToSummaries(recentlyUpdatedRows || [], summaryMap),
            } satisfies HomePageMangaSections;
        };

        const pendingRequest = runWithSupabaseBootstrapRetry({
            run: fetchSections,
            timeoutMs: 9000,
            timeoutMessage: 'Homepage manga fetch timeout',
            shouldRetryResult: (result) => !hasHomePageSectionData(result),
        });
        if (!includePrivate) {
            homePageMangaSectionsPromise[audienceCacheKey] = pendingRequest;
        }

        const sections = await pendingRequest;
        if (!includePrivate && hasHomePageSectionData(sections)) {
            homePageMangaSectionsCache[audienceCacheKey] = {
                fetchedAt: Date.now(),
                value: sections,
            };
        }

        return sections;
    } catch (error) {
        delete homePageMangaSectionsCache[audienceCacheKey];
        delete homePageMangaSectionsPromise[audienceCacheKey];
        if (!isExpectedAccessControlError(error)) {
            console.error('Homepage manga fetch error:', error);
        }
        return createEmptyHomePageMangaSections();
    } finally {
        if (!includePrivate) {
            delete homePageMangaSectionsPromise[audienceCacheKey];
        }
    }
};

export const getMangaMediaRecords = async (): Promise<MangaMediaRecord[]> => {
    const { data, error } = await supabase
        .from('mangas')
        .select('id, title, cover, banner, details')
        .order('title', { ascending: true });

    if (error) {
        throw error;
    }

    return (data || []).map((row) => ({
        id: row.id,
        title: row.title,
        cover: row.cover || undefined,
        banner: row.banner || undefined,
        galleryUrls: normalizeSeriesGalleryUrls(row.details),
    }));
};

interface GetMangaByIdOptions {
    includePrivate?: boolean;
    includePages?: boolean;
}

const mapChapterRowToChapter = (row: any, options?: { includePages?: boolean }): Chapter => {
    const includePages = options?.includePages === true;
    const pages = includePages ? sanitizeChapterPageUrls(row.pages || []) : [];

    return {
        id: row.id,
        number: Number(row.number) || 0,
        title: row.title || '',
        pages,
        pageCount: includePages ? pages.length : undefined,
        releaseDate: row.release_date || '',
        views: row.views || 0,
    };
};

export const getMangaChapters = async (
    mangaId: string,
    options?: { includePages?: boolean }
): Promise<Chapter[]> => {
    const includePages = options?.includePages === true;
    const selectColumns = includePages
        ? 'id, manga_id, number, title, pages, release_date, views'
        : 'id, manga_id, number, title, release_date, views';

    const { data, error } = await supabase
        .from('chapters')
        .select(selectColumns)
        .eq('manga_id', mangaId)
        .order('number', { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map((row: any) => mapChapterRowToChapter(row, { includePages }));
};

export const getChapterPagesByIds = async (chapterIds: string[]): Promise<Record<string, string[]>> => {
    const uniqueIds = [...new Set(chapterIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
        return {};
    }

    const { data, error } = await supabase
        .from('chapters')
        .select('id, pages')
        .in('id', uniqueIds);

    if (error) {
        throw error;
    }

    return (data || []).reduce<Record<string, string[]>>((map, row: any) => {
        map[row.id] = sanitizeChapterPageUrls(row.pages || []);
        return map;
    }, {});
};

const normalizeComparableChapterPageUrl = (value?: string | null) => {
    const normalized = unwrapManagedMediaUrl(value);
    return typeof normalized === 'string' ? normalized.trim() : '';
};

const haveEqualChapterPages = (left: string[] = [], right: string[] = []) => (
    left.length === right.length
    && left.every((pageUrl, index) => (
        normalizeComparableChapterPageUrl(pageUrl)
        === normalizeComparableChapterPageUrl(right[index])
    ))
);

const chapterNeedsStoredPageMaterialization = (chapter: Pick<Chapter, 'pages'>) => (
    chapter.pages.some((pageUrl) => {
        const normalizedPageUrl = normalizeComparableChapterPageUrl(pageUrl);
        return Boolean(normalizedPageUrl) && !isStoredMediaUrl(normalizedPageUrl);
    })
);

/**
 * Get a single manga by ID with all its chapters
 */
export const getMangaById = async (
    mangaId: string,
    options?: GetMangaByIdOptions
): Promise<Manga | undefined> => {
    const { includePrivate, includeAdult } = await resolveMangaVisibilityAccess(options?.includePrivate);

    const { data, error } = await supabase
        .from('mangas')
        .select('*')
        .eq('id', mangaId)
        .maybeSingle();

    if (error || !data) {
        if (error && error.code !== 'PGRST116') console.error('Manga detail fetch error:', error);
        return undefined;
    }

    if (!includePrivate && data.is_public === false) {
        return undefined;
    }

    if (!includePrivate && !includeAdult && data.is_adult === true) {
        return undefined;
    }

    const [
        { data: reviewData },
        chapterRows,
        authorsDetails,
        artistsDetails,
        relatedSeries,
        { count: characterCount },
    ] = await Promise.all([
        supabase.from('reviews').select('*').eq('manga_id', mangaId),
        getMangaChapters(mangaId, { includePages: options?.includePages === true }),
        getMangaAuthors(mangaId, options),
        getMangaArtists(mangaId, options),
        getMangaRelatedSeries(mangaId, { includePrivate }),
        supabase
            .from('manga_characters')
            .select('*', { count: 'exact', head: true })
            .eq('manga_id', mangaId),
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

    const hydratedChapters = hydrateChaptersWithCardImageState(chapterRows, data.details);

    return {
        ...data,
        author: joinNamedEntityValues(authorsDetails.map((author) => author.name)) || data.author,
        artist: joinNamedEntityValues(artistsDetails.map((artist) => artist.name)) || data.artist,
        ...mapMangaBaseFields(data),
        details: data.details || {},
        sourceLinks: data.source_links || [],
        relatedSeries,
        chapters: hydratedChapters,
        ratings: reviews.map(r => ({
            userId: r.user_id,
            rating: Math.round((r.rating_story + r.rating_characters + r.rating_art + r.rating_progression + r.rating_engagement) / 5),
            createdAt: r.created_at
        })),
        characterCount: characterCount || 0,
        averageRating: average,
        ratingBreakdown: breakdown,
        reviewCount: reviews.length,
        authorDetails: authorsDetails[0],
        artistDetails: artistsDetails[0],
        authorsDetails,
        artistsDetails,
    } as any;
};

/**
 * Save or update a manga
 */
export const saveManga = async (manga: Manga): Promise<void> => {
    const materializedMangaMedia = await materializeRemoteImages([
        {
            id: `${manga.id}:cover`,
            sourceUrl: manga.cover,
            entityType: 'manga',
            entityId: manga.id,
            variant: 'cover',
        },
        {
            id: `${manga.id}:banner`,
            sourceUrl: manga.banner || manga.cover,
            entityType: 'manga',
            entityId: manga.id,
            variant: 'banner',
        },
    ]).catch((error) => {
        console.warn('Manga cover/banner materialize failed:', error);
        return new Map<string, string>();
    });

    const normalizedCover =
        materializedMangaMedia.get(`${manga.id}:cover`)
        || manga.cover;
    const normalizedBanner =
        materializedMangaMedia.get(`${manga.id}:banner`)
        || manga.banner
        || normalizedCover;

    const normalizedChapters: Chapter[] = (manga.chapters || []).map((chapter) => ({
        ...chapter,
        pages: sanitizeChapterPageUrls(chapter.pages || []),
        cardImagePage: chapter.cardImagePage ?? null,
    }));
    const existingChapterPagesById = normalizedChapters.length > 0
        ? await getChapterPagesByIds(normalizedChapters.map((chapter) => chapter.id)).catch((error) => {
            console.warn('Existing chapter page lookup failed:', error);
            return {};
        })
        : {};
    const chaptersPendingStoredPageMaterialization = normalizedChapters.filter((chapter) => (
        chapterNeedsStoredPageMaterialization(chapter)
        && !haveEqualChapterPages(existingChapterPagesById[chapter.id], chapter.pages)
    ));
    const materializedChapterPageMap = chaptersPendingStoredPageMaterialization.length > 0
        ? new Map<string, string[]>(
            (
                await materializeChapterPages<Chapter>(manga.id, chaptersPendingStoredPageMaterialization).catch((error) => {
                    console.warn('Chapter page materialize failed:', error);
                    return chaptersPendingStoredPageMaterialization;
                })
            ).map((chapter) => [chapter.id, chapter.pages] as [string, string[]]),
        )
        : new Map<string, string[]>();
    const chaptersWithMaterializedPages = normalizedChapters.map((chapter) => ({
        ...chapter,
        pages: materializedChapterPageMap.get(chapter.id) || chapter.pages,
    }));
    const normalizedChapterById = new Map<string, Chapter>(
        normalizedChapters.map((chapter) => [chapter.id, chapter] as [string, Chapter]),
    );
    const chapterCardImageMode = getChapterCardImageMode(manga.details);
    const chaptersWithMaterializedCardImages = chapterCardImageMode === 'none'
        ? chaptersWithMaterializedPages
        : await materializeRemoteImages(
            normalizedChapters
                .map((chapter) => {
                    const sourceUrl = resolveChapterCardImageUrl(
                        chapter,
                        chapterCardImageMode,
                        chapter.cardImagePage,
                    );

                    if (!sourceUrl) {
                        return null;
                    }

                    return {
                        id: chapter.id,
                        sourceUrl,
                        entityType: 'manga' as const,
                        entityId: manga.id,
                        variant: 'gallery' as const,
                        objectKey: `manga/${manga.id}/chapter-card/${chapter.id}.webp`,
                        transform: CHAPTER_CARD_ADMIN_DIALOG_IMAGE_TRANSFORM,
                    };
                })
                .filter((item): item is NonNullable<typeof item> => Boolean(item)),
        )
            .then((materializedImages) => chaptersWithMaterializedPages.map((chapter) => ({
                ...chapter,
                cardImageUrl: materializedImages.get(chapter.id)
                    || chapter.cardImageUrl
                    || resolveChapterCardImageUrl(
                        normalizedChapterById.get(chapter.id) || chapter,
                        chapterCardImageMode,
                        chapter.cardImagePage,
                    ),
            })))
            .catch((error) => {
                console.warn('Chapter card image materialize failed:', error);
                return chaptersWithMaterializedPages.map((chapter) => ({
                    ...chapter,
                    cardImageUrl: chapter.cardImageUrl
                        || resolveChapterCardImageUrl(
                            normalizedChapterById.get(chapter.id) || chapter,
                            chapterCardImageMode,
                            chapter.cardImagePage,
                        ),
                }));
            });
    const normalizedDetails = buildChapterCardImageDetails(manga.details, chaptersWithMaterializedCardImages);

    const mangaData = {
        id: manga.id,
        title: manga.title,
        author: toLegacyMangaPersonLabel(manga.author),
        artist: toLegacyMangaPersonLabel(manga.artist),
        is_public: manga.isPublic ?? true,
        is_adult: manga.isAdult ?? false,
        description: manga.description,
        cover: normalizedCover,
        banner: normalizedBanner,
        genres: normalizeGenres(manga.genres),
        status: manga.status,
        type: manga.type,
        views: manga.views || 0,
        release_year: manga.releaseYear,
        alternative_titles: manga.alternativeTitles || [],
        details: normalizeEntityMetadata(normalizedDetails),
        source_links: normalizeEntitySourceLinks(manga.sourceLinks),
        last_updated: new Date().toISOString(),
        created_at: manga.createdAt || new Date().toISOString(),
    };

    let { error } = await supabase
        .from('mangas')
        .upsert(mangaData);

    if (error && isMissingMangaVisibilityColumnError(error)) {
        mangaVisibilityColumnAvailableCache = false;
        mangaVisibilityColumnAvailablePromise = null;
        mangaAdultColumnAvailableCache = false;
        mangaAdultColumnAvailablePromise = null;

        const { is_public: _ignoredVisibility, is_adult: _ignoredAdult, ...legacyMangaData } = mangaData;
        const retryResult = await supabase
            .from('mangas')
            .upsert(legacyMangaData);

        error = retryResult.error;
    } else if (error && isMissingMangaAdultColumnError(error)) {
        mangaAdultColumnAvailableCache = false;
        mangaAdultColumnAvailablePromise = null;

        const { is_adult: _ignoredAdult, ...legacyMangaData } = mangaData;
        const retryResult = await supabase
            .from('mangas')
            .upsert(legacyMangaData);

        error = retryResult.error;
    }

    if (error) throw error;
    invalidateAllMangasCache();

    // Sync chapters as well
    if (chaptersWithMaterializedCardImages.length > 0) {
        const chaptersData = hydrateChaptersWithCardImageState(chaptersWithMaterializedCardImages, normalizedDetails).map(c => ({
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

export const updateMangaMediaUrls = async (
    mangaId: string,
    media: { cover?: string | null; banner?: string | null; galleryUrls?: string[] | null },
): Promise<void> => {
    const payload: Record<string, unknown> = {};

    if (typeof media.cover === 'string') {
        payload.cover = media.cover;
    }

    if (typeof media.banner === 'string') {
        payload.banner = media.banner;
    }

    const shouldUpdateGallery = Array.isArray(media.galleryUrls);

    if (Object.keys(payload).length === 0 && !shouldUpdateGallery) {
        return;
    }

    if (shouldUpdateGallery) {
        const { data: existingRow, error: existingError } = await supabase
            .from('mangas')
            .select('details')
            .eq('id', mangaId)
            .maybeSingle();

        if (existingError) throw existingError;

        const nextDetails = normalizeEntityMetadata(existingRow?.details);
        const nextExtra = {
            ...(nextDetails.extra || {}),
        };

        if ((media.galleryUrls || []).length > 0) {
            nextExtra.seriesGallery = media.galleryUrls || [];
        } else {
            delete nextExtra.seriesGallery;
        }

        if (Object.keys(nextExtra).length > 0) {
            nextDetails.extra = nextExtra;
        } else {
            delete nextDetails.extra;
        }

        payload.details = nextDetails;
    }

    payload.last_updated = new Date().toISOString();

    const { error } = await supabase
        .from('mangas')
        .update(payload)
        .eq('id', mangaId);

    if (error) throw error;
    invalidateAllMangasCache();
};

// ==================== CHAPTER OPERATIONS ====================

export const addChapterToManga = async (mangaId: string, chapter: Chapter): Promise<boolean> => {
    const normalizedChapter = {
        ...chapter,
        pages: sanitizeChapterPageUrls(chapter.pages || []),
    };
    const [materializedChapter] = await materializeChapterPages(mangaId, [normalizedChapter]).catch((error) => {
        console.warn('Single chapter page materialize failed:', error);
        return [normalizedChapter];
    });
    const chapterData = {
        id: chapter.id,
        manga_id: mangaId,
        number: chapter.number,
        title: chapter.title,
        pages: materializedChapter?.pages || normalizedChapter.pages,
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
    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
    } = await resolveMangaVisibilityAccess();

    let query = supabase
        .from('chapters')
        .select(visibilityColumnAvailable && !includePrivate
            ? `
                id,
                manga_id,
                number,
                title,
                created_at,
                release_date,
                mangas:manga_id!inner(id, title, cover, type, is_public${adultColumnAvailable ? ', is_adult' : ''})
            `
            : `
                id,
                manga_id,
                number,
                title,
                created_at,
                release_date,
                mangas:manga_id(id, title, cover, type)
            `
        )
        .order('created_at', { ascending: false })
        .order('manga_id', { ascending: true })
        .order('number', { ascending: false })
        .order('id', { ascending: true });

    if (visibilityColumnAvailable && !includePrivate) {
        query = query.eq('mangas.is_public', true);
    }

    if (adultColumnAvailable && !includePrivate && !includeAdult) {
        query = query.eq('mangas.is_adult', false);
    }

    if (typeof end === 'number') {
        query = query.range(offset, end);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Latest chapters fetch error:', error);
        return [];
    }

    return sortChapterBatchItems(
        (data || [])
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
            .filter(Boolean) as LatestChapterFeedItem[],
        (chapter) => chapter.addedAt,
        (chapter) => chapter.chapterId
    );
};

export const getLatestChaptersCountLast24Hours = async (): Promise<number> => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
    } = await resolveMangaVisibilityAccess();

    let query = supabase
        .from('chapters')
        .select(
            visibilityColumnAvailable && !includePrivate
                ? `id, mangas:manga_id!inner(id, is_public${adultColumnAvailable ? ', is_adult' : ''})`
                : 'id',
            { count: 'exact', head: true },
        )
        .gte('created_at', since);

    if (visibilityColumnAvailable && !includePrivate) {
        query = query.eq('mangas.is_public', true);
    }

    if (adultColumnAvailable && !includePrivate && !includeAdult) {
        query = query.eq('mangas.is_adult', false);
    }

    const { count, error } = await query;

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

export const addReview = async (
    review: Omit<Review, 'id' | 'createdAt' | 'updatedAt' | 'likes' | 'likedBy' | 'dislikes' | 'dislikedBy'>
): Promise<void> => {
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

export const deleteReview = async (reviewId: string): Promise<void> => {
    const { error } = await supabase
        .from('reviews')
        .delete()
        .eq('id', reviewId);

    if (error) throw error;
};

export const getReviewsForManga = async (mangaId: string): Promise<Review[]> => {
    const reviewReactionTables = getReviewReactionTableNames();
    const { data, error } = await supabase
        .from('reviews')
        .select(`
            *,
            user:users!user_id(username, avatar, role),
            likes_count:${reviewReactionTables.like}(count),
            dislikes_count:${reviewReactionTables.dislike}(count)
        ` as any)
        .eq('manga_id', mangaId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Fetch reviews error:', error);
        return [];
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;

    const [userLikes, userDislikes] = userId
        ? await Promise.all([
            getUserReactionIds(reviewReactionTables.like, 'review_id', userId),
            getUserReactionIds(reviewReactionTables.dislike, 'review_id', userId),
        ])
        : [[], []];

    const reviewRows = ((data || []) as any[])
        .filter((row) => row !== null && typeof row === 'object' && 'id' in row);

    return reviewRows
        .map((r) => ({
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
            dislikes: (r as any).dislikes_count?.[0]?.count || 0,
            likedBy: userId && userLikes.includes(r.id) ? [userId] : [],
            dislikedBy: userId && userDislikes.includes(r.id) ? [userId] : [],
        })) as Review[];
};

const toggleReviewReaction = async (
    reviewId: string,
    userId: string,
    reactionType: ReactionType,
): Promise<void> => {
    const reactionTables = getReviewReactionTableNames();
    const activeTable = reactionType === 'like' ? reactionTables.like : reactionTables.dislike;
    const oppositeTable = reactionType === 'like' ? reactionTables.dislike : reactionTables.like;

    await toggleBinaryReaction(activeTable, oppositeTable, 'review_id', reviewId, userId);
};

export const toggleReviewLike = async (reviewId: string, userId: string): Promise<void> => (
    toggleReviewReaction(reviewId, userId, 'like')
);

export const toggleReviewDislike = async (reviewId: string, userId: string): Promise<void> => (
    toggleReviewReaction(reviewId, userId, 'dislike')
);

export const getUserRating = async (mangaId: string, userId: string): Promise<number | undefined> => {
    const { data: reviewData, error: reviewError } = await supabase
        .from('reviews')
        .select('rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
        .eq('manga_id', mangaId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!reviewError && reviewData) {
        const avg = (reviewData.rating_story + reviewData.rating_characters + reviewData.rating_art + reviewData.rating_progression + reviewData.rating_engagement) / 5;
        return Math.round(avg * 10) / 10;
    }

    const { data: ratingData, error: ratingError } = await supabase
        .from('ratings')
        .select('rating')
        .eq('manga_id', mangaId)
        .eq('user_id', userId)
        .maybeSingle();

    if (ratingError || typeof ratingData?.rating !== 'number') {
        return undefined;
    }

    return Math.round(ratingData.rating * 10) / 10;
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
        dislikes: 0,
        likedBy: [],
        dislikedBy: [],
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

export const searchMangas = async (
    query: string,
    options?: { includePrivate?: boolean }
): Promise<Manga[]> => {
    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
    } = await resolveMangaVisibilityAccess(options?.includePrivate);

    const { data, error } = await applyPublicMangaFilter(
        supabase
            .from('mangas')
            .select('*')
            .or(`title.ilike.%${query}%,author.ilike.%${query}%`),
        { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
    );

    if (error) return [];
    return data.map(m => ({
        ...m,
        ...mapMangaBaseFields(m),
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
    activeBanType: user.active_ban_type || null,
    banExpiresAt: user.ban_expires_at || null,
    warningCount: Number(user.warning_count) || 0,
    unreadWarningCount: Number(user.unread_warning_count) || 0,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at || undefined,
});

const ensureAuthenticatedAdminSession = async () => {
    const session = await waitForUsableSupabaseSession({
        required: true,
    });

    const { data, error } = await runWithSupabaseBootstrapRetry({
        run: () => supabase.auth.getSession(),
        timeoutMs: 5000,
        timeoutMessage: 'Admin session fetch timeout',
        shouldRetryResult: (response) => Boolean(response.error) && isRetryableSupabaseBootstrapError(response.error),
    });
    if (error) {
        throw error;
    }

    const activeSession = data.session || session;
    if (!activeSession?.user || !activeSession.access_token) {
        throw new Error('ADMIN_SESSION_REQUIRED');
    }

    return activeSession;
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
    await ensureAuthenticatedAdminSession();

    const data = await runWithSupabaseBootstrapRetry({
        run: () => invokeAuthenticatedFunction<{ success?: boolean; message?: string; users?: User[] }>('admin-user-directory', {}),
        timeoutMs: 7000,
        timeoutMessage: 'Admin directory fetch timeout',
    });

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
        const { data: authData, error: authError } = await runWithSupabaseBootstrapRetry({
            run: () => supabase.auth.getUser(),
            timeoutMs: 5000,
            timeoutMessage: 'Admin auth user fetch timeout',
            shouldRetryResult: (response) => Boolean(response.error) && isRetryableSupabaseBootstrapError(response.error),
        });

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

        const { data: ownProfile, error: ownProfileError } = await runWithSupabaseBootstrapRetry({
            run: async () => await supabase
                .from('users')
                .select('role')
                .eq('id', authUserId)
                .maybeSingle(),
            timeoutMs: 6000,
            timeoutMessage: 'Admin access profile fetch timeout',
            shouldRetryResult: (response) => Boolean(response.error) && isRetryableSupabaseBootstrapError(response.error),
        });

        if (ownProfileError) {
            if (!isExpectedAccessControlError(ownProfileError)) {
                console.error('Admin access context profile error:', ownProfileError);
            }
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

export const getMangasByIds = async (
    mangaIds: string[],
    options?: { includePrivate?: boolean }
): Promise<Manga[]> => {
    const uniqueIds = [...new Set(mangaIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
        return [];
    }

    try {
        const { includePrivate, visibilityColumnAvailable, summarySelectColumns } = await resolveMangaVisibilityAccess(options?.includePrivate);
        const { data: mangaData, error: mangaError } = await applyPublicMangaFilter(
            supabase
                .from('mangas')
                .select(summarySelectColumns)
                .in('id', uniqueIds),
            { includePrivate, visibilityColumnAvailable },
        );

        if (mangaError) {
            throw mangaError;
        }

        const mangaSummaries = await buildMangaSummariesForRows(mangaData || [], {
            logContext: 'Manga by ids',
            includePrivate,
        });
        const mangaMap = new Map(mangaSummaries.map((manga) => [manga.id, manga]));

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
        await supabase.auth.signOut({ scope: 'local' });
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
        hentai: mangaData?.filter(m => m.type === 'hentai').length || 0,
        webtoon_hentai: mangaData?.filter(m => m.type === 'webtoon_hentai').length || 0,
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

const isMissingSetCommentPinnedRpcError = (error: unknown) => {
    const message = typeof error === 'object' && error !== null
        ? `${String((error as { message?: unknown }).message || '')} ${String((error as { details?: unknown }).details || '')} ${String((error as { hint?: unknown }).hint || '')}`.toLowerCase()
        : '';
    const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '').toLowerCase()
        : '';

    return code === '42883'
        || code === 'pgrst202'
        || message.includes('set_comment_pinned')
        || message.includes('does not exist')
        || message.includes('could not find');
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
    entityType: CommentEntityType,
    entityId: string,
    chapterId?: string,
    sortBy: 'newest' | 'popular' = 'newest',
    options?: MangaCommentQueryOptions
): Promise<Comment[]> => {
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const colName = entityType === 'manga' ? 'manga_id' : `${entityType}_id`;
    const reactionTables = getCommentReactionTableNames(entityType);

    const createQuery = (includePageNumberFilter: boolean) => {
        let query = supabase
            .from(tableName as any)
            .select(`
                *,
                author:users!user_id(username, username_last_changed_at, avatar, role),
                likes_count:${reactionTables.like}(count),
                dislikes_count:${reactionTables.dislike}(count)
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
        console.error('Fetch comments error', { entityType, error });
        return [];
    }

    if (shouldUsePageNumberFilter && mangaCommentPageNumberFeatureState === 'unknown') {
        mangaCommentPageNumberFeatureState = 'available';
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const [userLikes, userDislikes] = userId
        ? await Promise.all([
            getUserReactionIds(reactionTables.like, 'comment_id', userId),
            getUserReactionIds(reactionTables.dislike, 'comment_id', userId),
        ])
        : [[], []];

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
            dislikes: c.dislikes_count?.[0]?.count || 0,
            likedBy: userId && userLikes.includes(c.id) ? [userId] : [],
            dislikedBy: userId && userDislikes.includes(c.id) ? [userId] : [],
            isPinned: Boolean(c.is_pinned),
        };
    }) as Comment[];

    return mappedComments.sort((a, b) => {
        const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinDiff !== 0) {
            return pinDiff;
        }

        if (sortBy === 'popular') {
            const scoreDiff = getReactionScore(b) - getReactionScore(a);
            if (scoreDiff !== 0) {
                return scoreDiff;
            }

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
        dislikes: 0,
        likedBy: [],
        dislikedBy: [],
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
            likes_count:comment_likes(count),
            dislikes_count:comment_dislikes(count)
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
            dislikes: c.dislikes_count?.[0]?.count || 0,
            likedBy: [],
            dislikedBy: [],
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

const buildPostgrestInFilter = (values: string[]) => (
    values
        .filter(Boolean)
        .map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
        .join(',')
);

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
            likes_count:comment_likes(count),
            dislikes_count:comment_dislikes(count)
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
            dislikes: c.dislikes_count?.[0]?.count || 0,
            likedBy: [],
            dislikedBy: [],
            isPinned: Boolean(c.is_pinned),
        };
    }) as Comment[];

    return {
        comments,
        total: count || 0,
    };
};

export const getAdminReviewsPage = async (
    page: number,
    pageSize: number = 30,
    searchQuery: string = '',
): Promise<AdminReviewsPage> => {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const normalizedQuery = searchQuery.trim();

    let matchingUserIds: string[] = [];
    let matchingMangaIds: string[] = [];

    if (normalizedQuery) {
        const [{ data: usersData }, { data: mangasData }] = await Promise.all([
            supabase
                .from('users')
                .select('id')
                .ilike('username', `%${normalizedQuery}%`)
                .limit(50),
            supabase
                .from('mangas')
                .select('id')
                .ilike('title', `%${normalizedQuery}%`)
                .limit(50),
        ]);

        matchingUserIds = (usersData || []).map((user: any) => user.id).filter(Boolean);
        matchingMangaIds = (mangasData || []).map((manga: any) => manga.id).filter(Boolean);
    }

    let query = supabase
        .from('reviews')
        .select(`
            id,
            manga_id,
            user_id,
            content,
            rating_story,
            rating_characters,
            rating_art,
            rating_progression,
            rating_engagement,
            created_at,
            updated_at,
            user:users!user_id(username, avatar, role),
            manga:mangas!manga_id(title, cover),
            likes_count:review_likes(count),
            dislikes_count:review_dislikes(count)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

    if (normalizedQuery) {
        const filters = [`content.ilike.%${normalizedQuery}%`];

        if (matchingUserIds.length > 0) {
            filters.push(`user_id.in.(${buildPostgrestInFilter(matchingUserIds)})`);
        }

        if (matchingMangaIds.length > 0) {
            filters.push(`manga_id.in.(${buildPostgrestInFilter(matchingMangaIds)})`);
        }

        query = query.or(filters.join(','));
    }

    const { data, error, count } = await query;

    if (error) {
        console.error('Admin reviews page fetch error:', error);
        return { reviews: [], total: 0 };
    }

    const reviews = (data || []).map((review: any) => ({
        id: review.id,
        mangaId: review.manga_id,
        mangaTitle: review.manga?.title || 'Bilinmeyen seri',
        mangaCover: review.manga?.cover || undefined,
        userId: review.user_id,
        username: review.user?.username || 'Anonim',
        userAvatar: review.user?.avatar || undefined,
        userRole: review.user?.role || undefined,
        content: review.content,
        rating_story: review.rating_story,
        rating_characters: review.rating_characters,
        rating_art: review.rating_art,
        rating_progression: review.rating_progression,
        rating_engagement: review.rating_engagement,
        createdAt: review.created_at,
        updatedAt: review.updated_at,
        likes: review.likes_count?.[0]?.count || 0,
        dislikes: review.dislikes_count?.[0]?.count || 0,
        likedBy: [],
        dislikedBy: [],
        averageScore: calculateReviewAverage(review),
        targetHref: `/manga/${review.manga_id}`,
    })) as AdminReview[];

    return {
        reviews,
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
    const { error } = await supabase.rpc('set_comment_pinned', {
        p_comment_id: id,
        p_is_pinned: isPinned,
        p_entity_type: entityType,
    });

    if (!error) {
        return;
    }

    if (!isMissingSetCommentPinnedRpcError(error)) {
        console.error('Yorum sabitleme hatası:', error);
        throw error;
    }

    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const { error: fallbackError } = await supabase
        .from(tableName as any)
        .update({ is_pinned: isPinned } as any)
        .eq('id', id);

    if (fallbackError) {
        console.error('Yorum sabitleme hatası:', fallbackError);
        throw fallbackError;
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
    commentEntityType: CommentEntityType;
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

export const createReviewReport = async (payload: {
    reviewId: string;
    reporterId: string;
    reason: string;
    details?: string;
}): Promise<void> => {
    const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('id, user_id')
        .eq('id', payload.reviewId)
        .maybeSingle();

    if (reviewError) {
        console.error('Review report validation error:', reviewError);
        throw reviewError;
    }

    if (!review) {
        throw new Error('İnceleme bulunamadı');
    }

    if (review.user_id === payload.reporterId) {
        throw new Error('Kendi incelemenizi bildiremezsiniz');
    }

    const { error } = await supabase
        .from('review_reports')
        .upsert({
            review_id: payload.reviewId,
            reporter_id: payload.reporterId,
            reason: payload.reason.trim(),
            details: payload.details?.trim() || null,
            status: 'open',
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'reporter_id,review_id',
        });

    if (error) {
        if (isMissingTableInSchemaCache(error, 'review_reports')) {
            throw new Error('İnceleme bildirme sistemi birkaç saniye içinde aktif olacak. Sayfayı yenileyip tekrar deneyin.');
        }
        console.error('Review report create error:', error);
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

export const getReviewReports = async (): Promise<ReviewReport[]> => {
    const { data, error } = await supabase
        .from('review_reports')
        .select('id, review_id, reporter_id, reason, details, status, created_at, updated_at')
        .order('created_at', { ascending: false });

    if (error || !data) {
        if (error) {
            if (isMissingTableInSchemaCache(error, 'review_reports')) {
                return [];
            }
            console.error('Review reports fetch error:', error);
        }
        return [];
    }

    const reviewIds = [...new Set(data.map((report: any) => report.review_id).filter(Boolean))];
    const reporterIds = [...new Set(data.map((report: any) => report.reporter_id).filter(Boolean))];

    const [{ data: reviewsData }, { data: reportersData }] = await Promise.all([
        reviewIds.length
            ? supabase
                .from('reviews')
                .select('id, manga_id, user_id, content, created_at, rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
                .in('id', reviewIds)
            : Promise.resolve({ data: [] as any[] }),
        reporterIds.length
            ? supabase.from('users').select('id, username').in('id', reporterIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const reviewMap = new Map((reviewsData || []).map((review: any) => [review.id, review]));
    const reviewedUserIds = [...new Set((reviewsData || []).map((review: any) => review.user_id).filter(Boolean))];
    const mangaIds = [...new Set((reviewsData || []).map((review: any) => review.manga_id).filter(Boolean))];

    const [{ data: reviewedUsersData }, { data: mangasData }] = await Promise.all([
        reviewedUserIds.length
            ? supabase.from('users').select('id, username').in('id', reviewedUserIds)
            : Promise.resolve({ data: [] as any[] }),
        mangaIds.length
            ? supabase.from('mangas').select('id, title, cover').in('id', mangaIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const reporterMap = new Map((reportersData || []).map((user: any) => [user.id, user.username]));
    const reviewedUserMap = new Map((reviewedUsersData || []).map((user: any) => [user.id, user.username]));
    const mangaMap = new Map((mangasData || []).map((manga: any) => [manga.id, manga]));

    return data.map((report: any) => {
        const review = reviewMap.get(report.review_id);
        const manga = review ? mangaMap.get(review.manga_id) : null;

        return {
            id: report.id,
            reviewId: report.review_id,
            mangaId: review?.manga_id || '',
            mangaTitle: manga?.title || 'Bilinmeyen seri',
            mangaCover: manga?.cover || undefined,
            reporterId: report.reporter_id,
            reporterUsername: reporterMap.get(report.reporter_id),
            reportedUserId: review?.user_id || '',
            reportedUsername: review ? reviewedUserMap.get(review.user_id) : undefined,
            reviewPreview: review?.content || undefined,
            reviewCreatedAt: review?.created_at || undefined,
            ratingAverage: calculateReviewAverage(review),
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

export const updateReviewReportStatus = async (id: string, status: ReportStatus): Promise<void> => {
    const { error } = await supabase
        .from('review_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error('Review report status update error:', error);
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

const toggleCommentReaction = async (
    commentId: string,
    userId: string,
    entityType: CommentEntityType = 'manga',
    reactionType: ReactionType,
): Promise<void> => {
    const reactionTables = getCommentReactionTableNames(entityType);
    const activeTable = reactionType === 'like' ? reactionTables.like : reactionTables.dislike;
    const oppositeTable = reactionType === 'like' ? reactionTables.dislike : reactionTables.like;

    await toggleBinaryReaction(activeTable, oppositeTable, 'comment_id', commentId, userId);
};

export const toggleCommentLike = async (
    commentId: string,
    userId: string,
    entityType: CommentEntityType = 'manga',
): Promise<void> => toggleCommentReaction(commentId, userId, entityType, 'like');

export const toggleCommentDislike = async (
    commentId: string,
    userId: string,
    entityType: CommentEntityType = 'manga',
): Promise<void> => toggleCommentReaction(commentId, userId, entityType, 'dislike');

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

    const [{ data: mangaRows, error: mangaError }, chapterRows] = await Promise.all([
        supabase
            .from('mangas')
            .select('id, title, alternative_titles, cover, banner, author, artist, status, genres, description, type, views, last_updated, created_at, is_public, is_adult')
            .in('id', uniqueMangaIds),
        fetchAllChapterMetaRows('manga_id', { mangaIds: uniqueMangaIds })
            .catch((chapterError) => {
                console.error('Reading list chapter count fetch error:', chapterError);
                return [];
            }),
    ]);

    if (mangaError || !mangaRows) {
        if (mangaError) {
            console.error('Reading list manga summary fetch error:', mangaError);
        }
        return {} as Record<string, ReturnType<typeof mapMangaToCachedReadingListItem>>;
    }

    const chapterCountMap = chapterRows.reduce<Record<string, number>>((map, chapter: any) => {
        map[chapter.manga_id] = (map[chapter.manga_id] || 0) + 1;
        return map;
    }, {});

    return mangaRows.reduce<Record<string, ReturnType<typeof mapMangaToCachedReadingListItem>>>((map, manga: any) => {
        map[manga.id] = mapMangaToCachedReadingListItem({
            id: manga.id,
            title: manga.title,
            ...mapMangaBaseFields(manga),
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
        ...mapMangaBaseFields(m),
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
            console.error('Sync failed for manga', { title: manga.title, error: err });
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

export const getEntityReactions = async (entityType: CommentEntityType, entityId: string, chapterId?: string): Promise<Record<string, number>> => {
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

export const getUserEntityReaction = async (entityType: CommentEntityType, entityId: string, userId: string, chapterId?: string): Promise<string | null> => {
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

export const addEntityReactionV2 = async (entityType: CommentEntityType, entityId: string, userId: string, reactionType: string, chapterId?: string): Promise<void> => {
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
        const {
            includePrivate,
            includeAdult,
            visibilityColumnAvailable,
            adultColumnAvailable,
        } = await resolveMangaVisibilityAccess();

        // Fetch all mangas except the current one
        const { data, error } = await applyPublicMangaFilter(
            supabase
                .from('mangas')
                .select('*')
                .neq('id', mangaId),
            { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
        );

        if (error || !data) return [];

        // Get reviews for average ratings
        const { data: revData } = await supabase
            .from('reviews')
            .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement');
        const allReviews = revData || [];

        // Get chapter counts
        const chapterCounts = await fetchAllChapterMetaRows('manga_id').catch((chapterError) => {
            console.error('Similar manga chapter count fetch error:', chapterError);
            return [];
        });

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
                    ...mapMangaBaseFields(m),
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

export const getCharacters = async (
    options?: { includePrivate?: boolean }
): Promise<Character[]> => {
    return getCharactersList(options);
};

export const getCharacterMediaRecords = async (): Promise<NamedEntityMediaRecord[]> => {
    const { data, error } = await supabase
        .from('characters')
        .select('id, name, image_url, gallery')
        .order('name', { ascending: true });

    if (error) {
        throw error;
    }

    return (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        imageUrl: sanitizeEntityImageUrl(row.image_url),
        gallery: normalizeEntityGallery(row.gallery),
    }));
};

export const getCharactersList = async (
    options?: { includePrivate?: boolean }
): Promise<Character[]> => {
    try {
        const rows = await fetchNamedEntityRows('characters', options?.includePrivate);
        return rows.map((character, index) => ({
            ...mapCharacterRow(character),
            rank: index + 1,
        }));
    } catch (error) {
        console.error('getCharactersList error:', error);
        return [];
    }
};

export const findCharacterByName = async (name: string): Promise<Character | null> => {
    const row = await findNamedEntityRowByName<any>('characters', name);
    return row ? mapCharacterRow(row) : null;
};

export const getCharacterById = async (
    id: string,
    options?: { includePrivate?: boolean }
): Promise<Character | undefined> => {
    const { data, error } = await applyPublicEntityFilter(
        supabase
            .from('characters')
            .select(`
                *,
                mangas:manga_characters(manga:mangas(*))
            `)
            .eq('id', id),
        options?.includePrivate,
    ).maybeSingle();

    if (error || !data) return undefined;

    const seriesIds = ((data as any).mangas || [])
        .map((item: any) => item.manga?.id)
        .filter(Boolean);

    const [series, rank] = await Promise.all([
        getMangasByIds(seriesIds, { includePrivate: options?.includePrivate }),
        getOrderedEntityRank('characters', id),
    ]);

    return {
        ...mapCharacterRow(data),
        rank,
        series,
    };
};

export const saveCharacter = async (character: Partial<Character>): Promise<string> => {
    const normalizedName = normalizeNamedEntityValue(character.name);
    if (!normalizedName) {
        throw new Error('CHARACTER_NAME_REQUIRED');
    }

    const data = createRichEntityPayload({
        ...character,
        name: normalizedName,
        description: sanitizeCharacterDescription(character.description),
    });
    const { image_url: _imageUrl, gallery: _gallery, ...dataWithoutMedia } = data;

    if (character.id) {
        const { error } = await supabase
            .from('characters')
            .update(dataWithoutMedia)
            .eq('id', character.id);
        if (error) throw error;
        if ('imageUrl' in character || 'gallery' in character) {
            await updateCharacterMedia(character.id, {
                imageUrl: character.imageUrl,
                gallery: character.gallery,
            });
        }
        return character.id;
    }

    const { data: inserted, error } = await supabase
        .from('characters')
        .insert(dataWithoutMedia)
        .select('id')
        .single();

    if (error) throw error;
    if ('imageUrl' in character || 'gallery' in character) {
        await updateCharacterMedia(inserted.id, {
            imageUrl: character.imageUrl,
            gallery: character.gallery,
        });
    }
    return inserted.id;
};

export const updateCharacterImageUrl = async (
    characterId: string,
    imageUrl?: string | null,
): Promise<void> => {
    await updateCharacterMedia(characterId, { imageUrl });
};

export const updateCharacterMedia = async (
    characterId: string,
    media: { imageUrl?: string | null; gallery?: EntityGalleryImage[] | null },
): Promise<void> => {
    const payload: Record<string, unknown> = {};
    const materializedMedia = await materializeNamedEntityMedia('character', characterId, media);

    if ('imageUrl' in media) {
        payload.image_url = materializedMedia.imageUrl;
    }

    if ('gallery' in media) {
        payload.gallery = materializedMedia.gallery;
    }

    if (Object.keys(payload).length === 0) {
        return;
    }

    const { error } = await supabase
        .from('characters')
        .update(payload)
        .eq('id', characterId);

    if (error) throw error;
};

export const ensureCharacterByName = async (name: string): Promise<Character | null> => {
    const normalizedName = normalizeNamedEntityValue(name);
    if (!isMeaningfulNamedEntity(normalizedName)) {
        return null;
    }

    const existing = await findCharacterByName(normalizedName);
    if (existing) {
        return existing;
    }

    const id = await saveCharacter({ name: normalizedName });
    return {
        id,
        name: normalizedName,
        imageUrl: undefined,
        description: undefined,
        likesCount: 0,
        createdAt: new Date().toISOString(),
        isPublic: true,
        alternativeNames: [],
        details: {},
        gallery: [],
        sourceLinks: [],
    };
};

export const deleteCharacter = async (id: string): Promise<void> => {
    const { error } = await supabase.from('characters').delete().eq('id', id);
    if (error) throw error;
};

export const linkMangaToCharacter = async (
    mangaId: string,
    characterId: string,
    options?: { listingRole?: CharacterListingRole | null },
): Promise<void> => {
    const payload: {
        manga_id: string;
        character_id: string;
        listing_role?: CharacterListingRole | null;
    } = {
        manga_id: mangaId,
        character_id: characterId,
    };

    if (options && 'listingRole' in options) {
        payload.listing_role = options.listingRole || null;
    }

    const { error } = await supabase
        .from('manga_characters')
        .upsert(payload, { onConflict: 'manga_id,character_id' });

    if (error) {
        throw error;
    }
};

export const unlinkMangaFromCharacter = async (mangaId: string, characterId: string): Promise<void> => {
    await supabase.from('manga_characters').delete().eq('manga_id', mangaId).eq('character_id', characterId);
};

export const getMangaCharacters = async (
    mangaId: string,
    options?: { includePrivate?: boolean }
): Promise<Character[]> => {
    const { data, error } = await supabase
        .from('manga_characters')
        .select('listing_role, character:characters(*)')
        .eq('manga_id', mangaId);

    if (error) return [];
    return (data || [])
        .map((entry: any) => {
            if (!entry.character) {
                return null;
            }

            return mapCharacterRow(entry.character, {
                listingRole: normalizeCharacterListingRole(entry.listing_role),
            });
        })
        .filter((character: any) => character && (options?.includePrivate || character.isPublic !== false))
        .sort((left, right) => {
            const priorityDiff = getCharacterListingRolePriority(left.listingRole) - getCharacterListingRolePriority(right.listingRole);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }

            return left.name.localeCompare(right.name, 'tr');
        });
};

export const replaceMangaCharacters = async (
    mangaId: string,
    characters: Array<{ characterId: string; listingRole?: CharacterListingRole | null }>,
) => {
    const { error: deleteError } = await supabase
        .from('manga_characters')
        .delete()
        .eq('manga_id', mangaId);

    if (deleteError) {
        throw deleteError;
    }

    const uniqueCharacters = Array.from(
        new Map(
            characters
                .filter((entry) => entry.characterId)
                .map((entry) => [
                    entry.characterId,
                    {
                        characterId: entry.characterId,
                        listingRole: entry.listingRole || null,
                    },
                ]),
        ).values(),
    );

    if (uniqueCharacters.length === 0) {
        return;
    }

    const { error } = await supabase
        .from('manga_characters')
        .insert(
            uniqueCharacters.map((entry) => ({
                manga_id: mangaId,
                character_id: entry.characterId,
                listing_role: entry.listingRole || null,
            })),
        );

    if (error) {
        throw error;
    }
};

// Same for Authors/Artists (shorter versions)
export const getAuthors = async (options?: { includePrivate?: boolean }): Promise<Author[]> => {
    try {
        const rows = await fetchNamedEntityRows('authors', options?.includePrivate);
        return rows.map((author, index) => ({
            ...mapAuthorRow(author),
            rank: index + 1,
        }));
    } catch (error) {
        console.error('getAuthors error:', error);
        return [];
    }
};

export const getAuthorMediaRecords = async (): Promise<NamedEntityMediaRecord[]> => {
    const { data, error } = await supabase
        .from('authors')
        .select('id, name, image_url, gallery')
        .order('name', { ascending: true });

    if (error) {
        throw error;
    }

    return (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        imageUrl: sanitizeEntityImageUrl(row.image_url),
        gallery: normalizeEntityGallery(row.gallery),
    }));
};

export const getArtists = async (options?: { includePrivate?: boolean }): Promise<Artist[]> => {
    try {
        const rows = await fetchNamedEntityRows('artists', options?.includePrivate);
        return rows.map((artist, index) => ({
            ...mapArtistRow(artist),
            rank: index + 1,
        }));
    } catch (error) {
        console.error('getArtists error:', error);
        return [];
    }
};

export const getArtistMediaRecords = async (): Promise<NamedEntityMediaRecord[]> => {
    const { data, error } = await supabase
        .from('artists')
        .select('id, name, image_url, gallery')
        .order('name', { ascending: true });

    if (error) {
        throw error;
    }

    return (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        imageUrl: sanitizeEntityImageUrl(row.image_url),
        gallery: normalizeEntityGallery(row.gallery),
    }));
};

export const getAuthorById = async (
    id: string,
    options?: { includePrivate?: boolean }
): Promise<Author | undefined> => {
    const { data, error } = await applyPublicEntityFilter(
        supabase
            .from('authors')
            .select(`*, mangas:manga_authors(manga:mangas(*))`)
            .eq('id', id),
        options?.includePrivate,
    ).maybeSingle();
    if (error || !data) return undefined;

    const seriesIds = ((data as any).mangas || [])
        .map((item: any) => item.manga?.id)
        .filter(Boolean);
    const [series, rank] = await Promise.all([
        getMangasByIds(seriesIds, { includePrivate: options?.includePrivate }),
        getOrderedEntityRank('authors', id),
    ]);

    return { ...mapAuthorRow(data), series, rank };
};

export const getArtistById = async (
    id: string,
    options?: { includePrivate?: boolean }
): Promise<Artist | undefined> => {
    const { data, error } = await applyPublicEntityFilter(
        supabase
            .from('artists')
            .select(`*, mangas:manga_artists(manga:mangas(*))`)
            .eq('id', id),
        options?.includePrivate,
    ).maybeSingle();
    if (error || !data) return undefined;

    const seriesIds = ((data as any).mangas || [])
        .map((item: any) => item.manga?.id)
        .filter(Boolean);
    const [series, rank] = await Promise.all([
        getMangasByIds(seriesIds, { includePrivate: options?.includePrivate }),
        getOrderedEntityRank('artists', id),
    ]);

    return { ...mapArtistRow(data), series, rank };
};

export const findAuthorByName = async (name: string): Promise<Author | null> => {
    const row = await findNamedEntityRowByName<any>('authors', name);
    return row ? mapAuthorRow(row) : null;
};

export const findArtistByName = async (name: string): Promise<Artist | null> => {
    const row = await findNamedEntityRowByName<any>('artists', name);
    return row ? mapArtistRow(row) : null;
};

export const saveAuthor = async (author: Partial<Author>) => {
    const normalizedName = normalizeNamedEntityValue(author.name);
    if (!normalizedName) {
        throw new Error('AUTHOR_NAME_REQUIRED');
    }

    const data = createRichEntityPayload({
        ...author,
        name: normalizedName,
    });
    const { image_url: _imageUrl, gallery: _gallery, ...dataWithoutMedia } = data;
    if (author.id) {
        const { error } = await supabase.from('authors').update(dataWithoutMedia).eq('id', author.id);
        if (error) throw error;
        if ('imageUrl' in author || 'gallery' in author) {
            await updateAuthorMedia(author.id, {
                imageUrl: author.imageUrl,
                gallery: author.gallery,
            });
        }
        return author.id;
    }

    const { data: inserted, error } = await supabase
        .from('authors')
        .insert(dataWithoutMedia)
        .select('id')
        .single();
    if (error) throw error;
    if ('imageUrl' in author || 'gallery' in author) {
        await updateAuthorMedia(inserted.id, {
            imageUrl: author.imageUrl,
            gallery: author.gallery,
        });
    }
    return inserted.id;
};

export const updateAuthorImageUrl = async (
    authorId: string,
    imageUrl?: string | null,
): Promise<void> => {
    await updateAuthorMedia(authorId, { imageUrl });
};

export const updateAuthorMedia = async (
    authorId: string,
    media: { imageUrl?: string | null; gallery?: EntityGalleryImage[] | null },
): Promise<void> => {
    const payload: Record<string, unknown> = {};
    const materializedMedia = await materializeNamedEntityMedia('author', authorId, media);

    if ('imageUrl' in media) {
        payload.image_url = materializedMedia.imageUrl;
    }

    if ('gallery' in media) {
        payload.gallery = materializedMedia.gallery;
    }

    if (Object.keys(payload).length === 0) {
        return;
    }

    const { error } = await supabase
        .from('authors')
        .update(payload)
        .eq('id', authorId);

    if (error) throw error;
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

    const data = createRichEntityPayload({
        ...artist,
        name: normalizedName,
    });
    const { image_url: _imageUrl, gallery: _gallery, ...dataWithoutMedia } = data;
    if (artist.id) {
        const { error } = await supabase.from('artists').update(dataWithoutMedia).eq('id', artist.id);
        if (error) throw error;
        if ('imageUrl' in artist || 'gallery' in artist) {
            await updateArtistMedia(artist.id, {
                imageUrl: artist.imageUrl,
                gallery: artist.gallery,
            });
        }
        return artist.id;
    }

    const { data: inserted, error } = await supabase
        .from('artists')
        .insert(dataWithoutMedia)
        .select('id')
        .single();
    if (error) throw error;
    if ('imageUrl' in artist || 'gallery' in artist) {
        await updateArtistMedia(inserted.id, {
            imageUrl: artist.imageUrl,
            gallery: artist.gallery,
        });
    }
    return inserted.id;
};

export const updateArtistImageUrl = async (
    artistId: string,
    imageUrl?: string | null,
): Promise<void> => {
    await updateArtistMedia(artistId, { imageUrl });
};

export const updateArtistMedia = async (
    artistId: string,
    media: { imageUrl?: string | null; gallery?: EntityGalleryImage[] | null },
): Promise<void> => {
    const payload: Record<string, unknown> = {};
    const materializedMedia = await materializeNamedEntityMedia('artist', artistId, media);

    if ('imageUrl' in media) {
        payload.image_url = materializedMedia.imageUrl;
    }

    if ('gallery' in media) {
        payload.gallery = materializedMedia.gallery;
    }

    if (Object.keys(payload).length === 0) {
        return;
    }

    const { error } = await supabase
        .from('artists')
        .update(payload)
        .eq('id', artistId);

    if (error) throw error;
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
        isPublic: true,
        alternativeNames: [],
        details: {},
        gallery: [],
        sourceLinks: [],
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
        isPublic: true,
        alternativeNames: [],
        details: {},
        gallery: [],
        sourceLinks: [],
    };
};

export const getMangaAuthors = async (
    mangaId: string,
    options?: { includePrivate?: boolean }
): Promise<Author[]> => {
    const { data, error } = await supabase
        .from('manga_authors')
        .select('author:authors(*)')
        .eq('manga_id', mangaId);

    if (error) {
        console.error('Manga authors fetch error:', error);
        return [];
    }

    return (data || [])
        .map((entry: any) => entry.author)
        .filter((author: any) => author && (options?.includePrivate || author.is_public !== false))
        .map((author: any) => mapAuthorRow(author));
};

const getMangaAuthorsByIds = async (
    mangaIds: string[],
    options?: { includePrivate?: boolean }
): Promise<Map<string, Author[]>> => {
    if (mangaIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('manga_authors')
        .select('manga_id, author:authors(*)')
        .in('manga_id', mangaIds);

    if (error) {
        console.error('Manga authors batch fetch error:', error);
        return new Map();
    }

    const authorsByMangaId = new Map<string, Author[]>();

    (data || []).forEach((entry: any) => {
        const author = entry.author;
        const mangaId = entry.manga_id;

        if (!mangaId || !author || (!options?.includePrivate && author.is_public === false)) {
            return;
        }

        const current = authorsByMangaId.get(mangaId) || [];
        current.push(mapAuthorRow(author));
        authorsByMangaId.set(mangaId, current);
    });

    return authorsByMangaId;
};

export const getMangaArtists = async (
    mangaId: string,
    options?: { includePrivate?: boolean }
): Promise<Artist[]> => {
    const { data, error } = await supabase
        .from('manga_artists')
        .select('artist:artists(*)')
        .eq('manga_id', mangaId);

    if (error) {
        console.error('Manga artists fetch error:', error);
        return [];
    }

    return (data || [])
        .map((entry: any) => entry.artist)
        .filter((artist: any) => artist && (options?.includePrivate || artist.is_public !== false))
        .map((artist: any) => mapArtistRow(artist));
};

const getMangaArtistsByIds = async (
    mangaIds: string[],
    options?: { includePrivate?: boolean }
): Promise<Map<string, Artist[]>> => {
    if (mangaIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('manga_artists')
        .select('manga_id, artist:artists(*)')
        .in('manga_id', mangaIds);

    if (error) {
        console.error('Manga artists batch fetch error:', error);
        return new Map();
    }

    const artistsByMangaId = new Map<string, Artist[]>();

    (data || []).forEach((entry: any) => {
        const artist = entry.artist;
        const mangaId = entry.manga_id;

        if (!mangaId || !artist || (!options?.includePrivate && artist.is_public === false)) {
            return;
        }

        const current = artistsByMangaId.get(mangaId) || [];
        current.push(mapArtistRow(artist));
        artistsByMangaId.set(mangaId, current);
    });

    return artistsByMangaId;
};

const createEmptyHomePageMangaSections = (): HomePageMangaSections => ({
    trendingManga: [],
    newlyAddedSeries: [],
    recentlyUpdated: [],
});

const hasHomePageSectionData = (sections: HomePageMangaSections) => (
    sections.trendingManga.length > 0
    || sections.newlyAddedSeries.length > 0
    || sections.recentlyUpdated.length > 0
);

const buildHomePageSectionsFromCollection = (mangas: Manga[]): HomePageMangaSections => ({
    trendingManga: [...mangas]
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, HOME_PAGE_SECTION_LIMITS.trending),
    newlyAddedSeries: [...mangas]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, HOME_PAGE_SECTION_LIMITS.newlyAdded),
    recentlyUpdated: [...mangas]
        .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
        .slice(0, HOME_PAGE_SECTION_LIMITS.recentlyUpdated),
});

const buildMangaSummariesForRows = async (
    mangaRows: any[],
    options?: { logContext?: string; includePrivate?: boolean; includeAdult?: boolean }
): Promise<Manga[]> => {
    if (!Array.isArray(mangaRows) || mangaRows.length === 0) {
        return [];
    }

    const logContext = options?.logContext || 'Manga summary';
    const visibleRows = options?.includePrivate
        ? mangaRows
        : mangaRows.filter((manga: any) => (
            manga?.is_public !== false
            && (options?.includeAdult || manga?.is_adult !== true)
        ));

    if (visibleRows.length === 0) {
        return [];
    }

    const mangaIds = visibleRows.map((manga: any) => manga.id).filter(Boolean);
    const [
        { data: reviewRows, error: reviewError },
        chapterRows,
        nextAuthorsByMangaId,
        nextArtistsByMangaId,
    ] = await Promise.all([
        supabase
            .from('reviews')
            .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
            .in('manga_id', mangaIds),
        fetchAllChapterMetaRows('id, manga_id, number', {
            mangaIds,
            orderByNumberAscending: false,
        }).catch((chapterError) => {
            if (!isExpectedAccessControlError(chapterError)) {
                console.error(`${logContext} chapter aggregate fetch error:`, chapterError);
            }
            return [];
        }),
        getMangaAuthorsByIds(mangaIds, { includePrivate: options?.includePrivate }),
        getMangaArtistsByIds(mangaIds, { includePrivate: options?.includePrivate }),
    ]);

    if (reviewError) {
        console.error(`${logContext} review aggregate fetch error:`, reviewError);
    }

    const reviewStatsByMangaId = buildReviewStatsByMangaId(reviewRows || []);
    const chapterCountByMangaId = buildChapterCountByMangaId(chapterRows);
    const latestChapterPreviewsByMangaId = buildLatestChapterPreviewsByMangaId(chapterRows);

    return visibleRows.map((manga: any) => {
        const reviewStats = reviewStatsByMangaId.get(manga.id);
        const authorsDetails = nextAuthorsByMangaId.get(manga.id) || [];
        const artistsDetails = nextArtistsByMangaId.get(manga.id) || [];

        return {
            ...manga,
            author: joinNamedEntityValues(authorsDetails.map((author) => author.name)) || manga.author,
            artist: joinNamedEntityValues(artistsDetails.map((artist) => artist.name)) || manga.artist,
            ...mapMangaBaseFields(manga),
            chapters: latestChapterPreviewsByMangaId.get(manga.id) || [],
            ratings: [],
            chapterCount: chapterCountByMangaId.get(manga.id) || 0,
            averageRating: reviewStats?.average || 0,
            reviewCount: reviewStats?.reviewCount || 0,
            authorDetails: authorsDetails[0],
            artistDetails: artistsDetails[0],
            authorsDetails,
            artistsDetails,
        } as Manga;
    });
};

export const linkMangaToAuthor = async (mangaId: string, authorId: string) => {
    await supabase.from('manga_authors').upsert({ manga_id: mangaId, author_id: authorId });
};

export const linkMangaToArtist = async (mangaId: string, artistId: string) => {
    await supabase.from('manga_artists').upsert({ manga_id: mangaId, artist_id: artistId });
};

export const replaceMangaAuthors = async (mangaId: string, authorIds: string[]) => {
    const { error: deleteError } = await supabase
        .from('manga_authors')
        .delete()
        .eq('manga_id', mangaId);

    if (deleteError) {
        throw deleteError;
    }

    const uniqueAuthorIds = [...new Set(authorIds.filter(Boolean))];
    if (uniqueAuthorIds.length === 0) {
        return;
    }

    const { error } = await supabase
        .from('manga_authors')
        .insert(uniqueAuthorIds.map((authorId) => ({ manga_id: mangaId, author_id: authorId })));

    if (error) {
        throw error;
    }
};

export const replaceMangaArtists = async (mangaId: string, artistIds: string[]) => {
    const { error: deleteError } = await supabase
        .from('manga_artists')
        .delete()
        .eq('manga_id', mangaId);

    if (deleteError) {
        throw deleteError;
    }

    const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))];
    if (uniqueArtistIds.length === 0) {
        return;
    }

    const { error } = await supabase
        .from('manga_artists')
        .insert(uniqueArtistIds.map((artistId) => ({ manga_id: mangaId, artist_id: artistId })));

    if (error) {
        throw error;
    }
};

export const getMangaRelatedSeries = async (
    mangaId: string,
    options?: { includePrivate?: boolean }
): Promise<MangaRelation[]> => {
    const { data, error } = await supabase
        .from('manga_relations')
        .select('*')
        .eq('manga_id', mangaId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Manga relations fetch error:', error);
        return [];
    }

    const relatedMangaIds = [...new Set((data || []).map((row: any) => row.related_manga_id).filter(Boolean))];
    const relatedManga = await getMangasByIds(relatedMangaIds, options);
    const mangaMap = new Map(relatedManga.map((manga) => [manga.id, manga]));

    return (data || []).map((row: any) => ({
        id: row.id,
        mangaId: row.manga_id,
        relatedMangaId: row.related_manga_id,
        relationType: row.relation_type,
        sourceName: row.source_name || undefined,
        sourceUrl: row.source_url || undefined,
        sortOrder: row.sort_order ?? 0,
        relatedManga: mangaMap.get(row.related_manga_id),
    })).filter((relation) => options?.includePrivate || Boolean(relation.relatedManga));
};

export const replaceMangaRelatedSeries = async (
    mangaId: string,
    relations: Array<Partial<MangaRelation>>
): Promise<void> => {
    const { error: deleteError } = await supabase
        .from('manga_relations')
        .delete()
        .eq('manga_id', mangaId);

    if (deleteError) {
        throw deleteError;
    }

    const normalizedRows = relations
        .filter((relation) => relation.relatedMangaId)
        .map((relation, index) => ({
            manga_id: mangaId,
            related_manga_id: relation.relatedMangaId,
            relation_type: relation.relationType || 'related',
            source_name: relation.sourceName || null,
            source_url: relation.sourceUrl || null,
            sort_order: relation.sortOrder ?? index,
        }));

    if (normalizedRows.length === 0) {
        return;
    }

    const { error } = await supabase
        .from('manga_relations')
        .insert(normalizedRows);

    if (error) {
        throw error;
    }
};

// Generic Like Toggle for Entities
export const toggleEntityLike = async (entityType: RichEntityType, entityId: string, userId: string): Promise<void> => {
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

export const getEntityComments = async (entityType: RichEntityType, entityId: string): Promise<Comment[]> => {
    return getEntityCommentsV2(entityType, entityId);
};

export const addEntityComment = async (entityType: RichEntityType, entityId: string, userId: string, content: string): Promise<void> => {
    await addCommentV2({
        entityId,
        entityType,
        userId,
        username: '',
        content,
        dislikes: 0,
        dislikedBy: [],
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

const slugifyTagName = (name: string) => slugifyCatalogTagName(name);

const mapTagRow = (tag: any, relation?: { is_discoverable?: boolean; added_by?: string | null } | null): Tag => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    category: tag.category as TagCategory,
    description: tag.description,
    usageCount: tag.usage_count,
    isOfficial: tag.is_official,
    communityApproved: tag.community_approved,
    isDiscoverable: relation?.is_discoverable ?? false,
    createdBy: tag.created_by,
    relationAddedBy: relation?.added_by ?? undefined,
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
    const slug = slugifyTagName(name);
    const resolvedUserId = userId || (await supabase.auth.getSession()).data.session?.user?.id;

    if (!slug) {
        return null;
    }

    const { data: existingTag, error: existingTagError } = await supabase
        .from('tags')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

    if (existingTagError) {
        console.error('Find existing tag error:', existingTagError);
        return null;
    }

    if (existingTag) {
        return mapTagRow(existingTag);
    }

    const { data, error } = await supabase
        .from('tags')
        .upsert({
            name,
            slug,
            category,
            description,
            created_by: resolvedUserId,
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

export const upsertOfficialTags = async (
    tags: OfficialTagSeed[],
): Promise<{ created: number; updated: number; total: number }> => {
    const normalizedTags = Array.from(
        new Map(
            tags
                .map((tag) => ({
                    ...tag,
                    name: tag.name.trim(),
                    slug: slugifyTagName(tag.name),
                }))
                .filter((tag) => tag.name.length > 0 && tag.slug.length > 0)
                .map((tag) => [tag.slug, tag]),
        ).values(),
    );

    if (normalizedTags.length === 0) {
        return { created: 0, updated: 0, total: 0 };
    }

    const slugs = normalizedTags.map((tag) => tag.slug);

    const { data: existingRows, error: existingError } = await supabase
        .from('tags')
        .select('id, slug, category, is_official, community_approved')
        .in('slug', slugs);

    if (existingError) {
        throw existingError;
    }

    const existingBySlug = new Map(
        ((existingRows || []) as Array<{
            id: string;
            slug: string;
            category: TagCategory;
            is_official: boolean;
            community_approved: boolean;
        }>).map((row) => [row.slug, row]),
    );

    const tagsToInsert = normalizedTags.filter((tag) => !existingBySlug.has(tag.slug));
    const tagsToUpdate = normalizedTags.filter((tag) => existingBySlug.has(tag.slug));

    // Insert new tags one by one to avoid 409 conflict on duplicate slug
    let created = 0;
    for (const tag of tagsToInsert) {
        const { error: insertError } = await supabase
            .from('tags')
            .insert({
                name: tag.name,
                slug: tag.slug,
                category: tag.category,
                is_official: true,
                community_approved: true,
            });

        if (insertError) {
            console.warn(`Tag insert skipped "${tag.slug}":`, insertError.message);
        } else {
            created++;
        }
    }

    let updated = 0;
    for (const tag of tagsToUpdate) {
        const existing = existingBySlug.get(tag.slug);

        if (!existing) {
            continue;
        }

        if (
            existing.category === tag.category
            && existing.is_official
            && existing.community_approved
        ) {
            continue;
        }

        const { error: updateError } = await supabase
            .from('tags')
            .update({
                category: tag.category,
                is_official: true,
                community_approved: true,
            })
            .eq('id', existing.id);

        if (updateError) {
            console.warn(`Tag update failed "${tag.slug}":`, updateError.message);
        } else {
            updated++;
        }
    }

    return {
        created,
        updated,
        total: normalizedTags.length,
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
    entityType: CommentEntityType,
    entityId: string
): Promise<Tag[]> => {
    const tableName = `${entityType}_tags`;
    const colName = `${entityType}_id`;

    const { data, error } = await supabase
        .from(tableName as any)
        .select(`
            tag_id,
            is_discoverable,
            added_by,
            tag:tags(*)
        `)
        .eq(colName, entityId);

    if (error) return [];

    return (data as any[])
        .filter(d => d.tag)
        .map(d => mapTagRow(d.tag, d));
};

export const addTagToEntity = async (
    entityType: CommentEntityType,
    entityId: string,
    tagId: string,
    userId?: string,
    options?: {
        discoverable?: boolean;
    }
): Promise<boolean> => {
    const tableName = `${entityType}_tags`;
    const colName = `${entityType}_id`;
    const resolvedUserId = userId || (await supabase.auth.getSession()).data.session?.user?.id;

    const discoverable = options?.discoverable ?? false;

    if (!resolvedUserId) {
        console.error('Add tag to entity error: authenticated user required');
        return false;
    }

    const { error } = await supabase
        .from(tableName as any)
        .upsert({
            [colName]: entityId,
            tag_id: tagId,
            added_by: resolvedUserId,
            is_discoverable: discoverable ?? false,
        });

    if (error) {
        console.error('Add tag to entity error:', error);
        return false;
    }
    return true;
};

export const removeTagFromEntity = async (
    entityType: CommentEntityType,
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
    entityType: CommentEntityType,
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
    entityType: CommentEntityType,
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
    entityType: CommentEntityType,
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

    return getMangaSummariesByIds(mangaIds);
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

    return getMangaSummariesByIds(matchingMangaIds);
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
type TopTenAudience = 'visible' | 'safe' | 'adult';

const buildAudienceTopTen = (
    summaries: Manga[],
    rawData: any[] | null | undefined,
    audience: TopTenAudience,
): Manga[] => {
    const matchesAudience = (manga: Manga) => (
        audience === 'adult'
            ? manga.isAdult === true
            : audience === 'safe'
                ? manga.isAdult !== true
                : true
    );

    const summaryMap = new Map(summaries.map((manga) => [manga.id, manga]));

    if (!rawData || rawData.length === 0) {
        return [];
    }

    return rawData
        .map((item: any) => {
            const summary = summaryMap.get(item.id);

            const mappedItem = {
                ...item,
                ...mapMangaBaseFields(summary ?? item),
            } as Manga;

            return {
                ...mappedItem,
                chapters: [],
                ratings: [],
                chapterCount: summary?.chapterCount ?? item.chapter_count ?? item.chapterCount ?? 0,
                engagementScore: item.engagement_score ?? item.engagementScore ?? 0,
                averageRating: item.average_rating || summary?.averageRating || item.averageRating || 0,
                reviewCount: summary?.reviewCount || item.review_count || item.reviewCount || 0,
            } as Manga;
        })
        .filter(matchesAudience)
        .sort((left, right) => {
            const engagementDiff = (right.engagementScore || 0) - (left.engagementScore || 0);
            if (engagementDiff !== 0) {
                return engagementDiff;
            }

            const ratingDiff = (right.averageRating || 0) - (left.averageRating || 0);
            if (ratingDiff !== 0) {
                return ratingDiff;
            }

            const reviewDiff = (right.reviewCount || 0) - (left.reviewCount || 0);
            if (reviewDiff !== 0) {
                return reviewDiff;
            }

            const chapterDiff = (right.chapterCount || 0) - (left.chapterCount || 0);
            if (chapterDiff !== 0) {
                return chapterDiff;
            }

            const viewDiff = (right.views || 0) - (left.views || 0);
            if (viewDiff !== 0) {
                return viewDiff;
            }

            const titleDiff = (left.title || '').localeCompare(right.title || '', 'tr');
            if (titleDiff !== 0) {
                return titleDiff;
            }

            return left.id.localeCompare(right.id, 'tr');
        })
        .slice(0, 10);
};

export const getTopTenMangaBuckets = async (
    timeframe: 'today' | 'week' | 'all' = 'today',
): Promise<{ visible: Manga[]; safe: Manga[]; adult: Manga[] }> => {
    try {
        const summaries = await getMangaSummaries();
        const { data: rawData, error } = await supabase.rpc('get_top_engaged_mangas', { time_filter: timeframe });

        if (error) {
            console.error('getTopTenMangaBuckets error:', error);
        }

        return {
            visible: buildAudienceTopTen(summaries, rawData, 'visible'),
            safe: buildAudienceTopTen(summaries, rawData, 'safe'),
            adult: buildAudienceTopTen(summaries, rawData, 'adult'),
        };
    } catch (error) {
        console.error('getTopTenMangaBuckets exception:', error);
        return {
            visible: [],
            safe: [],
            adult: [],
        };
    }
};

export const getTopTenPageBuckets = async (
    timeframe: 'today' | 'week' | 'all' = 'today',
): Promise<{ safe: Manga[]; adult: Manga[] }> => {
    try {
        const summaries = await getMangaSummaries();
        const [
            { data: safeRawData, error: safeError },
            { data: adultRawData, error: adultError },
        ] = await Promise.all([
            supabase.rpc('get_top_engaged_mangas_by_audience', {
                time_filter: timeframe,
                target_audience: 'safe',
                result_limit: 10,
            }),
            supabase.rpc('get_top_engaged_mangas_by_audience', {
                time_filter: timeframe,
                target_audience: 'adult',
                result_limit: 10,
            }),
        ]);

        if (safeError) {
            console.error('getTopTenPageBuckets safe error:', safeError);
        }

        if (adultError) {
            console.error('getTopTenPageBuckets adult error:', adultError);
        }

        return {
            safe: buildAudienceTopTen(summaries, safeRawData, 'safe'),
            adult: buildAudienceTopTen(summaries, adultRawData, 'adult'),
        };
    } catch (error) {
        console.error('getTopTenPageBuckets exception:', error);
        return {
            safe: [],
            adult: [],
        };
    }
};

export const getTopTenMangas = async (timeframe: 'today' | 'week' | 'all' = 'today'): Promise<Manga[]> => {
    const buckets = await getTopTenMangaBuckets(timeframe);
    return buckets.visible;
};

export const getTopTenMangaIds = async (timeframe: TopTenTimeframe = 'today'): Promise<Set<string>> => {
    const cached = topTenMangaIdsCache[timeframe];
    if (cached && Date.now() - cached.fetchedAt < TOP_TEN_IDS_CACHE_TTL_MS) {
        return new Set(cached.value);
    }

    if (topTenMangaIdsPromises[timeframe]) {
        const pendingIds = await topTenMangaIdsPromises[timeframe];
        return new Set(pendingIds);
    }

    topTenMangaIdsPromises[timeframe] = (async () => {
        try {
            const { data, error } = await supabase.rpc('get_top_engaged_mangas', { time_filter: timeframe });
            if (error || !Array.isArray(data)) {
                if (error) {
                    console.error('getTopTenMangaIds error:', error);
                }
                return new Set<string>();
            }

            const ids = new Set(
                data
                    .map((item: any) => item?.id)
                    .filter(Boolean),
            );

            topTenMangaIdsCache[timeframe] = {
                fetchedAt: Date.now(),
                value: ids,
            };

            return ids;
        } catch (error) {
            console.error('getTopTenMangaIds exception:', error);
            return new Set<string>();
        } finally {
            topTenMangaIdsPromises[timeframe] = null;
        }
    })();

    const ids = await topTenMangaIdsPromises[timeframe];
    return new Set(ids);
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
