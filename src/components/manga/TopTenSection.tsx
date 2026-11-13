import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { Manga } from '@/lib/types';
import { getTopTenMangas } from '@/lib/database';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import ProxyImage from '@/components/media/ProxyImage';
import { getMangaTypeLabel } from '@/lib/mangaType';

const TOP_TEN_CACHE: Record<'today' | 'week' | 'all', Manga[] | null> = {
  today: null,
  week: null,
  all: null,
};

const FILTER_LABELS: Record<'today' | 'week' | 'all', string> = {
  today: 'Bugün',
  week: 'Bu Hafta',
  all: 'Tüm Zamanlar',
};

const TOP_TEN_COVER_TRANSFORM = Object.freeze({
  width: 520,
  quality: 70,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const TopTenSection: React.FC = () => {
  const cardWidthClass = "w-[calc((100%-16px)/2.3)] sm:w-[calc((100%-120px)/5)]";
  const { disableHeavyEffects, isCoarsePointer } = useDeviceProfile();
  const [timeFilter, setTimeFilter] = useState<'today' | 'week' | 'all'>('today');
  const [displayedFilter, setDisplayedFilter] = useState<'today' | 'week' | 'all'>('today');
  const [mangas, setMangas] = useState<Manga[]>(() => TOP_TEN_CACHE.today ?? []);
  const [isLoading, setIsLoading] = useState(() => TOP_TEN_CACHE.today === null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [hasMeasuredArrows, setHasMeasuredArrows] = useState(false);
  const showArrowControls = !isCoarsePointer && !disableHeavyEffects;
  const isFilterSwitching = isLoading && displayedFilter !== timeFilter;
  const showLoadingSkeletons = isLoading && mangas.length === 0;
  const estimatedHasOverflow = mangas.length > 5;

  const updateArrows = useCallback(() => {
    const scroller = scrollNode;

    if (!scroller || !showArrowControls) {
      setHasMeasuredArrows(false);
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = scroller;
    setHasMeasuredArrows(true);
    setShowLeftArrow(scrollLeft > 20);
    setShowRightArrow(scrollWidth > clientWidth + 20 && scrollLeft < scrollWidth - clientWidth - 20);
  }, [scrollNode, showArrowControls]);

  const requestArrowUpdate = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateArrows();
    });
  }, [updateArrows]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      const scrollAmount = clientWidth;
      const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
      const nextScrollLeft = direction === 'left'
        ? Math.max(0, scrollLeft - scrollAmount)
        : Math.min(maxScrollLeft, scrollLeft + scrollAmount);

      scrollRef.current.scrollTo({
        left: nextScrollLeft,
        behavior: 'smooth',
      });
      window.setTimeout(requestArrowUpdate, 450);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!showArrowControls) {
      setHasMeasuredArrows(false);
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }

    const handleResize = () => requestArrowUpdate();
    window.addEventListener('resize', handleResize, { passive: true });

    let observer: ResizeObserver | null = null;

    if (scrollNode && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        requestArrowUpdate();
      });

      observer.observe(scrollNode);
    }

    requestArrowUpdate();
    const delayedChecks = [120, 320, 640].map((delay) => window.setTimeout(requestArrowUpdate, delay));

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
      delayedChecks.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [displayedFilter, requestArrowUpdate, scrollNode, showArrowControls, showLoadingSkeletons]);

  useEffect(() => () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setHasMeasuredArrows(false);
    const cachedMangas = TOP_TEN_CACHE[timeFilter];

    if (cachedMangas) {
      setDisplayedFilter(timeFilter);
      setMangas(cachedMangas);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    const fetchTopTen = async () => {
      try {
        const data = await getTopTenMangas(timeFilter);
        if (!active) {
          return;
        }

        TOP_TEN_CACHE[timeFilter] = data;
        setDisplayedFilter(timeFilter);
        setMangas(data);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    fetchTopTen();

    return () => {
      active = false;
    };
  }, [timeFilter]);

  useEffect(() => {
    if (!scrollNode) {
      return;
    }

    scrollNode.scrollTo({ left: 0, behavior: 'auto' });
    requestArrowUpdate();
  }, [displayedFilter, requestArrowUpdate, scrollNode, showLoadingSkeletons]);

  const uniqueMangas = React.useMemo(() => {
    const seen = new Set<string>();
    return mangas.filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 10);
  }, [mangas]);

  return (
    <section className="py-8 relative group/section overflow-visible">
      {/* Header Area */}
      <div className="container mx-auto max-w-7xl px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              {FILTER_LABELS[timeFilter]} Top 10
            </h2>
            <Link
              to="/top-10"
              className="text-xs font-medium text-primary hover:underline shrink-0"
            >
              Tümü →
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {/* Time Filter Pills */}
            <div className="inline-flex items-center rounded-lg border border-border/60 bg-card/70 p-0.5">
              {(['today', 'week', 'all'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    if (filter !== timeFilter) {
                      setTimeFilter(filter);
                    }
                  }}
                  className={cn(
                    'relative overflow-hidden rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap',
                    timeFilter === filter
                      ? 'text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  disabled={isFilterSwitching && timeFilter === filter}
                >
                  {timeFilter === filter && (
                    <motion.span
                      layoutId="top-ten-filter-pill"
                      className="absolute inset-0 rounded-md bg-primary shadow-sm"
                      transition={
                        disableHeavyEffects
                          ? { duration: 0.14, ease: 'easeOut' }
                          : { type: 'spring', stiffness: 420, damping: 34, mass: 0.6 }
                      }
                    />
                  )}
                  <span className="relative z-10">{FILTER_LABELS[filter]}</span>
                </button>
              ))}
            </div>

            {/* Header-integrated Carousel Arrows */}
            {showArrowControls && (
              <div className="hidden sm:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => scroll('left')}
                  disabled={!showLeftArrow}
                  aria-label="Sola kaydır"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/70 text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-35 disabled:pointer-events-none"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scroll('right')}
                  disabled={!showRightArrow && !( !hasMeasuredArrows && estimatedHasOverflow && !showLoadingSkeletons )}
                  aria-label="Sağa kaydır"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/70 text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-35 disabled:pointer-events-none"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Cards */}
        <div className="relative min-h-[250px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={showLoadingSkeletons ? `loading-${timeFilter}` : `content-${displayedFilter}`}
              initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: disableHeavyEffects ? 0 : -6 }}
              transition={{ duration: disableHeavyEffects ? 0.12 : 0.16, ease: 'easeOut' }}
            >
              <div
                ref={(node) => {
                  scrollRef.current = node;
                  setScrollNode(node);
                }}
                onScroll={updateArrows}
                className="flex gap-3 sm:gap-3.5 overflow-x-auto scrollbar-hide pb-2 scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {showLoadingSkeletons ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="w-[42vw] max-w-[165px] sm:w-[175px] md:w-[185px] shrink-0 space-y-2 animate-pulse">
                      <div className="aspect-[5/7] w-full rounded-lg bg-muted/60" />
                      <div className="h-3.5 w-4/5 rounded bg-muted/60" />
                      <div className="h-3 w-1/2 rounded bg-muted/60" />
                    </div>
                  ))
                ) : (
                  uniqueMangas.map((manga, index) => {
                    const rankClass =
                      index === 0
                        ? 'bg-amber-500 text-black border-amber-300/60'
                        : index === 1
                          ? 'bg-zinc-200 text-zinc-950 border-white/60'
                          : index === 2
                            ? 'bg-amber-700 text-white border-amber-500/50'
                            : 'bg-black/80 text-white border-white/15';

                    return (
                      <Link
                        key={manga.id}
                        to={`/manga/${manga.id}`}
                        className="group relative w-[42vw] max-w-[165px] sm:w-[175px] md:w-[185px] shrink-0 block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-lg"
                      >
                        <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg border border-border/60 bg-muted transition-colors group-hover:border-primary/50">
                          <ProxyImage
                            src={manga.cover}
                            alt={manga.title}
                            transform={TOP_TEN_COVER_TRANSFORM}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            loading={index < 5 ? 'eager' : 'lazy'}
                            decoding="async"
                            fetchPriority={index < 2 ? 'high' : 'low'}
                          />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />

                          <span
                            className={cn(
                              'absolute left-2 top-2 inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums shadow-sm',
                              rankClass,
                            )}
                          >
                            #{index + 1}
                          </span>

                          <span className="absolute right-2 top-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white/95 backdrop-blur-sm">
                            {getMangaTypeLabel(manga.type)}
                          </span>
                        </div>

                        <div className="mt-1.5 space-y-0.5 px-0.5 min-w-0">
                          <h3 className="truncate text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                            {manga.title}
                          </h3>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-0.5 font-medium text-amber-400">
                              <Star className="h-3 w-3 fill-current" />
                              {Number(manga.averageRating || 0).toFixed(1)}
                            </span>
                            <span className="opacity-50">·</span>
                            <span className="truncate tabular-nums">
                              {manga.chapterCount || manga.chapters?.length || 0} bölüm
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence>
            {isFilterSwitching && !showLoadingSkeletons && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="absolute inset-0 z-20 rounded-xl bg-background/50 backdrop-blur-[2px] flex items-center justify-center"
              >
                <div className="rounded-lg border border-border/60 bg-card/90 px-3.5 py-1.5 text-xs font-medium text-foreground">
                  {FILTER_LABELS[timeFilter]} hazırlanıyor...
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}} />
    </section>
  );
};

export default TopTenSection;
