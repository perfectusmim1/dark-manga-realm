import React, { useEffect, useRef } from 'react';
import { ReaderSettings, ResolvedReaderPage } from '@/lib/types';

interface VerticalReaderProps {
  pages: ResolvedReaderPage[];
  settings: ReaderSettings;
  onPageChange: (page: number) => void;
  initialPage?: number;
  trackingEnabled?: boolean;
}

import ProtectedImage from '@/components/security/ProtectedImage';

const VerticalReader: React.FC<VerticalReaderProps> = ({
  pages,
  settings,
  onPageChange,
  initialPage = 1,
  trackingEnabled = true,
}) => {
  const lastReportedPage = useRef<number>(initialPage);

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
    <div className="flex flex-col items-center gap-0 pb-20 pt-20">
      {pages.map((page, index) => (
        <div
          key={index}
          data-page-index={index}
          className="relative flex items-center justify-center w-full"
          style={{
            maxWidth: settings.fitWidth ? `${896 * (settings.zoom / 100)}px` : 'none'
          }}
        >
          <div data-reader-page-number={index + 1} className="flex w-full justify-center">
            <ProtectedImage
              src={page.src}
              alt={`Sayfa ${index + 1}`}
              zoom={settings.zoom}
            />
          </div>
          {/* Page number indicator for debugging/clarity if images fail */}
          <div className="absolute top-2 right-2 z-20 rounded bg-black/50 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
            P{index + 1}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VerticalReader;
