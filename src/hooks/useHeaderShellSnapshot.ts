import { useEffect, useState } from 'react';
import {
  HEADER_SHELL_CACHE_EVENT,
  readHeaderShellSnapshot,
  type HeaderShellSnapshot,
} from '@/lib/headerShellCache';

export const useHeaderShellSnapshot = () => {
  const [snapshot, setSnapshot] = useState<HeaderShellSnapshot | null>(() => readHeaderShellSnapshot());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncSnapshot = () => {
      setSnapshot(readHeaderShellSnapshot());
    };

    window.addEventListener(HEADER_SHELL_CACHE_EVENT, syncSnapshot);

    return () => {
      window.removeEventListener(HEADER_SHELL_CACHE_EVENT, syncSnapshot);
    };
  }, []);

  return snapshot;
};
