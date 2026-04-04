import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAppRuntime } from '@/lib/appRuntime';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

const PWA_INSTALLED_KEY = 'toonparrot_pwa_installed';

const getInstalledMarker = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(PWA_INSTALLED_KEY) === 'true';
};

const setInstalledMarker = (value: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (value) {
    window.localStorage.setItem(PWA_INSTALLED_KEY, 'true');
    return;
  }

  window.localStorage.removeItem(PWA_INSTALLED_KEY);
};

const getStandaloneState = () => {
  if (getAppRuntime().isNativeApp) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || navigatorWithStandalone.standalone === true
    || getInstalledMarker()
  );
};

const getIsIos = () => {
  if (getAppRuntime().isNativeApp) {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
};

export const usePwaInstall = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(getStandaloneState);
  const [isIos, setIsIos] = useState(getIsIos);

  useEffect(() => {
    if (getAppRuntime().isNativeApp) {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setIsIos(false);
      return;
    }

    if (getStandaloneState()) {
      setInstalledMarker(true);
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstalledMarker(false);
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setIsInstalled(getStandaloneState());
    };

    const handleAppInstalled = () => {
      setInstalledMarker(true);
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const handleDisplayModeChange = () => {
      if (window.matchMedia('(display-mode: standalone)').matches) {
        setInstalledMarker(true);
      }

      setIsInstalled(getStandaloneState());
      setIsIos(getIsIos());
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.matchMedia('(display-mode: standalone)').addEventListener('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.matchMedia('(display-mode: standalone)').removeEventListener('change', handleDisplayModeChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return null;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    if (choice.outcome === 'accepted') {
      setInstalledMarker(true);
      setIsInstalled(true);
    }

    setDeferredPrompt(null);
    return choice.outcome;
  }, [deferredPrompt]);

  const canInstall = useMemo(
    () => !isInstalled && Boolean(deferredPrompt),
    [deferredPrompt, isInstalled],
  );

  return {
    canInstall,
    isInstalled,
    isIos,
    promptInstall,
  };
};
