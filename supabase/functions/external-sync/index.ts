import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  createServiceClient,
  json,
  requireRequester,
} from "../_shared/auth.ts";
import {
  buildSiteRedirectUrl,
  clearProviderAccountError,
  createPkceVerifier,
  createProviderAuthorizeUrl,
  createRandomToken,
  ensureProviderAccessToken,
  exchangeAuthorizationCode,
  ExternalProviderAccountRow,
  ExternalSyncProvider,
  getProviderLink,
  getProviderMediaId,
  getProviderViewer,
  normalizeProvider,
  runAniListGraphQL,
  saveMyAnimeListMangaListStatus,
  setProviderAccountError,
  toAniListFuzzyDate,
  toDateOnly,
} from "../_shared/external-sync.ts";

type LocalLibraryStatus = "reading" | "plan_to_read" | "completed" | "on_hold" | "dropped";
type SyncTrigger = "manual" | "reading" | "category" | "favorite" | "rating" | "review";

const DEFAULT_EXTERNAL_SYNC_PREFERENCES = {
  global: {
    autoSync: true,
    disableWhileIncognito: true,
  },
  providers: {
    myanimelist: {
      enabled: true,
      connected: false,
      fieldToggles: {
        status: true,
        progress: true,
        score: true,
        dates: true,
      },
    },
    anilist: {
      enabled: true,
      connected: false,
      fieldToggles: {
        status: true,
        progress: true,
        score: true,
        dates: true,
        favorite: true,
      },
    },
  },
} as const;

const normalizeText = (value?: string | null) => value?.trim().replace(/\s+/g, " ") || "";
const REVIEW_SCORE_FIELDS = [
  "rating_story",
  "rating_characters",
  "rating_art",
  "rating_progression",
  "rating_engagement",
] as const;

const toFiniteScore = (value: unknown) => {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 10) / 10 : null;
};

const getReviewAverageScore = (review: any) => {
  const scores = REVIEW_SCORE_FIELDS
    .map((field) => toFiniteScore(review?.[field]))
    .filter((value): value is number => typeof value === "number");

  if (scores.length === 0) {
    return null;
  }

  return Math.round((scores.reduce((total, value) => total + value, 0) / scores.length) * 10) / 10;
};

const toTimestamp = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const toNullableBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  if (typeof value === "string") {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return null;
};

const getAniListGraphQLErrorMessage = (
  response?: { errors?: Array<{ message?: string }> } | null,
) => {
  const messages = (response?.errors || [])
    .map((item) => normalizeText(item?.message))
    .filter(Boolean);

  return messages.length > 0 ? messages.join(" | ") : "";
};

const getPreferredLocalScore = (params: {
  ratingRow?: { rating?: number | null; created_at?: string | null } | null;
  reviewRow?: {
    updated_at?: string | null;
    created_at?: string | null;
    rating_story?: number | null;
    rating_characters?: number | null;
    rating_art?: number | null;
    rating_progression?: number | null;
    rating_engagement?: number | null;
  } | null;
}) => {
  const ratingScore = toFiniteScore(params.ratingRow?.rating);
  const reviewScore = getReviewAverageScore(params.reviewRow);

  if (typeof reviewScore !== "number") {
    return ratingScore;
  }

  if (typeof ratingScore !== "number") {
    return reviewScore;
  }

  const ratingUpdatedAt = toTimestamp(params.ratingRow?.created_at);
  const reviewUpdatedAt = toTimestamp(params.reviewRow?.updated_at || params.reviewRow?.created_at);

  if (ratingUpdatedAt !== null && reviewUpdatedAt !== null && ratingUpdatedAt > reviewUpdatedAt) {
    return ratingScore;
  }

  return reviewScore;
};

const getProviderScore = (provider: ExternalSyncProvider, score?: number | null) => {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }

  const boundedScore = Math.min(10, Math.max(0, score));
  if (provider === "myanimelist") {
    return Math.floor(boundedScore);
  }

  return Math.round(boundedScore * 10) / 10;
};

const MAL_API_BASE_URL = "https://api.myanimelist.net/v2";
const IMPORT_UPSERT_BATCH_SIZE = 200;
const IMPORT_CHAPTER_PROGRESS_BATCH_SIZE = 500;

type AniListMediaListStatus =
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "PAUSED"
  | "DROPPED"
  | "REPEATING";

type RemoteImportEntry = {
  remoteMediaId: string;
  fallbackMyAnimeListId?: string | null;
  title: string;
  status: LocalLibraryStatus | null;
  progress: number;
  score: number | null;
  startedAt: string | null;
  completedAt: string | null;
  favorite: boolean | null;
  totalChapters: number | null;
};

type ImportableMangaRow = {
  id: string;
  title?: string | null;
  source_links?: unknown;
};

type ImportableChapterRow = {
  id: string;
  manga_id: string;
  number: number;
  pages?: string[] | null;
};

type ExternalLibraryImportResponse = {
  success: boolean;
  provider: ExternalSyncProvider;
  totalRemoteEntries: number;
  matchedEntries: number;
  unmatchedEntries: number;
  summary: {
    libraryImported: number;
    ratingsImported: number;
    progressImported: number;
    syncStateUpdated: number;
    skippedExistingLibrary: number;
    skippedExistingRatings: number;
    skippedExistingProgress: number;
  };
  unmatchedTitles: string[];
};

