import React, { useEffect, useRef, useState } from 'react';
import { ReaderSettings, ResolvedReaderPage } from '@/lib/types';
import ProtectedImage from '@/components/security/ProtectedImage';
import { PageTranslateButton, TranslationOverlay } from '@/components/reader/TranslationOverlay';
import { ReaderTranslationApi } from '@/hooks/useChapterTranslation';

interface VerticalReaderProps {
  pages: ResolvedReaderPage[];
  settings: ReaderSettings;
  onPageChange: (page: number) => void;
  onProgressChange?: (page: number, pageOffsetRatio: number, progressPercent: number) => void;
  initialPage?: number;
  trackingEnabled?: boolean;
  translation?: ReaderTranslationApi;
}

interface ReaderPageProps {
  index: number;
  page: ResolvedReaderPage;
  zoom: number;
  fitWidth: boolean;
  priority: boolean;
  translation?: ReaderTranslationApi;
}

const ReaderPage: React.FC<ReaderPageProps> = ({
  index,
  page,
  zoom,
  fitWidth,
  priority,
  translation,
}) => {
  const [pageOverlayShown, setPageOverlayShown] = useState(true);
  const state = translation?.pageStates[index];
  const showOverlay = Boolean(
    translation
    && state?.status === 'done'
    && state.blocks
    && translation.settings.overlayVisible
    && pageOverlayShown,
  );

  const overlayNode = translation ? (
    <>
      {showOverlay && state?.blocks && state.blocks.length > 0 && (
        <TranslationOverlay blocks={state.blocks} targetLang={translation.settings.targetLang} />
      )}
      <PageTranslateButton
        state={state}
        canRequestTranslation={translation.enabled}
        showIdleButton={!translation.settings.autoTranslate}
        overlayShown={translation.settings.overlayVisible && pageOverlayShown}
        onTranslate={() => translation.translatePage(index)}
        onRetranslate={() => translation.translatePage(index, { force: true })}
        onToggleOverlay={() => setPageOverlayShown((prev) => !prev)}
      />
    </>
  ) : undefined;

  return (
    <div
      data-page-index={index}
      className="group relative mx-auto flex w-full justify-center"
      style={{
        maxWidth: fitWidth ? `${896 * (zoom / 100)}px` : 'none',
      }}
    >
      <div
        data-reader-page-number={index + 1}
        className="mx-auto flex w-full justify-center"
      >
        <ProtectedImage
          src={page.src}
          alt={`Sayfa ${index + 1}`}
          zoom={zoom}
          priority={priority}
          reserveHeightWhenLoading
          overlay={overlayNode}
        />
      </div>
      <div className="absolute top-2 left-2 z-20 rounded bg-black/50 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
        P{index + 1}
      </div>
    </div>
  );
};

const VerticalReader: React.FC<VerticalReaderProps> = ({
  pages,
  settings,
  onPageChange,
  onProgressChange,
  initialPage = 1,
  trackingEnabled = true,
  translation,
}) => {
  const lastReportedPage = useRef<number>(initialPage);
  const lastReportedPercent = useRef<number>(-1);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 640);
  const effectiveZoom = isMobileViewport && settings.fitWidth
    ? Math.max(settings.zoom, 100)
    : settings.zoom;

  useEffect(() => {
    const handleResize = () => setIsMobileViewport(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // High-precision scroll + sub-page offset tracker for percentage & page state
  useEffect(() => {
    if (!trackingEnabled || pages.length === 0) {
      return;
    }

    let rafId: number | null = null;

    const evaluateScrollPosition = () => {
      rafId = null;
      const pageNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-page-index]'));
      if (pageNodes.length === 0) {
        return;
      }

      const totalPages = Math.max(1, pages.length);
      const scrollY = Math.max(0, window.scrollY);
      const viewportHeight = Math.max(1, window.innerHeight);
      const docHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
      );
      const maxScroll = Math.max(0, docHeight - viewportHeight);

      if (scrollY <= 4) {
        const firstPage = 1;
        if (firstPage !== lastReportedPage.current) {
          lastReportedPage.current = firstPage;
          onPageChange(firstPage);
        }
        if (Math.abs(lastReportedPercent.current - 0) >= 0.05) {
          lastReportedPercent.current = 0;
          onProgressChange?.(1, 0, 0);
        }
        return;
      }

      if (maxScroll > 0 && scrollY >= maxScroll - 4) {
        const lastPage = totalPages;
        if (lastPage !== lastReportedPage.current) {
          lastReportedPage.current = lastPage;
          onPageChange(lastPage);
        }
        if (Math.abs(lastReportedPercent.current - 100) >= 0.05) {
          lastReportedPercent.current = 100;
          onProgressChange?.(lastPage, 1, 100);
        }
        return;
      }

      const anchorViewportY = 2;
      let matchedIndex = 0;
      let matchedOffsetRatio = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const el of pageNodes) {
        const idx = parseInt(el.dataset.pageIndex || '-1', 10);
        if (idx < 0) continue;
        const rect = el.getBoundingClientRect();
        const height = Math.max(1, rect.height);

        if (rect.top <= anchorViewportY && rect.bottom >= anchorViewportY) {
          matchedIndex = idx;
          matchedOffsetRatio = Math.min(1, Math.max(0, (anchorViewportY - rect.top) / height));
          closestDistance = 0;
          break;
        }

        const distance = rect.top > anchorViewportY
          ? rect.top - anchorViewportY
          : anchorViewportY - rect.bottom;
        if (distance < closestDistance) {
          closestDistance = distance;
          matchedIndex = idx;
          matchedOffsetRatio = rect.top > anchorViewportY ? 0 : 1;
        }
      }

      const currentPage = Math.min(totalPages, Math.max(1, matchedIndex + 1));
      const rawPercent = ((currentPage - 1 + matchedOffsetRatio) / totalPages) * 100;
      const clampedPercent = Math.min(100, Math.max(0, Number(rawPercent.toFixed(2))));
      const clampedOffset = Math.min(1, Math.max(0, Number(matchedOffsetRatio.toFixed(4))));

      const pageChanged = currentPage !== lastReportedPage.current;
      if (pageChanged) {
        lastReportedPage.current = currentPage;
        onPageChange(currentPage);
      }

      if (
        Math.abs(clampedPercent - lastReportedPercent.current) >= 0.05
        || pageChanged
      ) {
        lastReportedPercent.current = clampedPercent;
        onProgressChange?.(currentPage, clampedOffset, clampedPercent);
      }
    };

    const scheduleEvaluation = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(evaluateScrollPosition);
    };

    window.addEventListener('scroll', scheduleEvaluation, { passive: true });
    window.addEventListener('resize', scheduleEvaluation);
    scheduleEvaluation();

    return () => {
      window.removeEventListener('scroll', scheduleEvaluation);
      window.removeEventListener('resize', scheduleEvaluation);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [pages.length, onPageChange, onProgressChange, trackingEnabled]);

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
          priority={index <= initialPage + 1}
          translation={translation}
        />
      ))}
    </div>
  );
};

export default VerticalReader;
