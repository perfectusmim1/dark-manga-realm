import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { Manga } from '@/lib/types';
import { getTopTenMangas } from '@/lib/database';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import ProxyImage from '@/components/media/ProxyImage';

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
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const showArrowControls = !isCoarsePointer && !disableHeavyEffects;
  const isFilterSwitching = isLoading && displayedFilter !== timeFilter;
  const showLoadingSkeletons = isLoading && mangas.length === 0;

  const updateArrows = () => {
    if (!scrollRef.current || !showArrowControls) {
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 20);
    setShowRightArrow(scrollWidth > clientWidth + 20 && scrollLeft < scrollWidth - clientWidth - 20);
  };

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
      setTimeout(updateArrows, 500);
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [showArrowControls]);

  useEffect(() => {
    let active = true;
    const cachedMangas = TOP_TEN_CACHE[timeFilter];
    const syncCarouselPosition = (delay: number) => {
      window.setTimeout(() => {
        if (!active) {
          return;
        }

        scrollRef.current?.scrollTo({ left: 0, behavior: 'auto' });
        updateArrows();
      }, delay);
    };

    if (cachedMangas) {
      setDisplayedFilter(timeFilter);
      setMangas(cachedMangas);
      setIsLoading(false);
      syncCarouselPosition(50);
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
          syncCarouselPosition(200);
        }
      }
    };

    fetchTopTen();

    return () => {
      active = false;
    };
  }, [timeFilter]);

  return (
    <section className="py-12 relative group/section overflow-visible">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-2 px-4 sm:px-10 lg:px-16">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="px-1.5 py-0.5 rounded bg-primary text-[10px] font-black text-primary-foreground uppercase shadow-lg shadow-primary/20">
              Top 10
            </span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                key={timeFilter}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="text-3xl sm:text-4xl font-black tracking-tighter text-white uppercase italic"
              >
                {FILTER_LABELS[timeFilter]} Top 10
              </motion.h2>
            </AnimatePresence>
          </div>
          <p className="text-[11px] font-black tracking-[0.2em] text-primary/60 uppercase">
            Popülerlik skoruna göre sıralı
          </p>
        </div>

        {/* Time Filter Buttons */}
        <div className={`grid w-full max-w-[20rem] grid-cols-3 items-stretch rounded-full border border-white/10 bg-white/5 p-1 sm:w-auto sm:max-w-[22rem] ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`}>
          {(['today', 'week', 'all'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => {
                if (filter === timeFilter) {
                  return;
                }

                setTimeFilter(filter);
              }}
              className={cn(
                "relative min-h-[2.85rem] w-full overflow-hidden rounded-full px-3 py-2 text-center text-[10px] font-black uppercase leading-tight tracking-[0.12em] transition-colors duration-200 sm:min-h-[3rem] sm:text-[11px]",
                timeFilter === filter 
                  ? "text-primary-foreground" 
                  : "text-white/40 hover:text-white"
              )}
              disabled={isFilterSwitching && timeFilter === filter}
            >
              {timeFilter === filter && (
                <motion.span
                  layoutId="top-ten-filter-pill"
                  className="absolute inset-0 rounded-full bg-primary shadow-lg shadow-primary/30"
                  transition={
                    disableHeavyEffects
                      ? { duration: 0.16, ease: 'easeOut' }
                      : { type: 'spring', stiffness: 420, damping: 34, mass: 0.6 }
                  }
                />
              )}
              <span className="relative z-10">{FILTER_LABELS[filter]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="relative group/carousel">
        {/* Adjusted Navigation Arrows - Centered precisely on the poster height */}
        {showArrowControls && <AnimatePresence>
          {showLeftArrow && (
            <motion.button
              key="top-ten-arrow-left"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('left')}
              className="absolute left-0 top-0 bottom-[80px] z-50 w-12 sm:w-16 bg-black/20 hover:bg-black/60 text-white transition-all duration-300 flex items-center justify-center group/arrow opacity-0 group-hover/carousel:opacity-100"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-10 w-10 transition-transform duration-300 group-hover/arrow:scale-125 group-active/arrow:scale-90" />
            </motion.button>
          )}

          {showRightArrow && (
            <motion.button
              key="top-ten-arrow-right"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('right')}
              className="absolute right-0 top-0 bottom-[80px] z-50 w-12 sm:w-16 bg-black/20 hover:bg-black/60 text-white transition-all duration-300 flex items-center justify-center group/arrow opacity-0 group-hover/carousel:opacity-100"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-10 w-10 transition-transform duration-300 group-hover/arrow:scale-125 group-active/arrow:scale-90" />
            </motion.button>
          )}
        </AnimatePresence>}

        {/* Scrollable Container with enough top space for the huge numbers */}
        <div className="relative min-h-[360px] sm:min-h-[420px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={showLoadingSkeletons ? `loading-${timeFilter}` : `content-${displayedFilter}`}
              initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: disableHeavyEffects ? 0 : -8 }}
              transition={{
                duration: disableHeavyEffects ? 0.14 : 0.2,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <div 
                ref={scrollRef}
                onScroll={updateArrows}
                className="flex gap-4 sm:gap-6 overflow-x-auto overflow-y-visible scrollbar-hide pt-16 pb-20 px-4 sm:px-10 lg:px-16 scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {showLoadingSkeletons ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className={`relative shrink-0 ${cardWidthClass} aspect-[2/3] animate-pulse bg-white/5 rounded-2xl`} />
                  ))
                ) : (
                  mangas.map((manga, index) => {
                    const posterContent = (
                      <>
                        <div className={`absolute -left-6 -top-8 z-40 pointer-events-none select-none ${disableHeavyEffects ? '' : 'transition-transform duration-500 group-hover:scale-105'} sm:-left-10`}>
                          <span
                            className={`block text-[96px] font-black leading-none text-transparent underline-none sm:text-[144px] ${disableHeavyEffects ? 'stroke-netflix-lite' : 'stroke-netflix-balanced transition-all duration-300'}`}
                            style={{ fontFamily: '"Arial Black", sans-serif', letterSpacing: '-0.08em' }}
                          >
                            {index + 1}
                          </span>
                        </div>

                        <Link
                          to={`/manga/${manga.id}`}
                          className={`relative z-10 block w-full aspect-[2/3] overflow-hidden rounded-xl bg-background shadow-2xl ${disableHeavyEffects ? '' : 'transform-gpu transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-primary/20'}`}
                        >
                          <ProxyImage
                            src={manga.cover}
                            alt={manga.title}
                            transform={TOP_TEN_COVER_TRANSFORM}
                            className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-700'}`}
                            loading="lazy"
                            decoding="async"
                            fetchPriority="low"
                          />

                          <div className={`absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent ${disableHeavyEffects ? 'opacity-100' : 'opacity-0 transition-opacity duration-300 group-hover:opacity-100'}`} />

                          <div className={`absolute bottom-0 left-0 right-0 p-3 sm:p-5 ${disableHeavyEffects ? '' : 'translate-y-full transition-transform duration-300 group-hover:translate-y-0'}`}>
                            <h3 className="mb-2 truncate text-[13px] font-black uppercase tracking-tight text-white drop-shadow-lg sm:text-[15px]">
                              {manga.title}
                            </h3>
                            <div className="flex items-center gap-3">
                              <span className="rounded bg-primary px-2 py-0.5 text-[9px] font-black uppercase text-primary-foreground shadow shadow-primary/30">
                                {manga.type}
                              </span>
                              <div className="flex items-center gap-1 text-[11px] font-black text-white">
                                <Star className="h-3 w-3 fill-primary text-primary" />
                                {Number(manga.averageRating || 0).toFixed(1)}
                              </div>
                            </div>
                          </div>
                        </Link>
                      </>
                    );

                    if (disableHeavyEffects) {
                      return (
                        <div key={manga.id} className={`group relative shrink-0 ${cardWidthClass}`}>
                          {posterContent}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={manga.id}
                        className={`group relative shrink-0 ${cardWidthClass}`}
                      >
                        {posterContent}
                      </div>
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
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className="absolute inset-x-4 top-16 bottom-20 z-20 rounded-[28px] border border-white/10 bg-background/45 backdrop-blur-[2px] sm:inset-x-10 lg:inset-x-16"
              >
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/75">
                    {FILTER_LABELS[timeFilter]} hazırlanıyor
                  </div>
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
        .stroke-netflix-balanced {
          -webkit-text-stroke: 4px rgba(255,255,255,0.9);
          text-shadow: 0 6px 18px rgba(0,0,0,0.72);
        }
        .stroke-netflix-lite {
          -webkit-text-stroke: 4px rgba(255,255,255,0.92);
          text-shadow: 0 2px 10px rgba(0,0,0,0.75);
        }
        .group:hover .stroke-netflix-balanced {
          -webkit-text-stroke: 3px rgba(255,255,255,1);
          text-shadow: 0 8px 22px rgba(255,255,255,0.16);
        }
        @media (min-width: 640px) {
          .stroke-netflix-balanced {
            -webkit-text-stroke: 6px rgba(255,255,255,1);
          }
          .stroke-netflix-lite {
            -webkit-text-stroke: 6px rgba(255,255,255,0.96);
          }
        }
      `}} />
    </section>
  );
};

export default TopTenSection;
