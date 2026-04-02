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
  sha256Hex,
  toAniListFuzzyDate,
  toDateOnly,
} from "../_shared/external-sync.ts";

type LocalLibraryStatus = "reading" | "plan_to_read" | "completed" | "on_hold" | "dropped";
type SyncTrigger = "manual" | "reading" | "category" | "rating" | "review";

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
        review: true,
      },
    },
  },
} as const;

const normalizeText = (value?: string | null) => value?.trim().replace(/\s+/g, " ") || "";

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

const buildAniListReviewPayload = async (review: any) => {
  const content = normalizeText(review?.content);
  if (!content) {
    return {
      enabled: false,
      warning: null,
      summary: null,
      body: null,
      hash: null,
    };
  }

  const scoreLines = [
    `Story: ${Number(review?.rating_story || 0)}/10`,
    `Characters: ${Number(review?.rating_characters || 0)}/10`,
    `Art: ${Number(review?.rating_art || 0)}/10`,
    `Progression: ${Number(review?.rating_progression || 0)}/10`,
    `Engagement: ${Number(review?.rating_engagement || 0)}/10`,
  ];

  const summary = content.slice(0, 120).trim();
  const body = [
    "ToonParrot incelemesi",
    "",
    ...scoreLines,
    "",
    content,
  ].join("\n");

  if (summary.length < 20 || body.length < 2200) {
    return {
      enabled: false,
      warning: "AniList incelemeleri için en az 2200 karakterlik detaylı bir metin gerekiyor.",
      summary: null,
      body: null,
      hash: null,
    };
  }

  return {
    enabled: true,
    warning: null,
    summary,
    body,
    hash: await sha256Hex(`${summary}\n${body}`),
  };
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

const findExistingAniListReviewId = async (
  accessToken: string,
  mediaId: number,
  userId: number,
) => {
  const response = await runAniListGraphQL<{
    data?: {
      Page?: {
        reviews?: Array<{ id?: number | null }> | null;
      };
    };
  }>(
    accessToken,
    `
      query ExistingReview($mediaId: Int, $userId: Int) {
        Page(page: 1, perPage: 1) {
          reviews(mediaId: $mediaId, userId: $userId, sort: ID_DESC) {
            id
          }
        }
      }
    `,
    { mediaId, userId },
  );

  return response.data?.Page?.reviews?.[0]?.id
    ? String(response.data.Page.reviews[0].id)
    : null;
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
  account: ExternalProviderAccountRow;
  providerPreferences: ReturnType<typeof getExternalSyncPreferences>["providers"]["anilist"];
  derivedStatus: LocalLibraryStatus | null;
  readCount: number;
  rating?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  review: Awaited<ReturnType<typeof buildAniListReviewPayload>>;
}) => {
  const shouldCreateEntry = Boolean(
    !normalizeText(params.syncState?.remote_media_id)
    && (params.readCount > 0 || typeof params.rating === "number" || params.derivedStatus || params.review.enabled),
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

    didChange = Boolean(response?.data?.SaveMediaListEntry?.id);
  }

  let remoteReviewId = normalizeText(params.syncState?.remote_review_id) || null;
  let reviewWarning: string | null = params.review.warning;

  if (params.providerPreferences.fieldToggles.review && params.review.enabled) {
    if (!remoteReviewId && normalizeText(params.account.provider_user_id)) {
      remoteReviewId = await findExistingAniListReviewId(
        params.accessToken,
        Number(params.mediaId),
        Number(params.account.provider_user_id),
      );
    }

    const response = await runAniListGraphQL<{
      data?: {
        SaveReview?: {
          id?: number | null;
        };
      };
    }>(
      params.accessToken,
      `
        mutation SaveReview($id: Int, $mediaId: Int, $summary: String, $body: String) {
          SaveReview(id: $id, mediaId: $mediaId, summary: $summary, body: $body) {
            id
          }
        }
      `,
      {
        id: remoteReviewId ? Number(remoteReviewId) : undefined,
        mediaId: Number(params.mediaId),
        summary: params.review.summary,
        body: params.review.body,
      },
    );

    const savedReviewId = response?.data?.SaveReview?.id;
    if (savedReviewId) {
      remoteReviewId = String(savedReviewId);
      didChange = true;
      reviewWarning = null;
    }
  }

  return {
    changed: didChange,
    remoteReviewId,
    reviewWarning,
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
      .select("rating")
      .eq("user_id", params.requester.requesterProfile.id)
      .eq("manga_id", params.mangaId)
      .maybeSingle(),
    params.requester.serviceClient
      .from("reviews")
      .select("content, rating_story, rating_characters, rating_art, rating_progression, rating_engagement, updated_at")
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
  const reviewPayload = await buildAniListReviewPayload(reviewRow);
  const results: SyncProviderResult[] = [];

  for (const provider of params.requestedProviders) {
    const providerPrefs = preferences.providers[provider];
    const account = accountMap.get(provider);
    const syncState = syncStateMap.get(provider);
    const mediaLink = getProviderLink(mangaRow.source_links, provider);
    const mediaId = getProviderMediaId(mediaLink);

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
    const desiredScore = typeof ratingRow?.rating === "number" ? ratingRow.rating : null;
    const desiredProgress = readCount;
    const desiredStartedAt = startedAt;
    const desiredCompletedAt = completedAt;
    const shouldForceRetry = params.trigger === "manual" && normalizeText(syncState?.last_error);
    const fieldsChanged = Boolean(
      (desiredStatus || "") !== normalizeText(syncState?.last_synced_status)
      || desiredProgress !== Number(syncState?.last_synced_progress || 0)
      || Number(desiredScore || 0) !== Number(syncState?.last_synced_score || 0)
      || (desiredStartedAt || "") !== (toDateOnly(syncState?.last_synced_started_at) || "")
      || (desiredCompletedAt || "") !== (toDateOnly(syncState?.last_synced_completed_at) || "")
      || (
        provider === "anilist"
        && providerPrefs.fieldToggles.review
        && reviewPayload.enabled
        && reviewPayload.hash !== normalizeText(syncState?.last_review_hash)
      )
    );

    if (!fieldsChanged && !shouldForceRetry) {
      results.push({ provider, success: true, skipped: true, message: "Değişiklik yok" });
      continue;
    }

    try {
      const activeAccount = await ensureProviderAccessToken(params.requester.serviceClient, account);

      let warning: string | null = null;
      let remoteReviewId = normalizeText(syncState?.remote_review_id) || null;

      if (provider === "myanimelist") {
        await syncMyAnimeListEntry({
          accessToken: activeAccount.access_token,
          mediaId,
          syncState,
          providerPreferences: preferences.providers.myanimelist,
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
          account: activeAccount,
          providerPreferences: preferences.providers.anilist,
          derivedStatus,
          readCount,
          rating: desiredScore,
          startedAt: desiredStartedAt,
          completedAt: desiredCompletedAt,
          review: reviewPayload,
        });

        remoteReviewId = aniListResult.remoteReviewId;
        warning = aniListResult.reviewWarning;
      }

      await upsertSyncState(params.requester.serviceClient, {
        user_id: params.requester.requesterProfile.id,
        manga_id: params.mangaId,
        provider,
        remote_media_id: mediaId,
        remote_review_id: remoteReviewId,
        last_synced_status: desiredStatus || null,
        last_synced_progress: providerPrefs.fieldToggles.progress ? desiredProgress : null,
        last_synced_score: providerPrefs.fieldToggles.score ? desiredScore : null,
        last_synced_started_at: providerPrefs.fieldToggles.dates ? desiredStartedAt : null,
        last_synced_completed_at: providerPrefs.fieldToggles.dates ? desiredCompletedAt : null,
        last_review_hash: provider === "anilist" && providerPrefs.fieldToggles.review && reviewPayload.enabled
          ? reviewPayload.hash
          : null,
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
        last_synced_progress: syncState?.last_synced_progress || null,
        last_synced_score: syncState?.last_synced_score || null,
        last_synced_started_at: syncState?.last_synced_started_at || null,
        last_synced_completed_at: syncState?.last_synced_completed_at || null,
        last_review_hash: syncState?.last_review_hash || null,
        last_sync_at: syncState?.last_sync_at || null,
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
    default:
      return json({ success: false, message: "Geçersiz action" }, 400);
  }
});
