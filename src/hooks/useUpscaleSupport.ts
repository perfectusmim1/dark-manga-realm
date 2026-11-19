import { useEffect, useState, useSyncExternalStore } from 'react';
import { detectUpscaleSupport, getCachedUpscaleSupport } from '@/lib/upscale/support';
import type { UpscaleRuntimeStatus, UpscaleSupport } from '@/lib/upscale/types';
import { upscaleQueue } from '@/lib/upscale/upscaleQueue';

export const useUpscaleSupport = (): UpscaleSupport => {
  const [support, setSupport] = useState<UpscaleSupport>(() => getCachedUpscaleSupport());

  useEffect(() => {
    if (support.checked) return;
    let active = true;
    void detectUpscaleSupport().then((res) => {
      if (active) setSupport(res);
    });
    return () => {
      active = false;
    };
  }, [support.checked]);

  return support;
};

export const useUpscaleStatus = (): UpscaleRuntimeStatus =>
  useSyncExternalStore(
    upscaleQueue.subscribe,
    upscaleQueue.getSnapshot,
    upscaleQueue.getSnapshot,
  );
