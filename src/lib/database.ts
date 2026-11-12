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
    readPersistedQueryCache,
    removePersistedQueryCache,
    writePersistedQueryCache,
} from './persistedQueryCache';
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
import { sanitizeCharacterDescription, sanitizeMangaDescription } from '@/lib/descriptionSanitizers';
import { sanitizeEntityImageUrl } from '@/lib/entityImages';
import { normalizeComparableText } from '@/lib/textMatching';
import { getReactionScore, type ReactionType } from './reactions';
import { getSeriesLanguage, resolveChapterLanguageCode } from '@/lib/seriesLanguage';

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
                normalized.replace(/[Ä°IÄ±i]/g, 'i'),
                normalized.replace(/[Ä°IÄ±i]/g, 'I'),
                normalized.replace(/[Ä°IÄ±i]/g, 'Ä°'),
                normalized.replace(/[Ä°IÄ±i]/g, 'Ä±'),
            ].map((item) => normalizeNamedEntityValue(item)).filter(Boolean),
        ),
    );
};

const PERSON_PLACEHOLDER_KEYS = new Set([
    '',
    'bilinmiyor',
    'unknown',
    'n/a',
    '-',
    'girilmedi',
    'girilmedi..',
    'girilmedi.',
    'girilmemis',
    'yok',
    'none',
    'null',
    'undefined',
]);

export const cleanPlaceholderNamedEntityString = (value?: string | null): string => {
    if (!value) return '';
    const parts = value.split(',').map((p) => normalizeNamedEntityValue(p)).filter(Boolean);
    const meaningful = parts.filter((p) => isMeaningfulNamedEntity(p));
    if (meaningful.length > 0) return meaningful.join(', ');
    if (parts.some((p) => !isMeaningfulNamedEntity(p))) return '';
    return value.trim();
};

export const chunkArray = <T>(items: T[], size: number): T[][] => {
    if (!items || items.length === 0) return [];
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

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
    imageUrl: sanitizeEntityImageUrl(row.image_url || row.imageUrl || row.image),
    likesCount: row.likes_count ?? 0,
    isPublic: row.is_public ?? true,
    alternativeNames: row.alternative_names || [],
    details: row.details || {},
    gallery: row.gallery || [],
    sourceLinks: row.source_links || [],
});

