import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { Manga } from '@/lib/types';
import { getTopTenMangas } from '@/lib/database';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const TOP_TEN_CACHE: Record<'today' | 'week' | 'all', Manga[] | null> = {
  today: null,
  week: null,
  all: null,
};

const TopTenSection: React.FC = () => {
  const cardWidthClass = "w-[calc((100%-16px)/2.3)] sm:w-[calc((100%-120px)/5)]";
  const [timeFilter, setTimeFilter] = useState<'today' | 'week' | 'all'>('today');
  const [mangas, setMangas] = useState<Manga[]>(() => TOP_TEN_CACHE.today ?? []);
  const [isLoading, setIsLoading] = useState(() => TOP_TEN_CACHE.today === null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const updateArrows = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeftArrow(scrollLeft > 20);
      setShowRightArrow(scrollWidth > clientWidth + 20 && scrollLeft < scrollWidth - clientWidth - 20);
    }
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
  }, []);

  useEffect(() => {
    let active = true;
    const cachedMangas = TOP_TEN_CACHE[timeFilter];

    if (cachedMangas) {
      setMangas(cachedMangas);
      setIsLoading(false);
      window.setTimeout(updateArrows, 50);
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
        setMangas(data);
      } finally {
        if (active) {
          setIsLoading(false);
          window.setTimeout(updateArrows, 200);
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
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter text-white uppercase italic">
              {timeFilter === 'all' ? 'Tüm Zamanlar' : timeFilter === 'week' ? 'Bu Hafta' : 'Bugün'} Top 10
            </h2>
          </div>
          <p className="text-[11px] font-black tracking-[0.2em] text-primary/60 uppercase">
            Popülerlik skoruna göre sıralı
          </p>
        </div>

        {/* Time Filter Buttons */}
        <div className="grid w-full max-w-[20rem] grid-cols-3 items-stretch rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md sm:w-auto sm:max-w-[22rem]">
          {(['today', 'week', 'all'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setTimeFilter(filter)}
              className={cn(
                "min-h-[2.85rem] w-full rounded-full px-3 py-2 text-center text-[10px] font-black uppercase leading-tight tracking-[0.12em] transition-all duration-300 sm:min-h-[3rem] sm:text-[11px]",
                timeFilter === filter 
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-105" 
                  : "text-white/40 hover:text-white"
              )}
            >
              {filter === 'today' ? 'Bugün' : filter === 'week' ? 'Bu Hafta' : 'Tüm Zamanlar'}
            </button>
          ))}
        </div>
      </div>

      <div className="relative group/carousel">
        {/* Adjusted Navigation Arrows - Centered precisely on the poster height */}
        <AnimatePresence>
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
        </AnimatePresence>

        {/* Scrollable Container with enough top space for the huge numbers */}
        <div 
          ref={scrollRef}
          onScroll={updateArrows}
          className="flex gap-4 sm:gap-6 overflow-x-auto overflow-y-visible scrollbar-hide pt-16 pb-20 px-4 sm:px-10 lg:px-16 scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`relative shrink-0 ${cardWidthClass} aspect-[2/3] animate-pulse bg-white/5 rounded-2xl`} />
            ))
          ) : (
            mangas.map((manga, index) => (
              <motion.div
                key={manga.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className={`group relative shrink-0 ${cardWidthClass}`}
              >
                {/* Huge Ranking Number - Netflix Style (Top Left Placement) */}
                <div className="absolute -top-8 -left-6 sm:-left-10 z-40 pointer-events-none select-none transition-transform duration-500 group-hover:scale-105">
                  <span className="text-[96px] sm:text-[144px] font-black leading-none text-transparent stroke-netflix transition-all duration-500 block underline-none"
                        style={{ fontFamily: '"Arial Black", sans-serif', letterSpacing: '-0.08em' }}>
                    {index + 1}
                  </span>
                </div>

                {/* Poster Content */}
                <Link
                  to={`/manga/${manga.id}`}
                  className="relative z-10 block w-full aspect-[2/3] overflow-hidden rounded-xl bg-background shadow-2xl transition-all duration-500 group-hover:shadow-primary/30 group-hover:-translate-y-2 will-change-transform transform-gpu"
                >
                  <img
                    src={manga.cover}
                    alt={manga.title}
                    className="h-full w-full object-cover transition-transform duration-700"
                    loading="lazy"
                  />
                  
                  {/* Glass Gradient Overlay - Subtle darkening as requested */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                  {/* Info Panel - Always uses the best available rating field */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-5 translate-y-full transition-transform duration-300 group-hover:translate-y-0">
                    <h3 className="text-white text-[13px] sm:text-[15px] font-black truncate mb-2 uppercase tracking-tight drop-shadow-lg">
                      {manga.title}
                    </h3>
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded bg-primary text-[9px] font-black text-primary-foreground uppercase shadow shadow-primary/30">
                        {manga.type}
                      </span>
                      <div className="flex items-center gap-1 text-white text-[11px] font-black">
                        <Star className="h-3 w-3 fill-primary text-primary" />
                        {Number(manga.averageRating || 0).toFixed(1)}
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .stroke-netflix {
          -webkit-text-stroke: 4px rgba(255,255,255,0.9);
          filter: drop-shadow(0 0 20px rgba(0,0,0,1))
                  drop-shadow(0 0 10px rgba(0,0,0,1));
        }
        .group:hover .stroke-netflix {
          -webkit-text-stroke: 1.5px rgba(255,255,255,1);
          color: white;
          filter: drop-shadow(0 0 30px rgba(255,255,255,0.3));
        }
        @media (min-width: 640px) {
          .stroke-netflix {
            -webkit-text-stroke: 6px rgba(255,255,255,1);
          }
        }
      `}} />
    </section>
  );
};

export default TopTenSection;
