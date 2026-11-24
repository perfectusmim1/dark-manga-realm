import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTopTenMangaIds } from '@/lib/database';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { siteQueryKeys } from '@/lib/cache/queryKeys';
import {
  TOP_TEN_WEEK_CACHE_TTL_MS,
  readHomeFeedSeed,
  writeTopTenWeekIdsCache,
} from '@/lib/homeFeedCache';

export const useTopTenWeekIds = (enabled = true): ReadonlySet<string> | null => {
  const { isOnline } = useEffectiveOnlineStatus();
  const seed = useMemo(() => readHomeFeedSeed('safe').topTenWeekIds, []);
  const seedIds = useMemo(
    () => (seed ? Array.from(seed.value) : undefined),
    [seed],
  );

  const query = useQuery<string[]>({
    queryKey: siteQueryKeys.topTenWeekIds(),
    queryFn: async () => {
      const ids = await getTopTenMangaIds('week');
      const uniqueIds = Array.from(ids);
      writeTopTenWeekIdsCache(ids, Date.now());
      return uniqueIds;
    },
    enabled: enabled && isOnline,
    staleTime: TOP_TEN_WEEK_CACHE_TTL_MS,
    initialData: seedIds,
    initialDataUpdatedAt: seed?.fetchedAt,
  });

  return useMemo(() => {
    if (!enabled || !isOnline) {
      return null;
    }
    if (!query.data) {
      return null;
    }
    return new Set(query.data);
  }, [enabled, isOnline, query.data]);
};
