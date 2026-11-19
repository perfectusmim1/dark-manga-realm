import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { planStrips, shouldSkipHighResPage } from '@/lib/upscale/stripPlanner';
import type {
  StripPlan,
  UpscaleEngineKey,
  UpscaleMode,
} from '@/lib/upscale/types';
import { upscaleQueue } from '@/lib/upscale/upscaleQueue';

export type StripVisualState = 'idle' | 'processing' | 'done' | 'error';

export interface PageUpscaleMetrics {
  naturalWidth: number;
  naturalHeight: number;
  screenPx: number;
  skippedHighRes: boolean;
  strips: StripPlan[];
}

interface UsePageUpscaleParams {
  src: string;
  mode: UpscaleMode;
  upscaleHighRes: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
}

const EMPTY_METRICS: PageUpscaleMetrics = {
  naturalWidth: 0,
  naturalHeight: 0,
  screenPx: 0,
  skippedHighRes: false,
  strips: [],
};

const clearStripCanvas = (canvas: HTMLCanvasElement | undefined) => {
  if (!canvas) return;
  canvas.style.opacity = '0';
  canvas.width = 1;
  canvas.height = 1;
};

const drawBitmapToCanvas = (canvas: HTMLCanvasElement, bitmap: ImageBitmap) => {
  const brCtx = canvas.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null;
  if (brCtx) {
    brCtx.transferFromImageBitmap(bitmap);
    canvas.style.opacity = '1';
    return;
  }
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    canvas.style.opacity = '1';
  }
  try {
    bitmap.close();
  } catch {
    // ignore
  }
};

