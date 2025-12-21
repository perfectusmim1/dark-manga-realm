import React, { useEffect, useRef } from 'react';
import { ReaderSettings } from '@/lib/types';

interface VerticalReaderProps {
  pages: string[];
  settings: ReaderSettings;
  onPageChange: (page: number) => void;
}

const VerticalReader: React.FC<VerticalReaderProps> = ({ pages, settings, onPageChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = pageRefs.current.findIndex((ref) => ref === entry.target);
            if (index !== -1) {
              onPageChange(index + 1);
            }
          }
        });
      },
      { threshold: 0.5 }
    );

    pageRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [pages, onPageChange]);

  return (
    <div 
      ref={containerRef}
      className="flex flex-col items-center gap-1 pb-20 pt-20"
    >
      {pages.map((page, index) => (
        <div
          key={index}
          ref={(el) => (pageRefs.current[index] = el)}
          className={`${settings.fitWidth ? 'w-full max-w-4xl' : 'w-auto'}`}
        >
          <img
            src={page}
            alt={`Sayfa ${index + 1}`}
            className="w-full select-none"
            loading="lazy"
            draggable={false}
          />
        </div>
      ))}
    </div>
  );
};

export default VerticalReader;
