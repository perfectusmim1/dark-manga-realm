import { useCallback, useEffect, useState } from 'react';

interface UseNearViewportOptions {
  rootMargin?: string;
  once?: boolean;
  disabled?: boolean;
  threshold?: number | number[];
  initialVisible?: boolean;
}

export const useNearViewport = <T extends Element>({
  rootMargin = '480px 0px',
  once = true,
  disabled = false,
  threshold = 0.01,
  initialVisible = false,
}: UseNearViewportOptions = {}) => {
  const [node, setNode] = useState<T | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(() => initialVisible || disabled);

  const ref = useCallback((value: T | null) => {
    setNode(value);
  }, []);

  useEffect(() => {
    if (disabled || typeof window === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    if (!node) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        const nextVisible = entry.isIntersecting || entry.intersectionRatio > 0;

        if (nextVisible) {
          setIsNearViewport(true);
          if (once) {
            observer.disconnect();
          }
          return;
        }

        if (!once) {
          setIsNearViewport(false);
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [disabled, node, once, rootMargin, threshold]);

  return { ref, isNearViewport };
};
