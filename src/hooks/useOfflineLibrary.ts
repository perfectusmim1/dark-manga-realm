import { useCallback, useEffect, useState } from 'react';
import { getOfflineLibrarySnapshot, subscribeOfflineLibrary } from '@/lib/offline/offlineStorage';
import { OfflineLibrarySnapshot } from '@/lib/offline/types';

const EMPTY_SNAPSHOT: OfflineLibrarySnapshot = {
  series: [],
  jobs: [],
  stats: {
    usedBytes: 0,
    browserUsageBytes: undefined,
    quotaBytes: undefined,
    seriesCount: 0,
    chapterCount: 0,
    activeDownloads: 0,
  },
};

export const useOfflineLibrary = () => {
  const [snapshot, setSnapshot] = useState<OfflineLibrarySnapshot>(EMPTY_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const refresh = useCallback(async () => {
    const nextSnapshot = await getOfflineLibrarySnapshot();
    setSnapshot(nextSnapshot);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();

    const unsubscribe = subscribeOfflineLibrary(() => {
      setIsOnline(navigator.onLine);
      void refresh();
    });

    return unsubscribe;
  }, [refresh]);

  return {
    snapshot,
    isLoading,
    isOnline,
    refresh,
  };
};
