import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderSettings, ResolvedReaderPage } from '@/lib/types';
import { PageTranslateButton, TranslationOverlay } from '@/components/reader/TranslationOverlay';
import { ReaderTranslationApi } from '@/hooks/useChapterTranslation';

interface HorizontalReaderProps {
  pages: ResolvedReaderPage[];
  settings: ReaderSettings;
  currentPage: number;
  onPageChange: (page: number) => void;
  translation?: ReaderTranslationApi;
}

import ProtectedImage from '@/components/security/ProtectedImage';

const HorizontalReader: React.FC<HorizontalReaderProps> = ({
  pages,
  settings,
  currentPage,
  onPageChange,
  translation
}) => {
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 640);
  const [pageOverlayShown, setPageOverlayShown] = useState(true);
  const effectiveZoom = isMobileViewport && settings.fitWidth
    ? Math.max(settings.zoom, 100)
    : settings.zoom;

  const pageIndex = currentPage - 1;
  const translationState = translation?.pageStates[pageIndex];
  const showTranslationOverlay = Boolean(
    translation
    && translationState?.status === 'done'
    && translationState.blocks
    && translation.settings.overlayVisible
    && pageOverlayShown,
  );

  useEffect(() => {
    setPageOverlayShown(true);
  }, [currentPage]);

  const translationOverlayNode = translation && translation.enabled ? (
    <>
      {showTranslationOverlay && translationState?.blocks && (
        <TranslationOverlay blocks={translationState.blocks} />
      )}
      <PageTranslateButton
        state={translationState}
        showIdleButton={!translation.settings.autoTranslate}
        overlayShown={translation.settings.overlayVisible && pageOverlayShown}
        onTranslate={() => translation.translatePage(pageIndex)}
        onRetranslate={() => translation.translatePage(pageIndex, { force: true })}
        onToggleOverlay={() => setPageOverlayShown((prev) => !prev)}
      />
    </>
  ) : (
    showTranslationOverlay && translationState?.blocks
      ? <TranslationOverlay blocks={translationState.blocks} />
      : undefined
  );

  useEffect(() => {
    const handleResize = () => setIsMobileViewport(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const goToPrevPage = useCallback(() => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  }, [currentPage, onPageChange]);

  const goToNextPage = useCallback(() => {
    if (currentPage < pages.length) {
      onPageChange(currentPage + 1);
    }
  }, [currentPage, pages.length, onPageChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrevPage();
      if (e.key === 'ArrowRight') goToNextPage();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevPage, goToNextPage]);

  return (
    <div className="relative flex h-screen items-center justify-center pt-14 pb-14">
      {/* Left Navigation Zone */}
      <button
        onClick={goToPrevPage}
        disabled={currentPage === 1}
        className="absolute left-0 top-14 bottom-14 w-1/3 z-10 cursor-pointer opacity-0 hover:opacity-100 transition-opacity disabled:cursor-default"
      >
        <div className="flex h-full items-center justify-start pl-4">
          <div className="rounded-full bg-background/80 p-3 backdrop-blur-sm">
            <ChevronLeft className="h-8 w-8 text-foreground" />
          </div>
        </div>
      </button>

      {/* Page Display */}
      <div className={`relative flex h-full items-center justify-center px-0 sm:px-4 ${settings.fitWidth ? 'w-full' : ''}`}>
        <div data-reader-page-number={currentPage} className="flex w-full justify-center">
          <ProtectedImage
            src={pages[currentPage - 1]?.src || ''}
            alt={`Sayfa ${currentPage}`}
            zoom={effectiveZoom}
            className="max-h-full items-center justify-center flex"
            style={{
              width: settings.fitWidth ? '100%' : 'auto',
              maxWidth: settings.fitWidth ? '896px' : 'none',
            }}
            overlay={translationOverlayNode}
          />
        </div>
      </div>

      {/* Right Navigation Zone */}
      <button
        onClick={goToNextPage}
        disabled={currentPage === pages.length}
        className="absolute right-0 top-14 bottom-14 w-1/3 z-10 cursor-pointer opacity-0 hover:opacity-100 transition-opacity disabled:cursor-default"
      >
        <div className="flex h-full items-center justify-end pr-4">
          <div className="rounded-full bg-background/80 p-3 backdrop-blur-sm">
            <ChevronRight className="h-8 w-8 text-foreground" />
          </div>
        </div>
      </button>
    </div>
  );
};

export default HorizontalReader;