const chunkArray = <T,>(items: T[], size: number) => {
  if (items.length === 0) {
    return [] as T[][];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const toDateOnlyFromAniListFuzzy = (
  value?: { year?: number | null; month?: number | null; day?: number | null } | null,
) => {
  const year = Number(value?.year || 0);
  const month = Number(value?.month || 0);
  const day = Number(value?.day || 0);

  if (!year || !month || !day) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const mapMyAnimeListStatusToLocal = (status?: string | null): LocalLibraryStatus | null => {
  const normalized = normalizeText(status).toLowerCase();
  switch (normalized) {
    case "reading":
      return "reading";
    case "plan_to_read":
      return "plan_to_read";
    case "completed":
      return "completed";
    case "on_hold":
      return "on_hold";
    case "dropped":
      return "dropped";
    default:
      return null;
  }
};

const mapAniListStatusToLocal = (status?: string | null): LocalLibraryStatus | null => {
  const normalized = normalizeText(status).toUpperCase();
  switch (normalized as AniListMediaListStatus) {
    case "CURRENT":
      return "reading";
    case "PLANNING":
      return "plan_to_read";
    case "COMPLETED":
      return "completed";
    case "PAUSED":
      return "on_hold";
    case "DROPPED":
      return "dropped";
    case "REPEATING":
      return "reading";
    default:
      return null;
  }
};

const normalizeImportProgressCount = (value: unknown, totalChapters?: number | null) => {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  const clampedValue = Math.max(0, Math.floor(numericValue));
  if (typeof totalChapters === "number" && Number.isFinite(totalChapters) && totalChapters > 0) {
    return Math.min(clampedValue, Math.floor(totalChapters));
  }

  return clampedValue;
};

const getPageCountForImportedChapter = (chapter?: Pick<ImportableChapterRow, "pages"> | null) => {
  if (!Array.isArray(chapter?.pages) || chapter.pages.length === 0) {
    return 1;
  }

  return chapter.pages.length;
};

const getLocalSourceMaps = (mangaRows: ImportableMangaRow[]) => {
  const byMyAnimeListId = new Map<string, ImportableMangaRow>();
  const byAniListId = new Map<string, ImportableMangaRow>();

  for (const mangaRow of mangaRows) {
    const malId = getProviderMediaId(getProviderLink(mangaRow.source_links, "myanimelist"));
    if (malId) {
      byMyAnimeListId.set(malId, mangaRow);
    }

    const aniListId = getProviderMediaId(getProviderLink(mangaRow.source_links, "anilist"));
    if (aniListId) {
      byAniListId.set(aniListId, mangaRow);
    }
  }

  return {
    byMyAnimeListId,
    byAniListId,
  };
};

const fetchMyAnimeListImportEntries = async (accessToken: string): Promise<RemoteImportEntry[]> => {
  const entries: RemoteImportEntry[] = [];
  let nextUrl = `${MAL_API_BASE_URL}/users/@me/mangalist?limit=1000&nsfw=true&fields=list_status,num_chapters`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const payload = await response.json().catch(() => null) as {
      data?: Array<{
        node?: {
          id?: number | null;
          title?: string | null;
          num_chapters?: number | null;
        } | null;
        list_status?: {
          status?: string | null;
          num_chapters_read?: number | null;
          score?: number | null;
          start_date?: string | null;
          finish_date?: string | null;
        } | null;
      }> | null;
      paging?: {
        next?: string | null;
      } | null;
      message?: string;
      error?: string;
    } | null;

    if (!response.ok) {
      const message = normalizeText(payload?.message || payload?.error)
        || `MyAnimeList liste verisi alinamadi (${response.status})`;
      throw new Error(message);
    }

    for (const item of payload?.data || []) {
      const mediaId = normalizeText(String(item?.node?.id || ""));
      if (!mediaId) {
        continue;
      }

      entries.push({
        remoteMediaId: mediaId,
        title: normalizeText(item?.node?.title) || `Manga #${mediaId}`,
        status: mapMyAnimeListStatusToLocal(item?.list_status?.status),
        progress: normalizeImportProgressCount(item?.list_status?.num_chapters_read, item?.node?.num_chapters ?? null),
        score: toFiniteScore(item?.list_status?.score),
        startedAt: toDateOnly(item?.list_status?.start_date) || null,
        completedAt: toDateOnly(item?.list_status?.finish_date) || null,
        favorite: null,
        totalChapters: Number.isFinite(Number(item?.node?.num_chapters))
          ? Math.max(0, Math.floor(Number(item?.node?.num_chapters)))
          : null,
      });
    }

    nextUrl = normalizeText(payload?.paging?.next);
  }

  return entries;
};

const fetchAniListImportEntries = async (
  accessToken: string,
  providerUserId?: string | null,
): Promise<RemoteImportEntry[]> => {
  const viewerId = Number(providerUserId || 0);
  const entriesByMediaId = new Map<string, RemoteImportEntry>();
  const response = await runAniListGraphQL<{
    data?: {
      MediaListCollection?: {
        lists?: Array<{
          entries?: Array<{
            status?: AniListMediaListStatus | null;
            progress?: number | null;
            score?: number | null;
            startedAt?: { year?: number | null; month?: number | null; day?: number | null } | null;
            completedAt?: { year?: number | null; month?: number | null; day?: number | null } | null;
            media?: {
              id?: number | null;
              idMal?: number | null;
              chapters?: number | null;
              isFavourite?: boolean | null;
              title?: {
                userPreferred?: string | null;
                romaji?: string | null;
                english?: string | null;
                native?: string | null;
              } | null;
            } | null;
          }> | null;
        }> | null;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  }>(
    accessToken,
    `
      query ToonParrotImportAniListMangaLibrary($userId: Int) {
        MediaListCollection(userId: $userId, type: MANGA) {
          lists {
            entries {
              status
              progress
              score(format: POINT_10_DECIMAL)
              startedAt {
                year
                month
                day
              }
              completedAt {
                year
                month
                day
              }
              media {
                id
                idMal
                chapters
                isFavourite
                title {
                  userPreferred
                  romaji
                  english
                  native
                }
              }
            }
          }
        }
      }
    `,
    viewerId > 0 ? { userId: viewerId } : {},
  );

  const errorMessage = getAniListGraphQLErrorMessage(response);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  for (const list of response?.data?.MediaListCollection?.lists || []) {
    for (const entry of list?.entries || []) {
      const mediaId = normalizeText(String(entry?.media?.id || ""));
      if (!mediaId) {
        continue;
      }

      const title = normalizeText(
        entry?.media?.title?.userPreferred
        || entry?.media?.title?.english
        || entry?.media?.title?.romaji
        || entry?.media?.title?.native,
      ) || `Manga #${mediaId}`;
      const totalChapters = Number.isFinite(Number(entry?.media?.chapters))
        ? Math.max(0, Math.floor(Number(entry?.media?.chapters)))
        : null;

      entriesByMediaId.set(mediaId, {
        remoteMediaId: mediaId,
        fallbackMyAnimeListId: normalizeText(String(entry?.media?.idMal || "")) || null,
        title,
        status: mapAniListStatusToLocal(entry?.status),
        progress: normalizeImportProgressCount(entry?.progress, totalChapters),
        score: toFiniteScore(entry?.score),
        startedAt: toDateOnlyFromAniListFuzzy(entry?.startedAt) || null,
        completedAt: toDateOnlyFromAniListFuzzy(entry?.completedAt) || null,
        favorite: toNullableBoolean(entry?.media?.isFavourite),
        totalChapters,
      });
    }
  }

  let page = 1;
  const perPage = 50;

  while (true) {
    const favoriteResponse = await runAniListGraphQL<{
      data?: {
        Viewer?: {
          favourites?: {
            manga?: {
              pageInfo?: {
                currentPage?: number | null;
                hasNextPage?: boolean | null;
              } | null;
              nodes?: Array<{
                id?: number | null;
                idMal?: number | null;
                chapters?: number | null;
                isFavourite?: boolean | null;
                title?: {
                  userPreferred?: string | null;
                  romaji?: string | null;
                  english?: string | null;
                  native?: string | null;
                } | null;
              } | null> | null;
            } | null;
          } | null;
        } | null;
      };
      errors?: Array<{ message?: string }>;
    }>(
      accessToken,
      `
        query ToonParrotImportAniListFavouriteManga($page: Int, $perPage: Int) {
          Viewer {
            favourites {
              manga(page: $page, perPage: $perPage) {
                pageInfo {
                  currentPage
                  hasNextPage
                }
                nodes {
                  id
                  idMal
                  chapters
                  isFavourite
                  title {
                    userPreferred
                    romaji
                    english
                    native
                  }
                }
              }
            }
          }
        }
      `,
      { page, perPage },
    );

    const favoriteErrorMessage = getAniListGraphQLErrorMessage(favoriteResponse);
    if (favoriteErrorMessage) {
      throw new Error(favoriteErrorMessage);
    }

    const favoriteConnection = favoriteResponse?.data?.Viewer?.favourites?.manga;

    for (const favoriteNode of favoriteConnection?.nodes || []) {
      const mediaId = normalizeText(String(favoriteNode?.id || ""));
      if (!mediaId) {
        continue;
      }

      const title = normalizeText(
        favoriteNode?.title?.userPreferred
        || favoriteNode?.title?.english
        || favoriteNode?.title?.romaji
        || favoriteNode?.title?.native,
      ) || `Manga #${mediaId}`;
      const totalChapters = Number.isFinite(Number(favoriteNode?.chapters))
        ? Math.max(0, Math.floor(Number(favoriteNode?.chapters)))
        : null;
      const existingEntry = entriesByMediaId.get(mediaId);

      if (existingEntry) {
        entriesByMediaId.set(mediaId, {
          ...existingEntry,
          fallbackMyAnimeListId: existingEntry.fallbackMyAnimeListId
            || normalizeText(String(favoriteNode?.idMal || "")) || null,
          title: existingEntry.title || title,
          favorite: true,
          totalChapters: existingEntry.totalChapters ?? totalChapters,
        });
        continue;
      }

      entriesByMediaId.set(mediaId, {
        remoteMediaId: mediaId,
        fallbackMyAnimeListId: normalizeText(String(favoriteNode?.idMal || "")) || null,
        title,
        status: null,
        progress: 0,
        score: null,
        startedAt: null,
        completedAt: null,
        favorite: toNullableBoolean(favoriteNode?.isFavourite) ?? true,
        totalChapters,
      });
    }

    if (!favoriteConnection?.pageInfo?.hasNextPage) {
      break;
    }

    page += 1;
  }

  return [...entriesByMediaId.values()];
};

const upsertRowsInChunks = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  tableName: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = IMPORT_UPSERT_BATCH_SIZE,
) => {
  for (const chunk of chunkArray(rows, chunkSize)) {
    const { error } = await serviceClient
      .from(tableName as any)
      .upsert(chunk as any, { onConflict });

    if (error) {
      throw error;
    }
  }
};

const buildImportedChapterProgress = (params: {
  userId: string;
  mangaId: string;
  remoteProgress: number;
  remoteStatus: LocalLibraryStatus | null;
  chapters: ImportableChapterRow[];
  importedAt: string;
}) => {
  const sortedChapters = [...params.chapters].sort(
    (left, right) => Number(left.number) - Number(right.number) || left.id.localeCompare(right.id),
  );
  const readCount = Math.min(Math.max(0, params.remoteProgress), sortedChapters.length);
  if (readCount <= 0 || sortedChapters.length === 0) {
    return {
      chapterRows: [] as Record<string, unknown>[],
      readingProgressRow: null as Record<string, unknown> | null,
      importedReadCount: 0,
    };
  }

  const readChapters = sortedChapters.slice(0, readCount);
  const nextUnreadChapter = sortedChapters[readCount] || null;
  const lastReadChapter = readChapters[readChapters.length - 1] || null;

  const chapterRows = readChapters.map((chapter, index) => {
    const pageCount = getPageCountForImportedChapter(chapter);
    const readAt = new Date(Date.parse(params.importedAt) + (index * 1000)).toISOString();

    return {
      user_id: params.userId,
      manga_id: params.mangaId,
      chapter_id: chapter.id,
      chapter_number: chapter.number,
      page: pageCount,
      page_count: pageCount,
      max_page: pageCount,
      read_progress_percent: 100,
      is_read: true,
      last_read: readAt,
      created_at: readAt,
      updated_at: readAt,
    };
  });

  const resumeChapter = params.remoteStatus === "completed" || !nextUnreadChapter
    ? lastReadChapter
    : nextUnreadChapter;
  const resumePage = params.remoteStatus === "completed" || !nextUnreadChapter
    ? getPageCountForImportedChapter(lastReadChapter)
    : 1;

  return {
    chapterRows,
    readingProgressRow: resumeChapter
      ? {
        user_id: params.userId,
        manga_id: params.mangaId,
        chapter_id: resumeChapter.id,
        chapter_number: resumeChapter.number,
        page: resumePage,
        last_read: params.importedAt,
      }
      : null,
    importedReadCount: readCount,
  };
};

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: location,
    },
  });