export const usePageUpscale = ({
  src,
  mode,
  upscaleHighRes,
  rootRef,
}: UsePageUpscaleParams) => {
  const { isMobile } = useDeviceProfile();
  const [metrics, setMetrics] = useState<PageUpscaleMetrics>(EMPTY_METRICS);
  const [stripStates, setStripStates] = useState<Record<number, StripVisualState>>({});
  const [layoutRevision, setLayoutRevision] = useState(0);

  const engine: UpscaleEngineKey | null = useMemo(() => {
    if (mode === 'off') return null;
    return mode === 'ai' ? 'realesrgan' : 'fast';
  }, [mode]);

  const stripElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasElsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const stateMapRef = useRef<Map<number, StripVisualState>>(new Map());
  const inFlightAbortRef = useRef<Map<number, AbortController>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const runIdRef = useRef(0);

  const setStripStatus = useCallback((stripIndex: number, nextState: StripVisualState) => {
    const prev = stateMapRef.current.get(stripIndex);
    if (prev === nextState) return;
    stateMapRef.current.set(stripIndex, nextState);
    if (engine === 'realesrgan') {
      setStripStates((curr) =>
        curr[stripIndex] === nextState ? curr : { ...curr, [stripIndex]: nextState },
      );
    }
  }, [engine]);

  // Görsel ölçümlerini ve ResizeObserver takibini yönet
  useEffect(() => {
    if (!src || !engine) {
      setMetrics(EMPTY_METRICS);
      return;
    }

    let cancelled = false;
    let resizeTimer: number | null = null;
    let lastScreenPx = 0;

    const getParentAndImg = () => {
      const parent = rootRef.current?.parentElement ?? null;
      const img = parent?.querySelector('img') ?? null;
      return { parent, img };
    };

    const measure = (fromResize = false) => {
      if (cancelled) return;
      const { parent, img } = getParentAndImg();
      if (!parent || !img || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        return;
      }

      const clientWidth = Math.max(1, parent.clientWidth || img.clientWidth || img.naturalWidth);
      const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      const screenPx = Math.ceil(clientWidth * dpr);
      const skippedHighRes = shouldSkipHighResPage(
        img.naturalWidth,
        clientWidth,
        dpr,
        upscaleHighRes,
      );

      setMetrics((prev) => {
        const nextStrips = skippedHighRes ? [] : planStrips(img.naturalHeight);
        if (
          prev.naturalWidth === img.naturalWidth &&
          prev.naturalHeight === img.naturalHeight &&
          prev.skippedHighRes === skippedHighRes &&
          prev.screenPx === screenPx
        ) {
          return prev;
        }
        return {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          screenPx,
          skippedHighRes,
          strips: nextStrips,
        };
      });

      if (fromResize && lastScreenPx > 0 && Math.abs(screenPx - lastScreenPx) / lastScreenPx > 0.12) {
        setLayoutRevision((r) => r + 1);
      }
      lastScreenPx = screenPx;
    };

    const { parent, img } = getParentAndImg();
    if (img && img.naturalWidth > 0) {
      measure(false);
    }

    const onImgLoad = () => measure(false);
    img?.addEventListener('load', onImgLoad);

    let ro: ResizeObserver | null = null;
    if (parent && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          resizeTimer = null;
          measure(true);
        }, 250);
      });
      ro.observe(parent);
    }

    return () => {
      cancelled = true;
      img?.removeEventListener('load', onImgLoad);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      ro?.disconnect();
    };
  }, [engine, rootRef, src, upscaleHighRes]);

  const scheduleStrip = useCallback(
    (strip: StripPlan, el: HTMLDivElement, runId: number) => {
      if (!engine || !src || metrics.skippedHighRes || metrics.screenPx <= 0) return;
      const currentState = stateMapRef.current.get(strip.index);
      if (currentState === 'done' || currentState === 'processing') {
        return;
      }

      const controller = new AbortController();
      inFlightAbortRef.current.set(strip.index, controller);
      setStripStatus(strip.index, 'processing');

      const stripLruKey = `${runId}:${src}:${strip.index}:${engine}`;

      upscaleQueue
        .enqueueStrip({
          src,
          strip,
          engine,
          screenPx: metrics.screenPx,
          isMobile,
          signal: controller.signal,
          getPriority: () => {
            const rect = el.getBoundingClientRect();
            const center = (rect.top + rect.bottom) * 0.5;
            const viewportCenter = typeof window !== 'undefined' ? window.innerHeight * 0.5 : 400;
            return Math.abs(center - viewportCenter);
          },
        })
        .then((bitmap) => {
          inFlightAbortRef.current.delete(strip.index);
          if (runIdRef.current !== runId || controller.signal.aborted) {
            try {
              bitmap.close();
            } catch {
              // ignore
            }
            return;
          }

          const canvas = canvasElsRef.current.get(strip.index);
          if (!canvas) {
            try {
              bitmap.close();
            } catch {
              // ignore
            }
            setStripStatus(strip.index, 'idle');
            return;
          }

          drawBitmapToCanvas(canvas, bitmap);
          setStripStatus(strip.index, 'done');

          upscaleQueue.markStripActive(
            stripLruKey,
            () => {
              if (runIdRef.current !== runId) return;
              clearStripCanvas(canvasElsRef.current.get(strip.index));
              stateMapRef.current.set(strip.index, 'idle');
              if (engine === 'realesrgan') {
                setStripStates((curr) =>
                  curr[strip.index] === 'idle' ? curr : { ...curr, [strip.index]: 'idle' },
                );
              }
            },
            isMobile,
          );
        })
        .catch((err) => {
          inFlightAbortRef.current.delete(strip.index);
          if (runIdRef.current !== runId) return;
          const isAbort = err instanceof DOMException && err.name === 'AbortError';
          if (isAbort) {
            setStripStatus(strip.index, 'idle');
          } else {
            console.warn('[Upscale] Şerit işlenemedi:', err);
            setStripStatus(strip.index, 'error');
          }
        });
    },
    [engine, isMobile, metrics.screenPx, metrics.skippedHighRes, setStripStatus, src],
  );

  // IntersectionObserver ile ekrandaki şeritleri kuyruğa ekle
  useEffect(() => {
    const runId = ++runIdRef.current;
    inFlightAbortRef.current.forEach((ctrl) => ctrl.abort());
    inFlightAbortRef.current.clear();
    stateMapRef.current.clear();
    setStripStates({});

    canvasElsRef.current.forEach((canvas) => {
      clearStripCanvas(canvas);
    });

    if (!engine || !src || metrics.skippedHighRes || metrics.strips.length === 0) {
      return;
    }

    const rootMargin = isMobile ? '600px 0px' : '1200px 0px';
    const stripByIndex = new Map<number, StripPlan>(
      metrics.strips.map((s) => [s.index, s]),
    );

    const observer = new IntersectionObserver(
      (entries) => {
        if (runIdRef.current !== runId) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLDivElement;
          const idxAttr = el.dataset.stripIndex;
          const idx = idxAttr ? Number.parseInt(idxAttr, 10) : -1;
          const strip = stripByIndex.get(idx);
          if (!strip) continue;
          scheduleStrip(strip, el, runId);
        }
      },
      { rootMargin, threshold: 0.01 },
    );

    observerRef.current = observer;
    // Ekrandaki ve bölümdeki tüm şeritleri öncelik sırasıyla kuyruğa ekle;
    // getPriority() viewport merkezine yakın olanları daima öne alır.
    stripElsRef.current.forEach((el, idx) => {
      observer.observe(el);
      const strip = stripByIndex.get(idx);
      if (!strip) return;
      scheduleStrip(strip, el, runId);
    });

    return () => {
      observer.disconnect();
      observerRef.current = null;
      inFlightAbortRef.current.forEach((ctrl) => ctrl.abort());
      inFlightAbortRef.current.clear();
      metrics.strips.forEach((s) => {
        upscaleQueue.unmarkStripActive(`${runId}:${src}:${s.index}:${engine}`);
      });
    };
  }, [engine, isMobile, layoutRevision, metrics.skippedHighRes, metrics.strips, scheduleStrip, src]);

  const registerStripEl = useCallback((index: number, el: HTMLDivElement | null) => {
    const prev = stripElsRef.current.get(index);
    if (prev && prev !== el) {
      observerRef.current?.unobserve(prev);
      stripElsRef.current.delete(index);
    }
    if (el) {
      stripElsRef.current.set(index, el);
      observerRef.current?.observe(el);
    }
  }, []);

  const registerCanvasEl = useCallback((index: number, el: HTMLCanvasElement | null) => {
    if (el) {
      if (!canvasElsRef.current.has(index)) {
        clearStripCanvas(el);
      }
      canvasElsRef.current.set(index, el);
    } else {
      canvasElsRef.current.delete(index);
    }
  }, []);

  return {
    metrics,
    engine,
    stripStates,
    registerStripEl,
    registerCanvasEl,
  };
};
