import React, { useEffect, useRef, useState } from 'react';
import { ReaderSettings } from '@/lib/types';

interface VerticalReaderProps {
  pages: string[];
  settings: ReaderSettings;
  onPageChange: (page: number) => void;
  initialPage?: number;
}

const VerticalReader: React.FC<VerticalReaderProps> = ({
  pages,
  settings,
  onPageChange,
  initialPage = 1
}) => {
  const [scrolledToInitial, setScrolledToInitial] = useState(false);
  const lastReportedPage = useRef<number>(initialPage);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());

  // Handle image load event
  const handleImageLoad = (index: number) => {
    setLoadedImages(prev => new Set(prev).add(index));
  };

  // Scroll to initial page when target image is loaded
  useEffect(() => {
    if (scrolledToInitial) return;

    if (initialPage === 1) {
      setScrolledToInitial(true);
      return;
    }

    const targetIndex = initialPage - 1;

    // Check if target image is loaded or if we have enough images loaded
    if (loadedImages.has(targetIndex) || loadedImages.size >= Math.min(targetIndex + 1, pages.length)) {
      // Find target element using data attribute
      const targetElement = document.querySelector(`[data-page-index="${targetIndex}"]`);

      if (targetElement) {
        const elementTop = (targetElement as HTMLElement).offsetTop;

        // Scroll to the target position
        window.scrollTo({
          top: elementTop - 80,
          behavior: 'auto'
        });

        setScrolledToInitial(true);
      }
    }
  }, [loadedImages, initialPage, scrolledToInitial, pages.length]);

  // Fallback: force scroll after a timeout regardless of image load status
  useEffect(() => {
    if (scrolledToInitial) return;
    if (initialPage === 1) return;

    const timeout = setTimeout(() => {
      if (!scrolledToInitial) {
        const targetIndex = initialPage - 1;
        const targetElement = document.querySelector(`[data-page-index="${targetIndex}"]`);

        if (targetElement) {
          const elementTop = (targetElement as HTMLElement).offsetTop;
          window.scrollTo({
            top: elementTop - 80,
            behavior: 'auto'
          });
        }
        setScrolledToInitial(true);
      }
    }, 500); // Force scroll after 500ms

    return () => clearTimeout(timeout);
  }, [initialPage, scrolledToInitial]);

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

  return (
    <div className="flex flex-col items-center gap-1 pb-20 pt-20">
      {pages.map((page, index) => (
        <div
          key={index}
          data-page-index={index}
          className={`relative min-h-[200px] flex items-center justify-center`}
          style={{
            width: settings.fitWidth ? '100%' : 'auto',
            maxWidth: settings.fitWidth ? `${896 * (settings.zoom / 100)}px` : 'none'
          }}
        >
          <img
            src={page}
            alt={`Sayfa ${index + 1}`}
            className="select-none transition-transform duration-200"
            style={{ width: `${settings.zoom}%` }}
            loading={index < (initialPage + 3) ? "eager" : "lazy"}
            draggable={false}
            onLoad={() => handleImageLoad(index)}
          />
          {/* Page number indicator for debugging/clarity if images fail */}
          <div className="absolute top-2 right-2 rounded bg-black/50 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity hover:opacity-100">
            P{index + 1}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VerticalReader;
