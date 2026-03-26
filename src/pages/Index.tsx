import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles, Play, BookOpen, ChevronLeft, ChevronRight, Download, WifiOff } from 'lucide-react';
import Header from '@/components/layout/Header';
import InstallAppBanner from '@/components/pwa/InstallAppBanner';
import TopTenSection from '@/components/manga/TopTenSection';
import MangaCard from '@/components/manga/MangaCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getMangaSummaries, getTopTenMangas, getTrendingTags } from '@/lib/database';
import TagBadge from '@/components/tags/TagBadge';
import { getReadingHistory, getLatestProgress } from '@/lib/storage';
import { useAuth } from '@/contexts/AuthContext';
import HomeSkeleton from '@/components/skeletons/HomeSkeleton';
import { Manga, Tag } from '@/lib/types';
import { AnimatePresence, motion } from 'framer-motion';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { OfflineMangaGroup } from '@/lib/offline/types';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import DeferredMount from '@/components/performance/DeferredMount';
import OptimizedImage from '@/components/media/OptimizedImage';

interface HorizontalMangaSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  linkTo: string;
  manga: Manga[];
  delay: string;
  topTenWeekIds: ReadonlySet<string>;
  disableHeavyEffects: boolean;
  isCoarsePointer: boolean;
  withTopSpacing?: boolean;
}

const HOME_PAGE_CACHE: {
  mangas: Manga[] | null;
  trendingTags: Tag[] | null;
} = {
  mangas: null,
  trendingTags: null,
};

