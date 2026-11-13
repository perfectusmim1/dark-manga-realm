import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { searchMangaMentions, MangaMentionResult } from '@/lib/database';
import { getMangaTypeLabel } from '@/lib/mangaType';
import { cn } from '@/lib/utils';

interface SeriesTagPopoverProps {
  open: boolean;
  query: string;
  includeAdult?: boolean;
  anchorEl: HTMLElement | null;
  onSelect: (series: MangaMentionResult) => void;
  onClose: () => void;
  highlightedIndex: number;
  onHighlightedIndexChange: (index: number) => void;
  onResultsChange?: (results: MangaMentionResult[]) => void;
}

const mentionSearchCache = new Map<string, MangaMentionResult[]>();

/**
 * Viewport-aware series autocomplete popover opened when typing `#query` inside
 * comment, reply, or review textareas.
 */
export const SeriesTagPopover: React.FC<SeriesTagPopoverProps> = ({
  open,
  query,
  includeAdult = false,
  anchorEl,
  onSelect,
  onClose,
  highlightedIndex,
  onHighlightedIndexChange,
  onResultsChange,
}) => {
  const [results, setResults] = useState<MangaMentionResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      return;
    }

    const updatePlacement = () => {
      const rect = anchorEl.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpwards(spaceBelow < 240 && rect.top > 240);
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement, { passive: true });
    return () => window.removeEventListener('resize', updatePlacement);
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const cacheKey = `${includeAdult ? '1' : '0'}:${query.trim().toLowerCase()}`;
    const cached = mentionSearchCache.get(cacheKey);
    if (cached) {
      setResults(cached);
      onResultsChange?.(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchMangaMentions(query, 8, includeAdult);
        if (cancelled) return;
        mentionSearchCache.set(cacheKey, rows);
        if (mentionSearchCache.size > 60) {
          const oldest = mentionSearchCache.keys().next().value;
          if (oldest !== undefined) mentionSearchCache.delete(oldest);
        }
        setResults(rows);
        onResultsChange?.(rows);
        onHighlightedIndexChange(0);
      } catch (error) {
        if (!cancelled) {
          console.error('Seri etiketleme araması başarısız:', error);
          setResults([]);
          onResultsChange?.([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 130);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, includeAdult, onHighlightedIndexChange, onResultsChange]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        containerRef.current?.contains(target) ||
        anchorEl?.contains(target)
      ) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, anchorEl, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Seri etiketleme önerileri"
      className={cn(
        'absolute left-0 z-50 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/80 bg-popover/95 shadow-2xl backdrop-blur-md',
        openUpwards ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
      )}
    >
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          SERİLER
        </span>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="max-h-60 overflow-y-auto overscroll-contain p-1">
        {!isLoading && results.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 opacity-60" />
            <span>Eşleşen seri bulunamadı.</span>
          </div>
        ) : (
          results.map((item, idx) => {
            const active = idx === highlightedIndex;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onHighlightedIndexChange(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-secondary text-foreground' : 'text-foreground/90 hover:bg-secondary/60',
                )}
              >
                <div className="h-10 w-7 shrink-0 overflow-hidden rounded bg-muted border border-border/40">
                  {item.cover ? (
                    <img
                      src={item.cover}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold leading-snug">{item.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {getMangaTypeLabel(item.type)}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
