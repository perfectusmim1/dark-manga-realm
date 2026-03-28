import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles, Play, ChevronLeft, ChevronRight, Download, WifiOff } from 'lucide-react';
import Header from '@/components/layout/Header';
import InstallAppBanner from '@/components/pwa/InstallAppBanner';
import MangaCard from '@/components/manga/MangaCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getMangaSummaries, getTrendingTags } from '@/lib/database';
import TagBadge from '@/components/tags/TagBadge';
import { getReadingHistoryEntries, type ReadingHistoryEntry } from '@/lib/storage';
import { supabaseUrl } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Manga, Tag } from '@/lib/types';
import { AnimatePresence, motion } from 'framer-motion';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { OfflineMangaGroup } from '@/lib/offline/types';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import DeferredMount from '@/components/performance/DeferredMount';
import OptimizedImage from '@/components/media/OptimizedImage';
import { Skeleton } from '@/components/ui/skeleton';
import { getManagedArtworkSrcSet } from '@/lib/managedArtwork';

interface HorizontalMangaSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  linkTo: string;
  manga: Manga[];
  delay: string;
  disableHeavyEffects: boolean;
  isCoarsePointer: boolean;
  withTopSpacing?: boolean;
  priorityCount?: number;
}

interface ContinueReadingEntry {
  manga: Manga;
  chapterId: string;
  chapterNumber: number;
  page: number;
  lastRead: string;
}

const getEstimatedHomeCarouselItemWidth = (viewportWidth: number, clientWidth: number) => {
  const fallbackWidth = Math.max(clientWidth, viewportWidth);

  if (viewportWidth >= 1280) {
    return Math.max(140, (fallbackWidth - 96) / 7);
  }

  if (viewportWidth >= 1024) {
    return Math.max(148, (fallbackWidth - 80) / 6);
  }

  if (viewportWidth >= 768) {
    return Math.max(156, (fallbackWidth - 64) / 5);
  }

  if (viewportWidth >= 640) {
    return Math.max(164, (fallbackWidth - 48) / 4);
  }

  if (viewportWidth >= 430) {
    return 168;
  }

  return 156;
};

const HOME_PAGE_CACHE: {
  mangas: Manga[] | null;
  trendingTags: Tag[] | null;
  continueReadingByUser: Record<string, ReadingHistoryEntry[] | undefined>;
} = {
  mangas: null,
  trendingTags: null,
  continueReadingByUser: {},
};

