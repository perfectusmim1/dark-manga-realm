import { invokeAuthenticatedFunction, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import type {
  AniListExternalSyncProviderPreferences,
  ExternalProviderConnectionState,
  ExternalRatingsCache,
  ExternalSourceLink,
  ExternalSyncPreferences,
  ExternalSyncProvider,
  ExternalSyncProviderPreferences,
  Manga,
  User,
} from '@/lib/types';

export const EXTERNAL_SYNC_PROVIDERS = ['myanimelist', 'anilist'] as const satisfies ExternalSyncProvider[];

export const DEFAULT_EXTERNAL_SYNC_PREFERENCES: ExternalSyncPreferences = {
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
};

export type ExternalSyncTrigger =
  | 'manual'
  | 'reading'
  | 'category'
  | 'favorite'
  | 'rating'
  | 'review';

export interface ExternalProviderStatusResponse {
  provider: ExternalSyncProvider;
  account: ExternalProviderConnectionState;
}

export interface ExternalSyncStatusResponse {
  success: boolean;
  providers: ExternalProviderStatusResponse[];
}

export interface ExternalProviderSyncResult {
  provider: ExternalSyncProvider;
  success: boolean;
  skipped?: boolean;
  message?: string;
  warning?: string | null;
}

export interface ExternalMangaSyncResponse {
  success: boolean;
  mangaId: string;
  title?: string;
  results: ExternalProviderSyncResult[];
}

export interface ExternalLibrarySyncResponse {
  success: boolean;
  mangaCount: number;
  results: Array<{
    mangaId: string;
    title?: string;
    results: ExternalProviderSyncResult[];
  }>;
  summary: {
    synced: number;
    skipped: number;
    failed: number;
    warnings: number;
  };
}

export interface ExternalLibraryImportResponse {
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
}

const MAL_MANGA_ID_PATTERN = /\/manga\/(\d+)/i;
const ANILIST_MANGA_ID_PATTERN = /\/manga\/(\d+)/i;

const normalizeText = (value?: string | null) => value?.trim().replace(/\s+/g, ' ') || '';

const normalizeProviderUrl = (provider: ExternalSyncProvider, value: string) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  if (/^\d+$/.test(normalized)) {
    return provider === 'myanimelist'
      ? `https://myanimelist.net/manga/${normalized}`
      : `https://anilist.co/manga/${normalized}`;
  }

  return normalized;
};

export const normalizeExternalSyncPreferences = (preferences?: User['preferences']): ExternalSyncPreferences => ({
  global: {
    ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.global,
    ...preferences?.externalSync?.global,
  },
  providers: {
    myanimelist: {
      ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.myanimelist,
      ...preferences?.externalSync?.providers?.myanimelist,
      fieldToggles: {
        ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.myanimelist.fieldToggles,
        ...preferences?.externalSync?.providers?.myanimelist?.fieldToggles,
      },
    },
    anilist: {
      ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.anilist,
      ...preferences?.externalSync?.providers?.anilist,
      fieldToggles: {
        ...DEFAULT_EXTERNAL_SYNC_PREFERENCES.providers.anilist.fieldToggles,
        ...preferences?.externalSync?.providers?.anilist?.fieldToggles,
      },
    },
  },
});

const parseExternalProviderId = (provider: ExternalSyncProvider, input?: string | null) => {
  const normalized = normalizeText(input);
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  const matcher = provider === 'myanimelist'
    ? MAL_MANGA_ID_PATTERN
    : ANILIST_MANGA_ID_PATTERN;

  return normalized.match(matcher)?.[1];
};

export const normalizeExternalSourceLinkInput = (
  provider: ExternalSyncProvider,
  input?: string | null,
): ExternalSourceLink | null => {
  const normalizedUrl = normalizeProviderUrl(provider, input || '');
  if (!normalizedUrl) {
    return null;
  }

  const externalId = parseExternalProviderId(provider, normalizedUrl);
  return {
    source: provider,
    url: normalizedUrl,
    externalId,
    kind: 'series',
  };
};

export const upsertExternalSourceLink = (
  sourceLinks: ExternalSourceLink[] | undefined,
  nextLink: ExternalSourceLink | null,
): ExternalSourceLink[] => {
  const currentLinks = Array.isArray(sourceLinks) ? sourceLinks : [];
  const normalizedLinks = currentLinks.filter((link) => normalizeText(link?.url));

  if (!nextLink) {
    return normalizedLinks;
  }

  const nextSource = normalizeText(nextLink.source);
  const withoutCurrentProvider = normalizedLinks.filter(
    (link) => normalizeText(link.source) !== nextSource,
  );

  return [...withoutCurrentProvider, nextLink];
};

