import { useEffect, useMemo, useState } from 'react';
import { getOfflinePreferences, subscribeOfflinePreferences } from '@/lib/offline/preferences';

export const useEffectiveOnlineStatus = () => {
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [forceOfflineMode, setForceOfflineMode] = useState(() => getOfflinePreferences().forceOfflineMode);

  useEffect(() => {
    const syncNetwork = () => {
      setNetworkOnline(navigator.onLine);
    };

    const unsubscribe = subscribeOfflinePreferences(() => {
      setForceOfflineMode(getOfflinePreferences().forceOfflineMode);
    });

    window.addEventListener('online', syncNetwork);
    window.addEventListener('offline', syncNetwork);

    return () => {
      unsubscribe();
      window.removeEventListener('online', syncNetwork);
      window.removeEventListener('offline', syncNetwork);
    };
  }, []);

  const isOnline = useMemo(
    () => networkOnline && !forceOfflineMode,
    [forceOfflineMode, networkOnline],
  );

  return {
    isOnline,
    networkOnline,
    forceOfflineMode,
  };
};
