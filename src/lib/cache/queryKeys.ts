import type { Manga } from '@/lib/types';

export type AudienceScope = 'safe' | 'adult';

export const siteQueryKeys = {
  all: ['site'] as const,
  homeSections: (audience: AudienceScope) => ['site', 'home-sections', audience] as const,
  homeCatalogPage: (
    audience: AudienceScope,
    page: number,
    pageSize: number,
    sort: 'updated' | 'popular' | 'newest',
  ) => ['site', 'home-catalog', audience, page, pageSize, sort] as const,
  trendingTags: (limit: number) => ['site', 'trending-tags', limit] as const,
  topTenWeekIds: () => ['site', 'top-ten-week-ids'] as const,
  topTenPage: () => ['site', 'top-ten-page'] as const,
  browseSummaries: (audience: AudienceScope, userId?: string | null) =>
    ['site', 'browse-summaries', audience, userId ?? 'anon'] as const,
  allTimeRanks: (audience: AudienceScope) => ['site', 'all-time-ranks', audience] as const,
  browseTagFilter: (slugsKey: string) => ['site', 'browse-tag-filter', slugsKey] as const,
  userProfile: (profileUserId: string, viewerId?: string | null) =>
    ['site', 'user-profile', profileUserId, viewerId ?? 'anon'] as const,
  entityTags: (entityType: 'manga' | 'character', entityId: string, viewerId?: string | null) =>
    ['site', 'entity-tags', entityType, entityId, viewerId ?? 'anon'] as const,
};

/**
 * Strict ID deduplication helper for cached/fetched manga lists.
 */
export const dedupeMangasById = <T extends Pick<Manga, 'id'>>(items: readonly T[]): T[] => {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique;
};
