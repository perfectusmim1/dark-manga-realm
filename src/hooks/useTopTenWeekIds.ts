import { useEffect, useState } from 'react';
import { getTopTenMangaIds } from '@/lib/database';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

export const useTopTenWeekIds = (enabled = true) => {
  const { isOnline } = useEffectiveOnlineStatus();
  const [topTenWeekIds, setTopTenWeekIds] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (!enabled || !isOnline) {
      setTopTenWeekIds(null);
      return;
    }

    let active = true;

    void getTopTenMangaIds('week')
      .then((ids) => {
        if (active) {
          setTopTenWeekIds(ids);
        }
      })
      .catch((error) => {
        console.error('Top ten week id loading error:', error);
        if (active) {
          setTopTenWeekIds(new Set<string>());
        }
      });

    return () => {
      active = false;
    };
  }, [enabled, isOnline]);

  return topTenWeekIds;
};
