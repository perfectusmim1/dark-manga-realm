import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderSettings } from '@/lib/types';

interface HorizontalReaderProps {
  pages: string[];
  settings: ReaderSettings;
  currentPage: number;
  onPageChange: (page: number) => void;
}

const HorizontalReader: React.FC<HorizontalReaderProps> = ({
  pages,
  settings,
  currentPage,
  onPageChange
}) => {
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
      <div className={`flex h-full items-center justify-center px-4 ${settings.fitWidth ? 'w-full' : ''}`}>
        <img
          src={pages[currentPage - 1]}
          alt={`Sayfa ${currentPage}`}
          className={`max-h-full select-none object-contain transition-transform duration-200`}
          style={{
            transform: `scale(${settings.zoom / 100})`,
            width: settings.fitWidth ? '100%' : 'auto',
            maxWidth: settings.fitWidth ? '896px' : 'none'
          }}
          draggable={false}
        />
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
