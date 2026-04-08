import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Manga } from '@/lib/types';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useAuth } from '@/contexts/AuthContext';
import { useTopTenWeekIds } from '@/hooks/useTopTenWeekIds';
import MangaCard from './MangaCard';

interface VirtualMangaGridProps {
  manga: Manga[];
  title?: string;
  emptyMessage?: string;
  overscanRows?: number;
  getColumnCount?: (viewportWidth: number) => number;
  enableEntryAnimation?: boolean;
  showTopTenWeekBadges?: boolean;
  entryAnimationClassName?: string;
  entryAnimationDelayStepMs?: number;
  entryAnimationDurationMs?: number;
}

const GRID_GAP_PX = 12;
const DEFAULT_CARD_HEIGHT = 340;

const getInitialContainerWidth = () => {
  if (typeof window === 'undefined') {
    return 0;
  }

  return Math.max(320, window.innerWidth - 32);
};

const getWindowMetrics = () => ({
  width: typeof window === 'undefined' ? 1024 : window.innerWidth,
  height: typeof window === 'undefined' ? 900 : window.innerHeight,
  scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
});

const getDefaultColumnCount = (viewportWidth: number) => {
  if (viewportWidth >= 1536) return 8;
  if (viewportWidth >= 1280) return 7;
  if (viewportWidth >= 1024) return 6;
  if (viewportWidth >= 768) return 5;
  if (viewportWidth >= 640) return 4;
  if (viewportWidth >= 430) return 3;
  return 2;
};