const parseJsonBody = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const getExternalSyncPreferences = (preferences: any) => ({
  global: {
    ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.global,
    ...(preferences?.externalSync?.global || {}),
  },
  providers: {
    myanimelist: {
      ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.myanimelist,
      ...(preferences?.externalSync?.providers?.myanimelist || {}),
      fieldToggles: {
        ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.myanimelist.fieldToggles,
        ...(preferences?.externalSync?.providers?.myanimelist?.fieldToggles || {}),
      },
    },
    anilist: {
      ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.anilist,
      ...(preferences?.externalSync?.providers?.anilist || {}),
      fieldToggles: {
        ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.anilist.fieldToggles,
        ...(preferences?.externalSync?.providers?.anilist?.fieldToggles || {}),
      },
    },
  },
});

const mapStatusToMyAnimeList = (status?: LocalLibraryStatus | null) => {
  if (!status) {
    return undefined;
  }

  return status;
};

const mapStatusToAniList = (status?: LocalLibraryStatus | null) => {
  switch (status) {
    case "reading":
      return "CURRENT";
    case "plan_to_read":
      return "PLANNING";
    case "completed":
      return "COMPLETED";
    case "on_hold":
      return "PAUSED";
    case "dropped":
      return "DROPPED";
    default:
      return undefined;
  }
};

const getLocalStartedAt = (params: {
  syncState?: any;
  favorite?: any;
  earliestReadAt?: string | null;
  readingProgressLastRead?: string | null;
  derivedStatus?: LocalLibraryStatus | null;
}) => {
  const current = toDateOnly(params.syncState?.last_synced_started_at);
  if (current) {
    return current;
  }

  if (!params.derivedStatus || params.derivedStatus === "plan_to_read") {
    return null;
  }

  return toDateOnly(
    params.earliestReadAt
      || params.favorite?.added_at
      || params.readingProgressLastRead
      || new Date().toISOString(),
  );
};

const getLocalCompletedAt = (params: {
  syncState?: any;
  favorite?: any;
  shouldBeCompleted: boolean;
  latestReadAt?: string | null;
}) => {
  if (!params.shouldBeCompleted) {
    return null;
  }

  return toDateOnly(
    params.syncState?.last_synced_completed_at
      || params.favorite?.added_at
      || params.latestReadAt
      || new Date().toISOString(),
  );
};

const shouldAutoComplete = (params: {
  mangaStatus?: string | null;
  explicitStatus?: LocalLibraryStatus | null;
  readCount: number;
  totalChapterCount: number;
}) => {
  if (params.explicitStatus === "completed") {
    return true;
  }

  if (params.explicitStatus && params.explicitStatus !== "reading") {
    return false;
  }

  return params.mangaStatus === "completed"
    && params.totalChapterCount > 0
    && params.readCount >= params.totalChapterCount;
};

const getDerivedLocalStatus = (params: {
  explicitStatus?: LocalLibraryStatus | null;
  mangaStatus?: string | null;
  readCount: number;
  totalChapterCount: number;
}) => {
  if (params.explicitStatus) {
    if (params.explicitStatus === "reading" && shouldAutoComplete(params)) {
      return "completed" as const;
    }

    return params.explicitStatus;
  }

  if (shouldAutoComplete(params)) {
    return "completed" as const;
  }

  if (params.readCount > 0) {
    return "reading" as const;
  }

  return null;
};

const getRequestedProviders = (input: unknown) => {
  if (!Array.isArray(input) || input.length === 0) {
    return ["myanimelist", "anilist"] as ExternalSyncProvider[];
  }

  const providers = input
    .map((value) => normalizeProvider(typeof value === "string" ? value : ""))
    .filter(Boolean) as ExternalSyncProvider[];

  return providers.length > 0 ? [...new Set(providers)] : ["myanimelist", "anilist"];
};

const getSyncStateMap = (rows: any[] | null | undefined) => {
  const map = new Map<ExternalSyncProvider, any>();
  for (const row of rows || []) {
    const provider = normalizeProvider(row?.provider);
    if (!provider) {
      continue;
    }
    map.set(provider, row);
  }
  return map;
};

const getAccountMap = (rows: any[] | null | undefined) => {
  const map = new Map<ExternalSyncProvider, ExternalProviderAccountRow>();
  for (const row of rows || []) {
    const provider = normalizeProvider(row?.provider);
    if (!provider) {
      continue;
    }
    map.set(provider, row as ExternalProviderAccountRow);
  }
  return map;
};

const upsertSyncState = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  payload: Record<string, unknown>,
) => {
  const { error } = await serviceClient
    .from("external_sync_state")
    .upsert(payload, {
      onConflict: "user_id,manga_id,provider",
    });

  if (error) {
    throw error;
  }
};

const getEffectiveProviderPreferences = <
  TProviderPreferences extends { fieldToggles: Record<string, boolean> },
>(
  providerPreferences: TProviderPreferences,
  params: {
    trigger: SyncTrigger;
    hasLocalFavorite: boolean;
  },
) => {
  if (params.trigger !== "favorite" || params.hasLocalFavorite) {
    return providerPreferences;
  }

  return {
    ...providerPreferences,
    fieldToggles: {
      ...providerPreferences.fieldToggles,
      status: false,
      progress: false,
      score: false,
      dates: false,
    },
  } as TProviderPreferences;
};

const syncMyAnimeListEntry = async (params: {
  accessToken: string;
  mediaId: string;
  syncState?: any;
  providerPreferences: ReturnType<typeof getExternalSyncPreferences>["providers"]["myanimelist"];
  derivedStatus: LocalLibraryStatus | null;
  readCount: number;
  rating?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
}) => {
  const shouldCreateEntry = Boolean(
    !normalizeText(params.syncState?.remote_media_id)
    && (params.readCount > 0 || typeof params.rating === "number" || params.derivedStatus),
  );
  const derivedRequestStatus = mapStatusToMyAnimeList(params.derivedStatus);
  const requestStatus = params.providerPreferences.fieldToggles.status
    ? (
      derivedRequestStatus
      || (shouldCreateEntry ? mapStatusToMyAnimeList(params.derivedStatus || "reading") : undefined)
    )
    : shouldCreateEntry
      ? mapStatusToMyAnimeList(params.derivedStatus || "reading")
      : undefined;

  const requestPayload: Record<string, string> = {};

  if (requestStatus) {
    requestPayload.status = requestStatus;
  }

  if (params.providerPreferences.fieldToggles.progress) {
    requestPayload.num_chapters_read = String(Math.max(0, params.readCount));
  }

  if (params.providerPreferences.fieldToggles.score && typeof params.rating === "number") {
    requestPayload.score = String(params.rating);
  }

  if (params.providerPreferences.fieldToggles.dates) {
    if (params.startedAt) {
      requestPayload.start_date = params.startedAt;
    }

    if (params.derivedStatus === "completed" && params.completedAt) {
      requestPayload.finish_date = params.completedAt;
    } else if (params.syncState?.last_synced_completed_at) {
      requestPayload.finish_date = "";
    }
  }

  if (Object.keys(requestPayload).length === 0) {
    return { changed: false };
  }

  await saveMyAnimeListMangaListStatus(params.accessToken, params.mediaId, requestPayload);
  return { changed: true };
};