const mapArtistRow = (row: any): Artist => ({
    ...row,
    imageUrl: sanitizeEntityImageUrl(row.image_url || row.imageUrl || row.image),
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
    imageUrl: sanitizeEntityImageUrl(row.image_url || row.imageUrl || row.image),
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
    image_url: sanitizeEntityImageUrl(entity.imageUrl || (entity as any).image_url || (entity as any).image),
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

const namedEntityRowsCache = new Map<string, { fetchedAt: number; rows: any[] }>();
const namedEntityRowsPromises = new Map<string, Promise<any[]>>();
const NAMED_ENTITY_CACHE_TTL_MS = 5 * 60_000;

const NAMED_ENTITY_SUMMARY_COLUMNS = 'id, name, image_url, description, likes_count, is_public, alternative_names, details, created_at';

const fetchNamedEntityRows = async (
    table: NamedEntityTableName,
    includePrivate?: boolean,
) => {
    const cacheKey = `${table}:${includePrivate ? 'private' : 'public'}`;
    const cached = namedEntityRowsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < NAMED_ENTITY_CACHE_TTL_MS) {
        return cached.rows;
    }

    const pending = namedEntityRowsPromises.get(cacheKey);
    if (pending) {
        return pending;
    }

    // IDB kalÄ±cÄ± cache: Header/SuperSearch aramasÄ± yeni sekmede de aÄŸa Ã§Ä±kmadan Ã§alÄ±ÅŸsÄ±n.
    const persistedEntityKey = `named-entities-v1:${cacheKey}`;
    if (!includePrivate) {
        const persistedEntityRows = await readPersistedQueryCache<any[]>(persistedEntityKey);
        if (
            persistedEntityRows
            && Array.isArray(persistedEntityRows.value)
            && persistedEntityRows.value.length > 0
            && Date.now() - persistedEntityRows.fetchedAt < PERSISTED_CATALOG_CACHE_TTL_MS
        ) {
            namedEntityRowsCache.set(cacheKey, {
                fetchedAt: persistedEntityRows.fetchedAt,
                rows: persistedEntityRows.value,
            });
            return persistedEntityRows.value;
        }
    }

    // NOT: count:'exact' kaldÄ±rÄ±ldÄ± â€” PostgREST her sayfa iÃ§in tÃ¼m tabloya count(*)
    // Ã§alÄ±ÅŸtÄ±rÄ±yordu (bkz. performans raporu). Bunun yerine kÄ±sa sayfa gelene kadar
    // batch'li paralel sayfalama yapÄ±lÄ±r.
    const ENTITY_PAGE_FETCH_BATCH = 4;
    const ENTITY_MAX_PAGES = 50;

    const promise = (async () => {
        const rows: any[] = [];
        let pageIndex = 0;
        let reachedEnd = false;

        while (!reachedEnd && pageIndex < ENTITY_MAX_PAGES) {
            const pageRequests = Array.from({ length: ENTITY_PAGE_FETCH_BATCH }, (_, offsetIndex) => {
                const currentPageIndex = pageIndex + offsetIndex;
                const from = currentPageIndex * NAMED_ENTITY_LIST_PAGE_SIZE;
                const to = from + NAMED_ENTITY_LIST_PAGE_SIZE - 1;
                return applyPublicEntityFilter(
                    (supabase.from(table) as any)
                        .select(NAMED_ENTITY_SUMMARY_COLUMNS)
                        .order('likes_count', { ascending: false })
                        .order('name', { ascending: true }),
                    includePrivate,
                ).range(from, to);
            });

            const responses = await Promise.all(pageRequests);
            for (const res of responses) {
                if (res.error) {
                    throw res.error;
                }
                const pageRows = Array.isArray(res.data) ? res.data : [];
                rows.push(...pageRows);
                if (pageRows.length < NAMED_ENTITY_LIST_PAGE_SIZE) {
                    reachedEnd = true;
                    break;
                }
            }

            pageIndex += ENTITY_PAGE_FETCH_BATCH;
        }

        namedEntityRowsCache.set(cacheKey, { fetchedAt: Date.now(), rows });
        if (!includePrivate) {
            void writePersistedQueryCache(persistedEntityKey, rows);
        }
        return rows;
    })().finally(() => {
        namedEntityRowsPromises.delete(cacheKey);
    });

    namedEntityRowsPromises.set(cacheKey, promise);
    return promise;
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

const fetchAllMangaRowsPaginated = async (
    selectColumns: string,
    options?: {
        includePrivate?: boolean;
        includeAdult?: boolean;
        visibilityColumnAvailable?: boolean;
        adultColumnAvailable?: boolean;
    },
) => {
    const CHUNK_SIZE = 1000;
    // 2'şerli batch'lerle çekilir; Supabase Postgres statement timeout riskini sıfırlar
    const PAGE_FETCH_BATCH = 2;
    const MAX_ROWS_SAFETY = 100_000;
    const rows: any[] = [];
    let pageIndex = 0;
    let reachedEnd = false;

    while (!reachedEnd && rows.length < MAX_ROWS_SAFETY) {
        const pageRequests = Array.from({ length: PAGE_FETCH_BATCH }, (_, offsetIndex) => {
            const currentPageIndex = pageIndex + offsetIndex;
            const from = currentPageIndex * CHUNK_SIZE;
            const to = from + CHUNK_SIZE - 1;
            return applyPublicMangaFilter(
                supabase
                    .from('mangas')
                    .select(selectColumns)
                    .order('last_updated', { ascending: false })
                    .order('id', { ascending: true })
                    .range(from, to),
                options,
            );
        });

        const responses = await Promise.all(pageRequests);

        for (let i = 0; i < responses.length; i++) {
            const response = responses[i];
            if (response.error) {
                // If parallel request encountered a timeout or error, retry this page sequentially
                const retryPageIndex = pageIndex + i;
                const from = retryPageIndex * CHUNK_SIZE;
                const to = from + CHUNK_SIZE - 1;
                const retryRes = await applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(selectColumns)
                        .order('last_updated', { ascending: false })
                        .order('id', { ascending: true })
                        .range(from, to),
                    options,
                );
                if (retryRes.error) {
                    throw retryRes.error;
                }
                const pageRows = Array.isArray(retryRes.data) ? retryRes.data : [];
                rows.push(...pageRows);
                if (pageRows.length < CHUNK_SIZE) {
                    reachedEnd = true;
                    break;
                }
                continue;
            }

            const pageRows = Array.isArray(response.data) ? response.data : [];
            rows.push(...pageRows);

            if (pageRows.length < CHUNK_SIZE) {
                reachedEnd = true;
                break;
            }
        }

        pageIndex += PAGE_FETCH_BATCH;
    }

    const uniqueRows: any[] = [];
    const seenRowIds = new Set<string>();
    for (const row of rows) {
        const rowId = typeof row?.id === 'string' ? row.id : null;
        if (rowId && seenRowIds.has(rowId)) {
            continue;
        }
        if (rowId) {
            seenRowIds.add(rowId);
        }
        uniqueRows.push(row);
    }

    return uniqueRows;
};

const joinNamedEntityValues = (values: Array<string | null | undefined>) => {
    const rawList = Array.from(
        new Set(
            values
                .map((value) => normalizeNamedEntityValue(value))
                .filter(Boolean)
                .map((value) => `${value}`),
        ),
    );
    const meaningful = rawList.filter((value) => isMeaningfulNamedEntity(value));
    const finalList = meaningful.length > 0 ? meaningful : rawList.filter((value) => isMeaningfulNamedEntity(value));
    return finalList.join(', ');
};

const mapMangaVisibilityFields = (row: any) => ({
    isPublic: row?.is_public ?? true,
    isAdult: row?.is_adult ?? false,
});

const mapMangaBaseFields = (row: any) => ({
    alternativeTitles: row?.alternative_titles || row?.alternativeTitles || [],
    ...mapMangaVisibilityFields(row),
    lastUpdated: row?.last_updated || row?.lastUpdated,
    createdAt: row?.created_at || row?.createdAt,
    releaseYear: row?.release_year ?? row?.releaseYear,
    description: sanitizeMangaDescription(row?.description || row?.description_tr || row?.descriptionTr || row?.details?.descriptionTr),
    descriptionTr: sanitizeMangaDescription(row?.description_tr || row?.descriptionTr || row?.details?.descriptionTr || row?.description),
    descriptionEn: sanitizeMangaDescription(row?.description_en || row?.descriptionEn || row?.details?.descriptionEn || ''),
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
    langCode?: string;
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

const PRIMARY_ADMIN_EMAIL = (import.meta.env.VITE_PRIMARY_ADMIN_EMAIL || '').trim().toLowerCase();
let adminAccessContextCache:
    | { authUserId: string | null; value: AdminAccessContext }
    | null = null;
let adminAccessContextPromise: Promise<AdminAccessContext> | null = null;
const ALL_MANGAS_CACHE_TTL_MS = 5 * 60_000;
const TOP_TEN_IDS_CACHE_TTL_MS = 15 * 60_000;
const STAFF_MANGA_ACCESS_ROLE_CACHE_TTL_MS = 5 * 60_000;
// IDB kalÄ±cÄ± katalog Ã¶nbelleÄŸi: sayfa yenilense bile bu sÃ¼re iÃ§inde aÄŸa Ã§Ä±kmadan dÃ¶ner.
const PERSISTED_CATALOG_CACHE_TTL_MS = 15 * 60_000;
const PERSISTED_MANGA_SUMMARIES_KEY_PREFIX = 'manga-summaries-v2:';
const PERSISTED_HOME_SECTIONS_KEY_PREFIX = 'home-sections-v2:';
// Manga detayÄ± kÄ±sa sÃ¼reli bellek cache'i: MangaDetail -> Reader geÃ§iÅŸinde aynÄ± aÄŸÄ±r
// sorgularÄ±n tekrar edilmesini engeller (yazma iÅŸlemlerinde invalidate edilir).
const MANGA_DETAIL_CACHE_TTL_MS = 60_000;
const mangaDetailCache = new Map<string, { fetchedAt: number; value: Manga }>();
// SWR: bayat IDB verisi dÃ¶ndÃ¼rÃ¼lÃ¼rken arka plan yenilemesinin tekrar tetiklenmesini Ã¶nler.
const persistedSummariesRefreshInFlight = new Set<MangaAudienceCacheKey>();

// Cache'ten dÃ¶nen nesnenin UI state'inde paylaÅŸÄ±lÄ±p mutasyona uÄŸramamasÄ± iÃ§in klonlanÄ±r.
function cloneMangaForCache(manga: Manga): Manga {
    return {
        ...manga,
        chapters: Array.isArray(manga.chapters)
            ? manga.chapters.map((chapter) => ({
                ...chapter,
                pages: Array.isArray(chapter.pages) ? [...chapter.pages] : [],
            }))
            : [],
    } as Manga;
}

const getPersistedMangaSummariesKey = (audienceCacheKey: MangaAudienceCacheKey) => (
    `${PERSISTED_MANGA_SUMMARIES_KEY_PREFIX}${audienceCacheKey}`
);

const getPersistedHomeSectionsKey = (audienceCacheKey: MangaAudienceCacheKey) => (
    `${PERSISTED_HOME_SECTIONS_KEY_PREFIX}${audienceCacheKey}`
);

const PERSISTED_TOP_TEN_PAGE_KEY = 'top-ten-page-data-v2';
const PERSISTED_LATEST_CHAPTERS_KEY_PREFIX = 'latest-chapters-v1:';
const TOP_TEN_PAGE_CACHE_TTL_MS = 5 * 60_000;
const LATEST_CHAPTERS_CACHE_TTL_MS = 2 * 60_000;

let topTenPageDataCache: { fetchedAt: number; value: Record<'safe' | 'adult', Record<TopTenTimeframe, Manga[]>> } | null = null;
let topTenPageDataPromise: Promise<Record<'safe' | 'adult', Record<TopTenTimeframe, Manga[]>>> | null = null;
const latestChaptersFirstPageCache: Partial<Record<MangaAudienceCacheKey, { fetchedAt: number; value: LatestChapterFeedItem[] }>> = {};
const latestChaptersFirstPagePromise: Partial<Record<MangaAudienceCacheKey, Promise<LatestChapterFeedItem[]>>> = {};
const tagsListCache = new Map<string, { fetchedAt: number; value: Tag[] }>();
const tagsListPromises = new Map<string, Promise<Tag[]>>();
const trendingTagsCache = new Map<string, { fetchedAt: number; value: Tag[] }>();
const trendingTagsPromises = new Map<string, Promise<Tag[]>>();

const invalidateTagCaches = () => {
    tagsListCache.clear();
    tagsListPromises.clear();
    trendingTagsCache.clear();
    trendingTagsPromises.clear();
};

const clearPersistedCatalogCache = () => {
    void removePersistedQueryCache([
        getPersistedMangaSummariesKey('safe'),
        getPersistedMangaSummariesKey('adult'),
        getPersistedHomeSectionsKey('safe'),
        getPersistedHomeSectionsKey('adult'),
        PERSISTED_TOP_TEN_PAGE_KEY,
        `${PERSISTED_LATEST_CHAPTERS_KEY_PREFIX}safe`,
        `${PERSISTED_LATEST_CHAPTERS_KEY_PREFIX}adult`,
        'named-entities-v1:characters:public',
        'named-entities-v1:authors:public',
        'named-entities-v1:artists:public',
    ]);
};
const MANGA_SUMMARY_BASE_SELECT_COLUMNS = 'id, title, alternative_titles, cover, banner, author, artist, status, genres, views, last_updated, created_at, type, release_year, chapter_count, latest_chapters';
// Liste/picker sorgularÄ± iÃ§in hafif kolon seti: description/details/source_links gibi aÄŸÄ±r
// alanlar Ã§ekilmez (bkz. performans raporu: select('*') payload'Ä± 1.8 KB/satÄ±r).
const MANGA_LIST_BASE_SELECT_COLUMNS = 'id, title, alternative_titles, cover, banner, author, artist, status, genres, views, last_updated, created_at, type, release_year, chapter_count, latest_chapters';
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
let mangaVisibilityColumnAvailableCache: boolean | null = true;
let mangaVisibilityColumnAvailablePromise: Promise<boolean> | null = null;
let mangaAdultColumnAvailableCache: boolean | null = true;
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
    mangaDetailCache.clear();
    clearPersistedCatalogCache();
    namedEntityRowsCache.clear();
    namedEntityRowsPromises.clear();
    topTenMangaIdsCache.today = null;
    topTenMangaIdsCache.week = null;
    topTenMangaIdsCache.all = null;
    topTenMangaIdsPromises.today = null;
    topTenMangaIdsPromises.week = null;
    topTenMangaIdsPromises.all = null;
    topTenPageDataCache = null;
    topTenPageDataPromise = null;
    latestChaptersFirstPageCache.safe = undefined;
    latestChaptersFirstPageCache.adult = undefined;
    latestChaptersFirstPagePromise.safe = undefined;
    latestChaptersFirstPagePromise.adult = undefined;
    invalidateTagCaches();
    clearHomeFeedCache();
};

const VIEWER_ACCESS_SESSION_KEY = 'toonparrot_viewer_access_v1';

const readPersistedViewerAccess = (
    authUserId: string | null,
): { role: User['role'] | undefined; adultModeEnabled: boolean } | null => {
    if (!authUserId || typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem(VIEWER_ACCESS_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.authUserId !== authUserId) return null;
        if (typeof parsed.fetchedAt !== 'number' || Date.now() - parsed.fetchedAt >= STAFF_MANGA_ACCESS_ROLE_CACHE_TTL_MS) {
            return null;
        }
        return {
            role: parsed.role as User['role'] | undefined,
            adultModeEnabled: parsed.adultModeEnabled === true,
        };
    } catch {
        return null;
    }
};

const writePersistedViewerAccess = (
    authUserId: string | null,
    access: { role: User['role'] | undefined; adultModeEnabled: boolean },
) => {
    if (typeof window === 'undefined') return;
    try {
        if (!authUserId) {
            window.sessionStorage.removeItem(VIEWER_ACCESS_SESSION_KEY);
            return;
        }
        window.sessionStorage.setItem(
            VIEWER_ACCESS_SESSION_KEY,
            JSON.stringify({
                authUserId,
                role: access.role,
                adultModeEnabled: access.adultModeEnabled === true,
                fetchedAt: Date.now(),
            }),
        );
    } catch {
        // Storage disabled/quota exceeded; memory cache remains active.
    }
};

const ADMIN_ACCESS_SESSION_KEY = 'toonparrot_admin_access_v1';

const readPersistedAdminAccessContext = (authUserId?: string | null): AdminAccessContext | null => {
    if (!authUserId || typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem(ADMIN_ACCESS_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.authUserId !== authUserId) return null;
        if (typeof parsed.fetchedAt !== 'number' || Date.now() - parsed.fetchedAt >= STAFF_MANGA_ACCESS_ROLE_CACHE_TTL_MS) {
            return null;
        }
        if (!parsed.value || typeof parsed.value.canAccessAdminPanel !== 'boolean') {
            return null;
        }
        return parsed.value as AdminAccessContext;
    } catch {
        return null;
    }
};

const writePersistedAdminAccessContext = (
    authUserId: string | null,
    value?: AdminAccessContext,
) => {
    if (typeof window === 'undefined') return;
    try {
        if (!authUserId || !value) {
            window.sessionStorage.removeItem(ADMIN_ACCESS_SESSION_KEY);
            return;
        }
        window.sessionStorage.setItem(
            ADMIN_ACCESS_SESSION_KEY,
            JSON.stringify({
                authUserId,
                fetchedAt: Date.now(),
                value,
            }),
        );
    } catch {
        // Ignore storage errors
    }
};

export const invalidateMangaVisibilityCaches = () => {
    currentViewerRoleCache = null;
    currentViewerRolePromise = null;
    currentViewerAdultModeCache = null;
    currentViewerAccessPromise = null;
    adminAccessContextCache = null;
    writePersistedViewerAccess(null, { role: undefined, adultModeEnabled: false });
    writePersistedAdminAccessContext(null);
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

const getMangaListSelectColumns = (
    visibilityColumnAvailable: boolean,
    adultColumnAvailable: boolean,
) => (
    [
        MANGA_LIST_BASE_SELECT_COLUMNS,
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

let currentViewerAdultModeCache: {
    authUserId: string | null;
    fetchedAt: number;
    enabled: boolean;
} | null = null;
let currentViewerAccessPromise: Promise<{ role: User['role'] | undefined; adultModeEnabled: boolean }> | null = null;

const getCurrentViewerAccessProfile = async (): Promise<{
    role: User['role'] | undefined;
    adultModeEnabled: boolean;
}> => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        if (!isExpectedAccessControlError(sessionError)) {
            console.error('Current viewer session fetch error:', sessionError);
        }
        return { role: undefined, adultModeEnabled: false };
    }

    const authUserId = sessionData.session?.user?.id || null;
    const sessionRole = sessionData.session?.user?.user_metadata?.role as User['role'] | undefined;

    if (!authUserId) {
        currentViewerRoleCache = {
            authUserId: null,
            fetchedAt: Date.now(),
            role: undefined,
        };
        currentViewerAdultModeCache = {
            authUserId: null,
            fetchedAt: Date.now(),
            enabled: false,
        };
        writePersistedViewerAccess(null, { role: undefined, adultModeEnabled: false });
        return { role: undefined, adultModeEnabled: false };
    }

    const now = Date.now();
    const persistedAccess = readPersistedViewerAccess(authUserId);
    const cachedPreferences = getCachedPreferencesForUser(authUserId);
    const metaPrefs = sessionData.session?.user?.user_metadata?.preferences as any;
    const hasMetaAdultMode = metaPrefs && typeof metaPrefs?.content?.adult_mode === 'boolean';
    const roleCacheFresh =
        currentViewerRoleCache?.authUserId === authUserId
        && now - currentViewerRoleCache.fetchedAt < STAFF_MANGA_ACCESS_ROLE_CACHE_TTL_MS;
    const adultCacheFresh =
        currentViewerAdultModeCache?.authUserId === authUserId
        && now - currentViewerAdultModeCache.fetchedAt < STAFF_MANGA_ACCESS_ROLE_CACHE_TTL_MS;

    const resolveAdultModeEnabled = () => {
        if (cachedPreferences) {
            return cachedPreferences.content?.adult_mode === true;
        }
        if (hasMetaAdultMode) {
            return metaPrefs.content.adult_mode === true;
        }
        if (adultCacheFresh && currentViewerAdultModeCache) {
            return currentViewerAdultModeCache.enabled;
        }
        if (persistedAccess) {
            return persistedAccess.adultModeEnabled;
        }
        return false;
    };

    if ((roleCacheFresh || persistedAccess || sessionRole) && (cachedPreferences || hasMetaAdultMode || adultCacheFresh || persistedAccess)) {
        const resolved = {
            role: currentViewerRoleCache?.role || persistedAccess?.role || sessionRole,
            adultModeEnabled: resolveAdultModeEnabled(),
        };
        if (!roleCacheFresh) {
            currentViewerRoleCache = { authUserId, fetchedAt: now, role: resolved.role };
        }
        if (!adultCacheFresh) {
            currentViewerAdultModeCache = { authUserId, fetchedAt: now, enabled: resolved.adultModeEnabled };
        }
        return resolved;
    }

    if (currentViewerAccessPromise) {
        return currentViewerAccessPromise;
    }

    currentViewerAccessPromise = (async () => {
        // Select only column-level-readable `role`; reading `preferences` directly is revoked on public.users (403).
        const { data: profile, error } = await supabase
            .from('users')
            .select('role')
            .eq('id', authUserId)
            .maybeSingle();

        if (error) {
            if (!isExpectedAccessControlError(error)) {
                console.error('Current viewer access profile fetch error:', error);
            }
            return {
                role: persistedAccess?.role || sessionRole,
                adultModeEnabled: resolveAdultModeEnabled(),
            };
        }

        const role = ((profile as any)?.role as User['role'] | undefined) || persistedAccess?.role || sessionRole;
        return {
            role,
            adultModeEnabled: resolveAdultModeEnabled(),
        };
    })()
        .then((result) => {
            const settledAt = Date.now();
            currentViewerRoleCache = {
                authUserId,
                fetchedAt: settledAt,
                role: result.role,
            };
            currentViewerAdultModeCache = {
                authUserId,
                fetchedAt: settledAt,
                enabled: result.adultModeEnabled,
            };
            writePersistedViewerAccess(authUserId, result);
            return result;
        })
        .finally(() => {
            currentViewerAccessPromise = null;
        });

    return currentViewerAccessPromise;
};

const resolveMangaVisibilityAccess = async (includePrivateOverride?: boolean) => {
    const [visibilityColumnAvailable, adultColumnAvailable, accessProfile] = await Promise.all([
        getMangaVisibilityColumnAvailability(),
        getMangaAdultColumnAvailability(),
        getCurrentViewerAccessProfile(),
    ]);
    const isStaff = accessProfile.role === 'admin' || accessProfile.role === 'moderator';
    const includePrivate = includePrivateOverride === true;
    const includeAdult = includePrivate || isStaff || accessProfile.adultModeEnabled;

    return {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
        summarySelectColumns: getMangaSummarySelectColumns(visibilityColumnAvailable, adultColumnAvailable),
    };
};

export const getCachedAdminAccessContext = (authUserId?: string | null): AdminAccessContext | null => {
    if (!authUserId) {
        return null;
    }

    if (adminAccessContextCache?.authUserId === authUserId) {
        return adminAccessContextCache.value;
    }

    const persisted = readPersistedAdminAccessContext(authUserId);
    if (persisted) {
        adminAccessContextCache = {
            authUserId,
            value: persisted,
        };
        return persisted;
    }

    return null;
};

const hasUserBlockRelationship = async (viewerId?: string, ownerId?: string): Promise<boolean> => {
    if (!viewerId || !ownerId || viewerId === ownerId) {
        return false;
    }

    // NOT: count:'exact' yerine limit(1) varlÄ±k kontrolÃ¼ â€” sadece boolean gerekiyor.
    const [
        { data: viewerBlocksOwner, error: viewerBlocksOwnerError },
        { data: ownerBlocksViewer, error: ownerBlocksViewerError },
    ] = await Promise.all([
        supabase
            .from('user_blocks')
            .select('blocker_id')
            .eq('blocker_id', viewerId)
            .eq('blocked_id', ownerId)
            .limit(1),
        supabase
            .from('user_blocks')
            .select('blocker_id')
            .eq('blocker_id', ownerId)
            .eq('blocked_id', viewerId)
            .limit(1),
    ]);

    if (viewerBlocksOwnerError || ownerBlocksViewerError) {
        console.error('User block relationship check error:', viewerBlocksOwnerError || ownerBlocksViewerError);
        return false;
    }

    return Boolean(viewerBlocksOwner?.length) || Boolean(ownerBlocksViewer?.length);
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

    if (uniqueMangaIds.length > 100) {
        const chunks = chunkArray(uniqueMangaIds, 100);
        const nestedResults = await Promise.all(
            chunks.map((chunk) =>
                fetchAllChapterMetaRows(selectColumns, {
                    ...options,
                    mangaIds: chunk,
                })
            )
        );
        return nestedResults.flat();
    }

    // NOT: count:'exact' kaldÄ±rÄ±ldÄ± (317k satÄ±rlÄ±k chapters tablosunda count(*) 3 sn
    // statement_timeout'a takÄ±lÄ±yordu). Sayfalar kÄ±sa sayfa gelene kadar batch'li
    // paralel Ã§ekilir.
    const pageFetchBatchSize = 8;
    const maxPages = 500;
    const rows: any[] = [];
    let pageIndex = 0;
    let reachedEnd = false;

    while (!reachedEnd && pageIndex < maxPages) {
        const pageRequests = Array.from({ length: pageFetchBatchSize }, (_, offsetIndex) => {
            const currentPageIndex = pageIndex + offsetIndex;
            const rangeStart = currentPageIndex * CHAPTER_META_BATCH_SIZE;
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

        const responses = await Promise.all(pageRequests);

        for (const response of responses) {
            if (response.error) {
                throw response.error;
            }

            const pageRows = response.data || [];
            rows.push(...pageRows);

            if (pageRows.length < CHAPTER_META_BATCH_SIZE) {
                reachedEnd = true;
                break;
            }
        }

        pageIndex += pageFetchBatchSize;
    }

    return rows;
};

// ==================== MANGA OPERATIONS ====================

const CATALOG_RPC_CHUNK_SIZE = 1000;
const CATALOG_RPC_CONCURRENCY = 5;

const deduplicateMangasById = (items: Manga[]): Manga[] => {
    const seenIds = new Set<string>();
    const result: Manga[] = [];

    for (const item of items) {
        if (item?.id && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            result.push(item);
        }
    }

    return result;
};

const fetchCatalogRowsViaRpc = async (includeAdult: boolean): Promise<any[] | null> => {
    try {
        const rows: any[] = [];
        let batchStartOffset = 0;

        while (true) {
            const offsets = Array.from(
                { length: CATALOG_RPC_CONCURRENCY },
                (_, idx) => batchStartOffset + idx * CATALOG_RPC_CHUNK_SIZE,
            );
            const responses = await Promise.all(
                offsets.map((offset) =>
                    supabase.rpc('get_manga_catalog_rows', {
                        p_offset: offset,
                        p_limit: CATALOG_RPC_CHUNK_SIZE,
                        p_include_adult: includeAdult,
                    }),
                ),
            );

            let reachedEnd = false;
            for (const response of responses) {
                if (response.error || !Array.isArray(response.data)) {
                    return null;
                }
                rows.push(...response.data);
                if (response.data.length < CATALOG_RPC_CHUNK_SIZE) {
                    reachedEnd = true;
                    break;
                }
            }

            if (reachedEnd) {
                break;
            }
            batchStartOffset += CATALOG_RPC_CONCURRENCY * CATALOG_RPC_CHUNK_SIZE;
        }

        return rows;
    } catch {
        return null;
    }
};

const mapSummaryRowToManga = (
    manga: any,
    reviewStats?: { average: number; reviewCount: number },
    includeSimplifiedRatings: boolean = false,
): Manga => {
    const precomputedChapters = Array.isArray(manga.latest_chapters)
        ? manga.latest_chapters
            .map((ch: any) => ({ id: String(ch?.id || ''), number: Number(ch?.number) || 1 }))
            .filter((ch: any) => ch.id)
        : [];
    const average = reviewStats?.average ?? (Number(manga.average_rating ?? manga.averageRating) || 0);
    const reviewCount = reviewStats?.reviewCount ?? (Number(manga.review_count ?? manga.reviewCount) || 0);

    return {
        ...manga,
        author: cleanPlaceholderNamedEntityString(manga.author) || manga.author,
        artist: cleanPlaceholderNamedEntityString(manga.artist) || manga.artist,
        ...mapMangaBaseFields(manga),
        chapters: precomputedChapters,
        chapterCount: Number(manga.chapter_count ?? manga.chapterCount) || precomputedChapters.length || 0,
        ratings: includeSimplifiedRatings ? Array(reviewCount).fill({ rating: average }) : [],
        averageRating: average,
        reviewCount,
    } as Manga;
};

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
            if (!includePrivate) {
                const rpcRows = await fetchCatalogRowsViaRpc(includeAdult);
                if (rpcRows !== null) {
                    return deduplicateMangasById(
                        rpcRows.map((m) => mapSummaryRowToManga(m, undefined, true)),
                    );
                }
            }

            const [
                data,
                { data: revData, error: reviewsError },
            ] = await Promise.all([
                fetchAllMangaRowsPaginated(
                    getMangaListSelectColumns(visibilityColumnAvailable, adultColumnAvailable),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                supabase
                    .from('reviews')
                    .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement'),
            ]);

            if (reviewsError) console.error('Manga list review aggregate fetch error:', reviewsError);

            const reviewStatsByMangaId = buildReviewStatsByMangaId(revData || []);
            return deduplicateMangasById(
                (data || []).map((m) => mapSummaryRowToManga(m, reviewStatsByMangaId.get(m.id), true)),
            );
        };

        const pendingRequest = runWithSupabaseBootstrapRetry({
            run: fetchManga,
            timeoutMs: 25000,
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
    options?: { includePrivate?: boolean; forceRefresh?: boolean }
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

    // IDB kalÄ±cÄ± Ã¶nbellek: taze ise aÄŸa hiÃ§ Ã§Ä±kmadan dÃ¶n (KeÅŸfet / arama / TopTen aÃ§Ä±lÄ±ÅŸÄ±).
    // Bayat ise: eldeki veriyi ANINDA dÃ¶ndÃ¼r + arka planda sessizce yenile (SWR).
    let persistedSummaries: Manga[] | null = null;
    if (!includePrivate && !options?.forceRefresh) {
        const persistedKey = getPersistedMangaSummariesKey(audienceCacheKey);
        const persisted = await readPersistedQueryCache<Manga[]>(persistedKey);
        if (persisted && Array.isArray(persisted.value) && persisted.value.length > 0) {
            if (Date.now() - persisted.fetchedAt < PERSISTED_CATALOG_CACHE_TTL_MS) {
                mangaSummariesCache[audienceCacheKey] = {
                    fetchedAt: persisted.fetchedAt,
                    value: persisted.value,
                };
                return persisted.value;
            }

            mangaSummariesCache[audienceCacheKey] = {
                fetchedAt: persisted.fetchedAt,
                value: persisted.value,
            };

            if (!persistedSummariesRefreshInFlight.has(audienceCacheKey)) {
                persistedSummariesRefreshInFlight.add(audienceCacheKey);
                void getMangaSummaries({ includePrivate, forceRefresh: true })
                    .catch(() => undefined)
                    .finally(() => {
                        persistedSummariesRefreshInFlight.delete(audienceCacheKey);
                    });
            }

            return persisted.value;
        }
    }

    try {
        const fetchSummaries = async () => {
            if (!includePrivate) {
                const rpcRows = await fetchCatalogRowsViaRpc(includeAdult);
                if (rpcRows !== null) {
                    return rpcRows.map((manga: any) => mapSummaryRowToManga(manga));
                }
            }

            const [
                mangaRows,
                { data: reviewRows, error: reviewError },
            ] = await Promise.all([
                fetchAllMangaRowsPaginated(
                    summarySelectColumns,
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                supabase
                    .from('reviews')
                    .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement'),
            ]);

            if (reviewError) {
                console.error('Manga summary review aggregate fetch error:', reviewError);
            }

            const reviewStatsByMangaId = buildReviewStatsByMangaId(reviewRows || []);
            return (mangaRows || []).map((manga: any) =>
                mapSummaryRowToManga(manga, reviewStatsByMangaId.get(manga.id)),
            );
        };

        const pendingRequest = runWithSupabaseBootstrapRetry({
            run: fetchSummaries,
            timeoutMs: 25000,
            timeoutMessage: 'Manga summary fetch timeout',
            shouldRetryResult: (result) => Array.isArray(result) && result.length === 0,
        });
        if (!includePrivate) {
            mangaSummariesPromise[audienceCacheKey] = pendingRequest;
        }
        const summaries = deduplicateMangasById(await pendingRequest);

        if (!includePrivate && summaries.length > 0) {
            mangaSummariesCache[audienceCacheKey] = {
                fetchedAt: Date.now(),
                value: summaries,
            };
            void writePersistedQueryCache(getPersistedMangaSummariesKey(audienceCacheKey), summaries);
        }

        return summaries;
    } catch (error) {
        if (!includePrivate) {
            delete mangaSummariesCache[audienceCacheKey];
            delete mangaSummariesPromise[audienceCacheKey];
        }
        // AÄŸ hatasÄ±nda elimizde bayat da olsa kalÄ±cÄ± Ã¶nbellek varsa onu kullan.
        if (persistedSummaries) {
            return persistedSummaries;
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
    const fetchMangaRowsForIds = async (ids: string[], filterOptions: any) => {
        if (ids.length === 0) return { data: [], error: null };
        if (ids.length <= 100) {
            return applyPublicMangaFilter(
                supabase
                    .from('mangas')
                    .select(summarySelectColumns)
                    .in('id', ids),
                filterOptions,
            );
        }
        const chunks = chunkArray(ids, 100);
        const results = await Promise.all(
            chunks.map((chunk) =>
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .in('id', chunk),
                    filterOptions,
                )
            )
        );
        const allData: any[] = [];
        let firstErr: any = null;
        for (const res of results) {
            if (res.error) firstErr = res.error;
            if (res.data) allData.push(...res.data);
        }
        return { data: allData, error: firstErr };
    };

    if (includePrivate) {
        const { data: mangaRows, error: mangaError } = await fetchMangaRowsForIds(
            uniqueMangaIds,
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
        const { data: mangaRows, error: mangaError } = await fetchMangaRowsForIds(
            missingIds,
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

    // IDB kalÄ±cÄ± Ã¶nbellek: taze ise aÄŸa Ã§Ä±kmadan dÃ¶n (ana sayfa aÃ§Ä±lÄ±ÅŸÄ±).
    let persistedHomeSections: HomePageMangaSections | null = null;
    if (!includePrivate) {
        const persistedKey = getPersistedHomeSectionsKey(audienceCacheKey);
        const persisted = await readPersistedQueryCache<HomePageMangaSections>(persistedKey);
        if (persisted && hasHomePageSectionData(persisted.value)) {
            if (Date.now() - persisted.fetchedAt < PERSISTED_CATALOG_CACHE_TTL_MS) {
                homePageMangaSectionsCache[audienceCacheKey] = {
                    fetchedAt: persisted.fetchedAt,
                    value: persisted.value,
                };
                return persisted.value;
            }
            persistedHomeSections = persisted.value;
        }
    }

    const mapRowsToSummaries = (rows: any[], summaryMap: Map<string, Manga>) => {
        const seen = new Set<string>();
        const list: Manga[] = [];
        for (const row of rows) {
            const summary = summaryMap.get(row?.id);
            if (summary && !seen.has(summary.id)) {
                seen.add(summary.id);
                list.push(summary);
            }
        }
        return list;
    };

    const mapPrecomputedHomeSectionRows = (rows: any[]): Manga[] => {
        if (!Array.isArray(rows) || rows.length === 0) {
            return [];
        }
        const seen = new Set<string>();
        const list: Manga[] = [];
        for (const manga of rows) {
            const id = typeof manga?.id === 'string' ? manga.id : '';
            if (!id || seen.has(id)) {
                continue;
            }
            if (!includePrivate && (manga?.is_public === false || (!includeAdult && manga?.is_adult === true))) {
                continue;
            }
            seen.add(id);
            const precomputedChapters = Array.isArray(manga.latest_chapters)
                ? manga.latest_chapters
                    .map((ch: any) => ({ id: String(ch?.id || ''), number: Number(ch?.number) || 1 }))
                    .filter((ch: any) => ch.id)
                : [];
            list.push({
                ...manga,
                author: cleanPlaceholderNamedEntityString(manga.author) || manga.author,
                artist: cleanPlaceholderNamedEntityString(manga.artist) || manga.artist,
                ...mapMangaBaseFields(manga),
                chapters: precomputedChapters,
                ratings: [],
                chapterCount: Number(manga.chapter_count ?? manga.chapterCount) || precomputedChapters.length || 0,
                averageRating: Number(manga.average_rating ?? 0),
                reviewCount: Number(manga.review_count ?? 0),
                authorsDetails: [],
                artistsDetails: [],
            } as Manga);
        }
        return list;
    };

    try {
        const fetchSections = async () => {
            if (!includePrivate) {
                try {
                    const { data: rpcData, error: rpcError } = await supabase.rpc('get_home_page_sections', {
                        p_newly_added_limit: HOME_PAGE_SECTION_LIMITS.newlyAdded,
                        p_recently_updated_limit: HOME_PAGE_SECTION_LIMITS.recentlyUpdated,
                        p_trending_limit: HOME_PAGE_SECTION_LIMITS.trending,
                    });

                    if (!rpcError && rpcData && typeof rpcData === 'object') {
                        const rpcPayload = rpcData as Record<string, any>;
                        const mappedSections: HomePageMangaSections = {
                            trendingManga: mapPrecomputedHomeSectionRows(rpcPayload.trending),
                            newlyAddedSeries: mapPrecomputedHomeSectionRows(rpcPayload.newly_added),
                            recentlyUpdated: mapPrecomputedHomeSectionRows(rpcPayload.recently_updated),
                        };
                        if (hasHomePageSectionData(mappedSections)) {
                            return mappedSections;
                        }
                    }
                } catch (rpcErr) {
                    console.warn('get_home_page_sections rpc error, falling back to multi-query:', rpcErr);
                }
            }

            const [
                { data: newlyAddedRows, error: newlyAddedError },
                { data: recentlyUpdatedRows, error: recentlyUpdatedError },
                { data: trendingRows, error: trendingError },
            ] = await Promise.all([
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .gt('chapter_count', 0)
                        .order('created_at', { ascending: false })
                        .limit(HOME_PAGE_SECTION_LIMITS.newlyAdded),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .gt('chapter_count', 0)
                        .order('last_updated', { ascending: false })
                        .limit(HOME_PAGE_SECTION_LIMITS.recentlyUpdated),
                    { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
                ),
                applyPublicMangaFilter(
                    supabase
                        .from('mangas')
                        .select(summarySelectColumns)
                        .gt('chapter_count', 0)
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
            timeoutMs: 20000,
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
            void writePersistedQueryCache(getPersistedHomeSectionsKey(audienceCacheKey), sections);
        }

        return sections;
    } catch (error) {
        delete homePageMangaSectionsCache[audienceCacheKey];
        delete homePageMangaSectionsPromise[audienceCacheKey];
        if (persistedHomeSections) {
            return persistedHomeSections;
        }
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

const getCatalogWorkerBaseUrl = (): string => (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CATALOG_WORKER_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_CATALOG_WORKER_URL) ||
    ''
).replace(/\/+$/, '');

interface R2CachedChapterEntry {
    chapter: Chapter;
    mangaId: string;
    slug?: string;
}

const r2SeriesCacheBySlug = new Map<string, { fetchedAt: number; data: any }>();
const r2SeriesInFlightBySlug = new Map<string, Promise<any>>();
const r2ChapterMetaById = new Map<string, R2CachedChapterEntry>();
const r2MangaSlugById = new Map<string, string>();
const r2ShardSeriesByIdOrSlug = new Map<string, any>();
const R2_SERIES_CACHE_TTL_MS = 60_000;

const mapChapterRowToChapter = (row: any, options?: { includePages?: boolean }): Chapter => {
    const includePages = options?.includePages === true;
    const pages = includePages ? sanitizeChapterPageUrls(row.pages || []) : [];
    const sourceUrl = row.source_url || row.sourceUrl || row._sourceLink || undefined;

    return {
        id: row.id,
        number: Number(row.number ?? row.chapterNumber) || 0,
        title: row.title || '',
        pages,
        pageCount: includePages ? pages.length : (typeof row.pageCount === 'number' ? row.pageCount : undefined),
        releaseDate: row.release_date || row.releaseDate || '',
        views: Number(row.views) || 0,
        language: row.language ? String(row.language).toLowerCase() : undefined,
        sourceUrl,
        _sourceLink: row._sourceLink || sourceUrl,
    };
};

const indexR2SeriesChapters = (seriesData: any, fallbackMangaId?: string, fallbackSlug?: string) => {
    if (!seriesData || typeof seriesData !== 'object') return;
    const mangaObj = seriesData.manga || seriesData;
    const mangaId = String(mangaObj?.id || fallbackMangaId || '').trim();
    const slug = String(mangaObj?.slug || seriesData.slug || fallbackSlug || '').trim();
    if (mangaId && slug) {
        r2MangaSlugById.set(mangaId, slug);
    }
    if (Array.isArray(seriesData.chapters)) {
        for (const sc of seriesData.chapters) {
            if (!sc || !sc.id) continue;
            const mapped = mapChapterRowToChapter(sc, { includePages: true });
            r2ChapterMetaById.set(sc.id, {
                chapter: mapped,
                mangaId: mangaId || String(sc.manga_id || sc.mangaId || ''),
                slug,
            });
        }
    }
};

const fetchR2SeriesBySlug = async (slug?: string | null): Promise<any | null> => {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    if (!cleanSlug) return null;

    const cached = r2SeriesCacheBySlug.get(cleanSlug);
    if (cached && Date.now() - cached.fetchedAt < R2_SERIES_CACHE_TTL_MS) {
        return cached.data;
    }

    const inFlight = r2SeriesInFlightBySlug.get(cleanSlug);
    if (inFlight) {
        return inFlight;
    }

    const workerUrl = getCatalogWorkerBaseUrl();
    if (!workerUrl) return null;

    const promise = (async () => {
        try {
            const res = await fetch(`${workerUrl}/v1/catalog/series/${encodeURIComponent(cleanSlug)}`, {
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) {
                r2SeriesCacheBySlug.set(cleanSlug, { fetchedAt: Date.now(), data: null });
                return null;
            }
            const data = await res.json();
            indexR2SeriesChapters(data, undefined, cleanSlug);
            r2SeriesCacheBySlug.set(cleanSlug, { fetchedAt: Date.now(), data });
            return data;
        } catch {
            return null;
        } finally {
            r2SeriesInFlightBySlug.delete(cleanSlug);
        }
    })();

    r2SeriesInFlightBySlug.set(cleanSlug, promise);
    return promise;
};

const mapR2ShardRowToMangaSummary = (raw: any): Manga | null => {
    if (!raw || typeof raw !== 'object' || !raw.id || !raw.title) return null;
    const slug = String(raw.slug || '').trim();
    if (slug) {
        r2MangaSlugById.set(raw.id, slug);
        r2ShardSeriesByIdOrSlug.set(slug.toLowerCase(), raw);
    }
    r2ShardSeriesByIdOrSlug.set(String(raw.id), raw);

    const precomputedChapters = Array.isArray(raw.latest_chapters || raw.chapters)
        ? (raw.latest_chapters || raw.chapters)
            .slice(0, 2)
            .map((ch: any) => ({
                id: String(ch?.id || ''),
                number: Number(ch?.number ?? ch?.chapterNumber) || 1,
                title: String(ch?.title || ''),
                pages: [],
                releaseDate: String(ch?.release_date || ch?.releaseDate || ''),
                views: 0,
                language: ch?.language ? String(ch.language).toLowerCase() : undefined,
            }))
            .filter((ch: any) => ch.id)
        : [];

    const chapterCount = Number(raw.chapter_count ?? raw.chapterCount ?? raw.chapters?.length ?? precomputedChapters.length) || 0;
    if (chapterCount <= 0) return null;

    return {
        ...raw,
        id: String(raw.id),
        slug,
        title: String(raw.title),
        author: cleanPlaceholderNamedEntityString(raw.author) || raw.author || 'Bilinmiyor',
        artist: cleanPlaceholderNamedEntityString(raw.artist) || raw.artist || '',
        cover: String(raw.cover || ''),
        banner: String(raw.banner || raw.cover || ''),
        genres: normalizeGenres(raw.genres || []),
        status: (raw.status === 'completed' || raw.status === 'hiatus' ? raw.status : 'ongoing') as Manga['status'],
        type: (raw.type || 'manhwa') as Manga['type'],
        views: 0,
        ...mapMangaBaseFields(raw),
        chapters: precomputedChapters as Chapter[],
        ratings: [],
        chapterCount,
        averageRating: 0,
        reviewCount: 0,
        details: raw.details || {},
        sourceLinks: raw.source_links || raw.sourceLinks || [],
    } as Manga;
};

export const getChapterById = async (chapterId: string): Promise<{ chapter: Chapter; mangaId: string } | null> => {
    try {
        const cachedR2 = r2ChapterMetaById.get(chapterId);
        if (cachedR2) {
            const ch = { ...cachedR2.chapter, pages: [...(cachedR2.chapter.pages || [])] };
            return {
                chapter: ch,
                mangaId: cachedR2.mangaId,
            };
        }

        const { data, error } = await supabase
            .from('chapters')
            .select('id, manga_id, number, title, pages, release_date, views')
            .eq('id', chapterId)
            .maybeSingle();

        if (!error && data) {
            const chapter = mapChapterRowToChapter(data, { includePages: true });
            return {
                chapter,
                mangaId: data.manga_id,
            };
        }

        return null;
    } catch {
        return null;
    }
};

export const getMangaChapters = async (
    mangaId: string,
    options?: { includePages?: boolean; slug?: string; fallbackLanguage?: string }
): Promise<Chapter[]> => {
    const includePages = options?.includePages === true;
    const selectColumns = includePages
        ? 'id, manga_id, number, title, pages, release_date, views'
        : 'id, manga_id, number, title, release_date, views';

    // PostgREST max-rows=1000: 1000+ bölümlü serilerde (ör. Martial Peak 3.842)
    // bölüm listesi sessizce kırpılmasın diye sayfalı çekilir.
    const CHAPTER_FETCH_PAGE_SIZE = 1000;
    const CHAPTER_FETCH_MAX_PAGES = 30;
    const data: any[] = [];
    for (let pageIndex = 0; pageIndex < CHAPTER_FETCH_MAX_PAGES; pageIndex += 1) {
        const from = pageIndex * CHAPTER_FETCH_PAGE_SIZE;
        const to = from + CHAPTER_FETCH_PAGE_SIZE - 1;
        const { data: pageData, error: pageError } = await supabase
            .from('chapters')
            .select(selectColumns)
            .eq('manga_id', mangaId)
            .order('number', { ascending: false })
            .range(from, to);

        if (pageError) {
            throw pageError;
        }

        const pageRows = pageData || [];
        data.push(...pageRows);
        if (pageRows.length < CHAPTER_FETCH_PAGE_SIZE) {
            break;
        }
    }

    let resolvedSlug = options?.slug || r2MangaSlugById.get(mangaId) || '';
    let fallbackLang = options?.fallbackLanguage || '';

    if (!resolvedSlug || !fallbackLang) {
        try {
            const { data: mangaRow } = await supabase
                .from('mangas')
                .select('slug, title, details, source_links, genres')
                .eq('id', mangaId)
                .maybeSingle();
            if (mangaRow?.slug) {
                resolvedSlug = mangaRow.slug;
                r2MangaSlugById.set(mangaId, resolvedSlug);
            }
            if (!fallbackLang && mangaRow) {
                fallbackLang = getSeriesLanguage(mangaRow as any);
            }
        } catch {
            // ignore
        }
    }
    if (!fallbackLang) {
        fallbackLang = 'tr';
    }

    const mapped = data.map((row: any) => {
        const ch = mapChapterRowToChapter(row, { includePages });
        ch.language = resolveChapterLanguageCode(ch, fallbackLang);
        return ch;
    });

    const needsR2Chapters =
        mapped.length === 0 ||
        (includePages && mapped.some((ch) => !ch.pages || ch.pages.length === 0));

    try {
        if (resolvedSlug && needsR2Chapters) {
            const seriesData = await fetchR2SeriesBySlug(resolvedSlug);
            if (seriesData && Array.isArray(seriesData.chapters)) {
                indexR2SeriesChapters(seriesData, mangaId, resolvedSlug);

                const existingById = new Map<string, Chapter>();
                const existingByNumAndLang = new Map<string, Chapter>();

                for (const ch of mapped) {
                    existingById.set(ch.id, ch);
                    const lang = resolveChapterLanguageCode(ch, fallbackLang);
                    existingByNumAndLang.set(`${ch.number}:${lang}`, ch);
                }

                for (const sc of seriesData.chapters) {
                    const r2Ch = mapChapterRowToChapter(sc, { includePages });
                    const r2Lang = resolveChapterLanguageCode(r2Ch, sc.language || fallbackLang);
                    r2Ch.language = r2Lang;
                    const key = `${r2Ch.number}:${r2Lang}`;

                    const match = existingById.get(r2Ch.id) || existingByNumAndLang.get(key);
                    if (match) {
                        if (includePages && (!match.pages || match.pages.length === 0) && r2Ch.pages.length > 0) {
                            match.pages = r2Ch.pages;
                        }
                        if (!match.language && r2Ch.language) {
                            match.language = r2Ch.language;
                        }
                        if (!match.sourceUrl && r2Ch.sourceUrl) {
                            match.sourceUrl = r2Ch.sourceUrl;
                            match._sourceLink = r2Ch._sourceLink;
                        }
                    } else {
                        existingById.set(r2Ch.id, r2Ch);
                        existingByNumAndLang.set(key, r2Ch);
                        mapped.push(r2Ch);
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`Failed to merge R2 chapters for manga ${mangaId}:`, e);
    }

    mapped.sort((a, b) => {
        if (b.number !== a.number) return b.number - a.number;
        const langA = resolveChapterLanguageCode(a, fallbackLang);
        const langB = resolveChapterLanguageCode(b, fallbackLang);
        if (langA === 'tr' && langB !== 'tr') return -1;
        if (langB === 'tr' && langA !== 'tr') return 1;
        if (langA === 'en' && langB !== 'en') return -1;
        if (langB === 'en' && langA !== 'en') return 1;
        return langA.localeCompare(langB);
    });

    return mapped;
};

export const getChapterPagesByIds = async (chapterIds: string[]): Promise<Record<string, string[]>> => {
    const uniqueIds = [...new Set(chapterIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
        return {};
    }

    const map: Record<string, string[]> = {};
    const idsToQuerySupabase: string[] = [];

    for (const id of uniqueIds) {
        const cachedR2 = r2ChapterMetaById.get(id);
        if (cachedR2 && cachedR2.chapter.pages && cachedR2.chapter.pages.length > 0) {
            map[id] = cachedR2.chapter.pages;
        } else if (!/^c01c0000-[0-9a-f]{4}-4000-8000-\d{12}$/i.test(id)) {
            idsToQuerySupabase.push(id);
        }
    }

    const missingMangaIds = new Set<string>();
    const chapterNumberByChId = new Map<string, number>();

    if (idsToQuerySupabase.length > 0) {
        const chunks = chunkArray(idsToQuerySupabase, 100);
        const chunkResults = await Promise.all(
            chunks.map((chunk) =>
                supabase
                    .from('chapters')
                    .select('id, pages, manga_id, number')
                    .in('id', chunk)
            )
        );

        const data: any[] = [];
        for (const res of chunkResults) {
            if (res.error) throw res.error;
            if (res.data) data.push(...res.data);
        }

        for (const row of data || []) {
            if (typeof row.number === 'number' || !isNaN(Number(row.number))) {
                chapterNumberByChId.set(row.id, Number(row.number));
            }
            const pages = sanitizeChapterPageUrls(row.pages || []);
            if (pages.length > 0) {
                map[row.id] = pages;
            } else if (row.manga_id) {
                missingMangaIds.add(row.manga_id);
            }
        }
    }

    for (const id of uniqueIds) {
        if (!map[id] || map[id].length === 0) {
            const cachedR2 = r2ChapterMetaById.get(id);
            if (cachedR2?.mangaId) {
                missingMangaIds.add(cachedR2.mangaId);
            }
        }
    }

    if (missingMangaIds.size > 0) {
        await Promise.all(
            [...missingMangaIds].map(async (mangaId) => {
                try {
                    let slug = r2MangaSlugById.get(mangaId) || '';
                    if (!slug) {
                        const { data: manga } = await supabase
                            .from('mangas')
                            .select('slug')
                            .eq('id', mangaId)
                            .maybeSingle();
                        if (manga?.slug) {
                            slug = manga.slug;
                            r2MangaSlugById.set(mangaId, slug);
                        }
                    }

                    if (!slug) return;

                    const seriesData = await fetchR2SeriesBySlug(slug);
                    if (!seriesData || !Array.isArray(seriesData.chapters)) return;

                    const pagesByChId = new Map<string, string[]>();
                    const pagesByChNum = new Map<number, string[]>();
                    for (const sc of seriesData.chapters) {
                        const p = sanitizeChapterPageUrls(sc.pages || []);
                        if (sc.id) pagesByChId.set(sc.id, p);
                        const num = Number(sc.chapterNumber ?? sc.number);
                        if (!isNaN(num) && p.length > 0 && !pagesByChNum.has(num)) {
                            pagesByChNum.set(num, p);
                        }
                    }

                    for (const targetId of uniqueIds) {
                        if (!map[targetId] || map[targetId].length === 0) {
                            const num = chapterNumberByChId.get(targetId);
                            const pages = pagesByChId.get(targetId) || (num !== undefined ? pagesByChNum.get(num) : undefined);
                            if (pages && pages.length > 0) {
                                map[targetId] = pages;
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to hydrate chapter pages from R2 series for manga ${mangaId}:`, e);
                }
            })
        );
    }

    return map;
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
    const mangaDetailCacheKey = `${mangaId}:${includePrivate ? 'private' : 'public'}:${includeAdult ? 'adult' : 'safe'}:${options?.includePages === true ? 'pages' : 'meta'}`;
    const cachedMangaDetail = mangaDetailCache.get(mangaDetailCacheKey);
    if (cachedMangaDetail && Date.now() - cachedMangaDetail.fetchedAt < MANGA_DETAIL_CACHE_TTL_MS) {
        return cloneMangaForCache(cachedMangaDetail.value);
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mangaId);
    let query = supabase.from('mangas').select('*');
    if (isUuid) {
        query = query.eq('id', mangaId);
    } else {
        query = query.eq('slug', mangaId);
    }
    const { data: supabaseData, error } = await query.maybeSingle();

    let data = supabaseData;
    if (error && error.code !== 'PGRST116') {
        console.error('Manga detail fetch error:', error);
    }

    if (!data) {
        const shardCandidate = r2ShardSeriesByIdOrSlug.get(mangaId) || r2ShardSeriesByIdOrSlug.get(mangaId.toLowerCase());
        const targetSlug = shardCandidate?.slug || (!isUuid ? mangaId : r2MangaSlugById.get(mangaId));
        const r2SeriesPayload = targetSlug ? await fetchR2SeriesBySlug(targetSlug) : null;
        const r2MangaRaw = r2SeriesPayload?.manga || r2SeriesPayload || shardCandidate;

        if (r2MangaRaw && r2MangaRaw.id && r2MangaRaw.title) {
            data = {
                ...r2MangaRaw,
                id: String(r2MangaRaw.id),
                slug: String(r2MangaRaw.slug || targetSlug || ''),
                title: String(r2MangaRaw.title),
                author: r2MangaRaw.author || 'Bilinmiyor',
                artist: r2MangaRaw.artist || '',
                is_public: r2MangaRaw.is_public ?? r2MangaRaw.isPublic ?? true,
                is_adult: r2MangaRaw.is_adult ?? r2MangaRaw.isAdult ?? false,
                description: r2MangaRaw.description || '',
                cover: r2MangaRaw.cover || '',
                banner: r2MangaRaw.banner || r2MangaRaw.cover || '',
                genres: normalizeGenres(r2MangaRaw.genres || []),
                status: r2MangaRaw.status || 'ongoing',
                type: r2MangaRaw.type || 'manhwa',
                views: 0,
                release_year: r2MangaRaw.release_year ?? r2MangaRaw.releaseYear,
                alternative_titles: r2MangaRaw.alternative_titles || r2MangaRaw.alternativeTitles || [],
                details: r2MangaRaw.details || {},
                source_links: r2MangaRaw.source_links || r2MangaRaw.sourceLinks || [],
                last_updated: r2MangaRaw.last_updated || r2MangaRaw.lastUpdated || new Date().toISOString(),
                created_at: r2MangaRaw.created_at || r2MangaRaw.createdAt || new Date().toISOString(),
            };
        }
    }

    if (!data) {
        return undefined;
    }

    if (!includePrivate && data.is_public === false) {
        return undefined;
    }

    const realMangaId = data.id;
    if (data.slug) {
        r2MangaSlugById.set(realMangaId, data.slug);
    }

    const [
        { data: reviewData },
        chapterRows,
        authorsDetails,
        artistsDetails,
        relatedSeries,
        { count: characterCount },
    ] = await Promise.all([
        supabase.from('reviews').select('*').eq('manga_id', realMangaId),
        getMangaChapters(realMangaId, {
            includePages: options?.includePages === true,
            slug: data.slug,
            fallbackLanguage: getSeriesLanguage(data),
        }),
        getMangaAuthors(realMangaId, options),
        getMangaArtists(realMangaId, options),
        getMangaRelatedSeries(realMangaId, { includePrivate }),
        supabase
            .from('manga_characters')
            .select('manga_id', { count: 'exact', head: true })
            .eq('manga_id', realMangaId),
    ]);

    const r2SeriesData = data.slug && chapterRows.length === 0
        ? await fetchR2SeriesBySlug(data.slug)
        : null;

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

    const r2MangaObj = r2SeriesData?.manga || r2SeriesData || {};
    const mergedAltTitles = Array.from(
        new Set(
            [
                ...(Array.isArray(data.alternative_titles) ? data.alternative_titles : []),
                ...(Array.isArray(r2MangaObj.alternative_titles) ? r2MangaObj.alternative_titles : []),
                ...(Array.isArray(r2MangaObj.alternativeTitles) ? r2MangaObj.alternativeTitles : []),
            ]
                .map((t) => String(t || '').trim())
                .filter((t) => Boolean(t) && t.toLowerCase() !== String(data.title || '').trim().toLowerCase())
        )
    );

    const mergedSourceLinks = normalizeEntitySourceLinks([
        ...(Array.isArray(data.source_links) ? data.source_links : []),
        ...(Array.isArray(r2MangaObj.source_links) ? r2MangaObj.source_links : []),
        ...(Array.isArray(r2MangaObj.sourceLinks) ? r2MangaObj.sourceLinks : []),
    ]);

    const r2CharacterList = Array.isArray(r2SeriesData?.characters) ? r2SeriesData.characters : [];
    const totalCharacterCount = Math.max(characterCount || 0, r2CharacterList.length);

    const uniqueChapterCount = new Set(hydratedChapters.map((c) => Number(c.number))).size || hydratedChapters.length;
    const mergedDetails = { ...(r2MangaObj.details || {}), ...(data.details || {}) };

    const mangaDetail = {
        ...data,
        author: joinNamedEntityValues(authorsDetails.map((author) => author.name)) || cleanPlaceholderNamedEntityString(data.author) || data.author,
        artist: joinNamedEntityValues(artistsDetails.map((artist) => artist.name)) || cleanPlaceholderNamedEntityString(data.artist) || data.artist,
        ...mapMangaBaseFields({
            ...r2MangaObj,
            ...data,
            details: mergedDetails,
            alternative_titles: mergedAltTitles,
        }),
        details: mergedDetails,
        sourceLinks: mergedSourceLinks,
        relatedSeries,
        chapters: hydratedChapters,
        chapterCount: uniqueChapterCount,
        ratings: reviews.map(r => ({
            userId: r.user_id,
            rating: Math.round((r.rating_story + r.rating_characters + r.rating_art + r.rating_progression + r.rating_engagement) / 5),
            createdAt: r.created_at
        })),
        characterCount: totalCharacterCount,
        averageRating: average,
        ratingBreakdown: breakdown,
        reviewCount: reviews.length,
        authorDetails: authorsDetails[0],
        artistDetails: artistsDetails[0],
        authorsDetails,
        artistsDetails,
    } as any;

    mangaDetailCache.set(mangaDetailCacheKey, {
        fetchedAt: Date.now(),
        value: cloneMangaForCache(mangaDetail as Manga),
    });

    return mangaDetail as Manga;
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

const LATEST_CHAPTERS_PERSISTED_SWR_TTL_MS = 10 * 60_000;
const persistedLatestChaptersRefreshInFlight = new Set<MangaAudienceCacheKey>();

const deduplicateLatestChapterItems = (items: LatestChapterFeedItem[]): LatestChapterFeedItem[] => {
    const seenIds = new Set<string>();
    const result: LatestChapterFeedItem[] = [];

    for (const item of items) {
        if (item?.chapterId && !seenIds.has(item.chapterId)) {
            seenIds.add(item.chapterId);
            result.push(item);
        }
    }

    return result;
};

export const getLatestChapters = async (
    limit?: number,
    offset: number = 0,
    options?: { forceRefresh?: boolean },
): Promise<LatestChapterFeedItem[]> => {
    const end = typeof limit === 'number' ? offset + limit - 1 : undefined;
    const normalizedLimit = limit || 30;
    const {
        includePrivate,
        includeAdult,
        visibilityColumnAvailable,
        adultColumnAvailable,
    } = await resolveMangaVisibilityAccess();
    const audienceCacheKey = getMangaAudienceCacheKey(includeAdult);
    const isFirstPageCacheable = !includePrivate && offset === 0 && normalizedLimit === 30;
    const persistedKey = `${PERSISTED_LATEST_CHAPTERS_KEY_PREFIX}${audienceCacheKey}`;

    if (isFirstPageCacheable && !options?.forceRefresh) {
        const cachedFirstPage = latestChaptersFirstPageCache[audienceCacheKey];
        if (cachedFirstPage && Date.now() - cachedFirstPage.fetchedAt < LATEST_CHAPTERS_CACHE_TTL_MS) {
            return cachedFirstPage.value;
        }

        const pendingFirstPage = latestChaptersFirstPagePromise[audienceCacheKey];
        if (pendingFirstPage) {
            return pendingFirstPage;
        }

        const persisted = await readPersistedQueryCache<LatestChapterFeedItem[]>(persistedKey);
        if (persisted && Array.isArray(persisted.value) && persisted.value.length > 0) {
            const age = Date.now() - persisted.fetchedAt;
            if (age < LATEST_CHAPTERS_CACHE_TTL_MS) {
                latestChaptersFirstPageCache[audienceCacheKey] = {
                    fetchedAt: persisted.fetchedAt,
                    value: persisted.value,
                };
                return persisted.value;
            }

            if (age < LATEST_CHAPTERS_PERSISTED_SWR_TTL_MS) {
                latestChaptersFirstPageCache[audienceCacheKey] = {
                    fetchedAt: persisted.fetchedAt,
                    value: persisted.value,
                };

                if (!persistedLatestChaptersRefreshInFlight.has(audienceCacheKey)) {
                    persistedLatestChaptersRefreshInFlight.add(audienceCacheKey);
                    void getLatestChapters(normalizedLimit, 0, { forceRefresh: true })
                        .catch(() => undefined)
                        .finally(() => {
                            persistedLatestChaptersRefreshInFlight.delete(audienceCacheKey);
                        });
                }

                return persisted.value;
            }
        }
    }

    const fetchPage = async (): Promise<LatestChapterFeedItem[]> => {
        const mapRpcRows = (rows: any[]): LatestChapterFeedItem[] => deduplicateLatestChapterItems(
            sortChapterBatchItems(
                rows.map((row: any) => ({
                    chapterId: String(row.chapter_id),
                    mangaId: String(row.manga_id),
                    mangaTitle: String(row.manga_title || ''),
                    mangaCover: String(row.manga_cover || ''),
                    mangaType: row.manga_type || 'manga',
                    chapterNumber: Number(row.chapter_number),
                    chapterTitle: row.chapter_title || undefined,
                    addedAt: row.added_at,
                    releaseDate: row.release_date || undefined,
                    langCode: row.manga_lang_code || undefined,
                } satisfies LatestChapterFeedItem)),
                (chapter) => chapter.addedAt,
                (chapter) => chapter.chapterId,
            ),
        );

        // Fast path: language-enriched RPC avoids N+1 follow-up query to `mangas`
        try {
            const { data: langRpcData, error: langRpcError } = await supabase.rpc('get_latest_chapters_feed_with_lang', {
                p_limit: normalizedLimit,
                p_offset: offset || 0,
                p_include_adult: Boolean(includeAdult),
            });

            if (!langRpcError && Array.isArray(langRpcData) && (langRpcData.length > 0 || offset > 0)) {
                return mapRpcRows(langRpcData);
            }
        } catch (langRpcErr) {
            console.warn('get_latest_chapters_feed_with_lang rpc error, trying legacy RPC:', langRpcErr);
        }

        // Secondary RPC fallback if the with_lang wrapper isn't available yet
        try {
            const { data: rpcData, error: rpcError } = await supabase.rpc('get_latest_chapters_feed', {
                p_limit: normalizedLimit,
                p_offset: offset || 0,
                p_include_adult: Boolean(includeAdult),
            });

            if (!rpcError && Array.isArray(rpcData) && (rpcData.length > 0 || offset > 0)) {
                return mapRpcRows(rpcData);
            }
        } catch (rpcErr) {
            console.warn('get_latest_chapters_feed rpc error, falling back to direct query:', rpcErr);
        }

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
            .order('created_at', { ascending: false });

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

        return deduplicateLatestChapterItems(
            sortChapterBatchItems(
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
                (chapter) => chapter.chapterId,
            ),
        );
    };

    const requestPromise = fetchPage();
    if (isFirstPageCacheable) {
        latestChaptersFirstPagePromise[audienceCacheKey] = requestPromise;
    }

    try {
        const items = await requestPromise;
        if (isFirstPageCacheable && items.length > 0) {
            latestChaptersFirstPageCache[audienceCacheKey] = {
                fetchedAt: Date.now(),
                value: items,
            };
            void writePersistedQueryCache(persistedKey, items);
        }
        return items;
    } finally {
        if (isFirstPageCacheable) {
            delete latestChaptersFirstPagePromise[audienceCacheKey];
        }
    }
};

let latestChaptersFeedStatsCache: { fetchedAt: number; data: { recent_count: number; total_count: number } } | null = null;

export const getLatestChaptersFeedStats = async (): Promise<{ recentChapterCount: number; totalChaptersCount: number }> => {
    if (latestChaptersFeedStatsCache && Date.now() - latestChaptersFeedStatsCache.fetchedAt < 60_000) {
        return {
            recentChapterCount: latestChaptersFeedStatsCache.data.recent_count,
            totalChaptersCount: latestChaptersFeedStatsCache.data.total_count,
        };
    }

    try {
        const { data, error } = await supabase.rpc('get_latest_chapters_feed_stats', { p_hours: 24 });
        if (!error && data) {
            const result = {
                recent_count: Number(data.recent_count) || 0,
                total_count: Number(data.total_count) || 0,
            };
            latestChaptersFeedStatsCache = {
                fetchedAt: Date.now(),
                data: result,
            };
            return {
                recentChapterCount: result.recent_count,
                totalChaptersCount: result.total_count,
            };
        }
    } catch (e) {
        console.error('get_latest_chapters_feed_stats error:', e);
    }

    return { recentChapterCount: 0, totalChaptersCount: 0 };
};

export const getLatestChaptersCountLast24Hours = async (): Promise<number> => {
    const stats = await getLatestChaptersFeedStats();
    return stats.recentChapterCount;
};

export const getTotalLatestChaptersCount = async (): Promise<number> => {
    const stats = await getLatestChaptersFeedStats();
    return stats.totalChaptersCount;
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
            .select(getMangaListSelectColumns(visibilityColumnAvailable, adultColumnAvailable))
            .or(`title.ilike.%${query}%,author.ilike.%${query}%`)
            .limit(100),
        { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
    );

    if (error) return [];
    const rows = (data || []) as any[];
    return rows.map(m => ({
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

export const getAdminAccessContext = async (options?: { forceOnline?: boolean }): Promise<AdminAccessContext> => {
    const forceOnline = options?.forceOnline === true;
    if (!forceOnline && adminAccessContextPromise) {
        return adminAccessContextPromise;
    }

    const request = (async () => {
        // NOT: admin erişim kontrolü local session'dan başlar. Ağdaki /auth/v1/user
        // çağrısı yavaş olduğunda 5 sn timeout alıp yöneticiyi panelden atıyordu.
        // Yetkinin gerçek doğrulaması aşağıdaki admin-user-directory edge çağrısında yapılır.
        const { data: sessionData, error: authError } = await supabase.auth.getSession();
        const authUser = sessionData.session?.user ?? null;

        if (authError || !authUser) {
            return {
                canAccessAdminPanel: false,
                isPrimaryAdmin: false,
            };
        }

        const authUserId = authUser.id;

        if (!forceOnline) {
            const cached = getCachedAdminAccessContext(authUserId);
            if (cached) {
                return cached;
            }
        }

        const persist = (value: AdminAccessContext) => {
            adminAccessContextCache = {
                authUserId,
                value,
            };
            writePersistedAdminAccessContext(authUserId, value);

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
                isPrimaryAdmin: buildPrimaryAdminFallback(authUser.email, role),
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
                    isPrimaryAdmin: buildPrimaryAdminFallback(authUser.email, role),
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

    if (!forceOnline) {
        adminAccessContextPromise = request;
    }

    try {
        return await request;
    } finally {
        if (adminAccessContextPromise === request) {
            adminAccessContextPromise = null;
        }
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
    const reason = options.reason ?? 'YÃ¶netici tarafÄ±ndan banlandÄ±.';

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

export const getRecentAdminMangas = async (limit = 5): Promise<Manga[]> => {
    const { data, error } = await supabase
        .from('mangas')
        .select(`${MANGA_SUMMARY_BASE_SELECT_COLUMNS}, is_public, is_adult`)
        .order('last_updated', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return (data || []).map((m: any) => {
        const precomputedChapters = Array.isArray(m.latest_chapters)
            ? m.latest_chapters
                .map((ch: any) => ({ id: String(ch?.id || ''), number: Number(ch?.number) || 1 }))
                .filter((ch: any) => ch.id)
            : [];
        return {
            ...m,
            author: cleanPlaceholderNamedEntityString(m.author) || m.author,
            artist: cleanPlaceholderNamedEntityString(m.artist) || m.artist,
            ...mapMangaBaseFields(m),
            chapters: precomputedChapters,
            chapterCount: Number(m.chapter_count ?? m.chapterCount) || precomputedChapters.length || 0,
            ratings: [],
            averageRating: 0,
            reviewCount: 0,
        } as Manga;
    });
};

export const getStatistics = async () => {
    const { data: rpcStats, error: rpcError } = await supabase.rpc('get_admin_dashboard_stats');
    if (!rpcError && rpcStats && typeof rpcStats === 'object') {
        const s = rpcStats as Record<string, any>;
        const byType = (s.mangasByType || {}) as Record<string, number>;
        const byStatus = (s.mangasByStatus || {}) as Record<string, number>;
        return {
            totalMangas: Number(s.totalMangas) || 0,
            totalChapters: Number(s.totalChapters) || 0,
            totalViews: Number(s.totalViews) || 0,
            totalComments: Number(s.totalComments) || 0,
            totalUsers: Number(s.totalUsers) || 0,
            mangasByType: {
                manga: Number(byType.manga) || 0,
                manhwa: Number(byType.manhwa) || 0,
                manhua: Number(byType.manhua) || 0,
                webtoon: Number(byType.webtoon) || 0,
                hentai: Number(byType.hentai) || 0,
                webtoon_hentai: Number(byType.webtoon_hentai) || 0,
            },
            mangasByStatus: {
                ongoing: Number(byStatus.ongoing) || 0,
                completed: Number(byStatus.completed) || 0,
                hiatus: Number(byStatus.hiatus) || 0,
            },
        };
    }

    // NOT: bu istatistikler gÃ¶sterim amaÃ§lÄ±; count:'exact' tÃ¼m tabloyu sayÄ±yordu.
    // 'planned' (planner tahmini) ile hÄ±zlÄ± dÃ¶nÃ¼yor.
    const [
        { count: mangaCount },
        { count: commentCount },
        { count: userCount },
        { data: mangaData },
    ] = await Promise.all([
        supabase.from('mangas').select('id', { count: 'planned', head: true }),
        supabase.from('comments').select('id', { count: 'planned', head: true }),
        supabase.from('users').select('id', { count: 'planned', head: true }),
        supabase.from('mangas').select('type, status, views, chapter_count'),
    ]);

    const totalViews = mangaData?.reduce((sum, m: any) => sum + (m.views || 0), 0) || 0;
    const chapterCount = mangaData?.reduce((sum, m: any) => sum + (m.chapter_count || 0), 0) || 0;

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
        console.error('Yorum dÃ¼zenleme Ã¶n kontrol hatasÄ±:', existingCommentError);
        throw existingCommentError;
    }

    const editDeadline = new Date(existingComment.created_at).getTime() + (24 * 60 * 60 * 1000);
    if (Date.now() > editDeadline) {
        throw new Error('Yorumlar yalnÄ±zca ilk 24 saat iÃ§inde dÃ¼zenlenebilir');
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
        console.error('Yorum gÃ¼ncelleme hatasÄ±:', error);
        throw error;
    }
};

export const deleteComment = async (id: string, entityType: string = 'manga'): Promise<void> => {
    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const { error } = await supabase.from(tableName as any).delete().eq('id', id);
    if (error) {
        console.error('Yorum silme hatasÄ±:', error);
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
        `, { count: 'planned' })
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
        `, { count: 'planned' })
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
        console.error('Yorum sabitleme hatasÄ±:', error);
        throw error;
    }

    const tableName = entityType === 'manga' ? 'comments' : `${entityType}_comments`;
    const { error: fallbackError } = await supabase
        .from(tableName as any)
        .update({ is_pinned: isPinned } as any)
        .eq('id', id);

    if (fallbackError) {
        console.error('Yorum sabitleme hatasÄ±:', fallbackError);
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
        throw new Error('Ä°nceleme bulunamadÄ±');
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
            throw new Error('Ä°nceleme bildirme sistemi birkaÃ§ saniye iÃ§inde aktif olacak. SayfayÄ± yenileyip tekrar deneyin.');
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

    const chunks = chunkArray(uniqueMangaIds, 100);
    const results = await Promise.all(
        chunks.map((chunk) =>
            supabase
                .from('mangas')
                .select('id, title, alternative_titles, cover, banner, author, artist, status, genres, description, type, views, last_updated, created_at, is_public, is_adult, chapter_count')
                .in('id', chunk)
        )
    );
    const mangaRows: any[] = [];
    let mangaError: any = null;
    for (const res of results) {
        if (res.error) mangaError = res.error;
        if (res.data) mangaRows.push(...res.data);
    }

    if (mangaError || mangaRows.length === 0) {
        if (mangaError) {
            console.error('Reading list manga summary fetch error:', mangaError);
        }
        return {} as Record<string, ReturnType<typeof mapMangaToCachedReadingListItem>>;
    }

    return mangaRows.reduce<Record<string, ReturnType<typeof mapMangaToCachedReadingListItem>>>((map, manga: any) => {
        map[manga.id] = mapMangaToCachedReadingListItem({
            id: manga.id,
            title: manga.title,
            ...mapMangaBaseFields(manga),
            cover: manga.cover,
            banner: manga.banner,
            author: cleanPlaceholderNamedEntityString(manga.author) || manga.author,
            artist: cleanPlaceholderNamedEntityString(manga.artist) || manga.artist,
            status: manga.status,
            genres: manga.genres || [],
            description: manga.description || '',
            ratings: [],
            views: manga.views || 0,
            chapters: [],
            chapterCount: Number(manga.chapter_count ?? manga.chapterCount) || 0,
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
        .select(getMangaListSelectColumns(true, true))
        .in('id', mangaIds);

    if (mangaError || !mangaData) return [];

    const rows = mangaData as any[];
    return rows.map(m => ({
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

        // NOT: select('*') yerine hafif kolon seti + limitsiz tablo Ã§ekimine karÅŸÄ± limit.
        // chapter sayÄ±larÄ± ayrÄ±ca tÃ¼m chapters tablosundan deÄŸil, mangas.chapter_count'tan gelir.
        const { data, error } = await applyPublicMangaFilter(
            supabase
                .from('mangas')
                .select(getMangaListSelectColumns(visibilityColumnAvailable, adultColumnAvailable))
                .neq('id', mangaId)
                .limit(1000),
            { includePrivate, includeAdult, visibilityColumnAvailable, adultColumnAvailable },
        );

        if (error || !data) return [];
        const mangaRows = data as any[];

        // Get reviews for average ratings
        const { data: revData } = await supabase
            .from('reviews')
            .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement');
        const allReviews = revData || [];

        // Calculate similarity score and map data
        const scoredMangas = mangaRows.map((m: any) => {
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

            const chapterCount = Number((m as any).chapter_count ?? (m as any).chapterCount) || 0;

            return {
                manga: {
                    ...m,
                    ...mapMangaBaseFields(m),
                    chapters: Array(chapterCount).fill({}),
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
        imageUrl: sanitizeEntityImageUrl(row.image_url || (row as any).imageUrl || (row as any).image),
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

let characterSeriesMapCache: { fetchedAt: number; data: Record<string, string> } | null = null;
const CHARACTER_SERIES_MAP_TTL_MS = 1000 * 60 * 30;

export const getCharacterSeriesMap = async (): Promise<Record<string, string>> => {
    if (characterSeriesMapCache && Date.now() - characterSeriesMapCache.fetchedAt < CHARACTER_SERIES_MAP_TTL_MS) {
        return characterSeriesMapCache.data;
    }

    const persistedKey = 'character-series-map-v1';
    const persisted = await readPersistedQueryCache<Record<string, string>>(persistedKey);
    if (persisted?.value && Date.now() - persisted.fetchedAt < CHARACTER_SERIES_MAP_TTL_MS) {
        characterSeriesMapCache = { fetchedAt: persisted.fetchedAt, data: persisted.value };
        return persisted.value;
    }

    try {
        const { data: relations, error } = await supabase
            .from('manga_characters')
            .select('character_id, manga_id');

        if (error || !relations) {
            return characterSeriesMapCache?.data || {};
        }

        const mangas = await getAllMangas();
        const mangaTitleMap = new Map<string, string>();
        for (const m of mangas) {
            if (m.id && m.title) {
                mangaTitleMap.set(m.id, m.title);
            }
        }

        const mapping: Record<string, string> = {};
        for (const rel of relations) {
            if (rel.character_id && rel.manga_id && !mapping[rel.character_id]) {
                const title = mangaTitleMap.get(rel.manga_id);
                if (title) {
                    mapping[rel.character_id] = title;
                }
            }
        }

        characterSeriesMapCache = { fetchedAt: Date.now(), data: mapping };
        void writePersistedQueryCache(persistedKey, mapping);
        return mapping;
    } catch (err) {
        console.warn('getCharacterSeriesMap error:', err);
        return characterSeriesMapCache?.data || {};
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
                mangas:manga_characters(manga:mangas(id))
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

    const supabaseCharacters = (!error && Array.isArray(data) ? data : [])
        .map((entry: any) => {
            if (!entry.character) {
                return null;
            }

            return mapCharacterRow(entry.character, {
                listingRole: normalizeCharacterListingRole(entry.listing_role),
            });
        })
        .filter((character: any) => character && (options?.includePrivate || character.isPublic !== false)) as Character[];

    try {
        let slug = r2MangaSlugById.get(mangaId) || '';
        if (!slug) {
            const { data: mangaRow } = await supabase
                .from('mangas')
                .select('slug')
                .eq('id', mangaId)
                .maybeSingle();
            if (mangaRow?.slug) {
                slug = mangaRow.slug;
                r2MangaSlugById.set(mangaId, slug);
            }
        }
        if (slug) {
            const r2Series = await fetchR2SeriesBySlug(slug);
            if (Array.isArray(r2Series?.characters) && r2Series.characters.length > 0) {
                const seenKeys = new Set(supabaseCharacters.map((c) => normalizeNamedEntityKey(c.name)));
                for (const rawChar of r2Series.characters) {
                    if (!rawChar || !rawChar.name) continue;
                    const key = normalizeNamedEntityKey(rawChar.name);
                    if (key && !seenKeys.has(key)) {
                        seenKeys.add(key);
                        supabaseCharacters.push(
                            mapCharacterRow(rawChar, {
                                listingRole: normalizeCharacterListingRole(rawChar.listing_role || rawChar.listingRole || rawChar.role),
                            })
                        );
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`Failed to merge R2 characters for manga ${mangaId}:`, e);
    }

    return supabaseCharacters.sort((left, right) => {
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
        imageUrl: sanitizeEntityImageUrl(row.image_url || (row as any).imageUrl || (row as any).image),
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
        imageUrl: sanitizeEntityImageUrl(row.image_url || (row as any).imageUrl || (row as any).image),
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
            .select(`*, mangas:manga_authors(manga:mangas(id))`)
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
            .select(`*, mangas:manga_artists(manga:mangas(id))`)
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

    const chunks = chunkArray(mangaIds, 100);
    const chunkResults = await Promise.all(
        chunks.map((chunk) =>
            supabase
                .from('manga_authors')
                .select('manga_id, author:authors(*)')
                .in('manga_id', chunk)
        )
    );

    const authorsByMangaId = new Map<string, Author[]>();

    for (const { data, error } of chunkResults) {
        if (error) {
            console.error('Manga authors batch fetch error:', error);
            continue;
        }

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
    }

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

    const chunks = chunkArray(mangaIds, 100);
    const chunkResults = await Promise.all(
        chunks.map((chunk) =>
            supabase
                .from('manga_artists')
                .select('manga_id, artist:artists(*)')
                .in('manga_id', chunk)
        )
    );

    const artistsByMangaId = new Map<string, Artist[]>();

    for (const { data, error } of chunkResults) {
        if (error) {
            console.error('Manga artists batch fetch error:', error);
            continue;
        }

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
    }

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

const buildHomePageSectionsFromCollection = (mangas: Manga[]): HomePageMangaSections => {
    const active = mangas.filter((m) => (m.chapterCount || 0) > 0 || (m.chapters?.length || 0) > 0);
    const pool = active.length > 0 ? active : mangas;
    return {
        trendingManga: [...pool]
            .sort((a, b) => (b.views || 0) - (a.views || 0))
            .slice(0, HOME_PAGE_SECTION_LIMITS.trending),
        newlyAddedSeries: [...pool]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, HOME_PAGE_SECTION_LIMITS.newlyAdded),
        recentlyUpdated: [...pool]
            .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
            .slice(0, HOME_PAGE_SECTION_LIMITS.recentlyUpdated),
    };
};

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
    const fetchReviewsForIds = async (ids: string[]) => {
        if (ids.length === 0) return { data: [], error: null };
        if (ids.length <= 100) {
            return supabase
                .from('reviews')
                .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
                .in('manga_id', ids);
        }
        const chunks = chunkArray(ids, 100);
        const results = await Promise.all(
            chunks.map((chunk) =>
                supabase
                    .from('reviews')
                    .select('manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement')
                    .in('manga_id', chunk)
            )
        );
        const data: any[] = [];
        let firstError: any = null;
        for (const res of results) {
            if (res.error) firstError = res.error;
            if (res.data) data.push(...res.data);
        }
        return { data, error: firstError };
    };

    const hasPrecomputedChapters = visibleRows.every(
        (row: any) => Array.isArray(row?.latest_chapters) || typeof row?.chapter_count === 'number',
    );
    const shouldFetchEntityRelations = Boolean((options as any)?.includeEntityRelations);

    const [
        { data: reviewRows, error: reviewError },
        chapterRows,
        nextAuthorsByMangaId,
        nextArtistsByMangaId,
    ] = await Promise.all([
        fetchReviewsForIds(mangaIds),
        hasPrecomputedChapters
            ? Promise.resolve([] as any[])
            : fetchAllChapterMetaRows('id, manga_id, number', {
                mangaIds,
                orderByNumberAscending: false,
            }).catch((chapterError) => {
                if (!isExpectedAccessControlError(chapterError)) {
                    console.error(`${logContext} chapter aggregate fetch error:`, chapterError);
                }
                return [];
            }),
        shouldFetchEntityRelations
            ? getMangaAuthorsByIds(mangaIds, { includePrivate: options?.includePrivate })
            : Promise.resolve(new Map<string, Author[]>()),
        shouldFetchEntityRelations
            ? getMangaArtistsByIds(mangaIds, { includePrivate: options?.includePrivate })
            : Promise.resolve(new Map<string, Artist[]>()),
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
        const precomputedChapters = Array.isArray(manga.latest_chapters)
            ? manga.latest_chapters
                .map((ch: any) => ({ id: String(ch?.id || ''), number: Number(ch?.number) || 1 }))
                .filter((ch: any) => ch.id)
            : [];
        const finalChapters = precomputedChapters.length > 0
            ? precomputedChapters
            : (latestChapterPreviewsByMangaId.get(manga.id) || []);

        return {
            ...manga,
            author: joinNamedEntityValues(authorsDetails.map((author) => author.name)) || cleanPlaceholderNamedEntityString(manga.author) || manga.author,
            artist: joinNamedEntityValues(artistsDetails.map((artist) => artist.name)) || cleanPlaceholderNamedEntityString(manga.artist) || manga.artist,
            ...mapMangaBaseFields(manga),
            chapters: finalChapters,
            ratings: [],
            chapterCount: chapterCountByMangaId.get(manga.id) || Number(manga.chapter_count ?? manga.chapterCount) || finalChapters.length || 0,
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

const TAGS_LIST_CACHE_TTL_MS = 5 * 60_000;
const TRENDING_TAGS_CACHE_TTL_MS = 2 * 60_000;

export const getAllTags = async (options?: { includePending?: boolean }): Promise<Tag[]> => {
    const cacheKey = options?.includePending ? 'all' : 'public';
    const cached = tagsListCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < TAGS_LIST_CACHE_TTL_MS) {
        return cached.value;
    }

    const pending = tagsListPromises.get(cacheKey);
    if (pending) {
        return pending;
    }

    const request = (async (): Promise<Tag[]> => {
        let query = supabase
            .from('tags')
            .select('*')
            .order('usage_count', { ascending: false });

        if (!options?.includePending) {
            query = query.or(COMMUNITY_VISIBLE_TAG_FILTER);
        }

        const { data, error } = await query;

        if (error) return [];
        const tags = filterGloballyAvailableTagRows(data || [], options?.includePending).map((tag) => mapTagRow(tag));
        tagsListCache.set(cacheKey, {
            fetchedAt: Date.now(),
            value: tags,
        });
        return tags;
    })();

    tagsListPromises.set(cacheKey, request);
    try {
        return await request;
    } finally {
        tagsListPromises.delete(cacheKey);
    }
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

    invalidateTagCaches();

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
    invalidateTagCaches();
};

export const deleteTag = async (tagId: string): Promise<void> => {
    const { error } = await supabase.from('tags').delete().eq('id', tagId);
    if (error) throw error;
    invalidateTagCaches();
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
    const cacheKey = `${limit}:${Boolean(options?.includePending)}`;
    const cached = trendingTagsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < TRENDING_TAGS_CACHE_TTL_MS) {
        return cached.value;
    }

    const pending = trendingTagsPromises.get(cacheKey);
    if (pending) {
        return pending;
    }

    const request = (async (): Promise<Tag[]> => {
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
        const tags = filterGloballyAvailableTagRows(data || [], options?.includePending).map((tag) => mapTagRow(tag));
        trendingTagsCache.set(cacheKey, {
            fetchedAt: Date.now(),
            value: tags,
        });
        return tags;
    })();

    trendingTagsPromises.set(cacheKey, request);
    try {
        return await request;
    } finally {
        trendingTagsPromises.delete(cacheKey);
    }
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

    const seenItemIds = new Set<string>();
    const uniqueRawData = rawData.filter((item: any) => {
        const id = typeof item?.id === 'string' ? item.id : null;
        if (!id || seenItemIds.has(id)) {
            return false;
        }
        seenItemIds.add(id);
        return true;
    });

    return uniqueRawData
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

type TopTenPageData = Record<'safe' | 'adult', Record<TopTenTimeframe, Manga[]>>;

let persistedTopTenRefreshInFlight = false;

const createEmptyTopTenPageData = (): TopTenPageData => ({
    safe: { today: [], week: [], all: [] },
    adult: { today: [], week: [], all: [] },
});

const mapTopTenBucketRows = (rows: unknown, audience: 'safe' | 'adult'): Manga[] => {
    const rawRows = Array.isArray(rows) ? rows : [];
    if (rawRows.length === 0) {
        return [];
    }

    return buildAudienceTopTen(
        rawRows.map((row) => mapSummaryRowToManga(row)),
        rawRows,
        audience,
    );
};

export const getTopTenPageData = async (
    options?: { forceRefresh?: boolean },
): Promise<TopTenPageData> => {
    if (!options?.forceRefresh) {
        if (topTenPageDataCache && Date.now() - topTenPageDataCache.fetchedAt < TOP_TEN_PAGE_CACHE_TTL_MS) {
            return topTenPageDataCache.value;
        }

        if (topTenPageDataPromise) {
            return topTenPageDataPromise;
        }

        const persisted = await readPersistedQueryCache<TopTenPageData>(PERSISTED_TOP_TEN_PAGE_KEY);
        if (
            persisted &&
            persisted.value?.safe &&
            persisted.value?.adult &&
            (persisted.value.safe.today.length > 0 ||
                persisted.value.safe.all.length > 0 ||
                persisted.value.adult.today.length > 0 ||
                persisted.value.adult.all.length > 0)
        ) {
            const age = Date.now() - persisted.fetchedAt;
            topTenPageDataCache = {
                fetchedAt: persisted.fetchedAt,
                value: persisted.value,
            };

            if (age < TOP_TEN_PAGE_CACHE_TTL_MS) {
                return persisted.value;
            }

            if (age < PERSISTED_CATALOG_CACHE_TTL_MS) {
                if (!persistedTopTenRefreshInFlight) {
                    persistedTopTenRefreshInFlight = true;
                    void getTopTenPageData({ forceRefresh: true })
                        .catch(() => undefined)
                        .finally(() => {
                            persistedTopTenRefreshInFlight = false;
                        });
                }
                return persisted.value;
            }
        }
    }

    const requestPromise = (async (): Promise<TopTenPageData> => {
        try {
            const { data, error } = await supabase.rpc('get_top_ten_page_data');
            if (error || !data || typeof data !== 'object') {
                if (error) {
                    console.error('getTopTenPageData rpc error:', error);
                }
                return createEmptyTopTenPageData();
            }

            const payload = data as any;
            const mapped: TopTenPageData = {
                safe: {
                    today: mapTopTenBucketRows(payload.safe?.today, 'safe'),
                    week: mapTopTenBucketRows(payload.safe?.week, 'safe'),
                    all: mapTopTenBucketRows(payload.safe?.all, 'safe'),
                },
                adult: {
                    today: mapTopTenBucketRows(payload.adult?.today, 'adult'),
                    week: mapTopTenBucketRows(payload.adult?.week, 'adult'),
                    all: mapTopTenBucketRows(payload.adult?.all, 'adult'),
                },
            };

            const hasAnyEntries =
                mapped.safe.today.length > 0 ||
                mapped.safe.week.length > 0 ||
                mapped.safe.all.length > 0 ||
                mapped.adult.today.length > 0 ||
                mapped.adult.week.length > 0 ||
                mapped.adult.all.length > 0;

            if (hasAnyEntries) {
                topTenPageDataCache = {
                    fetchedAt: Date.now(),
                    value: mapped,
                };
                void writePersistedQueryCache(PERSISTED_TOP_TEN_PAGE_KEY, mapped);
            }

            return mapped;
        } catch (error) {
            console.error('getTopTenPageData exception:', error);
            return createEmptyTopTenPageData();
        }
    })();

    topTenPageDataPromise = requestPromise;
    try {
        return await requestPromise;
    } finally {
        if (topTenPageDataPromise === requestPromise) {
            topTenPageDataPromise = null;
        }
    }
};

export const getTopTenPageBuckets = async (
    timeframe: 'today' | 'week' | 'all' = 'today',
): Promise<{ safe: Manga[]; adult: Manga[] }> => {
    try {
        const pageData = await getTopTenPageData();
        return {
            safe: pageData.safe[timeframe] || [],
            adult: pageData.adult[timeframe] || [],
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
            let { data, error } = await supabase.rpc('get_top_engaged_manga_ids', { time_filter: timeframe });
            if (error) {
                ({ data, error } = await supabase.rpc('get_top_engaged_mangas', { time_filter: timeframe }));
            }
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