const VirtualMangaGrid: React.FC<VirtualMangaGridProps> = ({
  manga,
  title,
  emptyMessage = 'Manga bulunamadı',
  overscanRows = 3,
  getColumnCount = getDefaultColumnCount,
  enableEntryAnimation = true,
  showTopTenWeekBadges = true,
  entryAnimationClassName = 'animate-fade-up',
  entryAnimationDelayStepMs = 50,
  entryAnimationDurationMs = 500,
}) => {
  const { disableHeavyEffects } = useDeviceProfile();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(getInitialContainerWidth);
  const [windowMetrics, setWindowMetrics] = useState(getWindowMetrics);
  const [containerTop, setContainerTop] = useState(0);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const hoverPreviewEnabled = user?.preferences?.appearance?.manga_hover_preview ?? false;
  const columns = useMemo(
    () => getColumnCount(windowMetrics.width),
    [getColumnCount, windowMetrics.width],
  );
  const cardWidth = useMemo(() => {
    if (containerWidth <= 0) {
      return 0;
    }

    return Math.max(0, (containerWidth - GRID_GAP_PX * (columns - 1)) / columns);
  }, [columns, containerWidth]);
  const estimatedCardHeight = useMemo(() => {
    if (cardWidth <= 0) {
      return DEFAULT_CARD_HEIGHT;
    }

    return Math.round(cardWidth * 1.5 + 92);
  }, [cardWidth]);
  const resolvedCardHeight = cardHeight ?? estimatedCardHeight;
  const rowStride = resolvedCardHeight + GRID_GAP_PX;
  const totalRows = Math.ceil(manga.length / columns);
  const shouldVirtualize = manga.length > columns * 6 && containerWidth > 0;
  const topTenWeekIds = useTopTenWeekIds(showTopTenWeekBadges && manga.length > 0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = container.clientWidth;
      setContainerWidth((current) => (
        current === nextWidth ? current : nextWidth
      ));
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => {
        window.removeEventListener('resize', updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let ticking = false;

    const updateMetrics = () => {
      ticking = false;
      const nextMetrics = getWindowMetrics();
      setWindowMetrics((current) => (
        current.width === nextMetrics.width
          && current.height === nextMetrics.height
          && current.scrollY === nextMetrics.scrollY
          ? current
          : nextMetrics
      ));
    };

    const requestMetricsUpdate = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(updateMetrics);
    };

    requestMetricsUpdate();
    window.addEventListener('resize', requestMetricsUpdate);
    if (shouldVirtualize) {
      window.addEventListener('scroll', requestMetricsUpdate, { passive: true });
    }

    return () => {
      window.removeEventListener('resize', requestMetricsUpdate);
      if (shouldVirtualize) {
        window.removeEventListener('scroll', requestMetricsUpdate);
      }
    };
  }, [shouldVirtualize]);

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = probe.getBoundingClientRect().height;
      if (nextHeight > 0) {
        setCardHeight((current) => (
          current === nextHeight ? current : nextHeight
        ));
      }
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => {
        window.removeEventListener('resize', updateHeight);
      };
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    observer.observe(probe);
    return () => observer.disconnect();
  }, [containerWidth, disableHeavyEffects, manga.length]);

  useEffect(() => {
    if (typeof window === 'undefined' || !shouldVirtualize) {
      setContainerTop(0);
      return;
    }

    const updateContainerTop = () => {
      const container = containerRef.current;
      if (!container) {
        setContainerTop(0);
        return;
      }

      const nextTop = container.getBoundingClientRect().top + window.scrollY;
      setContainerTop((current) => (
        Math.abs(current - nextTop) < 1 ? current : nextTop
      ));
    };

    updateContainerTop();
    window.addEventListener('resize', updateContainerTop);

    return () => {
      window.removeEventListener('resize', updateContainerTop);
    };
  }, [containerWidth, manga.length, shouldVirtualize]);

  const visibleRange = useMemo(() => {
    if (!shouldVirtualize || rowStride <= 0) {
      return {
        startRow: 0,
        endRow: totalRows,
      };
    }

    const viewportTop = windowMetrics.scrollY;
    const viewportBottom = windowMetrics.scrollY + windowMetrics.height;
    const nextStartRow = Math.max(
      0,
      Math.floor((viewportTop - containerTop) / rowStride) - overscanRows,
    );
    const nextEndRow = Math.min(
      totalRows,
      Math.ceil((viewportBottom - containerTop) / rowStride) + overscanRows,
    );

    return {
      startRow: nextStartRow,
      endRow: Math.max(nextStartRow + 1, nextEndRow),
    };
  }, [containerTop, overscanRows, rowStride, shouldVirtualize, totalRows, windowMetrics.height, windowMetrics.scrollY]);

  const startIndex = visibleRange.startRow * columns;
  const endIndex = Math.min(manga.length, visibleRange.endRow * columns);
  const visibleManga = shouldVirtualize ? manga.slice(startIndex, endIndex) : manga;
  const topSpacerHeight = shouldVirtualize ? visibleRange.startRow * rowStride : 0;
  const bottomSpacerHeight = shouldVirtualize ? Math.max(0, (totalRows - visibleRange.endRow) * rowStride) : 0;

  if (manga.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8">
        <p className="text-center text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <section>
      {title && (
        <h2 className="mb-6 text-xl font-bold tracking-tight text-foreground md:text-2xl">
          {title}
        </h2>
      )}

      <div ref={containerRef} className="relative">
        {cardWidth > 0 && manga[0] && (
          <div aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
            <div ref={probeRef} style={{ width: `${cardWidth}px` }}>
              <MangaCard
                manga={manga[0]}
                index={0}
                topTenWeekIds={showTopTenWeekBadges ? null : new Set<string>()}
                hoverPreviewEnabled={false}
                disableHeavyEffects
                enableEntryAnimation={false}
              />
            </div>
          </div>
        )}

        {topSpacerHeight > 0 && <div aria-hidden style={{ height: topSpacerHeight }} />}

        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {visibleManga.map((item, index) => (
            <MangaCard
              key={item.id}
              manga={item}
              index={startIndex + index}
              topTenWeekIds={topTenWeekIds}
              hoverPreviewEnabled={hoverPreviewEnabled}
              disableHeavyEffects={disableHeavyEffects}
              enableEntryAnimation={enableEntryAnimation}
              entryAnimationClassName={entryAnimationClassName}
              entryAnimationDelayStepMs={entryAnimationDelayStepMs}
              entryAnimationDurationMs={entryAnimationDurationMs}
            />
          ))}
        </div>

        {bottomSpacerHeight > 0 && <div aria-hidden style={{ height: bottomSpacerHeight }} />}
      </div>
    </section>
  );
};

export default VirtualMangaGrid;
