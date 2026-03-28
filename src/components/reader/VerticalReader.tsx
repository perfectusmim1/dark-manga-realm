import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReaderSettings, ResolvedReaderPage } from '@/lib/types';
import { useNearViewport } from '@/hooks/use-near-viewport';
import ProtectedImage from '@/components/security/ProtectedImage';

interface VerticalReaderProps {
  pages: ResolvedReaderPage[];
  settings: ReaderSettings;
  onPageChange: (page: number) => void;
  initialPage?: number;
  trackingEnabled?: boolean;
}

interface ReaderPageProps {
  index: number;
  page: ResolvedReaderPage;
  zoom: number;
  fitWidth: boolean;
  initialPage: number;
  preloadWindow: number;
  rootMargin: string;
  estimatedHeight: number;
  onHeightChange: (index: number, height: number) => void;
}

const ReaderPage: React.FC<ReaderPageProps> = ({
  index,
  page,
  zoom,
  fitWidth,
  initialPage,
  preloadWindow,
  rootMargin,
  estimatedHeight,
  onHeightChange,
}) => {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const isPriorityPage = Math.abs(index - Math.max(0, initialPage - 1)) <= preloadWindow;
  const { ref: viewportRef, isNearViewport } = useNearViewport<HTMLDivElement>({
    rootMargin,
    disabled: isPriorityPage,
    initialVisible: isPriorityPage,
  });
  const shouldRenderMedia = isPriorityPage || isNearViewport;
  const placeholderHeight = Math.max(estimatedHeight, 320);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    pageRef.current = node;
    viewportRef(node);
  }, [viewportRef]);

  useEffect(() => {
    if (!shouldRenderMedia || !isMediaReady || typeof ResizeObserver === 'undefined') {
      return;
    }

    const node = pageRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = node.getBoundingClientRect().height;
      if (nextHeight >= 32) {
        onHeightChange(index, nextHeight);
      }
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [index, isMediaReady, onHeightChange, shouldRenderMedia]);

  useEffect(() => {
    setIsMediaReady(false);
  }, [page.src, shouldRenderMedia]);

  return (
    <div
      ref={setRefs}
      data-page-index={index}
      className="group relative mx-auto flex w-full justify-center"
      style={{
        maxWidth: fitWidth ? `${896 * (zoom / 100)}px` : 'none',
        ...(shouldRenderMedia && isMediaReady
          ? {}
          : {
              contentVisibility: 'auto' as const,
              containIntrinsicSize: `${Math.round(placeholderHeight)}px`,
            }),
      }}
    >
      <div
        data-reader-page-number={index + 1}
        className="mx-auto flex w-full justify-center"
        style={shouldRenderMedia && isMediaReady ? undefined : { minHeight: placeholderHeight }}
      >
        {shouldRenderMedia ? (
          <ProtectedImage
            src={page.src}
            alt={`Sayfa ${index + 1}`}
            zoom={zoom}
            onMediaReadyChange={setIsMediaReady}
          />
        ) : (
          <div
            aria-hidden
            className="w-full rounded-sm bg-muted/10"
            style={{ minHeight: placeholderHeight }}
          />
        )}
      </div>
      <div className="absolute top-2 right-2 z-20 rounded bg-black/50 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
        P{index + 1}
      </div>
    </div>
  );
};

const VerticalReader: React.FC<VerticalReaderProps> = ({
  pages,
  settings,
  onPageChange,
  initialPage = 1,
  trackingEnabled = true,
}) => {
  const lastReportedPage = useRef<number>(initialPage);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 640);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const effectiveZoom = isMobileViewport && settings.fitWidth
    ? Math.max(settings.zoom, 100)
    : settings.zoom;
  const preloadWindow = Math.max(2, settings.preloadPages || 0);
  const rootMargin = `${Math.max(720, preloadWindow * 320)}px 0px`;
  const averagePageHeight = useMemo(() => {
    const knownHeights = Object.values(pageHeights).filter((height) => height >= 32);
    if (knownHeights.length === 0) {
      return settings.mode === 'webtoon' ? 1400 : 1180;
    }

    return knownHeights.reduce((sum, height) => sum + height, 0) / knownHeights.length;
  }, [pageHeights, settings.mode]);

  const handlePageHeightChange = useCallback((index: number, height: number) => {
    setPageHeights((current) => {
      if (current[index] && Math.abs(current[index] - height) < 4) {
        return current;
      }

      return {
        ...current,
        [index]: height,
      };
    });
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobileViewport(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setPageHeights({});
  }, [pages]);

  // Intersection Observer for tracking current page
  useEffect(() => {
    if (!trackingEnabled) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries
          .filter(e => e.isIntersecting)
          .map(entry => {
            const index = parseInt((entry.target as HTMLElement).dataset.pageIndex || '-1', 10);
            return { index, entry };
          })
          .filter(p => p.index !== -1)
          .sort((a, b) => a.index - b.index);

        if (intersecting.length > 0) {
          const currentPage = intersecting[0].index + 1;

          if (currentPage !== lastReportedPage.current) {
            lastReportedPage.current = currentPage;
            onPageChange(currentPage);
          }
        }
      },
      {
        threshold: [0, 0.1, 0.5],
        rootMargin: '-15% 0px -80% 0px'
      }
    );

    // Observe all page containers
    document.querySelectorAll('[data-page-index]').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [pages, onPageChange, trackingEnabled]);

  useEffect(() => {
    lastReportedPage.current = initialPage;
  }, [initialPage]);

  return (
    <div className="flex flex-col items-center gap-0 pb-10 pt-14 sm:pb-14 sm:pt-20">
      {pages.map((page, index) => (
        <ReaderPage
          key={index}
          index={index}
          page={page}
          zoom={effectiveZoom}
          fitWidth={settings.fitWidth}
          initialPage={initialPage}
          preloadWindow={preloadWindow}
          rootMargin={rootMargin}
          estimatedHeight={pageHeights[index] ?? averagePageHeight}
          onHeightChange={handlePageHeightChange}
        />
      ))}
    </div>
  );
};

export default VerticalReader;