const HorizontalMangaSection: React.FC<HorizontalMangaSectionProps> = ({
  title,
  icon: Icon,
  iconClassName,
  linkTo,
  manga,
  delay,
  topTenWeekIds,
  disableHeavyEffects,
  isCoarsePointer,
  withTopSpacing = true,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [itemWidth, setItemWidth] = useState(0);
  const [scrollMetrics, setScrollMetrics] = useState(() => ({
    scrollLeft: 0,
    clientWidth: 0,
    viewportWidth: typeof window === 'undefined' ? 1024 : window.innerWidth,
  }));
  const showArrowControls = !isCoarsePointer && !disableHeavyEffects;

  const updateLayoutMetrics = () => {
    if (!scrollRef.current) {
      setScrollMetrics((current) => ({
        ...current,
        viewportWidth: typeof window === 'undefined' ? current.viewportWidth : window.innerWidth,
      }));
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;

    setScrollMetrics({
      scrollLeft,
      clientWidth,
      viewportWidth,
    });

    if (!showArrowControls) {
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }

    setShowLeftArrow(scrollLeft > 20);
    setShowRightArrow(scrollWidth > clientWidth + 20 && scrollLeft < scrollWidth - clientWidth - 20);
  };

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) {
      return;
    }

    const scrollAmount = scrollRef.current.clientWidth * 0.82;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });

    window.setTimeout(updateLayoutMetrics, 450);
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let ticking = false;

    const requestLayoutUpdate = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        updateLayoutMetrics();
      });
    };

    requestLayoutUpdate();
    window.addEventListener('resize', requestLayoutUpdate);

    return () => window.removeEventListener('resize', requestLayoutUpdate);
  }, [manga.length, showArrowControls]);

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) {
      return;
    }

    const updateItemWidth = () => {
      const nextWidth = probe.getBoundingClientRect().width;
      if (nextWidth > 0) {
        setItemWidth(nextWidth);
      }
    };

    updateItemWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateItemWidth);
      return () => window.removeEventListener('resize', updateItemWidth);
    }

    const observer = new ResizeObserver(() => {
      updateItemWidth();
    });

    observer.observe(probe);
    return () => observer.disconnect();
  }, [manga.length]);

  const gapPx = scrollMetrics.viewportWidth >= 640 ? 16 : 12;
  const itemStride = itemWidth > 0 ? itemWidth + gapPx : 0;
  const shouldVirtualize = manga.length > 6 && itemStride > 0 && scrollMetrics.clientWidth > 0;

  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: manga.length,
      };
    }

    const overscanItems = 2;
    const startIndex = Math.max(0, Math.floor(scrollMetrics.scrollLeft / itemStride) - overscanItems);
    const endIndex = Math.min(
      manga.length,
      Math.ceil((scrollMetrics.scrollLeft + scrollMetrics.clientWidth) / itemStride) + overscanItems,
    );

    return {
      startIndex,
      endIndex: Math.max(startIndex + 1, endIndex),
    };
  }, [itemStride, manga.length, scrollMetrics.clientWidth, scrollMetrics.scrollLeft, shouldVirtualize]);

  const visibleManga = shouldVirtualize
    ? manga.slice(visibleRange.startIndex, visibleRange.endIndex)
    : manga;
  const hiddenBeforeCount = shouldVirtualize ? visibleRange.startIndex : 0;
  const hiddenAfterCount = shouldVirtualize ? Math.max(0, manga.length - visibleRange.endIndex) : 0;
  const leftSpacerWidth = shouldVirtualize
    ? Math.max(0, hiddenBeforeCount * itemStride - gapPx)
    : 0;
  const rightSpacerWidth = shouldVirtualize
    ? Math.max(0, hiddenAfterCount * itemStride - gapPx)
    : 0;

  const sectionStyle: React.CSSProperties = {
    contentVisibility: 'auto',
    containIntrinsicSize: '420px 1120px',
  };

  if (!disableHeavyEffects) {
    sectionStyle.animationDelay = delay;
    sectionStyle.animationFillMode = 'forwards';
  }

  return (
    <section className={`${withTopSpacing ? 'mt-12 ' : ''}${disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}`} style={sectionStyle}>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={iconClassName} />
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to={linkTo}>
            Tümünü Gör
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="relative group/carousel">
        {showArrowControls && <AnimatePresence>
          {showLeftArrow && (
            <motion.button
              key={`${title}-arrow-left`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('left')}
              className="absolute left-0 top-0 bottom-0 z-40 w-12 sm:w-16 bg-black/20 hover:bg-black/60 text-white transition-all duration-300 flex items-center justify-center group/arrow opacity-0 group-hover/carousel:opacity-100"
              aria-label={`${title} sola kaydır`}
            >
              <ChevronLeft className="h-10 w-10 transition-transform duration-300 group-hover/arrow:scale-125 group-active/arrow:scale-90" />
            </motion.button>
          )}

          {showRightArrow && (
            <motion.button
              key={`${title}-arrow-right`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('right')}
              className="absolute right-0 top-0 bottom-0 z-40 w-12 sm:w-16 bg-black/20 hover:bg-black/60 text-white transition-all duration-300 flex items-center justify-center group/arrow opacity-0 group-hover/carousel:opacity-100"
              aria-label={`${title} sağa kaydır`}
            >
              <ChevronRight className="h-10 w-10 transition-transform duration-300 group-hover/arrow:scale-125 group-active/arrow:scale-90" />
            </motion.button>
          )}
        </AnimatePresence>}

        {manga[0] && (
          <div aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
            <div
              ref={probeRef}
              className="w-[9.75rem] shrink-0 min-[430px]:w-[10.5rem] sm:w-[calc((100%-48px)/4)] md:w-[calc((100%-64px)/5)] lg:w-[calc((100%-80px)/6)] xl:w-[calc((100%-96px)/7)] 2xl:w-[calc((100%-96px)/7)]"
            />
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={updateLayoutMetrics}
          className="flex gap-3 overflow-x-auto px-0 scroll-smooth scrollbar-hide sm:gap-4"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {leftSpacerWidth > 0 && <div aria-hidden style={{ width: leftSpacerWidth, flex: '0 0 auto' }} />}

          {visibleManga.map((item, index) => (
            <div
              key={item.id}
              className="w-[9.75rem] shrink-0 min-[430px]:w-[10.5rem] sm:w-[calc((100%-48px)/4)] md:w-[calc((100%-64px)/5)] lg:w-[calc((100%-80px)/6)] xl:w-[calc((100%-96px)/7)] 2xl:w-[calc((100%-96px)/7)]"
            >
              <MangaCard
                manga={item}
                index={visibleRange.startIndex + index}
                topTenWeekIds={topTenWeekIds}
                disableHeavyEffects={disableHeavyEffects}
              />
            </div>
          ))}

          {rightSpacerWidth > 0 && <div aria-hidden style={{ width: rightSpacerWidth, flex: '0 0 auto' }} />}
        </div>
      </div>
    </section>
  );
};

const Index: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const { snapshot: offlineSnapshot, isLoading: offlineLibraryLoading, isOnline } = useOfflineLibrary();
  const { disableHeavyEffects, isCoarsePointer } = useDeviceProfile();
  const [mangas, setMangas] = useState<Manga[]>(() => HOME_PAGE_CACHE.mangas ?? []);
  const [continueReading, setContinueReading] = useState<{ manga: Manga; chapterId: string; chapterNumber: number }[]>([]);
  const [isLoading, setIsLoading] = useState(() => HOME_PAGE_CACHE.mangas === null);
  const [trendingTags, setTrendingTags] = useState<Tag[]>(() => HOME_PAGE_CACHE.trendingTags ?? []);
  const [tagsLoading, setTagsLoading] = useState(() => HOME_PAGE_CACHE.trendingTags === null);
  const [topTenWeekIds, setTopTenWeekIds] = useState<Set<string>>(() => new Set());

  const offlineManga = React.useMemo<Manga[]>(() => (
    offlineSnapshot.series.map((entry: OfflineMangaGroup) => ({
      id: entry.manga.mangaId,
      title: entry.manga.title,
      alternativeTitles: [],
      cover: entry.manga.cover,
      banner: entry.manga.banner,
      author: entry.manga.author,
      artist: entry.manga.artist,
      status: entry.manga.status,
      genres: entry.manga.genres,
      description: entry.manga.description,
      ratings: [],
      views: 0,
      chapters: entry.chapters
        .slice()
        .sort((a, b) => b.chapterNumber - a.chapterNumber)
        .map((chapter) => ({
          id: chapter.chapterId,
          number: chapter.chapterNumber,
          title: chapter.title,
          pages: chapter.sourcePageUrls,
          releaseDate: chapter.releaseDate,
          views: 0,
        })),
      lastUpdated: entry.manga.lastUpdated,
      createdAt: entry.manga.createdAt,
      type: entry.manga.type,
      averageRating: 0,
      reviewCount: 0,
    }))
  ), [offlineSnapshot.series]);

  useEffect(() => {
    if (isOnline) {
      return;
    }

    setMangas(offlineManga);
    setIsLoading(false);
  }, [isOnline, offlineManga]);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    let active = true;

    const loadMainContent = async () => {
      try {
        if (HOME_PAGE_CACHE.mangas === null) {
          setIsLoading(true);
        }

        const allMangas = await getMangaSummaries();
        if (!active) {
          return;
        }

        HOME_PAGE_CACHE.mangas = allMangas;
        setMangas(allMangas);
        setIsLoading(false);
      } catch (err) {
        console.error('Data loading error:', err);
        if (active) {
          setIsLoading(false);
        }
      }
    };

    loadMainContent();

    return () => {
      active = false;
    };
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) {
      setTopTenWeekIds(new Set());
      return;
    }

    let active = true;

    const loadTopTenWeekIds = async () => {
      try {
        const weeklyTopTen = await getTopTenMangas('week');
        if (!active) {
          return;
        }

        setTopTenWeekIds(new Set(weeklyTopTen.map((item) => item.id)));
      } catch (error) {
        console.error('Weekly top ten id load error:', error);
      }
    };

    void loadTopTenWeekIds();

    return () => {
      active = false;
    };
  }, [isOnline]);

  useEffect(() => {
    let active = true;

    const loadTrendingTags = async () => {
      if (!isOnline) {
        setTrendingTags([]);
        setTagsLoading(false);
        return;
      }

      if (HOME_PAGE_CACHE.trendingTags === null) {
        setTagsLoading(true);
      }

      try {
        const tags = await getTrendingTags(20);
        if (!active) {
          return;
        }

        HOME_PAGE_CACHE.trendingTags = tags;
        setTrendingTags(tags);
      } finally {
        if (active) {
          setTagsLoading(false);
        }
      }
    };

    loadTrendingTags();

    return () => {
      active = false;
    };
  }, [isOnline]);

  useEffect(() => {
    let active = true;

    const loadContinueReading = async () => {
      if (authLoading) {
        return;
      }

      if (!isOnline || !user || mangas.length === 0) {
        setContinueReading([]);
        return;
      }

      try {
        const history = await getReadingHistory(user.id);
        const uniqueMangaIds = [...new Set(history.map((item) => item.mangaId))].slice(0, 6);

        const continueList = await Promise.all(uniqueMangaIds.map(async (mangaId) => {
          const manga = mangas.find((item) => item.id === mangaId);
          const progress = await getLatestProgress(user.id, mangaId);
          if (manga && progress) {
            return { manga, chapterId: progress.chapterId, chapterNumber: progress.chapterNumber };
          }
          return null;
        }));

        if (!active) {
          return;
        }

        setContinueReading(continueList.filter(Boolean) as { manga: Manga; chapterId: string; chapterNumber: number }[]);
      } catch (err) {
        console.error('Continue reading loading error:', err);
        if (active) {
          setContinueReading([]);
        }
      }
    };

    loadContinueReading();

    return () => {
      active = false;
    };
  }, [authLoading, isOnline, mangas, user]);

  const {
    trendingManga,
    newlyAddedSeries,
    recentlyUpdated,
    popularManhwa,
    popularManhua,
    popularWebtoon,
  } = useMemo(() => ({
    trendingManga: [...mangas].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8),
    newlyAddedSeries: [...mangas]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8),
    recentlyUpdated: [...mangas]
      .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
      .slice(0, 12),
    popularManhwa: mangas.filter(m => m.type === 'manhwa').slice(0, 8),
    popularManhua: mangas.filter(m => m.type === 'manhua').slice(0, 8),
    popularWebtoon: mangas.filter(m => m.type === 'webtoon').slice(0, 8),
  }), [mangas]);

  const showHomeSkeleton =
    (isOnline && isLoading && mangas.length === 0) ||
    (!isOnline && offlineLibraryLoading && offlineManga.length === 0);

  if (showHomeSkeleton) {
    return (
      <>
        <Header />
        <HomeSkeleton />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'} style={disableHeavyEffects ? undefined : { animationDelay: '0.06s', animationFillMode: 'forwards' }}>
          <InstallAppBanner className="mb-8" />
        </div>

        {!isOnline && (
          <section className={`mb-10 rounded-[28px] border border-blue-500/20 bg-blue-500/10 p-6 shadow-[0_20px_50px_rgba(14,165,233,0.08)] ${disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}`} style={disableHeavyEffects ? undefined : { animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
                  <WifiOff className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300/80">Çevrimdışı Mod</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight">Ana sayfa yerel kütüphane ile açıldı</h2>
                  <p className="mt-2 max-w-2xl text-sm text-blue-100/75">
                    Bu modda yalnızca indirilen seriler güvenli şekilde açılır. Topluluk, arama ve online içerikler internet isteyebilir.
                  </p>
                </div>
              </div>
              <Button asChild variant="glow" className="rounded-full px-5">
                <Link to="/downloads">
                  <Download className="mr-2 h-4 w-4" />
                  İndirilenlere Git
                </Link>
              </Button>
            </div>
          </section>
        )}

        {isOnline && (
          <div className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'} style={disableHeavyEffects ? undefined : { animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <TopTenSection />
          </div>
        )}

        {/* Continue Reading Section */}
        {user && continueReading.length > 0 && (
          <DeferredMount className="mt-10" placeholderMinHeight={420} rootMargin="600px 0px">
            <section
              className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
              style={disableHeavyEffects ? { contentVisibility: 'auto', containIntrinsicSize: '420px 1120px' } : { animationDelay: '0.15s', animationFillMode: 'forwards', contentVisibility: 'auto', containIntrinsicSize: '420px 1120px' }}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Play className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold tracking-tight md:text-2xl">Kaldığın Yerden Devam Et</h2>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/history">
                    Tümünü Gör
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
                {continueReading.map(({ manga, chapterId, chapterNumber }, index) => (
                  <Link
                    key={manga.id}
                    to={`/manga/${manga.id}/chapter/${chapterId}`}
                    className="group relative"
                  >
                    <div className="relative aspect-[3/4] overflow-hidden rounded-xl">
                      <OptimizedImage
                        src={manga.cover}
                        alt={manga.title}
                        priority={index < 4}
                        rootMargin="520px 0px"
                        containerClassName="h-full w-full"
                        placeholderClassName="rounded-xl"
                        className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-300 group-hover:scale-110'}`}
                      />
                      <div className={`absolute inset-0 bg-black/8 ${disableHeavyEffects ? '' : 'transition-colors duration-300 group-hover:bg-black/18'}`} />
                      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 z-20 p-3">
                        <h3 className="line-clamp-1 text-sm font-semibold text-white">{manga.title}</h3>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            Bölüm {chapterNumber}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </DeferredMount>
        )}

        {isOnline ? (
          <>
            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin="680px 0px">
              <HorizontalMangaSection
                title="Yeni Çıkan Seriler"
                icon={Sparkles}
                iconClassName="h-5 w-5 text-amber-400"
                linkTo="/browse?sort=created"
                manga={newlyAddedSeries}
                delay="0.18s"
                topTenWeekIds={topTenWeekIds}
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
              />
            </DeferredMount>

            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin="680px 0px">
              <HorizontalMangaSection
                title="Son Güncellenenler"
                icon={Clock}
                iconClassName="h-5 w-5 text-primary"
                linkTo="/browse?sort=updated"
                manga={recentlyUpdated}
                delay="0.2s"
                topTenWeekIds={topTenWeekIds}
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
              />
            </DeferredMount>

            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin="680px 0px">
              <HorizontalMangaSection
                title="Trend Olanlar"
                icon={TrendingUp}
                iconClassName="h-5 w-5 text-primary"
                linkTo="/browse?sort=trending"
                manga={trendingManga}
                delay="0.25s"
                topTenWeekIds={topTenWeekIds}
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
              />
            </DeferredMount>

            {popularManhwa.length > 0 && (
              <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin="680px 0px">
                <HorizontalMangaSection
                  title="Popüler Manhwa"
                  icon={Sparkles}
                  iconClassName="h-5 w-5 text-purple-500"
                  linkTo="/browse?type=manhwa"
                  manga={popularManhwa}
                  delay="0.3s"
                  topTenWeekIds={topTenWeekIds}
                  disableHeavyEffects={disableHeavyEffects}
                  isCoarsePointer={isCoarsePointer}
                  withTopSpacing={false}
                />
              </DeferredMount>
            )}

            {popularManhua.length > 0 && (
              <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin="680px 0px">
                <HorizontalMangaSection
                  title="Popüler Manhua"
                  icon={BookOpen}
                  iconClassName="h-5 w-5 text-green-500"
                  linkTo="/browse?type=manhua"
                  manga={popularManhua}
                  delay="0.35s"
                  topTenWeekIds={topTenWeekIds}
                  disableHeavyEffects={disableHeavyEffects}
                  isCoarsePointer={isCoarsePointer}
                  withTopSpacing={false}
                />
              </DeferredMount>
            )}

            {popularWebtoon.length > 0 && (
              <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin="680px 0px">
                <HorizontalMangaSection
                  title="Popüler Webtoon"
                  icon={BookOpen}
                  iconClassName="h-5 w-5 text-sky-400"
                  linkTo="/browse?type=webtoon"
                  manga={popularWebtoon}
                  delay="0.4s"
                  topTenWeekIds={topTenWeekIds}
                  disableHeavyEffects={disableHeavyEffects}
                  isCoarsePointer={isCoarsePointer}
                  withTopSpacing={false}
                />
              </DeferredMount>
            )}

            <DeferredMount className="mt-16" placeholderMinHeight={260} rootMargin="720px 0px">
              <section
                className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
                style={disableHeavyEffects ? { contentVisibility: 'auto', containIntrinsicSize: '260px 1120px' } : { animationDelay: '0.45s', animationFillMode: 'forwards', contentVisibility: 'auto', containIntrinsicSize: '260px 1120px' }}
              >
                <div className="mb-6 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold tracking-tight">Trend Etiketler</h2>
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-none px-2 h-5 text-[10px]">
                    Bu Hafta
                  </Badge>
                </div>
                <div className={`flex flex-wrap gap-2.5 rounded-2xl border border-border bg-card/30 p-8 ${disableHeavyEffects ? '' : 'backdrop-blur-sm'}`}>
                  {tagsLoading ? (
                    Array.from({ length: 15 }).map((_, i) => (
                      <div key={i} className="h-8 rounded-full bg-secondary/30 animate-pulse" style={{ width: `${60 + (i % 5) * 20}px` }} />
                    ))
                  ) : (
                    trendingTags.map((tag, index) => (
                      <Link key={tag.id} to={`/browse?tags=${tag.slug}`}>
                        <TagBadge tag={tag} size={index < 5 ? 'md' : 'sm'} />
                      </Link>
                    ))
                  )}
                </div>
              </section>
            </DeferredMount>
          </>
        ) : (
          <DeferredMount className="mt-10" placeholderMinHeight={720} rootMargin="720px 0px">
            <section
              className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
              style={disableHeavyEffects ? { contentVisibility: 'auto', containIntrinsicSize: '720px 1120px' } : { animationDelay: '0.16s', animationFillMode: 'forwards', contentVisibility: 'auto', containIntrinsicSize: '720px 1120px' }}
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold tracking-tight md:text-2xl">İndirilen Seriler</h2>
                </div>
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  {offlineManga.length} seri
                </Badge>
              </div>

              {offlineManga.length > 0 ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
                  {offlineManga.map((manga, index) => (
                    <MangaCard
                      key={manga.id}
                      manga={manga}
                      index={index}
                      topTenWeekIds={topTenWeekIds}
                      disableHeavyEffects={disableHeavyEffects}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-border bg-card/30 p-10 text-center">
                  <Download className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-xl font-bold">Henüz indirilen seri yok</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Çevrimdışında ana sayfadan açılabilecek seriler burada görünür.
                  </p>
                  <Button asChild className="mt-5" variant="outline">
                    <Link to="/downloads">İndirilenler</Link>
                  </Button>
                </div>
              )}
            </section>
          </DeferredMount>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 py-8">
        <div className="container">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="text-center md:text-left">
              <h3 className="text-lg font-bold">
                <img src="/logo.webp" alt="Logo" className="h-12 w-auto object-contain" loading="lazy" decoding="async" />
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                En iyi manga, manhwa, manhua ve webtoon okuma deneyimi
              </p>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link to="/browse" className="hover:text-foreground transition-colors">Keşfet</Link>
              <Link to="/browse?type=manhwa" className="hover:text-foreground transition-colors">Manhwa</Link>
              <Link to="/browse?type=manga" className="hover:text-foreground transition-colors">Manga</Link>
              <Link to="/browse?type=manhua" className="hover:text-foreground transition-colors">Manhua</Link>
              <Link to="/browse?type=webtoon" className="hover:text-foreground transition-colors">Webtoon</Link>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-border text-center">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} ToonParrot. Tüm hakları saklıdır.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
