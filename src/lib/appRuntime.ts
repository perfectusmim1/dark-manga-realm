import { Capacitor } from '@capacitor/core';
import * as React from 'react';

export interface AppRuntime {
  isNativeApp: boolean;
  isStandalonePwa: boolean;
  platform: string;
}

const getStandaloneDisplayMode = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia('(display-mode: standalone)').matches
    || navigatorWithStandalone.standalone === true
  );
};

export const getAppRuntime = (): AppRuntime => {
  const isNativeApp = Capacitor.isNativePlatform();

  return {
    isNativeApp,
    isStandalonePwa: !isNativeApp && getStandaloneDisplayMode(),
    platform: Capacitor.getPlatform(),
  };
};

export const isNativeApp = () => getAppRuntime().isNativeApp;

export const useAppRuntime = () => {
  const [runtime] = React.useState(getAppRuntime);

  return runtime;
};
