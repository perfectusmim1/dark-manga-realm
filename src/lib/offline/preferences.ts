export interface OfflinePreferences {
  compressedDownloads: boolean;
  forceOfflineMode: boolean;
}

const OFFLINE_PREFERENCES_KEY = 'toonparrot_offline_preferences';
const OFFLINE_PREFERENCES_EVENT = 'toonparrot:offline-preferences-updated';

const DEFAULT_OFFLINE_PREFERENCES: OfflinePreferences = {
  compressedDownloads: true,
  forceOfflineMode: false,
};

const canUseStorage = () => typeof window !== 'undefined';

export const getOfflinePreferences = (): OfflinePreferences => {
  if (!canUseStorage()) {
    return DEFAULT_OFFLINE_PREFERENCES;
  }

  const raw = window.localStorage.getItem(OFFLINE_PREFERENCES_KEY);
  if (!raw) {
    return DEFAULT_OFFLINE_PREFERENCES;
  }

  try {
    return {
      ...DEFAULT_OFFLINE_PREFERENCES,
      ...JSON.parse(raw),
    };
  } catch {
    return DEFAULT_OFFLINE_PREFERENCES;
  }
};

export const setOfflinePreferences = (patch: Partial<OfflinePreferences>) => {
  if (!canUseStorage()) {
    return DEFAULT_OFFLINE_PREFERENCES;
  }

  const nextValue = {
    ...getOfflinePreferences(),
    ...patch,
  };

  window.localStorage.setItem(OFFLINE_PREFERENCES_KEY, JSON.stringify(nextValue));
  window.dispatchEvent(new Event(OFFLINE_PREFERENCES_EVENT));
  return nextValue;
};

export const subscribeOfflinePreferences = (listener: () => void) => {
  if (!canUseStorage()) {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === OFFLINE_PREFERENCES_KEY) {
      listener();
    }
  };

  window.addEventListener(OFFLINE_PREFERENCES_EVENT, listener);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(OFFLINE_PREFERENCES_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
};
