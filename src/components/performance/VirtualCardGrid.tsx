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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
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

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = probe.getBoundingClientRect().height;
      if (nextHeight > 0) {
        setItemHeight(nextHeight);
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
  }, [cardWidth, items]);

  const resolvedItemHeight = itemHeight ?? estimatedItemHeight;
  const rowStride = resolvedItemHeight + gapPx;
  const totalRows = Math.ceil(items.length / columns);
  const shouldVirtualize = items.length > columns * minRowsBeforeVirtualize && containerWidth > 0;

  const containerTop = useMemo(() => {
    const container = containerRef.current;
    if (!container) {
      return 0;
    }

    return container.getBoundingClientRect().top + windowMetrics.scrollY;
  }, [containerWidth, windowMetrics.scrollY]);

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
