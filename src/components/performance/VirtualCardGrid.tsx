import React, { useEffect, useMemo, useRef, useState } from 'react';

interface VirtualCardGridProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getItemKey: (item: T, index: number) => React.Key;
  gridClassName: string;
  getColumnCount: (viewportWidth: number) => number;
  gapPx: number;
  estimatedItemHeight?: number;
  overscanRows?: number;
  minRowsBeforeVirtualize?: number;
  emptyState?: React.ReactNode;
}

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

function VirtualCardGrid<T>({
  items,
  renderItem,
  getItemKey,
  gridClassName,
  getColumnCount,
  gapPx,
  estimatedItemHeight = 320,
  overscanRows = 3,
  minRowsBeforeVirtualize = 6,
  emptyState = null,
}: VirtualCardGridProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(getInitialContainerWidth);
  const [windowMetrics, setWindowMetrics] = useState(getWindowMetrics);
  const [itemHeight, setItemHeight] = useState<number | null>(null);
  const [containerTop, setContainerTop] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = (measuredWidth?: number) => {
      const nextWidth = typeof measuredWidth === 'number' && measuredWidth > 0
        ? Math.round(measuredWidth)
        : container.clientWidth;
      if (nextWidth > 0) {
        setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
      }
    };

    const rafId = typeof window !== 'undefined'
      ? window.requestAnimationFrame(() => updateWidth())
      : null;

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateWidth();
      updateWidth();
      window.addEventListener('resize', handleResize);
      return () => {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        window.removeEventListener('resize', handleResize);
      };
    }

    const observer = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect?.width);
    });

    observer.observe(container);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let ticking = false;

    const updateMetrics = () => {
      ticking = false;
      setWindowMetrics(getWindowMetrics());
    };

    const requestMetricsUpdate = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(updateMetrics);
    };

    requestMetricsUpdate();
    window.addEventListener('scroll', requestMetricsUpdate, { passive: true });
    window.addEventListener('resize', requestMetricsUpdate);

    return () => {
      window.removeEventListener('scroll', requestMetricsUpdate);
      window.removeEventListener('resize', requestMetricsUpdate);
    };
  }, []);

  const columns = useMemo(
    () => Math.max(1, getColumnCount(windowMetrics.width)),
    [getColumnCount, windowMetrics.width],
  );

  const cardWidth = useMemo(() => {
    if (containerWidth <= 0) {
      return 0;
    }

    return Math.max(0, (containerWidth - gapPx * (columns - 1)) / columns);
  }, [columns, containerWidth, gapPx]);

  const hasItems = items.length > 0;

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe || !hasItems) {
      return;
    }

    const updateHeight = (measuredHeight?: number) => {
      const nextHeight = typeof measuredHeight === 'number' && measuredHeight > 0
        ? measuredHeight
        : probe.getBoundingClientRect().height;
      if (nextHeight > 0) {
        setItemHeight((current) => (current === nextHeight ? current : nextHeight));
      }
    };

    const rafId = typeof window !== 'undefined'
      ? window.requestAnimationFrame(() => updateHeight())
      : null;

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateHeight();
      window.addEventListener('resize', handleResize);
      return () => {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        window.removeEventListener('resize', handleResize);
      };
    }

    const observer = new ResizeObserver((entries) => {
      updateHeight(entries[0]?.contentRect?.height);
    });

    observer.observe(probe);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [cardWidth, hasItems]);

  const resolvedItemHeight = itemHeight ?? estimatedItemHeight;
  const rowStride = resolvedItemHeight + gapPx;
  const totalRows = Math.ceil(items.length / columns);
  const shouldVirtualize = items.length > columns * minRowsBeforeVirtualize && containerWidth > 0;

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
      setContainerTop((current) => (Math.abs(current - nextTop) < 1 ? current : nextTop));
    };

    const rafId = window.requestAnimationFrame(updateContainerTop);
    window.addEventListener('resize', updateContainerTop);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateContainerTop);
    };
  }, [containerWidth, shouldVirtualize]);

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
  const endIndex = Math.min(items.length, visibleRange.endRow * columns);
  const visibleItems = shouldVirtualize ? items.slice(startIndex, endIndex) : items;
  const topSpacerHeight = shouldVirtualize ? visibleRange.startRow * rowStride : 0;
  const bottomSpacerHeight = shouldVirtualize ? Math.max(0, (totalRows - visibleRange.endRow) * rowStride) : 0;

  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div ref={containerRef} className="relative">
      {cardWidth > 0 && items[0] && (
        <div aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
          <div ref={probeRef} style={{ width: `${cardWidth}px` }}>
            {renderItem(items[0], 0)}
          </div>
        </div>
      )}

      {topSpacerHeight > 0 && <div aria-hidden style={{ height: topSpacerHeight }} />}

      <div
        className={gridClassName}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item, index) => {
          const absoluteIndex = startIndex + index;

          return (
            <React.Fragment key={getItemKey(item, absoluteIndex)}>
              {renderItem(item, absoluteIndex)}
            </React.Fragment>
          );
        })}
      </div>

      {bottomSpacerHeight > 0 && <div aria-hidden style={{ height: bottomSpacerHeight }} />}
    </div>
  );
}

export default VirtualCardGrid;
