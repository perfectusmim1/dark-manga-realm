import { useEffect, useState } from 'react';
import {
  getOfflinePreferences,
  setOfflinePreferences,
  subscribeOfflinePreferences,
} from '@/lib/offline/preferences';

export const useOfflinePreferences = () => {
  const [preferences, setPreferencesState] = useState(getOfflinePreferences);

  useEffect(() => {
    const unsubscribe = subscribeOfflinePreferences(() => {
      setPreferencesState(getOfflinePreferences());
    });

    return unsubscribe;
  }, []);

  const updatePreferences = (patch: Partial<typeof preferences>) => {
    const nextValue = setOfflinePreferences(patch);
    setPreferencesState(nextValue);
  };

  return {
    preferences,
    updatePreferences,
  };
};

