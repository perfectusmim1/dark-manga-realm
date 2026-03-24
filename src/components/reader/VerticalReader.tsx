import React, { useEffect, useRef, useState } from 'react';
import { ReaderSettings, ResolvedReaderPage } from '@/lib/types';

interface VerticalReaderProps {
  pages: ResolvedReaderPage[];
  settings: ReaderSettings;
  onPageChange: (page: number) => void;
  initialPage?: number;
}

import ProtectedImage from '@/components/security/ProtectedImage';

const VerticalReader: React.FC<VerticalReaderProps> = ({
  pages,
  settings,
  onPageChange,
  initialPage = 1
}) => {
  const [scrolledToInitial, setScrolledToInitial] = useState(false);
  const lastReportedPage = useRef<number>(initialPage);

  // Intersection Observer for tracking current page
  useEffect(() => {
    if (!scrolledToInitial) return;

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
  }, [pages, onPageChange, scrolledToInitial]);

  // Handle initial scroll
  useEffect(() => {
    if (scrolledToInitial) return;

    // For vertical reader, we can just mark as scrolled since ProtectedImage handles its own loading
    // In a real scenario, we might want to wait for the first image to render on canvas
    const timeout = setTimeout(() => {
      if (initialPage > 1) {
        const targetElement = document.querySelector(`[data-page-index="${initialPage - 1}"]`);
        if (targetElement) {
          window.scrollTo({
            top: (targetElement as HTMLElement).offsetTop - 80,
            behavior: 'auto'
          });
        }
      }
      setScrolledToInitial(true);
    }, 500);

    return () => clearTimeout(timeout);
  }, [initialPage, scrolledToInitial]);

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
          <ProtectedImage
            src={page.src}
            alt={`Sayfa ${index + 1}`}
            zoom={settings.zoom}
          />
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
