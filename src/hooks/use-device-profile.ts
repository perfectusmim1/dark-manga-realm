import * as React from 'react';

const MOBILE_MAX_WIDTH = 767;
const TABLET_MAX_WIDTH = 1023;
const LOW_END_MEMORY_GB = 4;
const LOW_END_CPU_CORES = 4;

type Orientation = 'portrait' | 'landscape';

interface DeviceProfileSnapshot {
  width: number;
  orientation: Orientation;
  isCoarsePointer: boolean;
  prefersReducedMotion: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

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

const getDeviceProfileSnapshot = (): DeviceProfileSnapshot => {
  if (typeof window === 'undefined') {
    return {
      width: TABLET_MAX_WIDTH + 1,
      orientation: 'landscape',
      isCoarsePointer: false,
      prefersReducedMotion: false,
    };
  }

  const navigatorWithDeviceMemory = navigator as Navigator & { deviceMemory?: number };

  return {
    width: window.innerWidth,
    orientation: window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape',
    isCoarsePointer: window.matchMedia('(pointer: coarse)').matches,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigatorWithDeviceMemory.deviceMemory,
  };
};

export const useDeviceProfile = (): DeviceProfile => {
  const [snapshot, setSnapshot] = React.useState<DeviceProfileSnapshot>(getDeviceProfileSnapshot);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateSnapshot = () => {
      setSnapshot(getDeviceProfileSnapshot());
    };

    const mediaQueries = [
      window.matchMedia('(orientation: portrait)'),
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(prefers-reduced-motion: reduce)'),
    ];

    updateSnapshot();
    window.addEventListener('resize', updateSnapshot, { passive: true });
    mediaQueries.forEach((query) => query.addEventListener('change', updateSnapshot));

    return () => {
      window.removeEventListener('resize', updateSnapshot);
      mediaQueries.forEach((query) => query.removeEventListener('change', updateSnapshot));
    };
  }, []);

  return React.useMemo(() => {
    const isMobile = snapshot.width <= MOBILE_MAX_WIDTH;
    const isTablet = snapshot.width > MOBILE_MAX_WIDTH && snapshot.width <= TABLET_MAX_WIDTH;
    const isLowCpu = typeof snapshot.hardwareConcurrency === 'number' && snapshot.hardwareConcurrency <= LOW_END_CPU_CORES;
    const isLowMemory = typeof snapshot.deviceMemory === 'number' && snapshot.deviceMemory <= LOW_END_MEMORY_GB;
    const isLowEndDevice = snapshot.prefersReducedMotion || isLowCpu || isLowMemory;

    return {
      isMobile,
      isTablet,
      isPortrait: snapshot.orientation === 'portrait',
      isLandscape: snapshot.orientation === 'landscape',
      isCoarsePointer: snapshot.isCoarsePointer,
      prefersReducedMotion: snapshot.prefersReducedMotion,
      isLowEndDevice,
      disableHeavyEffects: isLowEndDevice || (isMobile && snapshot.isCoarsePointer),
    };
  }, [snapshot]);
};