export const getExternalSourceLink = (
  sourceLinks: ExternalSourceLink[] | undefined,
  provider: ExternalSyncProvider,
) => (sourceLinks || []).find((link) => normalizeText(link.source) === provider);

export const isExternalProviderSupported = (
  sourceLinks: ExternalSourceLink[] | undefined,
  provider: ExternalSyncProvider,
) => Boolean(
  getExternalSourceLink(sourceLinks, provider)?.externalId
  || getExternalSourceLink(sourceLinks, provider)?.url,
);

export const getMangaExternalRatings = (manga?: Pick<Manga, 'details'> | null): ExternalRatingsCache => {
  const rawRatings = manga?.details?.extra?.externalRatings;
  if (!rawRatings || typeof rawRatings !== 'object' || Array.isArray(rawRatings)) {
    return {};
  }

  return rawRatings as ExternalRatingsCache;
};

const createFunctionUrl = (functionName: string) => `${supabaseUrl}/functions/v1/${functionName}`;

export const beginExternalProviderAuth = async (
  provider: ExternalSyncProvider,
  redirectPath = '/settings?tab=sync',
) => {
  const response = await invokeAuthenticatedFunction<{
    success?: boolean;
    authorizeUrl?: string;
    message?: string;
  }>('external-sync', {
    action: 'begin-auth',
    provider,
    redirectPath,
  });

  if (!response?.success || !response.authorizeUrl) {
    throw new Error(response?.message || 'Bağlantı başlatılamadı');
  }

  window.location.assign(response.authorizeUrl);
};

export const disconnectExternalProvider = async (provider: ExternalSyncProvider) => {
  const response = await invokeAuthenticatedFunction<{
    success?: boolean;
    message?: string;
  }>('external-sync', {
    action: 'disconnect',
    provider,
  });

  if (!response?.success) {
    throw new Error(response?.message || 'Bağlantı kesilemedi');
  }

  return response;
};

export const getExternalSyncStatuses = () => (
  invokeAuthenticatedFunction<ExternalSyncStatusResponse>('external-sync', {
    action: 'get-status',
  })
);

export const syncMangaToExternalProviders = async (params: {
  mangaId: string;
  trigger: ExternalSyncTrigger;
  providers?: ExternalSyncProvider[];
}) => {
  const response = await invokeAuthenticatedFunction<ExternalMangaSyncResponse & {
    message?: string;
  }>('external-sync', {
    action: 'sync-manga',
    mangaId: params.mangaId,
    trigger: params.trigger,
    providers: params.providers,
  });

  if (!response?.success) {
    throw new Error(response?.message || 'Harici senkron başarısız oldu');
  }

  return response;
};

export const syncLibraryToExternalProviders = async (params?: {
  providers?: ExternalSyncProvider[];
}) => {
  const response = await invokeAuthenticatedFunction<ExternalLibrarySyncResponse & {
    message?: string;
  }>('external-sync', {
    action: 'sync-library',
    providers: params?.providers,
  });

  if (!response?.success) {
    throw new Error(response?.message || 'Harici kütüphane senkronu başarısız oldu');
  }

  return response;
};

export const importLibraryFromExternalProvider = async (provider: ExternalSyncProvider) => {
  const response = await invokeAuthenticatedFunction<ExternalLibraryImportResponse & {
    message?: string;
  }>('external-sync', {
    action: 'import-library',
    provider,
  });

  if (!response?.success) {
    throw new Error(response?.message || 'Harici kütüphane içe aktarma başarısız oldu');
  }

  return response;
};

export const refreshMangaExternalRatings = async (mangaId: string) => {
  const response = await fetch(createFunctionUrl('external-ratings-refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ mangaId }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : 'Harici puanlar yenilenemedi';
    throw new Error(message);
  }

  return payload as {
    success: boolean;
    ratings?: ExternalRatingsCache;
    details?: Manga['details'];
  };
};

export const withExternalProviderConnection = <TProviderState extends ExternalSyncProviderPreferences | AniListExternalSyncProviderPreferences>(
  providerPreferences: TProviderState,
  account?: ExternalProviderConnectionState | null,
) => ({
  ...providerPreferences,
  connected: Boolean(account?.connected || providerPreferences.connected),
});
