import type { HomePageMangaSections } from '@/lib/database';
import type { Tag } from '@/lib/types';

const HOME_FEED_SESSION_CACHE_KEY = 'toonparrot-home-feed-v1';
const HOME_FEED_SESSION_CACHE_VERSION = 1;

export const HOME_SECTIONS_CACHE_TTL_MS = 60_000;
export const HOME_SECTIONS_MAX_SEED_AGE_MS = 30 * 60_000;
export const TRENDING_TAGS_CACHE_TTL_MS = 5 * 60_000;
export const TRENDING_TAGS_MAX_SEED_AGE_MS = 30 * 60_000;
export const TOP_TEN_WEEK_CACHE_TTL_MS = 2 * 60_000;
export const TOP_TEN_WEEK_MAX_SEED_AGE_MS = 10 * 60_000;

interface PersistedHomeFeedEntry<T> {
  fetchedAt: number;
  value: T;
}

interface PersistedHomeFeedCache {
  version: number;
  sections?: PersistedHomeFeedEntry<HomePageMangaSections>;
  trendingTags?: PersistedHomeFeedEntry<Tag[]>;
  topTenWeekIds?: PersistedHomeFeedEntry<string[]>;
}

export interface HomeFeedSeedEntry<T> {
  fetchedAt: number;
  value: T;
}

export interface HomeFeedSeed {
  sections: HomeFeedSeedEntry<HomePageMangaSections> | null;
  trendingTags: HomeFeedSeedEntry<Tag[]> | null;
  topTenWeekIds: HomeFeedSeedEntry<ReadonlySet<string>> | null;
}

const isValidFetchedAt = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value > 0
);

const isRenderableSeed = (fetchedAt: number, maxAgeMs: number) => (
  Date.now() - fetchedAt <= maxAgeMs
);

const readPersistedHomeFeedCache = (): PersistedHomeFeedCache | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(HOME_FEED_SESSION_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedHomeFeedCache | null;
    if (!parsed || parsed.version !== HOME_FEED_SESSION_CACHE_VERSION) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const writePersistedHomeFeedCache = (
  updater: (current: PersistedHomeFeedCache) => PersistedHomeFeedCache,
) => {
  if (typeof window === 'undefined') {
    return;
  }

  const current = readPersistedHomeFeedCache() ?? {
    version: HOME_FEED_SESSION_CACHE_VERSION,
  };

  const next = updater({
    ...current,
    version: HOME_FEED_SESSION_CACHE_VERSION,
  });

  window.sessionStorage.setItem(
    HOME_FEED_SESSION_CACHE_KEY,
    JSON.stringify({
      ...next,
      version: HOME_FEED_SESSION_CACHE_VERSION,
    }),
  );
};

export const isHomeFeedEntryFresh = (fetchedAt: number, ttlMs: number) => (
  Date.now() - fetchedAt < ttlMs
);

export const readHomeFeedSeed = (): HomeFeedSeed => {
  const persisted = readPersistedHomeFeedCache();

  const sections = persisted?.sections;
  const trendingTags = persisted?.trendingTags;
  const topTenWeekIds = persisted?.topTenWeekIds;

  return {
    sections: sections && isValidFetchedAt(sections.fetchedAt) && isRenderableSeed(sections.fetchedAt, HOME_SECTIONS_MAX_SEED_AGE_MS)
      ? sections
      : null,
    trendingTags: trendingTags && isValidFetchedAt(trendingTags.fetchedAt) && Array.isArray(trendingTags.value) && isRenderableSeed(trendingTags.fetchedAt, TRENDING_TAGS_MAX_SEED_AGE_MS)
      ? trendingTags
      : null,
    topTenWeekIds: topTenWeekIds && isValidFetchedAt(topTenWeekIds.fetchedAt) && Array.isArray(topTenWeekIds.value) && isRenderableSeed(topTenWeekIds.fetchedAt, TOP_TEN_WEEK_MAX_SEED_AGE_MS)
      ? {
          fetchedAt: topTenWeekIds.fetchedAt,
          value: new Set(topTenWeekIds.value.filter((value): value is string => typeof value === 'string' && value.length > 0)),
        }
      : null,
  };
};

export const writeHomeSectionsCache = (
  sections: HomePageMangaSections,
  fetchedAt = Date.now(),
) => {
  writePersistedHomeFeedCache((current) => ({
    ...current,
    sections: {
      fetchedAt,
      value: sections,
    },
  }));
};

export const writeTrendingTagsCache = (
  tags: Tag[],
  fetchedAt = Date.now(),
) => {
  writePersistedHomeFeedCache((current) => ({
    ...current,
    trendingTags: {
      fetchedAt,
      value: tags,
    },
  }));
};

export const writeTopTenWeekIdsCache = (
  ids: ReadonlySet<string>,
  fetchedAt = Date.now(),
) => {
  writePersistedHomeFeedCache((current) => ({
    ...current,
    topTenWeekIds: {
      fetchedAt,
      value: [...ids],
    },
  }));
};

export const clearHomeFeedCache = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(HOME_FEED_SESSION_CACHE_KEY);
};