const syncAniListEntry = async (params: {
  accessToken: string;
  mediaId: string;
  syncState?: any;
  providerPreferences: ReturnType<typeof getExternalSyncPreferences>["providers"]["anilist"];
  derivedStatus: LocalLibraryStatus | null;
  readCount: number;
  rating?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  desiredFavorite?: boolean | null;
  shouldSyncFavorite: boolean;
}) => {
  const shouldCreateEntry = Boolean(
    !normalizeText(params.syncState?.remote_media_id)
    && (params.readCount > 0 || typeof params.rating === "number" || params.derivedStatus),
  );
  const derivedStatus = mapStatusToAniList(params.derivedStatus);
  const status = params.providerPreferences.fieldToggles.status
    ? (
      derivedStatus
      || (shouldCreateEntry ? mapStatusToAniList(params.derivedStatus || "reading") : undefined)
    )
    : shouldCreateEntry
      ? mapStatusToAniList(params.derivedStatus || "reading")
      : undefined;
  const variables: Record<string, unknown> = {
    mediaId: Number(params.mediaId),
  };

  if (status) {
    variables.status = status;
  }

  if (params.providerPreferences.fieldToggles.progress) {
    variables.progress = Math.max(0, params.readCount);
  }

  if (params.providerPreferences.fieldToggles.score && typeof params.rating === "number") {
    variables.score = params.rating;
  }

  if (params.providerPreferences.fieldToggles.dates) {
    variables.startedAt = toAniListFuzzyDate(params.startedAt) || undefined;
    variables.completedAt = params.derivedStatus === "completed"
      ? toAniListFuzzyDate(params.completedAt) || undefined
      : null;
  }

  let didChange = false;
  if (Object.keys(variables).length > 1) {
    const response = await runAniListGraphQL<{
      data?: {
        SaveMediaListEntry?: {
          id?: number | null;
        };
      };
    }>(
      params.accessToken,
      `
        mutation SaveMediaListEntry(
          $mediaId: Int
          $status: MediaListStatus
          $progress: Int
          $score: Float
          $startedAt: FuzzyDateInput
          $completedAt: FuzzyDateInput
        ) {
          SaveMediaListEntry(
            mediaId: $mediaId
            status: $status
            progress: $progress
            score: $score
            startedAt: $startedAt
            completedAt: $completedAt
          ) {
            id
          }
        }
      `,
      variables,
    );

    const errorMessage = getAniListGraphQLErrorMessage(response);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    didChange = Boolean(response?.data?.SaveMediaListEntry?.id);
  }

  let warning: string | null = null;
  let favoriteSyncedValue = toNullableBoolean(params.syncState?.last_synced_favorite);

  if (params.shouldSyncFavorite && typeof params.desiredFavorite === "boolean") {
    const favoriteStateResponse = await runAniListGraphQL<{
      data?: {
        Media?: {
          isFavourite?: boolean | null;
          isFavouriteBlocked?: boolean | null;
        } | null;
      };
    }>(
      params.accessToken,
      `
        query AniListFavoriteState($mediaId: Int, $type: MediaType) {
          Media(id: $mediaId, type: $type) {
            isFavourite
            isFavouriteBlocked
          }
        }
      `,
      {
        mediaId: Number(params.mediaId),
        type: "MANGA",
      },
    );

    const favoriteStateError = getAniListGraphQLErrorMessage(favoriteStateResponse);
    if (favoriteStateError) {
      throw new Error(favoriteStateError);
    }

    const remoteFavorite = Boolean(favoriteStateResponse?.data?.Media?.isFavourite);
    const isFavoriteBlocked = Boolean(favoriteStateResponse?.data?.Media?.isFavouriteBlocked);

    if (isFavoriteBlocked && params.desiredFavorite && !remoteFavorite) {
      warning = "AniList bu seriyi favorilere eklemeye izin vermiyor";
      favoriteSyncedValue = remoteFavorite;
    } else if (remoteFavorite !== params.desiredFavorite) {
      const toggleResponse = await runAniListGraphQL<{
        data?: {
          ToggleFavourite?: {
            manga?: {
              nodes?: Array<{ id?: number | null }> | null;
            } | null;
          } | null;
        };
      }>(
        params.accessToken,
        `
          mutation ToggleAniListFavourite($mangaId: Int) {
            ToggleFavourite(mangaId: $mangaId) {
              manga {
                nodes {
                  id
                }
              }
            }
          }
        `,
        {
          mangaId: Number(params.mediaId),
        },
      );

      const toggleError = getAniListGraphQLErrorMessage(toggleResponse);
      if (toggleError) {
        throw new Error(toggleError);
      }

      didChange = true;
      favoriteSyncedValue = params.desiredFavorite;
    } else {
      favoriteSyncedValue = remoteFavorite;
    }
  }

  return {
    changed: didChange,
    warning,
    favoriteSyncedValue,
  };
};

type AuthorizedRequester = {
  serviceClient: ReturnType<typeof createServiceClient>;
  requesterProfile: {
    id: string;
  };
};

type SyncProviderResult = {
  provider: ExternalSyncProvider;
  success: boolean;
  skipped?: boolean;
  message?: string;
  warning?: string | null;
};

type SyncMangaExecutionResult = {
  mangaId: string;
  title?: string | null;
  results: SyncProviderResult[];
};

const buildSyncSummary = (results: SyncMangaExecutionResult[]) => results.reduce(
  (summary, mangaResult) => {
    for (const providerResult of mangaResult.results) {
      if (!providerResult.success) {
        summary.failed += 1;
        continue;
      }

      if (providerResult.skipped) {
        summary.skipped += 1;
      } else {
        summary.synced += 1;
      }

      if (normalizeText(providerResult.warning)) {
        summary.warnings += 1;
      }
    }

    return summary;
  },
  { synced: 0, skipped: 0, failed: 0, warnings: 0 },
);

