import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles, Play, ChevronLeft, ChevronRight, Download, WifiOff } from 'lucide-react';
import Header from '@/components/layout/Header';
import InstallAppBanner from '@/components/pwa/InstallAppBanner';
import MangaCard from '@/components/manga/MangaCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { HomePageMangaSections } from '@/lib/database';
import TagBadge from '@/components/tags/TagBadge';
import type { ReadingHistoryEntry } from '@/lib/storage';
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
import { getAlignedCarouselTarget } from '@/lib/carousel';
import {
  areContinueReadingEntriesEquivalent,
  areContinueReadingMangaSnapshotsEquivalent,
  buildContinueReadingMangaFromSnapshot,
  clearPersistedContinueReadingCache,
  extractContinueReadingMangaSnapshot,
  readPersistedContinueReadingCache,
  type ContinueReadingCacheEntry,
  writePersistedContinueReadingCache,
} from '@/lib/continueReadingCache';

interface HorizontalMangaSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  linkTo: string;
  manga: Manga[];
  topTenWeekIds?: ReadonlySet<string> | null;
  delay: string;
  disableHeavyEffects: boolean;
  isCoarsePointer: boolean;
  withTopSpacing?: boolean;
  priorityCount?: number;
  coverRootMargin?: string;
  sectionAnimationDurationMs?: number;
  cardAnimationDelayStepMs?: number;
  cardAnimationDurationMs?: number;
}

interface ContinueReadingEntry {
  manga: Manga;
  chapterId: string;
  chapterNumber: number;
  page: number;
  lastRead: string;
}

const buildContinueReadingFallbackManga = (entry: ContinueReadingCacheEntry): Manga | null => {
  if (!entry.mangaId || !entry.mangaTitle || !entry.mangaCover) {
    return null;
  }

  const anchorDate = entry.lastRead || new Date().toISOString();

  return {
    id: entry.mangaId,
    title: entry.mangaTitle,
    alternativeTitles: entry.mangaAlternativeTitles || [],
    cover: entry.mangaCover,
    banner: entry.mangaCover,
    author: 'Bilinmiyor',
    artist: '',
    status: 'ongoing',
    genres: [],
    description: 'Kaldığın yerden okumaya devam et.',
    ratings: [],
    views: 0,
    chapters: [],
    lastUpdated: anchorDate,
    createdAt: anchorDate,
    type: 'manga',
    averageRating: 0,
    reviewCount: 0,
  };
};

