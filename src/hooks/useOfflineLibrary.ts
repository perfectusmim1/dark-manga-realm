import { useCallback, useEffect, useRef, useState } from 'react';
import { getOfflineLibrarySnapshot, subscribeOfflineLibrary } from '@/lib/offline/offlineStorage';
import { OfflineLibrarySnapshot } from '@/lib/offline/types';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

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

export const useOfflineLibrary = (options?: { throttleMs?: number }) => {
  const [snapshot, setSnapshot] = useState<OfflineLibrarySnapshot>(EMPTY_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const { isOnline } = useEffectiveOnlineStatus();
  const throttleMs = options?.throttleMs ?? 0;
  const timeoutRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const hasPendingRefreshRef = useRef(false);

  const refresh = useCallback(async () => {
    if (isRefreshingRef.current) {
      hasPendingRefreshRef.current = true;
      return;
    }

    isRefreshingRef.current = true;

    const nextSnapshot = await getOfflineLibrarySnapshot();
    try {
      setSnapshot(nextSnapshot);
      setIsLoading(false);
      lastRefreshAtRef.current = Date.now();
    } finally {
      isRefreshingRef.current = false;

      if (hasPendingRefreshRef.current) {
        hasPendingRefreshRef.current = false;
        void refresh();
      }
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (throttleMs <= 0 || typeof window === 'undefined') {
      void refresh();
      return;
    }

    if (timeoutRef.current !== null) {
      hasPendingRefreshRef.current = true;
      return;
    }

    const elapsed = Date.now() - lastRefreshAtRef.current;
    const delay = Math.max(0, throttleMs - elapsed);

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      void refresh();
    }, delay);
  }, [refresh, throttleMs]);

  useEffect(() => {
    void refresh();

    const unsubscribe = subscribeOfflineLibrary(() => {
      scheduleRefresh();
    });

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      unsubscribe();
    };
  }, [refresh, scheduleRefresh]);

  return {
    snapshot,
    isLoading,
    isOnline,
    refresh,
  };
};