const syncMangaRecord = async (params: {
  requester: AuthorizedRequester;
  mangaId: string;
  trigger: SyncTrigger;
  requestedProviders: ExternalSyncProvider[];
}): Promise<SyncMangaExecutionResult> => {
  const [
    { data: userRow },
    { data: mangaRow },
    { data: favoriteRow },
    { data: ratingRow },
    { data: reviewRow },
    { data: readRows },
    { data: readingProgressRow },
    { count: totalChapterCount },
    { data: accountRows },
    { data: syncRows },
  ] = await Promise.all([
    params.requester.serviceClient
      .from("users")
      .select("preferences")
      .eq("id", params.requester.requesterProfile.id)
      .maybeSingle(),
    params.requester.serviceClient
      .from("mangas")
      .select("id, title, status, source_links")
      .eq("id", params.mangaId)
      .maybeSingle(),
    params.requester.serviceClient
      .from("favorites")
      .select("category, added_at")
      .eq("user_id", params.requester.requesterProfile.id)
      .eq("manga_id", params.mangaId)
      .maybeSingle(),
    params.requester.serviceClient
      .from("ratings")
      .select("rating, created_at")
      .eq("user_id", params.requester.requesterProfile.id)
      .eq("manga_id", params.mangaId)
      .maybeSingle(),
    params.requester.serviceClient
      .from("reviews")
      .select("content, rating_story, rating_characters, rating_art, rating_progression, rating_engagement, updated_at, created_at")
      .eq("user_id", params.requester.requesterProfile.id)
      .eq("manga_id", params.mangaId)
      .maybeSingle(),
    params.requester.serviceClient
      .from("chapter_read_progress")
      .select("chapter_id, last_read")
      .eq("user_id", params.requester.requesterProfile.id)
      .eq("manga_id", params.mangaId)
      .eq("is_read", true),
    params.requester.serviceClient
      .from("reading_progress")
      .select("last_read")
      .eq("user_id", params.requester.requesterProfile.id)
      .eq("manga_id", params.mangaId)
      .maybeSingle(),
    params.requester.serviceClient
      .from("chapters")
      .select("id", { count: "exact", head: true })
      .eq("manga_id", params.mangaId),
    params.requester.serviceClient
      .from("external_provider_accounts")
      .select("*")
      .eq("user_id", params.requester.requesterProfile.id)
      .in("provider", params.requestedProviders),
    params.requester.serviceClient
      .from("external_sync_state")
      .select("*")
      .eq("user_id", params.requester.requesterProfile.id)
      .eq("manga_id", params.mangaId)
      .in("provider", params.requestedProviders),
  ]);

  if (!mangaRow?.id) {
    return {
      mangaId: params.mangaId,
      title: null,
      results: params.requestedProviders.map((provider) => ({
        provider,
        success: false,
        message: "Seri bulunamadı",
      })),
    };
  }

  const preferences = getExternalSyncPreferences(userRow?.preferences);
  const accountMap = getAccountMap(accountRows);
  const syncStateMap = getSyncStateMap(syncRows);
  const readCount = (readRows || []).length;
  const sortedReadDates = (readRows || [])
    .map((row: any) => row?.last_read)
    .filter(Boolean)
    .sort();
  const earliestReadAt = sortedReadDates[0] || null;
  const latestReadAt = sortedReadDates[sortedReadDates.length - 1] || null;
  const explicitStatus = normalizeText(favoriteRow?.category) as LocalLibraryStatus | "";
  const derivedStatus = getDerivedLocalStatus({
    explicitStatus: explicitStatus || null,
    mangaStatus: mangaRow.status,
    readCount,
    totalChapterCount: totalChapterCount || 0,
  });
  const baselineSyncState = syncStateMap.get("myanimelist") || syncStateMap.get("anilist");
  const startedAt = getLocalStartedAt({
    syncState: baselineSyncState,
    favorite: favoriteRow,
    earliestReadAt,
    readingProgressLastRead: readingProgressRow?.last_read || null,
    derivedStatus,
  });
  const completedAt = getLocalCompletedAt({
    syncState: baselineSyncState,
    favorite: favoriteRow,
    shouldBeCompleted: derivedStatus === "completed",
    latestReadAt,
  });
  const preferredLocalScore = getPreferredLocalScore({
    ratingRow,
    reviewRow,
  });
  const results: SyncProviderResult[] = [];

  for (const provider of params.requestedProviders) {
    const providerPrefs = preferences.providers[provider];
    const effectiveProviderPrefs = getEffectiveProviderPreferences(providerPrefs, {
      trigger: params.trigger,
      hasLocalFavorite: Boolean(favoriteRow),
    });
    const effectiveFieldToggles = effectiveProviderPrefs.fieldToggles as Record<string, boolean>;
    const account = accountMap.get(provider);
    const syncState = syncStateMap.get(provider);
    const mediaLink = getProviderLink(mangaRow.source_links, provider);
    const mediaId = getProviderMediaId(mediaLink);
    const lastSyncedFavorite = toNullableBoolean(syncState?.last_synced_favorite);

    if (!account) {
      results.push({ provider, success: false, skipped: true, message: "Hesap bağlı değil" });
      continue;
    }

    if (!providerPrefs?.enabled) {
      results.push({ provider, success: true, skipped: true, message: "Sağlayıcı senkronu kapalı" });
      continue;
    }

    if (params.trigger !== "manual" && !preferences.global.autoSync) {
      results.push({ provider, success: true, skipped: true, message: "Otomatik senkron kapalı" });
      continue;
    }

    if (!mediaId) {
      results.push({ provider, success: true, skipped: true, message: "Seri eşleştirmesi yok" });
      continue;
    }

    const desiredStatus = provider === "myanimelist"
      ? mapStatusToMyAnimeList(derivedStatus)
      : mapStatusToAniList(derivedStatus);
    const desiredScore = getProviderScore(provider, preferredLocalScore);
    const desiredProgress = readCount;
    const desiredStartedAt = startedAt;
    const desiredCompletedAt = completedAt;
    const desiredFavorite = provider === "anilist" && effectiveFieldToggles.favorite
      ? favoriteRow
        ? true
        : lastSyncedFavorite === true
          ? false
          : null
      : null;
    const shouldForceRetry = params.trigger === "manual" && normalizeText(syncState?.last_error);
    const statusChanged = Boolean(
      effectiveFieldToggles.status
      && (desiredStatus || "") !== normalizeText(syncState?.last_synced_status)
    );
    const progressChanged = Boolean(
      effectiveFieldToggles.progress
      && desiredProgress !== Number(syncState?.last_synced_progress || 0)
    );
    const scoreChanged = Boolean(
      effectiveFieldToggles.score
      && Number(desiredScore || 0) !== Number(syncState?.last_synced_score || 0)
    );
    const startedAtChanged = Boolean(
      effectiveFieldToggles.dates
      && (desiredStartedAt || "") !== (toDateOnly(syncState?.last_synced_started_at) || "")
    );
    const completedAtChanged = Boolean(
      effectiveFieldToggles.dates
      && (desiredCompletedAt || "") !== (toDateOnly(syncState?.last_synced_completed_at) || "")
    );
    const favoriteChanged = Boolean(
      provider === "anilist"
      && effectiveFieldToggles.favorite
      && typeof desiredFavorite === "boolean"
      && desiredFavorite !== lastSyncedFavorite
    );
    const fieldsChanged = statusChanged
      || progressChanged
      || scoreChanged
      || startedAtChanged
      || completedAtChanged
      || favoriteChanged;

    if (!fieldsChanged && !shouldForceRetry) {
      results.push({ provider, success: true, skipped: true, message: "Değişiklik yok" });
      continue;
    }

    try {
      const activeAccount = await ensureProviderAccessToken(params.requester.serviceClient, account);

      let warning: string | null = null;
      let remoteReviewId = normalizeText(syncState?.remote_review_id) || null;
      let syncedFavoriteState = lastSyncedFavorite;

      if (provider === "myanimelist") {
        await syncMyAnimeListEntry({
          accessToken: activeAccount.access_token,
          mediaId,
          syncState,
          providerPreferences: effectiveProviderPrefs as ReturnType<typeof getExternalSyncPreferences>["providers"]["myanimelist"],
          derivedStatus,
          readCount,
          rating: desiredScore,
          startedAt: desiredStartedAt,
          completedAt: desiredCompletedAt,
        });
      } else {
        const aniListResult = await syncAniListEntry({
          accessToken: activeAccount.access_token,
          mediaId,
          syncState,
          providerPreferences: effectiveProviderPrefs as ReturnType<typeof getExternalSyncPreferences>["providers"]["anilist"],
          derivedStatus,
          readCount,
          rating: desiredScore,
          startedAt: desiredStartedAt,
          completedAt: desiredCompletedAt,
          desiredFavorite,
          shouldSyncFavorite: Boolean(
            effectiveFieldToggles.favorite
            && typeof desiredFavorite === "boolean"
            && (favoriteChanged || shouldForceRetry)
          ),
        });
        warning = aniListResult.warning || null;
        syncedFavoriteState = toNullableBoolean(aniListResult.favoriteSyncedValue);
      }

      await upsertSyncState(params.requester.serviceClient, {
        user_id: params.requester.requesterProfile.id,
        manga_id: params.mangaId,
        provider,
        remote_media_id: mediaId,
        remote_review_id: remoteReviewId,
        last_synced_status: effectiveFieldToggles.status
          ? desiredStatus || null
          : syncState?.last_synced_status || null,
        last_synced_progress: effectiveFieldToggles.progress
          ? desiredProgress
          : syncState?.last_synced_progress ?? null,
        last_synced_score: effectiveFieldToggles.score
          ? desiredScore
          : syncState?.last_synced_score ?? null,
        last_synced_started_at: effectiveFieldToggles.dates
          ? desiredStartedAt
          : syncState?.last_synced_started_at ?? null,
        last_synced_completed_at: effectiveFieldToggles.dates
          ? desiredCompletedAt
          : syncState?.last_synced_completed_at ?? null,
        last_synced_favorite: provider === "anilist"
          ? syncedFavoriteState
          : syncState?.last_synced_favorite ?? null,
        last_review_hash: null,
        last_sync_at: new Date().toISOString(),
        last_error: warning,
        last_error_at: warning ? new Date().toISOString() : null,
      });

      await clearProviderAccountError(params.requester.serviceClient, params.requester.requesterProfile.id, provider);

      results.push({
        provider,
        success: true,
        warning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Senkron başarısız oldu";
      await upsertSyncState(params.requester.serviceClient, {
        user_id: params.requester.requesterProfile.id,
        manga_id: params.mangaId,
        provider,
        remote_media_id: mediaId,
        remote_review_id: normalizeText(syncState?.remote_review_id) || null,
        last_synced_status: syncState?.last_synced_status || null,
        last_synced_progress: syncState?.last_synced_progress ?? null,
        last_synced_score: syncState?.last_synced_score ?? null,
        last_synced_started_at: syncState?.last_synced_started_at ?? null,
        last_synced_completed_at: syncState?.last_synced_completed_at ?? null,
        last_synced_favorite: toNullableBoolean(syncState?.last_synced_favorite),
        last_review_hash: syncState?.last_review_hash || null,
        last_sync_at: syncState?.last_sync_at ?? null,
        last_error: message,
        last_error_at: new Date().toISOString(),
      });
      await setProviderAccountError(params.requester.serviceClient, params.requester.requesterProfile.id, provider, message);
      results.push({ provider, success: false, message });
    }
  }

  return {
    mangaId: params.mangaId,
    title: mangaRow.title || null,
    results,
  };
};

const importProviderLibrary = async (req: Request, body: any) => {
  const requester = await requireRequester(req);
  if (!requester.ok) {
    return requester.response;
  }

  const provider = normalizeProvider(body?.provider);
  if (!provider) {
    return json({ success: false, message: "Geçersiz sağlayıcı" }, 400);
  }

  const { data: accountRow, error: accountError } = await requester.serviceClient
    .from("external_provider_accounts")
    .select("*")
    .eq("user_id", requester.requesterProfile.id)
    .eq("provider", provider)
    .maybeSingle();

  if (accountError) {
    return json({ success: false, message: "Sağlayıcı hesabı okunamadı" }, 500);
  }

  if (!accountRow) {
    return json({ success: false, message: "Bu sağlayıcı önce bağlanmalı" }, 400);
  }

  try {
    const activeAccount = await ensureProviderAccessToken(requester.serviceClient, accountRow as ExternalProviderAccountRow);
    const { data: userRow, error: userError } = await requester.serviceClient
      .from("users")
      .select("preferences")
      .eq("id", requester.requesterProfile.id)
      .maybeSingle();

    if (userError) {
      throw userError;
    }

    const providerPreferences = getExternalSyncPreferences(userRow?.preferences).providers[provider];
    const shouldImportStatus = Boolean(providerPreferences.fieldToggles.status);
    const shouldImportProgress = Boolean(providerPreferences.fieldToggles.progress);
    const shouldImportScore = Boolean(providerPreferences.fieldToggles.score);
    const shouldImportDates = Boolean(providerPreferences.fieldToggles.dates);
    const shouldImportFavorite = provider === "anilist"
      ? Boolean((providerPreferences.fieldToggles as Record<string, boolean>).favorite)
      : false;
    const effectiveProviderUserId = provider === "anilist" && !normalizeText(activeAccount.provider_user_id)
      ? normalizeText(String((await getProviderViewer(provider, activeAccount.access_token) as any)?.data?.Viewer?.id || ""))
      : normalizeText(activeAccount.provider_user_id);
    const rawRemoteEntries = provider === "myanimelist"
      ? await fetchMyAnimeListImportEntries(activeAccount.access_token)
      : await fetchAniListImportEntries(activeAccount.access_token, effectiveProviderUserId);
    const remoteEntries = [...new Map(
      rawRemoteEntries.map((entry) => [entry.remoteMediaId, entry]),
    ).values()];

    const response: ExternalLibraryImportResponse = {
      success: true,
      provider,
      totalRemoteEntries: remoteEntries.length,
      matchedEntries: 0,
      unmatchedEntries: 0,
      summary: {
        libraryImported: 0,
        ratingsImported: 0,
        progressImported: 0,
        syncStateUpdated: 0,
        skippedExistingLibrary: 0,
        skippedExistingRatings: 0,
        skippedExistingProgress: 0,
      },
      unmatchedTitles: [],
    };

    if (remoteEntries.length === 0) {
      await clearProviderAccountError(requester.serviceClient, requester.requesterProfile.id, provider);
      return json(response);
    }

    const { data: mangaRows, error: mangaError } = await requester.serviceClient
      .from("mangas")
      .select("id, title, source_links");

    if (mangaError) {
      throw mangaError;
    }

    const sourceMaps = getLocalSourceMaps((mangaRows || []) as ImportableMangaRow[]);
    const matchedEntries = remoteEntries.flatMap((entry) => {
      const matchedManga = provider === "myanimelist"
        ? sourceMaps.byMyAnimeListId.get(entry.remoteMediaId)
        : sourceMaps.byAniListId.get(entry.remoteMediaId)
          || (entry.fallbackMyAnimeListId ? sourceMaps.byMyAnimeListId.get(entry.fallbackMyAnimeListId) : undefined);

      if (!matchedManga) {
        response.unmatchedEntries += 1;
        if (response.unmatchedTitles.length < 15) {
          response.unmatchedTitles.push(entry.title);
        }
        return [];
      }

      return [{
        entry,
        manga: matchedManga,
      }];
    });

    response.matchedEntries = matchedEntries.length;

    if (matchedEntries.length === 0) {
      await clearProviderAccountError(requester.serviceClient, requester.requesterProfile.id, provider);
      return json(response);
    }

    const matchedMangaIds = [...new Set(matchedEntries.map((item) => item.manga.id))];
    const [
      { data: favoriteRows },
      { data: ratingRows },
      { data: reviewRows },
      { data: readingRows },
      { data: chapterProgressRows },
      { data: syncRows },
    ] = await Promise.all([
      requester.serviceClient
        .from("favorites")
        .select("manga_id, category, added_at")
        .eq("user_id", requester.requesterProfile.id)
        .in("manga_id", matchedMangaIds),
      requester.serviceClient
        .from("ratings")
        .select("manga_id, rating, created_at")
        .eq("user_id", requester.requesterProfile.id)
        .in("manga_id", matchedMangaIds),
      requester.serviceClient
        .from("reviews")
        .select("manga_id, rating_story, rating_characters, rating_art, rating_progression, rating_engagement, updated_at, created_at")
        .eq("user_id", requester.requesterProfile.id)
        .in("manga_id", matchedMangaIds),
      requester.serviceClient
        .from("reading_progress")
        .select("manga_id, chapter_id, chapter_number, page, last_read")
        .eq("user_id", requester.requesterProfile.id)
        .in("manga_id", matchedMangaIds),
      requester.serviceClient
        .from("chapter_read_progress")
        .select("manga_id, chapter_id, is_read")
        .eq("user_id", requester.requesterProfile.id)
        .in("manga_id", matchedMangaIds),
      requester.serviceClient
        .from("external_sync_state")
        .select("*")
        .eq("user_id", requester.requesterProfile.id)
        .eq("provider", provider)
        .in("manga_id", matchedMangaIds),
    ]);

    const favoriteMap = new Map<string, any>();
    for (const row of favoriteRows || []) {
      favoriteMap.set(row.manga_id, row);
    }

    const ratingMap = new Map<string, any>();
    for (const row of ratingRows || []) {
      ratingMap.set(row.manga_id, row);
    }

    const reviewMap = new Map<string, any>();
    for (const row of reviewRows || []) {
      reviewMap.set(row.manga_id, row);
    }

    const readingMap = new Map<string, any>();
    for (const row of readingRows || []) {
      readingMap.set(row.manga_id, row);
    }

    const chapterProgressPresence = new Set<string>();
    const chapterReadCountByManga = new Map<string, number>();
    for (const row of chapterProgressRows || []) {
      chapterProgressPresence.add(row.manga_id);
      if (row.is_read) {
        chapterReadCountByManga.set(
          row.manga_id,
          (chapterReadCountByManga.get(row.manga_id) || 0) + 1,
        );
      }
    }

    const syncStateByManga = new Map<string, any>();
    for (const row of syncRows || []) {
      syncStateByManga.set(row.manga_id, row);
    }

    const progressCandidateMangaIds = [...new Set(
      shouldImportProgress
        ? matchedEntries
          .filter(({ entry, manga }) => (
            entry.progress > 0
            && !readingMap.has(manga.id)
            && !chapterProgressPresence.has(manga.id)
          ))
          .map(({ manga }) => manga.id)
        : [],
    )];

    const chaptersByMangaId = new Map<string, ImportableChapterRow[]>();
    if (progressCandidateMangaIds.length > 0) {
      const { data: chapterRows, error: chapterError } = await requester.serviceClient
        .from("chapters")
        .select("id, manga_id, number, pages")
        .in("manga_id", progressCandidateMangaIds);

      if (chapterError) {
        throw chapterError;
      }

      for (const row of chapterRows || []) {
        const bucket = chaptersByMangaId.get(row.manga_id) || [];
        bucket.push({
          id: row.id,
          manga_id: row.manga_id,
          number: Number(row.number),
          pages: Array.isArray(row.pages) ? row.pages : [],
        });
        chaptersByMangaId.set(row.manga_id, bucket);
      }
    }

    const nowIso = new Date().toISOString();
    const favoriteUpserts: Record<string, unknown>[] = [];
    const ratingUpserts: Record<string, unknown>[] = [];
    const readingProgressUpserts: Record<string, unknown>[] = [];
    const chapterProgressUpserts: Record<string, unknown>[] = [];
    const syncStateUpserts: Record<string, unknown>[] = [];

    for (const { entry, manga } of matchedEntries) {
      const existingFavorite = favoriteMap.get(manga.id);
      const existingRating = ratingMap.get(manga.id);
      const existingReview = reviewMap.get(manga.id);
      const existingReading = readingMap.get(manga.id);
      const existingSyncState = syncStateByManga.get(manga.id);

      const remoteCategory = shouldImportStatus
        ? entry.status
        : null;
      const shouldImportLibraryEntry = Boolean(remoteCategory || (shouldImportFavorite && entry.favorite));
      const importedLibraryCategory = remoteCategory || (shouldImportFavorite && entry.favorite
        ? "plan_to_read" as LocalLibraryStatus
        : null);
      const remoteScore = shouldImportScore && typeof entry.score === "number" && entry.score > 0
        ? entry.score
        : null;
      const importTimestamp = shouldImportDates && entry.completedAt
        ? `${entry.completedAt}T23:59:59.000Z`
        : shouldImportDates && entry.startedAt
          ? `${entry.startedAt}T12:00:00.000Z`
          : nowIso;

      if (!existingFavorite && importedLibraryCategory) {
        favoriteUpserts.push({
          user_id: requester.requesterProfile.id,
          manga_id: manga.id,
          category: importedLibraryCategory,
          added_at: shouldImportDates ? (entry.startedAt || entry.completedAt || nowIso) : nowIso,
        });
        response.summary.libraryImported += 1;
      } else if (existingFavorite && shouldImportLibraryEntry) {
        response.summary.skippedExistingLibrary += 1;
      }

      if (!existingRating && !existingReview && typeof remoteScore === "number") {
        ratingUpserts.push({
          user_id: requester.requesterProfile.id,
          manga_id: manga.id,
          rating: remoteScore,
          created_at: importTimestamp,
        });
        response.summary.ratingsImported += 1;
      } else if ((existingRating || existingReview) && typeof remoteScore === "number") {
        response.summary.skippedExistingRatings += 1;
      }

      let importedReadCount: number | null = null;
      if (shouldImportProgress && entry.progress > 0) {
        if (!existingReading && !chapterProgressPresence.has(manga.id)) {
          const progressPlan = buildImportedChapterProgress({
            userId: requester.requesterProfile.id,
            mangaId: manga.id,
            remoteProgress: entry.progress,
            remoteStatus: importedLibraryCategory,
            chapters: chaptersByMangaId.get(manga.id) || [],
            importedAt: importTimestamp,
          });

          if (progressPlan.chapterRows.length > 0) {
            chapterProgressUpserts.push(...progressPlan.chapterRows);
            if (progressPlan.readingProgressRow) {
              readingProgressUpserts.push(progressPlan.readingProgressRow);
            }
            importedReadCount = progressPlan.importedReadCount;
            response.summary.progressImported += 1;
          }
        } else {
          response.summary.skippedExistingProgress += 1;
        }
      }

      const localScore = getPreferredLocalScore({
        ratingRow: existingRating,
        reviewRow: existingReview,
      });
      const finalLocalStatus = (normalizeText(existingFavorite?.category) as LocalLibraryStatus | "") || importedLibraryCategory;
      const finalLocalScore = typeof localScore === "number"
        ? localScore
        : remoteScore;
      const finalReadCount = importedReadCount
        ?? Math.max(
          Number(chapterReadCountByManga.get(manga.id) || 0),
          Number(existingReading?.chapter_number || 0),
        );
      const finalStartedAt = shouldImportDates
        ? (
          entry.startedAt
          || toDateOnly(existingSyncState?.last_synced_started_at)
          || null
        )
        : toDateOnly(existingSyncState?.last_synced_started_at) || null;
      const finalCompletedAt = shouldImportDates && finalLocalStatus === "completed"
        ? (
          entry.completedAt
          || toDateOnly(existingSyncState?.last_synced_completed_at)
          || null
        )
        : shouldImportDates
          ? null
          : toDateOnly(existingSyncState?.last_synced_completed_at) || null;
      const finalFavoriteState = provider === "anilist" && shouldImportFavorite
        ? Boolean(existingFavorite || importedLibraryCategory || entry.favorite)
        : toNullableBoolean(existingSyncState?.last_synced_favorite);
      const nextSyncedStatus = provider === "myanimelist"
        ? mapStatusToMyAnimeList(finalLocalStatus)
        : mapStatusToAniList(finalLocalStatus);
      const nextSyncedScore = getProviderScore(provider, finalLocalScore);

      syncStateUpserts.push({
        user_id: requester.requesterProfile.id,
        manga_id: manga.id,
        provider,
        remote_media_id: entry.remoteMediaId,
        remote_review_id: normalizeText(existingSyncState?.remote_review_id) || null,
        last_synced_status: shouldImportStatus
          ? nextSyncedStatus || existingSyncState?.last_synced_status || null
          : existingSyncState?.last_synced_status || null,
        last_synced_progress: shouldImportProgress
          ? (
            finalReadCount > 0
              ? finalReadCount
              : existingSyncState?.last_synced_progress ?? null
          )
          : existingSyncState?.last_synced_progress ?? null,
        last_synced_score: shouldImportScore
          ? (
            typeof nextSyncedScore === "number"
              ? nextSyncedScore
              : existingSyncState?.last_synced_score ?? null
          )
          : existingSyncState?.last_synced_score ?? null,
        last_synced_started_at: shouldImportDates ? finalStartedAt : existingSyncState?.last_synced_started_at ?? null,
        last_synced_completed_at: shouldImportDates ? finalCompletedAt : existingSyncState?.last_synced_completed_at ?? null,
        last_synced_favorite: provider === "anilist"
          ? (
            shouldImportFavorite
              ? finalFavoriteState
              : existingSyncState?.last_synced_favorite ?? null
          )
          : null,
        last_review_hash: normalizeText(existingSyncState?.last_review_hash) || null,
        last_sync_at: nowIso,
        last_error: null,
        last_error_at: null,
      });
      response.summary.syncStateUpdated += 1;
    }

    await upsertRowsInChunks(requester.serviceClient, "favorites", favoriteUpserts, "user_id,manga_id");
    await upsertRowsInChunks(requester.serviceClient, "ratings", ratingUpserts, "manga_id,user_id");
    await upsertRowsInChunks(requester.serviceClient, "reading_progress", readingProgressUpserts, "user_id,manga_id");
    await upsertRowsInChunks(
      requester.serviceClient,
      "chapter_read_progress",
      chapterProgressUpserts,
      "user_id,chapter_id",
      IMPORT_CHAPTER_PROGRESS_BATCH_SIZE,
    );
    await upsertRowsInChunks(requester.serviceClient, "external_sync_state", syncStateUpserts, "user_id,manga_id,provider");

    await clearProviderAccountError(requester.serviceClient, requester.requesterProfile.id, provider);
    return json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kütüphane içe aktarma başarısız oldu";
    await setProviderAccountError(requester.serviceClient, requester.requesterProfile.id, provider, message);
    return json({ success: false, message }, 500);
  }
};

const handleCallback = async (req: Request) => {
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  const state = normalizeText(url.searchParams.get("state"));
  const code = normalizeText(url.searchParams.get("code"));
  const providerError = normalizeText(url.searchParams.get("error") || url.searchParams.get("error_description"));
  const serviceClient = createServiceClient();

  if (!provider) {
    return redirect(buildSiteRedirectUrl("/settings?tab=sync", {
      sync_status: "error",
      sync_message: "Geçersiz sağlayıcı callback isteği.",
    }));
  }

  const { data: authState } = await serviceClient
    .from("external_provider_auth_states")
    .select("*")
    .eq("state", state)
    .eq("provider", provider)
    .maybeSingle();

  if (!authState) {
    return redirect(buildSiteRedirectUrl("/settings?tab=sync", {
      sync_provider: provider,
      sync_status: "error",
      sync_message: "Bağlantı oturumu bulunamadı veya süresi doldu.",
    }));
  }

  const authStateExpiresAt = Date.parse(authState.expires_at || "");
  if (!Number.isFinite(authStateExpiresAt) || authStateExpiresAt < Date.now()) {
    await serviceClient
      .from("external_provider_auth_states")
      .delete()
      .eq("state", authState.state);

    return redirect(buildSiteRedirectUrl("/settings?tab=sync", {
      sync_provider: provider,
      sync_status: "error",
      sync_message: "Bağlantı oturumunun süresi doldu. Lütfen tekrar deneyin.",
    }));
  }

  const redirectPath = authState.redirect_path || "/settings?tab=sync";

  try {
    if (providerError) {
      throw new Error(providerError);
    }

    if (!code) {
      throw new Error("Yetkilendirme kodu alınamadı");
    }

    const tokenPayload = await exchangeAuthorizationCode(provider, code, authState.code_verifier);
    const accountTokenExpiresAt = tokenPayload?.expires_in
      ? new Date(Date.now() + (Number(tokenPayload.expires_in) * 1000)).toISOString()
      : null;
    const viewer = await getProviderViewer(provider, tokenPayload.access_token);

    const providerUserId = provider === "myanimelist"
      ? normalizeText(String((viewer as any)?.id || ""))
      : normalizeText(String((viewer as any)?.data?.Viewer?.id || ""));

    const { error: upsertError } = await serviceClient
      .from("external_provider_accounts")
      .upsert({
        user_id: authState.user_id,
        provider,
        provider_user_id: providerUserId || null,
        access_token: tokenPayload.access_token,
        refresh_token: normalizeText((tokenPayload as any)?.refresh_token) || null,
        token_expires_at: accountTokenExpiresAt,
        scopes: [],
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
      }, {
        onConflict: "user_id,provider",
      });

    if (upsertError) {
      throw upsertError;
    }

    await serviceClient
      .from("external_provider_auth_states")
      .delete()
      .eq("state", authState.state);

    return redirect(buildSiteRedirectUrl(redirectPath, {
      sync_provider: provider,
      sync_status: "connected",
    }));
  } catch (error) {
    await serviceClient
      .from("external_provider_auth_states")
      .delete()
      .eq("state", authState.state);

    await setProviderAccountError(
      serviceClient,
      authState.user_id,
      provider,
      error instanceof Error ? error.message : "Bağlantı tamamlanamadı",
    );

    return redirect(buildSiteRedirectUrl(redirectPath, {
      sync_provider: provider,
      sync_status: "error",
      sync_message: error instanceof Error ? error.message : "Bağlantı tamamlanamadı",
    }));
  }
};

const handleBeginAuth = async (req: Request, body: any) => {
  const requester = await requireRequester(req);
  if (!requester.ok) {
    return requester.response;
  }

  const provider = normalizeProvider(body?.provider);
  if (!provider) {
    return json({ success: false, message: "Geçersiz sağlayıcı" }, 400);
  }

  const redirectPath = normalizeText(body?.redirectPath) || "/settings?tab=sync";
  const state = createRandomToken(32);
  const codeVerifier = provider === "myanimelist" ? createPkceVerifier() : null;

  await requester.serviceClient
    .from("external_provider_auth_states")
    .delete()
    .eq("user_id", requester.requesterProfile.id)
    .eq("provider", provider);

  const { error } = await requester.serviceClient
    .from("external_provider_auth_states")
    .insert({
      state,
      user_id: requester.requesterProfile.id,
      provider,
      code_verifier: codeVerifier,
      redirect_path: redirectPath,
      expires_at: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
    });

  if (error) {
    return json({ success: false, message: "Bağlantı oturumu oluşturulamadı" }, 500);
  }

  const authorizeUrl = createProviderAuthorizeUrl(provider, state, redirectPath, codeVerifier);
  return json({
    success: true,
    provider,
    authorizeUrl,
  });
};

const handleDisconnect = async (req: Request, body: any) => {
  const requester = await requireRequester(req);
  if (!requester.ok) {
    return requester.response;
  }

  const provider = normalizeProvider(body?.provider);
  if (!provider) {
    return json({ success: false, message: "Geçersiz sağlayıcı" }, 400);
  }

  await requester.serviceClient
    .from("external_sync_state")
    .delete()
    .eq("user_id", requester.requesterProfile.id)
    .eq("provider", provider);

  const { error } = await requester.serviceClient
    .from("external_provider_accounts")
    .delete()
    .eq("user_id", requester.requesterProfile.id)
    .eq("provider", provider);

  if (error) {
    return json({ success: false, message: "Bağlantı kesilemedi" }, 500);
  }

  return json({ success: true, provider });
};

const handleGetStatus = async (req: Request) => {
  const requester = await requireRequester(req);
  if (!requester.ok) {
    return requester.response;
  }

  const [{ data: accountRows }, { data: syncRows }] = await Promise.all([
    requester.serviceClient
      .from("external_provider_accounts")
      .select("*")
      .eq("user_id", requester.requesterProfile.id),
    requester.serviceClient
      .from("external_sync_state")
      .select("provider, last_sync_at, last_error, last_error_at")
      .eq("user_id", requester.requesterProfile.id)
      .order("last_sync_at", { ascending: false }),
  ]);

  const accounts = getAccountMap(accountRows);
  const groupedSyncRows = new Map<ExternalSyncProvider, any[]>();
  for (const row of syncRows || []) {
    const provider = normalizeProvider(row?.provider);
    if (!provider) {
      continue;
    }

    const bucket = groupedSyncRows.get(provider) || [];
    bucket.push(row);
    groupedSyncRows.set(provider, bucket);
  }

  const providers = (["myanimelist", "anilist"] as ExternalSyncProvider[]).map((provider) => {
    const account = accounts.get(provider);
    const syncBucket = groupedSyncRows.get(provider) || [];
    const latestSyncAt = syncBucket.find((row) => normalizeText(row?.last_sync_at))?.last_sync_at || null;
    const latestSyncError = syncBucket.find((row) => normalizeText(row?.last_error));

    return {
      provider,
      account: {
        connected: Boolean(account),
        providerUserId: account?.provider_user_id || null,
        connectedAt: account?.connected_at || null,
        updatedAt: account?.updated_at || null,
        lastSyncAt: latestSyncAt,
        lastError: latestSyncError?.last_error || account?.last_error || null,
        lastErrorAt: latestSyncError?.last_error_at || account?.last_error_at || null,
      },
    };
  });

  return json({
    success: true,
    providers,
  });
};

const syncSingleManga = async (req: Request, body: any) => {
  const requester = await requireRequester(req);
  if (!requester.ok) {
    return requester.response;
  }

  const mangaId = normalizeText(body?.mangaId);
  const trigger = normalizeText(body?.trigger) as SyncTrigger;
  if (!mangaId) {
    return json({ success: false, message: "mangaId zorunlu" }, 400);
  }

  const requestedProviders = getRequestedProviders(body?.providers);
  const result = await syncMangaRecord({
    requester,
    mangaId,
    trigger,
    requestedProviders,
  });

  return json({
    success: true,
    mangaId,
    title: result.title,
    results: result.results,
  });
};

const syncLibrary = async (req: Request, body: any) => {
  const requester = await requireRequester(req);
  if (!requester.ok) {
    return requester.response;
  }

  const requestedProviders = getRequestedProviders(body?.providers);
  const [
    { data: favoriteRows },
    { data: ratingRows },
    { data: reviewRows },
    { data: readRows },
    { data: readingProgressRows },
  ] = await Promise.all([
    requester.serviceClient
      .from("favorites")
      .select("manga_id")
      .eq("user_id", requester.requesterProfile.id),
    requester.serviceClient
      .from("ratings")
      .select("manga_id")
      .eq("user_id", requester.requesterProfile.id),
    requester.serviceClient
      .from("reviews")
      .select("manga_id")
      .eq("user_id", requester.requesterProfile.id),
    requester.serviceClient
      .from("chapter_read_progress")
      .select("manga_id")
      .eq("user_id", requester.requesterProfile.id),
    requester.serviceClient
      .from("reading_progress")
      .select("manga_id")
      .eq("user_id", requester.requesterProfile.id),
  ]);

  const mangaIds = [
    ...(favoriteRows || []).map((row: any) => normalizeText(row?.manga_id)),
    ...(ratingRows || []).map((row: any) => normalizeText(row?.manga_id)),
    ...(reviewRows || []).map((row: any) => normalizeText(row?.manga_id)),
    ...(readRows || []).map((row: any) => normalizeText(row?.manga_id)),
    ...(readingProgressRows || []).map((row: any) => normalizeText(row?.manga_id)),
  ].filter(Boolean);

  const uniqueMangaIds = [...new Set(mangaIds)];
  const results: SyncMangaExecutionResult[] = [];

  for (const mangaId of uniqueMangaIds) {
    results.push(await syncMangaRecord({
      requester,
      mangaId,
      trigger: "manual",
      requestedProviders,
    }));
  }

  return json({
    success: true,
    mangaCount: uniqueMangaIds.length,
    results,
    summary: buildSyncSummary(results),
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return await handleCallback(req);
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  const body = await parseJsonBody(req);
  const action = normalizeText(body?.action);

  switch (action) {
    case "begin-auth":
      return await handleBeginAuth(req, body);
    case "disconnect":
      return await handleDisconnect(req, body);
    case "get-status":
      return await handleGetStatus(req);
    case "sync-manga":
      return await syncSingleManga(req, body);
    case "sync-library":
      return await syncLibrary(req, body);
    case "import-library":
      return await importProviderLibrary(req, body);
    default:
      return json({ success: false, message: "Geçersiz action" }, 400);
  }
});
