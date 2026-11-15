import * as React from 'react';

const MOBILE_MAX_WIDTH = 767;
const TABLET_MAX_WIDTH = 1023;
const LOW_END_MEMORY_GB = 4;
const LOW_END_CPU_CORES = 4;

export interface DeviceProfile {
  isMobile: boolean;
  isTablet: boolean;
  isPortrait: boolean;
  isLandscape: boolean;
  isCoarsePointer: boolean;
  prefersReducedMotion: boolean;
  isLowEndDevice: boolean;
  disableHeavyEffects: boolean;
}

const SERVER_DEVICE_PROFILE: DeviceProfile = {
  isMobile: false,
  isTablet: false,
  isPortrait: false,
  isLandscape: true,
  isCoarsePointer: false,
  prefersReducedMotion: false,
  isLowEndDevice: false,
  disableHeavyEffects: false,
};

let portraitMediaQuery: MediaQueryList | null = null;
let coarsePointerMediaQuery: MediaQueryList | null = null;
let reducedMotionMediaQuery: MediaQueryList | null = null;
let cachedDeviceProfile: DeviceProfile | null = null;
const profileListeners = new Set<() => void>();
let resizeRafId: number | null = null;
let listenersAttached = false;

const ensureMediaQueries = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  if (!portraitMediaQuery) {
    portraitMediaQuery = window.matchMedia('(orientation: portrait)');
  }
  if (!coarsePointerMediaQuery) {
    coarsePointerMediaQuery = window.matchMedia('(pointer: coarse)');
  }
  if (!reducedMotionMediaQuery) {
    reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
};

const computeDeviceProfile = (): DeviceProfile => {
  if (typeof window === 'undefined') {
    return SERVER_DEVICE_PROFILE;
  }

  ensureMediaQueries();
  const width = window.innerWidth;
  const isMobile = width <= MOBILE_MAX_WIDTH;
  const isTablet = width > MOBILE_MAX_WIDTH && width <= TABLET_MAX_WIDTH;
  const isPortrait = portraitMediaQuery ? portraitMediaQuery.matches : window.innerHeight > width;
  const isCoarsePointer = coarsePointerMediaQuery ? coarsePointerMediaQuery.matches : false;
  const prefersReducedMotion = reducedMotionMediaQuery ? reducedMotionMediaQuery.matches : false;

  const navigatorWithDeviceMemory = navigator as Navigator & { deviceMemory?: number };
  const isLowCpu = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= LOW_END_CPU_CORES;
  const isLowMemory = typeof navigatorWithDeviceMemory.deviceMemory === 'number' && navigatorWithDeviceMemory.deviceMemory <= LOW_END_MEMORY_GB;
  const isLowEndDevice = prefersReducedMotion || isLowCpu || isLowMemory;

  return {
    isMobile,
    isTablet,
    isPortrait,
    isLandscape: !isPortrait,
    isCoarsePointer,
    prefersReducedMotion,
    isLowEndDevice,
    disableHeavyEffects: isLowEndDevice || (isMobile && isCoarsePointer),
  };
};

const isSameDeviceProfile = (left: DeviceProfile, right: DeviceProfile) => (
  left.isMobile === right.isMobile
  && left.isTablet === right.isTablet
  && left.isPortrait === right.isPortrait
  && left.isLandscape === right.isLandscape
  && left.isCoarsePointer === right.isCoarsePointer
  && left.prefersReducedMotion === right.prefersReducedMotion
  && left.isLowEndDevice === right.isLowEndDevice
  && left.disableHeavyEffects === right.disableHeavyEffects
);

const getSharedDeviceProfile = (): DeviceProfile => {
  if (typeof window === 'undefined') {
    return SERVER_DEVICE_PROFILE;
  }
  if (!cachedDeviceProfile) {
    cachedDeviceProfile = computeDeviceProfile();
  }
  return cachedDeviceProfile;
};

const notifyIfProfileChanged = () => {
  const nextProfile = computeDeviceProfile();
  if (cachedDeviceProfile && isSameDeviceProfile(cachedDeviceProfile, nextProfile)) {
    return;
  }
  cachedDeviceProfile = nextProfile;
  profileListeners.forEach((listener) => listener());
};

const handleWindowResize = () => {
  if (resizeRafId !== null || typeof window === 'undefined') {
    return;
  }
  resizeRafId = window.requestAnimationFrame(() => {
    resizeRafId = null;
    notifyIfProfileChanged();
  });
};

const handleMediaChange = () => {
  notifyIfProfileChanged();
};

const attachGlobalProfileListeners = () => {
  if (listenersAttached || typeof window === 'undefined') {
    return;
  }
  listenersAttached = true;
  ensureMediaQueries();
  window.addEventListener('resize', handleWindowResize, { passive: true });
  portraitMediaQuery?.addEventListener('change', handleMediaChange);
  coarsePointerMediaQuery?.addEventListener('change', handleMediaChange);
  reducedMotionMediaQuery?.addEventListener('change', handleMediaChange);
};

const detachGlobalProfileListeners = () => {
  if (!listenersAttached || typeof window === 'undefined') {
    return;
  }
  listenersAttached = false;
  if (resizeRafId !== null) {
    window.cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
  window.removeEventListener('resize', handleWindowResize);
  portraitMediaQuery?.removeEventListener('change', handleMediaChange);
  coarsePointerMediaQuery?.removeEventListener('change', handleMediaChange);
  reducedMotionMediaQuery?.removeEventListener('change', handleMediaChange);
};

const subscribeDeviceProfile = (listener: () => void) => {
  profileListeners.add(listener);
  if (profileListeners.size === 1) {
    attachGlobalProfileListeners();
  }
  return () => {
    profileListeners.delete(listener);
    if (profileListeners.size === 0) {
      detachGlobalProfileListeners();
    }
  };
};

const getServerDeviceProfile = () => SERVER_DEVICE_PROFILE;

export const useDeviceProfile = (): DeviceProfile => (
  React.useSyncExternalStore(subscribeDeviceProfile, getSharedDeviceProfile, getServerDeviceProfile)
);