const CONTINUE_READING_BANNER_TRANSFORM = Object.freeze({
  width: 1200,
  quality: 64,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const CONTINUE_READING_COVER_TRANSFORM = Object.freeze({
  width: 520,
  quality: 70,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const CONTINUE_READING_COVER_INTRINSIC_WIDTH = 480;
const CONTINUE_READING_COVER_INTRINSIC_HEIGHT = 640;
const CONTINUE_READING_COVER_SIZES = '(min-width: 1024px) 16rem, (min-width: 640px) 14rem, 9.75rem';
const CONTINUE_READING_BANNER_SIZES = '100vw';

const CONTINUE_READING_SESSION_CACHE_KEY = 'toonparrot-home-continue-reading-v1';

interface PersistedContinueReadingCache {
  userId: string;
  entries: ReadingHistoryEntry[];
  updatedAt: string;
}

const getSupabaseAuthStorageKey = () => {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
};

const hasPersistedSupabaseSession = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const authStorageKey = getSupabaseAuthStorageKey();
  if (!authStorageKey) {
    return false;
  }

  return Boolean(window.localStorage.getItem(authStorageKey));
};

const readPersistedContinueReadingCache = (): PersistedContinueReadingCache | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(CONTINUE_READING_SESSION_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedContinueReadingCache;
    if (!parsed || typeof parsed.userId !== 'string' || !Array.isArray(parsed.entries)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const writePersistedContinueReadingCache = (userId: string, entries: ReadingHistoryEntry[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  const payload: PersistedContinueReadingCache = {
    userId,
    entries: entries.slice(0, 6),
    updatedAt: new Date().toISOString(),
  };

  window.sessionStorage.setItem(CONTINUE_READING_SESSION_CACHE_KEY, JSON.stringify(payload));
};

const clearPersistedContinueReadingCache = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(CONTINUE_READING_SESSION_CACHE_KEY);
};

const formatContinueReadingLastRead = (lastRead: string) => {
  const timestamp = new Date(lastRead).getTime();
  if (Number.isNaN(timestamp)) {
    return 'Son okuma kaydı hazır';
  }

  const diffMs = Date.now() - timestamp;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (diffMs < oneDayMs) {
    return 'Bugün okudun';
  }

  if (diffMs < oneDayMs * 2) {
    return 'Dün okudun';
  }

  return `Son okuma ${new Date(timestamp).toLocaleDateString('tr-TR')}`;
};

interface ContinueReadingSpotlightProps {
  entries: ContinueReadingEntry[];
  disableHeavyEffects: boolean;
}

const ContinueReadingSpotlightSkeleton: React.FC = () => (
  <section aria-hidden>
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-7 w-56 max-w-[52vw] sm:h-9 sm:w-72 sm:max-w-[70vw]" />
      </div>
      <Skeleton className="h-8 w-20 shrink-0 rounded-full sm:h-9 sm:w-24" />
    </div>

    <div className="overflow-hidden rounded-[30px] border border-primary/10 bg-card/70 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.14)] sm:p-8 lg:p-10">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.15fr)_240px] lg:items-end lg:gap-10">
        <div className="order-2 lg:order-1">
          <Skeleton className="h-7 w-32 rounded-full sm:h-8 sm:w-36" />
          <Skeleton className="mt-3 h-10 w-full max-w-xl sm:mt-4 sm:h-14 sm:max-w-2xl" />
          <Skeleton className="mt-4 hidden h-24 w-full max-w-3xl sm:block" />

          <div className="mt-5 flex flex-wrap gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6">
            <Skeleton className="h-12 w-40 rounded-full" />
            <Skeleton className="h-12 w-36 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
          <Skeleton className="aspect-[3/4] w-[9.75rem] rounded-[26px] sm:w-[14rem] sm:rounded-[28px] lg:w-full lg:max-w-[16rem]" />
        </div>
      </div>
    </div>

    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`continue-reading-skeleton-${index}`}
          className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/70 p-3"
        >
          <Skeleton className="h-20 w-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  </section>
);

const ContinueReadingSpotlight: React.FC<ContinueReadingSpotlightProps> = ({
  entries,
  disableHeavyEffects,
}) => {
  const [featured, ...secondaryEntries] = entries;

  if (!featured) {
    return null;
  }

  const featuredBannerSrcSet = getManagedArtworkSrcSet(featured.manga.banner);
  const featuredCoverSrcSet = getManagedArtworkSrcSet(featured.manga.cover);

  const secondary = secondaryEntries.slice(0, 3);
  const continueHref = `/manga/${featured.manga.id}/chapter/${featured.chapterId}`;
  const detailsHref = `/manga/${featured.manga.id}`;

  return (
    <section
      className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
      style={
        disableHeavyEffects
          ? { contentVisibility: 'auto', containIntrinsicSize: '760px 1120px' }
          : {
              animationDelay: '0.12s',
              animationFillMode: 'forwards',
              contentVisibility: 'auto',
              containIntrinsicSize: '760px 1120px',
            }
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <Play className="h-5 w-5 text-primary" />
          <h2 className="line-clamp-1 text-lg font-bold tracking-tight sm:text-xl md:text-2xl">Kaldığın Yerden Devam Et</h2>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0 px-2 sm:px-3">
          <Link to="/history">
            Geçmiş
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="relative overflow-hidden rounded-[30px] border border-primary/15 bg-card shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        {featured.manga.banner && (
          <div className="absolute inset-0">
            <OptimizedImage
              src={featured.manga.banner}
              alt=""
              priority
              srcSet={featuredBannerSrcSet}
              sizes={CONTINUE_READING_BANNER_SIZES}
              transform={CONTINUE_READING_BANNER_TRANSFORM}
              containerClassName="h-full w-full"
              placeholderClassName="rounded-none"
              className="h-full w-full object-cover object-top opacity-30"
            />
          </div>
        )}

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(244,114,182,0.12),transparent_34%)]" />
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background/92 to-background/78" />

        <div className="relative z-10 grid gap-4 px-4 py-4 sm:gap-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.15fr)_240px] lg:items-end lg:gap-10 lg:px-10 lg:py-10">
          <div className="order-2 lg:order-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              Son kaldığın seri
            </div>

            <h3 className="mt-3 max-w-3xl line-clamp-1 text-[2rem] font-black leading-[1.02] tracking-tight sm:mt-4 sm:text-4xl lg:text-[2.75rem] lg:leading-none">
              {featured.manga.title}
            </h3>

            <p className="mt-4 hidden max-w-2xl text-sm leading-6 text-muted-foreground sm:block sm:text-[15px]">
              {featured.manga.description || 'Kaldığın bölüme tek dokunuşla geri dön ve okumayı bıraktığın yerden devam et.'}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="secondary" className="h-8 rounded-full px-3 text-xs">
                Bölüm {featured.chapterNumber}
              </Badge>
              <Badge variant="outline" className="h-8 rounded-full px-3 text-xs">
                Sayfa {Math.max(1, featured.page)}
              </Badge>
              <Badge variant="outline" className="h-8 rounded-full px-3 text-xs">
                {featured.manga.type.toUpperCase()}
              </Badge>
              {featured.manga.genres[0] && (
                <Badge variant="outline" className="h-8 rounded-full px-3 text-xs">
                  {featured.manga.genres[0]}
                </Badge>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button asChild variant="glow" className="rounded-full px-5">
                <Link to={continueHref}>
                  <Play className="mr-2 h-4 w-4" />
                  Devam Et
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full px-5">
                <Link to={detailsHref}>Seri Sayfası</Link>
              </Button>
              <p className="text-xs text-muted-foreground">{formatContinueReadingLastRead(featured.lastRead)}</p>
            </div>
          </div>

          <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
            <Link
              to={continueHref}
              className="group block w-[9.75rem] sm:w-[14rem] lg:w-full lg:max-w-[16rem]"
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-[28px] border border-white/10 bg-black/20 shadow-[0_20px_40px_rgba(0,0,0,0.28)]">
                <OptimizedImage
                  src={featured.manga.cover}
                  alt={featured.manga.title}
                  width={CONTINUE_READING_COVER_INTRINSIC_WIDTH}
                  height={CONTINUE_READING_COVER_INTRINSIC_HEIGHT}
                  srcSet={featuredCoverSrcSet}
                  sizes={CONTINUE_READING_COVER_SIZES}
                  priority
                  rootMargin="640px 0px"
                  transform={CONTINUE_READING_COVER_TRANSFORM}
                  containerClassName="h-full w-full"
                  placeholderClassName="rounded-[28px]"
                  className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-500 group-hover:scale-105'}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">Devam Noktan</p>
                  <p className="mt-1 text-lg font-black text-white">Bölüm {featured.chapterNumber}</p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {secondary.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {secondary.map((entry, index) => (
            <Link
              key={entry.manga.id}
              to={`/manga/${entry.manga.id}/chapter/${entry.chapterId}`}
              className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card/70 p-3 transition-colors hover:border-primary/20 hover:bg-card"
            >
              <OptimizedImage
                src={entry.manga.cover}
                alt={entry.manga.title}
                width={CONTINUE_READING_COVER_INTRINSIC_WIDTH}
                height={CONTINUE_READING_COVER_INTRINSIC_HEIGHT}
                srcSet={getManagedArtworkSrcSet(entry.manga.cover)}
                sizes="56px"
                priority={index === 0}
                rootMargin="540px 0px"
                transform={CONTINUE_READING_COVER_TRANSFORM}
                containerClassName="h-20 w-14 shrink-0 overflow-hidden rounded-xl"
                placeholderClassName="rounded-xl"
                className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-300 group-hover:scale-105'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-sm font-semibold">{entry.manga.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Bölüm {entry.chapterNumber}</span>
                  <span className="h-1 w-1 rounded-full bg-border" />
                  <span>Sayfa {Math.max(1, entry.page)}</span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{formatContinueReadingLastRead(entry.lastRead)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
};

const HorizontalMangaSection: React.FC<HorizontalMangaSectionProps> = ({
  title,
  icon: Icon,
  iconClassName,
  linkTo,
  manga,
  delay,
  disableHeavyEffects,
  isCoarsePointer,
  withTopSpacing = true,
  priorityCount = 0,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [itemWidth, setItemWidth] = useState(0);
  const [scrollMetrics, setScrollMetrics] = useState(() => ({
    scrollLeft: 0,
    clientWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
    viewportWidth: typeof window === 'undefined' ? 1024 : window.innerWidth,
  }));
  const showArrowControls = !isCoarsePointer && !disableHeavyEffects;

  const updateLayoutMetrics = useCallback(() => {
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
  }, [showArrowControls]);

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
  }, [manga.length, showArrowControls, updateLayoutMetrics]);

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
  const effectiveItemWidth = itemWidth > 0
    ? itemWidth
    : getEstimatedHomeCarouselItemWidth(scrollMetrics.viewportWidth, scrollMetrics.clientWidth);
  const itemStride = effectiveItemWidth > 0 ? effectiveItemWidth + gapPx : 0;
  const shouldVirtualize = manga.length > 6 && itemStride > 0 && scrollMetrics.clientWidth > 0;

  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: manga.length,
      };
    }

    const overscanItems = 1;
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
                topTenWeekIds={null}
                disableHeavyEffects={disableHeavyEffects}
                coverPriority={visibleRange.startIndex + index < priorityCount}
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
  const { snapshot: offlineSnapshot, isOnline } = useOfflineLibrary();
  const { disableHeavyEffects, isCoarsePointer } = useDeviceProfile();
  const [mangas, setMangas] = useState<Manga[]>(() => HOME_PAGE_CACHE.mangas ?? []);
  const [hasPersistedAuthSession, setHasPersistedAuthSession] = useState(() => hasPersistedSupabaseSession());
  const [continueReadingSeed, setContinueReadingSeed] = useState<ReadingHistoryEntry[]>(() => (
    readPersistedContinueReadingCache()?.entries ?? []
  ));
  const [continueReadingLoading, setContinueReadingLoading] = useState(false);
  const [trendingTags, setTrendingTags] = useState<Tag[]>(() => HOME_PAGE_CACHE.trendingTags ?? []);
  const [tagsLoading, setTagsLoading] = useState(() => HOME_PAGE_CACHE.trendingTags === null);
  const mangaById = useMemo(() => new Map(mangas.map((item) => [item.id, item])), [mangas]);
  const sectionDeferredRootMargin = isCoarsePointer ? '260px 0px' : '180px 0px';
  const blockDeferredRootMargin = isCoarsePointer ? '320px 0px' : '220px 0px';

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
  }, [isOnline, offlineManga]);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    let active = true;

    const loadMainContent = async () => {
      try {
        const allMangas = await getMangaSummaries();
        if (!active) {
          return;
        }

        HOME_PAGE_CACHE.mangas = allMangas;
        setMangas(allMangas);
      } catch (err) {
        console.error('Data loading error:', err);
      }
    };

    loadMainContent();

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
    if (authLoading) {
      setHasPersistedAuthSession(hasPersistedSupabaseSession());
      return;
    }

    setHasPersistedAuthSession(Boolean(user));

    if (!user) {
      clearPersistedContinueReadingCache();
    }
  }, [authLoading, user]);

  useEffect(() => {
    let active = true;

    const loadContinueReading = async () => {
      if (authLoading) {
        if (hasPersistedAuthSession && continueReadingSeed.length === 0) {
          setContinueReadingLoading(true);
        }
        return;
      }

      if (!isOnline || !user) {
        setContinueReadingSeed([]);
        setContinueReadingLoading(false);
        clearPersistedContinueReadingCache();
        return;
      }

      const persistedCache = readPersistedContinueReadingCache();
      const cachedEntries = HOME_PAGE_CACHE.continueReadingByUser[user.id]
        ?? (persistedCache?.userId === user.id ? persistedCache.entries : undefined);

      if (cachedEntries) {
        setContinueReadingSeed(cachedEntries);
        setContinueReadingLoading(false);
      } else {
        setContinueReadingLoading(true);
      }

      try {
        const historyEntries = await getReadingHistoryEntries(user.id);
        const uniqueEntries: ReadingHistoryEntry[] = [];
        const seenMangaIds = new Set<string>();

        for (const entry of historyEntries) {
          if (seenMangaIds.has(entry.mangaId)) {
            continue;
          }

          seenMangaIds.add(entry.mangaId);
          uniqueEntries.push(entry);

          if (uniqueEntries.length === 6) {
            break;
          }
        }

        if (!active) {
          return;
        }

        HOME_PAGE_CACHE.continueReadingByUser[user.id] = uniqueEntries;
        setContinueReadingSeed(uniqueEntries);
        writePersistedContinueReadingCache(user.id, uniqueEntries);
      } catch (err) {
        console.error('Continue reading loading error:', err);
        if (active) {
          setContinueReadingSeed([]);
        }
      } finally {
        if (active) {
          setContinueReadingLoading(false);
        }
      }
    };

    void loadContinueReading();

    return () => {
      active = false;
    };
  }, [authLoading, continueReadingSeed.length, hasPersistedAuthSession, isOnline, user]);

  const continueReading = useMemo<ContinueReadingEntry[]>(() => (
    continueReadingSeed
      .map((entry) => {
        const manga = mangaById.get(entry.mangaId);
        if (!manga) {
          return null;
        }

        return {
          manga,
          chapterId: entry.chapterId,
          chapterNumber: entry.chapterNumber,
          page: entry.page,
          lastRead: entry.lastRead,
        } satisfies ContinueReadingEntry;
      })
      .filter(Boolean) as ContinueReadingEntry[]
  ), [continueReadingSeed, mangaById]);

  const {
    trendingManga,
    newlyAddedSeries,
    recentlyUpdated,
  } = useMemo(() => ({
    trendingManga: [...mangas].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8),
    newlyAddedSeries: [...mangas]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8),
    recentlyUpdated: [...mangas]
      .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
      .slice(0, 12),
  }), [mangas]);

  const canRenderContinueReadingSlot = isOnline && (Boolean(user) || (authLoading && hasPersistedAuthSession));
  const shouldShowContinueReading = canRenderContinueReadingSlot && continueReading.length > 0;
  const showContinueReadingSkeleton = canRenderContinueReadingSlot
    && !shouldShowContinueReading
    && (authLoading || continueReadingLoading || continueReadingSeed.length > 0);
  const shouldRenderContinueReadingSlot = shouldShowContinueReading || showContinueReadingSkeleton;

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

        {shouldRenderContinueReadingSlot && (
          <div className="mt-10">
            {showContinueReadingSkeleton ? (
              <ContinueReadingSpotlightSkeleton />
            ) : (
            <ContinueReadingSpotlight
              entries={continueReading}
              disableHeavyEffects={disableHeavyEffects}
            />
            )}
          </div>
        )}

        {isOnline ? (
          <>
            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin={sectionDeferredRootMargin}>
              <HorizontalMangaSection
                title="Yeni Çıkan Seriler"
                icon={Sparkles}
                iconClassName="h-5 w-5 text-amber-400"
                linkTo="/browse?sort=created"
                manga={newlyAddedSeries}
                delay="0.18s"
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
                priorityCount={2}
              />
            </DeferredMount>

            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin={sectionDeferredRootMargin}>
              <HorizontalMangaSection
                title="Son Güncellenenler"
                icon={Clock}
                iconClassName="h-5 w-5 text-primary"
                linkTo="/browse?sort=updated"
                manga={recentlyUpdated}
                delay="0.2s"
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
                priorityCount={0}
              />
            </DeferredMount>

            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin={sectionDeferredRootMargin}>
              <HorizontalMangaSection
                title="Trend Olanlar"
                icon={TrendingUp}
                iconClassName="h-5 w-5 text-primary"
                linkTo="/browse?sort=trending"
                manga={trendingManga}
                delay="0.25s"
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
                priorityCount={0}
              />
            </DeferredMount>

            <DeferredMount className="mt-16" placeholderMinHeight={260} rootMargin={blockDeferredRootMargin}>
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
          <DeferredMount className="mt-10" placeholderMinHeight={720} rootMargin={blockDeferredRootMargin}>
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
                      topTenWeekIds={null}
                      disableHeavyEffects={disableHeavyEffects}
                      coverPriority={index < 4}
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