const getEstimatedHomeCarouselItemWidth = (viewportWidth: number, clientWidth: number) => {
  const fallbackWidth = Math.max(clientWidth, viewportWidth);

  if (viewportWidth >= 1280) {
    return Math.max(148, (fallbackWidth - 96) / 6);
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

const EMPTY_HOME_PAGE_SECTIONS: HomePageMangaSections = {
  trendingManga: [],
  newlyAddedSeries: [],
  recentlyUpdated: [],
};

const CONTINUE_READING_DESCRIPTION_LIMIT = 280;

type HomeDataModule = {
  getHomePageMangaSections: () => Promise<HomePageMangaSections>;
  getTopTenMangaIds: (timeframe?: 'today' | 'week' | 'all') => Promise<Set<string>>;
  getTrendingTags: (limit?: number, options?: { includePending?: boolean }) => Promise<Tag[]>;
};

type ReadingHistoryModule = {
  getReadingHistoryEntries: (userId: string) => Promise<ReadingHistoryEntry[]>;
};

let homeDataModulePromise: Promise<HomeDataModule> | null = null;
let readingHistoryModulePromise: Promise<ReadingHistoryModule> | null = null;

const loadHomeDataModule = () => {
  if (!homeDataModulePromise) {
    homeDataModulePromise = import('@/lib/database').then((module) => ({
      getHomePageMangaSections: module.getHomePageMangaSections,
      getTopTenMangaIds: module.getTopTenMangaIds,
      getTrendingTags: module.getTrendingTags,
    }));
  }

  return homeDataModulePromise;
};

const loadReadingHistoryModule = () => {
  if (!readingHistoryModulePromise) {
    readingHistoryModulePromise = import('@/lib/storage').then((module) => ({
      getReadingHistoryEntries: module.getReadingHistoryEntries,
    }));
  }

  return readingHistoryModulePromise;
};

const HOME_PAGE_CACHE: {
  sections: HomePageMangaSections | null;
  trendingTags: Tag[] | null;
  continueReadingByUser: Record<string, ContinueReadingCacheEntry[] | undefined>;
} = {
  sections: null,
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
const HOME_SECTION_DEFERRED_ROOT_MARGIN = {
  coarse: '1040px 0px',
  fine: '820px 0px',
} as const;
const HOME_BLOCK_DEFERRED_ROOT_MARGIN = {
  coarse: '1160px 0px',
  fine: '920px 0px',
} as const;
const HOME_CARD_IMAGE_ROOT_MARGIN = {
  coarse: '1080px 0px',
  fine: '860px 0px',
} as const;
const HOME_SECTION_ANIMATION_DURATION_MS = 220;
const HOME_CARD_ANIMATION_DELAY_STEP_MS = 12;
const HOME_CARD_ANIMATION_DURATION_MS = 180;
const HOME_CAROUSEL_ARROW_STEP_ITEMS = 5;
const HOME_CAROUSEL_SCROLL_SETTLE_DELAY_MS = 280;
const HOME_CAROUSEL_ARROW_VISIBILITY_THRESHOLD_PX = 12;
const DISABLE_HOME_DEFERRED_MOUNTS = true;

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

const getInitialVisibleHomeSectionCardCount = (viewportWidth: number, isCoarsePointer: boolean) => {
  if (viewportWidth >= 1280) {
    return 6;
  }

  if (viewportWidth >= 1024) {
    return 5;
  }

  if (viewportWidth >= 640) {
    return 4;
  }

  return isCoarsePointer ? 3 : 4;
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

const truncateContinueReadingDescription = (value?: string | null) => {
  const normalized = value?.replace(/\s+/g, ' ').trim() || '';
  if (!normalized) {
    return 'Kaldığın bölüme tek dokunuşla geri dön ve okumayı bıraktığın yerden devam et.';
  }

  if (normalized.length <= CONTINUE_READING_DESCRIPTION_LIMIT) {
    return normalized;
  }

  const sliced = normalized.slice(0, CONTINUE_READING_DESCRIPTION_LIMIT);
  const safeCutIndex = sliced.lastIndexOf(' ');
  const shortened = safeCutIndex >= CONTINUE_READING_DESCRIPTION_LIMIT - 24
    ? sliced.slice(0, safeCutIndex)
    : sliced;

  return `${shortened.trimEnd()}...`;
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
  const featuredDescription = truncateContinueReadingDescription(featured.manga.description);

  return (
    <section
      className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
      style={
        disableHeavyEffects
          ? undefined
          : {
              animationDelay: '0.12s',
              animationFillMode: 'forwards',
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

        <div className="relative z-10 grid grid-cols-[minmax(0,1fr)_8.75rem] items-start gap-3 px-3 py-3 min-[430px]:grid-cols-[minmax(0,1fr)_10rem] min-[430px]:gap-4 sm:gap-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.15fr)_240px] lg:items-end lg:gap-10 lg:px-10 lg:py-10">
          <div className="order-1 min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              Son kaldığın seri
            </div>

            <h3 className="mt-3 max-w-3xl pb-[0.08em] pr-1 text-[1.85rem] font-black leading-[1.02] tracking-tight min-[430px]:text-[2.05rem] sm:mt-4 sm:text-4xl sm:leading-[1.06] lg:text-[2.75rem] lg:leading-[1.04]">
              {featured.manga.title}
            </h3>

            <p className="mt-4 hidden max-w-2xl text-sm leading-6 text-muted-foreground sm:block sm:text-[15px]">
              {featuredDescription}
            </p>

            <div className="mt-4 flex flex-wrap gap-2 sm:mt-5">
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

            <div className="mt-5 flex flex-col gap-2.5 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <Button asChild variant="glow" className="w-full rounded-full px-5 sm:w-auto">
                <Link to={continueHref}>
                  <Play className="mr-2 h-4 w-4" />
                  Devam Et
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full rounded-full px-5 sm:w-auto">
                <Link to={detailsHref}>Seri Sayfası</Link>
              </Button>
              <p className="text-xs text-muted-foreground sm:ml-1">{formatContinueReadingLastRead(featured.lastRead)}</p>
            </div>
          </div>

          <div className="order-2 flex justify-end self-start lg:justify-end">
            <Link
              to={continueHref}
              className="group block w-full max-w-[8.75rem] min-[430px]:max-w-[10rem] sm:w-[14rem] sm:max-w-none lg:w-full lg:max-w-[16rem]"
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-[24px] border border-white/10 bg-black/20 shadow-[0_20px_40px_rgba(0,0,0,0.28)] sm:rounded-[28px]">
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
                  placeholderClassName="rounded-[24px] sm:rounded-[28px]"
                  className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-500 group-hover:scale-105'}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">Devam Noktan</p>
                  <p className="mt-1 text-base font-black text-white sm:text-lg">Bölüm {featured.chapterNumber}</p>
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
  topTenWeekIds,
  delay,
  disableHeavyEffects,
  isCoarsePointer,
  withTopSpacing = true,
  priorityCount = 0,
  coverRootMargin = '520px 0px',
  sectionAnimationDurationMs = HOME_SECTION_ANIMATION_DURATION_MS,
  cardAnimationDelayStepMs = HOME_CARD_ANIMATION_DELAY_STEP_MS,
  cardAnimationDurationMs = HOME_CARD_ANIMATION_DURATION_MS,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const layoutRafRef = useRef<number | null>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [itemWidth, setItemWidth] = useState(0);
  const [scrollMetrics, setScrollMetrics] = useState(() => ({
    clientWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
    viewportWidth: typeof window === 'undefined' ? 1024 : window.innerWidth,
  }));
  const showArrowControls = !isCoarsePointer && !disableHeavyEffects;
  const visibleManga = manga;
  const visibleCoverPriorityCount = Math.max(
    priorityCount,
    getInitialVisibleHomeSectionCardCount(scrollMetrics.viewportWidth, isCoarsePointer),
  );

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

    setScrollMetrics((current) => (
      current.clientWidth === clientWidth && current.viewportWidth === viewportWidth
        ? current
        : {
            clientWidth,
            viewportWidth,
          }
    ));

    if (!showArrowControls) {
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }

    setShowLeftArrow(scrollLeft > HOME_CAROUSEL_ARROW_VISIBILITY_THRESHOLD_PX);
    setShowRightArrow(
      scrollWidth > clientWidth + HOME_CAROUSEL_ARROW_VISIBILITY_THRESHOLD_PX
        && scrollLeft < scrollWidth - clientWidth - HOME_CAROUSEL_ARROW_VISIBILITY_THRESHOLD_PX,
    );
  }, [showArrowControls]);

  const requestLayoutMetricsUpdate = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (layoutRafRef.current !== null) {
      return;
    }

    layoutRafRef.current = window.requestAnimationFrame(() => {
      layoutRafRef.current = null;
      updateLayoutMetrics();
    });
  }, [updateLayoutMetrics]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    requestLayoutMetricsUpdate();
    window.addEventListener('resize', requestLayoutMetricsUpdate, { passive: true });

    return () => window.removeEventListener('resize', requestLayoutMetricsUpdate);
  }, [manga.length, requestLayoutMetricsUpdate, showArrowControls]);

  useEffect(() => {
    requestLayoutMetricsUpdate();
  }, [manga.length, requestLayoutMetricsUpdate]);

  useEffect(() => () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (layoutRafRef.current !== null) {
      window.cancelAnimationFrame(layoutRafRef.current);
    }
  }, []);

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) {
      return;
    }

    const updateItemWidth = () => {
      const nextWidth = probe.getBoundingClientRect().width;
      if (nextWidth > 0) {
        setItemWidth(nextWidth);
        requestLayoutMetricsUpdate();
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
  }, [manga.length, requestLayoutMetricsUpdate]);

  const gapPx = scrollMetrics.viewportWidth >= 640 ? 16 : 12;
  const effectiveItemWidth = itemWidth > 0
    ? itemWidth
    : getEstimatedHomeCarouselItemWidth(scrollMetrics.viewportWidth, scrollMetrics.clientWidth);
  const itemStride = effectiveItemWidth > 0 ? effectiveItemWidth + gapPx : 0;

  const scroll = useCallback((direction: 'left' | 'right') => {
    const scroller = scrollRef.current;

    if (!scroller || itemStride <= 0) {
      return;
    }

    const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const targetLeft = getAlignedCarouselTarget({
      currentScrollLeft: scroller.scrollLeft,
      itemStride,
      direction,
      stepItems: HOME_CAROUSEL_ARROW_STEP_ITEMS,
      maxScrollLeft,
    });

    scroller.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });

    requestLayoutMetricsUpdate();
    window.setTimeout(requestLayoutMetricsUpdate, HOME_CAROUSEL_SCROLL_SETTLE_DELAY_MS);
  }, [itemStride, requestLayoutMetricsUpdate]);

  const sectionStyle: React.CSSProperties = {};

  if (!disableHeavyEffects) {
    sectionStyle.animationDelay = delay;
    sectionStyle.animationDuration = `${sectionAnimationDurationMs}ms`;
    sectionStyle.animationTimingFunction = 'cubic-bezier(0.22, 1, 0.36, 1)';
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
              className="group/arrow absolute left-4 top-1/2 z-40 flex h-[3.25rem] w-[3.25rem] -translate-y-1/2 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.92))] text-white shadow-[0_16px_34px_rgba(37,99,235,0.34)] ring-1 ring-white/12 backdrop-blur-md transition-all duration-200 hover:scale-[1.04] hover:shadow-[0_18px_38px_rgba(37,99,235,0.42)] active:scale-[0.9] active:shadow-[0_10px_20px_rgba(37,99,235,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:left-5 sm:h-[3.6rem] sm:w-[3.6rem]"
              aria-label={`${title} sola kaydır`}
            >
              <ChevronLeft className="h-7 w-7 -translate-x-[1px] transition-transform duration-200 group-active/arrow:-translate-x-[3px] sm:h-8 sm:w-8" />
            </motion.button>
          )}

          {showRightArrow && (
            <motion.button
              key={`${title}-arrow-right`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('right')}
              className="group/arrow absolute right-4 top-1/2 z-40 flex h-[3.25rem] w-[3.25rem] -translate-y-1/2 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.92))] text-white shadow-[0_16px_34px_rgba(37,99,235,0.34)] ring-1 ring-white/12 backdrop-blur-md transition-all duration-200 hover:scale-[1.04] hover:shadow-[0_18px_38px_rgba(37,99,235,0.42)] active:scale-[0.9] active:shadow-[0_10px_20px_rgba(37,99,235,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:right-5 sm:h-[3.6rem] sm:w-[3.6rem]"
              aria-label={`${title} sağa kaydır`}
            >
              <ChevronRight className="h-7 w-7 translate-x-[1px] transition-transform duration-200 group-active/arrow:translate-x-[3px] sm:h-8 sm:w-8" />
            </motion.button>
          )}
        </AnimatePresence>}

        {manga[0] && (
          <div aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
            <div
              ref={probeRef}
              className="w-[9.75rem] shrink-0 min-[430px]:w-[10.5rem] sm:w-[calc((100%-48px)/4)] md:w-[calc((100%-64px)/5)] lg:w-[calc((100%-80px)/6)] xl:w-[calc((100%-96px)/6)] 2xl:w-[calc((100%-96px)/6)]"
            />
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={requestLayoutMetricsUpdate}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-0 scrollbar-hide sm:gap-4"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {visibleManga.map((item, index) => (
            <div
              key={item.id}
              className="w-[9.75rem] shrink-0 snap-start min-[430px]:w-[10.5rem] sm:w-[calc((100%-48px)/4)] md:w-[calc((100%-64px)/5)] lg:w-[calc((100%-80px)/6)] xl:w-[calc((100%-96px)/6)] 2xl:w-[calc((100%-96px)/6)]"
            >
              <MangaCard
                manga={item}
                index={index}
                topTenWeekIds={topTenWeekIds}
                disableHeavyEffects={disableHeavyEffects}
                coverPriority={index < visibleCoverPriorityCount}
                coverRootMargin={coverRootMargin}
                enableEntryAnimation
                entryAnimationClassName="animate-card-reveal-fast"
                entryAnimationDelayStepMs={cardAnimationDelayStepMs}
                entryAnimationDurationMs={cardAnimationDurationMs}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Index: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const { snapshot: offlineSnapshot, isOnline } = useOfflineLibrary();
  const { disableHeavyEffects, isCoarsePointer } = useDeviceProfile();
  const [homeSections, setHomeSections] = useState<HomePageMangaSections>(() => HOME_PAGE_CACHE.sections ?? EMPTY_HOME_PAGE_SECTIONS);
  const [topTenWeekIds, setTopTenWeekIds] = useState<ReadonlySet<string> | null>(null);
  const [hasPersistedAuthSession, setHasPersistedAuthSession] = useState(() => hasPersistedSupabaseSession());
  const [continueReadingSeed, setContinueReadingSeed] = useState<ContinueReadingCacheEntry[]>(() => (
    readPersistedContinueReadingCache()?.entries ?? []
  ));
  const [continueReadingLoading, setContinueReadingLoading] = useState(() => hasPersistedSupabaseSession());
  const [trendingTags, setTrendingTags] = useState<Tag[]>(() => HOME_PAGE_CACHE.trendingTags ?? []);
  const [tagsLoading, setTagsLoading] = useState(() => HOME_PAGE_CACHE.trendingTags === null);
  const mangas = useMemo(() => {
    const uniqueMangaById = new Map<string, Manga>();

    [
      ...homeSections.newlyAddedSeries,
      ...homeSections.recentlyUpdated,
      ...homeSections.trendingManga,
    ].forEach((manga) => {
      if (!uniqueMangaById.has(manga.id)) {
        uniqueMangaById.set(manga.id, manga);
      }
    });

    return [...uniqueMangaById.values()];
  }, [homeSections]);
  const mangaById = useMemo(() => new Map(mangas.map((item) => [item.id, item])), [mangas]);
  const sectionDeferredRootMargin = isCoarsePointer
    ? HOME_SECTION_DEFERRED_ROOT_MARGIN.coarse
    : HOME_SECTION_DEFERRED_ROOT_MARGIN.fine;
  const blockDeferredRootMargin = isCoarsePointer
    ? HOME_BLOCK_DEFERRED_ROOT_MARGIN.coarse
    : HOME_BLOCK_DEFERRED_ROOT_MARGIN.fine;
  const homeCardImageRootMargin = isCoarsePointer
    ? HOME_CARD_IMAGE_ROOT_MARGIN.coarse
    : HOME_CARD_IMAGE_ROOT_MARGIN.fine;

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
    if (!isOnline) {
      setTopTenWeekIds(null);
      return;
    }

    let active = true;
    const homeDataPromise = loadHomeDataModule();

    const loadMainContent = async () => {
      try {
        const { getHomePageMangaSections } = await homeDataPromise;
        const sections = await getHomePageMangaSections();
        if (!active) {
          return;
        }

        HOME_PAGE_CACHE.sections = sections;
        startTransition(() => {
          setHomeSections(sections);
        });
      } catch (err) {
        console.error('Data loading error:', err);
      }
    };

    const loadTopTenWeekIds = async () => {
      try {
        const { getTopTenMangaIds } = await homeDataPromise;
        const ids = await getTopTenMangaIds('week');
        if (active) {
          setTopTenWeekIds(ids);
        }
      } catch (err) {
        if (active) {
          setTopTenWeekIds(new Set<string>());
        }
        console.error('Top ten id loading error:', err);
      }
    };

    void loadMainContent();
    void loadTopTenWeekIds();

    return () => {
      active = false;
    };
  }, [isOnline]);

  useEffect(() => {
    let active = true;
    const homeDataPromise = loadHomeDataModule();

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
        const { getTrendingTags } = await homeDataPromise;
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
      HOME_PAGE_CACHE.continueReadingByUser = {};
      clearPersistedContinueReadingCache();
    }
  }, [authLoading, user]);

  useEffect(() => {
    let active = true;
    const readingHistoryPromise = loadReadingHistoryModule();

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
      const cachedEntriesByMangaId = new Map(
        (cachedEntries || []).map((entry) => [entry.mangaId, entry]),
      );

      if (cachedEntries) {
        setContinueReadingSeed(cachedEntries);
        setContinueReadingLoading(false);
      } else {
        setContinueReadingLoading(true);
      }

      try {
        const { getReadingHistoryEntries } = await readingHistoryPromise;
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

        const nextEntries: ContinueReadingCacheEntry[] = uniqueEntries.map((entry) => {
          const liveManga = mangaById.get(entry.mangaId);
          const mangaSnapshot = liveManga
            ? extractContinueReadingMangaSnapshot(liveManga)
            : cachedEntriesByMangaId.get(entry.mangaId)?.mangaSnapshot ?? null;

          return {
            ...entry,
            mangaSnapshot,
          };
        });

        const hasSnapshotDifferences = nextEntries.some((entry, index) => (
          !areContinueReadingMangaSnapshotsEquivalent(entry.mangaSnapshot, cachedEntries?.[index]?.mangaSnapshot)
        ));

        HOME_PAGE_CACHE.continueReadingByUser[user.id] = nextEntries;
        if (!areContinueReadingEntriesEquivalent(cachedEntries, nextEntries) || hasSnapshotDifferences) {
          startTransition(() => {
            setContinueReadingSeed(nextEntries);
          });
        }
        writePersistedContinueReadingCache(user.id, nextEntries);
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
  }, [authLoading, continueReadingSeed.length, hasPersistedAuthSession, isOnline, mangaById, user]);

  useEffect(() => {
    if (!user?.id || continueReadingSeed.length === 0) {
      return;
    }

    let hasSnapshotUpdate = false;
    const nextEntries = continueReadingSeed.map((entry) => {
      const liveManga = mangaById.get(entry.mangaId);
      if (!liveManga) {
        return entry;
      }

      const nextSnapshot = extractContinueReadingMangaSnapshot(liveManga);
      if (areContinueReadingMangaSnapshotsEquivalent(entry.mangaSnapshot, nextSnapshot)) {
        return entry;
      }

      hasSnapshotUpdate = true;
      return {
        ...entry,
        mangaSnapshot: nextSnapshot,
      };
    });

    if (!hasSnapshotUpdate) {
      return;
    }

    HOME_PAGE_CACHE.continueReadingByUser[user.id] = nextEntries;
    setContinueReadingSeed(nextEntries);
    writePersistedContinueReadingCache(user.id, nextEntries);
  }, [continueReadingSeed, mangaById, user?.id]);

  const continueReading = useMemo<ContinueReadingEntry[]>(() => (
    continueReadingSeed
      .map((entry) => {
        const manga = mangaById.get(entry.mangaId)
          || (entry.mangaSnapshot ? buildContinueReadingMangaFromSnapshot(entry.mangaSnapshot) : null)
          || buildContinueReadingFallbackManga(entry);
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
  } = homeSections;

  const canRenderContinueReadingSlot = isOnline && (Boolean(user) || (authLoading && hasPersistedAuthSession));
  const shouldShowContinueReading = isOnline
    && continueReading.length > 0
    && (Boolean(user) || (authLoading && hasPersistedAuthSession));
  const showContinueReadingSkeleton = canRenderContinueReadingSlot
    && continueReading.length === 0
    && (continueReadingLoading || authLoading);
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
            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin={sectionDeferredRootMargin} disabled={DISABLE_HOME_DEFERRED_MOUNTS}>
              <HorizontalMangaSection
                title="Yeni Çıkan Seriler"
                icon={Sparkles}
                iconClassName="h-5 w-5 text-amber-400"
                linkTo="/browse?sort=created"
                manga={newlyAddedSeries}
                topTenWeekIds={topTenWeekIds}
                delay="0s"
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
                priorityCount={2}
                coverRootMargin={homeCardImageRootMargin}
              />
            </DeferredMount>

            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin={sectionDeferredRootMargin} disabled={DISABLE_HOME_DEFERRED_MOUNTS}>
              <HorizontalMangaSection
                title="Son Güncellenenler"
                icon={Clock}
                iconClassName="h-5 w-5 text-primary"
                linkTo="/browse?sort=updated"
                manga={recentlyUpdated}
                topTenWeekIds={topTenWeekIds}
                delay="0.02s"
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
                priorityCount={0}
                coverRootMargin={homeCardImageRootMargin}
              />
            </DeferredMount>

            <DeferredMount className="mt-12" placeholderMinHeight={420} rootMargin={sectionDeferredRootMargin} disabled={DISABLE_HOME_DEFERRED_MOUNTS}>
              <HorizontalMangaSection
                title="Trend Olanlar"
                icon={TrendingUp}
                iconClassName="h-5 w-5 text-primary"
                linkTo="/browse?sort=trending"
                manga={trendingManga}
                topTenWeekIds={topTenWeekIds}
                delay="0.04s"
                disableHeavyEffects={disableHeavyEffects}
                isCoarsePointer={isCoarsePointer}
                withTopSpacing={false}
                priorityCount={0}
                coverRootMargin={homeCardImageRootMargin}
              />
            </DeferredMount>

            <DeferredMount className="mt-16" placeholderMinHeight={260} rootMargin={blockDeferredRootMargin} disabled={DISABLE_HOME_DEFERRED_MOUNTS}>
              <section
                className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
                style={disableHeavyEffects ? undefined : { animationDelay: '0.45s', animationFillMode: 'forwards' }}
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
                      <Link
                        key={tag.id}
                        to={`/browse?tags=${tag.slug}`}
                        className="inline-block rounded-full transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <TagBadge tag={tag} size={index < 5 ? 'md' : 'sm'} />
                      </Link>
                    ))
                  )}
                </div>
              </section>
            </DeferredMount>
          </>
        ) : (
          <DeferredMount className="mt-10" placeholderMinHeight={720} rootMargin={blockDeferredRootMargin} disabled={DISABLE_HOME_DEFERRED_MOUNTS}>
            <section
              className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
              style={disableHeavyEffects ? undefined : { animationDelay: '0.16s', animationFillMode: 'forwards' }}
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
                <div className="grid grid-cols-2 gap-4 min-[430px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {offlineManga.map((manga, index) => (
                    <MangaCard
                      key={manga.id}
                      manga={manga}
                      index={index}
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
