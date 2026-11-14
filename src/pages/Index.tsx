import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles, Play, ChevronLeft, ChevronRight, Download, WifiOff, Layers } from 'lucide-react';
import Header from '@/components/layout/Header';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import InstallAppBanner from '@/components/pwa/InstallAppBanner';
import MangaCard from '@/components/manga/MangaCard';
import AppPagination from '@/components/ui/AppPagination';
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
import { useBootstrappedAppearancePreferences } from '@/hooks/useBootstrappedAppearancePreferences';
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
import { ADULT_MODE_CHANGED_EVENT } from '@/lib/adultModeEvents';
import { readHeaderShellSnapshot } from '@/lib/headerShellCache';
import { cn } from '@/lib/utils';
import {
  HOME_SECTIONS_CACHE_TTL_MS,
  TOP_TEN_WEEK_CACHE_TTL_MS,
  TRENDING_TAGS_CACHE_TTL_MS,
  isHomeFeedEntryFresh,
  readHomeFeedSeed,
  writeHomeSectionsCache,
  writeTopTenWeekIdsCache,
  writeTrendingTagsCache,
} from '@/lib/homeFeedCache';

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
  progressPercent?: number;
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
    return Math.max(132, (fallbackWidth - 72) / 7);
  }

  if (viewportWidth >= 1024) {
    return Math.max(132, (fallbackWidth - 60) / 6.5);
  }

  if (viewportWidth >= 768) {
    return Math.max(136, (fallbackWidth - 50) / 5.5);
  }

  if (viewportWidth >= 640) {
    return Math.max(140, (fallbackWidth - 40) / 4.5);
  }

  if (viewportWidth >= 400) {
    return 140;
  }

  return 132;
};

const EMPTY_HOME_PAGE_SECTIONS: HomePageMangaSections = {
  trendingManga: [],
  newlyAddedSeries: [],
  recentlyUpdated: [],
};

type HomeDataModule = {
  getHomePageMangaSections: () => Promise<HomePageMangaSections>;
  getMangaCatalogPage: typeof import('@/lib/database').getMangaCatalogPage;
  getMangaSummariesByIds: (mangaIds: string[], options?: { includePrivate?: boolean }) => Promise<Manga[]>;
  getTopTenMangaIds: (timeframe?: 'today' | 'week' | 'all') => Promise<Set<string>>;
  getTrendingTags: (limit?: number, options?: { includePending?: boolean }) => Promise<Tag[]>;
};

type ReadingHistoryModule = {
  getReadingHistoryEntries: (userId: string) => Promise<ReadingHistoryEntry[]>;
  getContinueReadingEntries: (userId: string, uniqueMangaLimit?: number) => Promise<ReadingHistoryEntry[]>;
};

let homeDataModulePromise: Promise<HomeDataModule> | null = null;
let readingHistoryModulePromise: Promise<ReadingHistoryModule> | null = null;
const loadHomeDataModule = () => {
  if (!homeDataModulePromise) {
    homeDataModulePromise = import('@/lib/database').then((module) => ({
      getHomePageMangaSections: module.getHomePageMangaSections,
      getMangaCatalogPage: module.getMangaCatalogPage,
      getMangaSummariesByIds: module.getMangaSummariesByIds,
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
      getContinueReadingEntries: module.getContinueReadingEntries,
    }));
  }

  return readingHistoryModulePromise;
};

const HOME_PAGE_CACHE: {
  sections: HomePageMangaSections | null;
  sectionsFetchedAt: number;
  trendingTags: Tag[] | null;
  trendingTagsFetchedAt: number;
  topTenWeekIds: ReadonlySet<string> | null;
  topTenWeekIdsFetchedAt: number;
  continueReadingByUser: Record<string, ContinueReadingCacheEntry[] | undefined>;
} = {
  sections: null,
  sectionsFetchedAt: 0,
  trendingTags: null,
  trendingTagsFetchedAt: 0,
  topTenWeekIds: null,
  topTenWeekIdsFetchedAt: 0,
  continueReadingByUser: {},
};

const CONTINUE_READING_COVER_TRANSFORM = Object.freeze({
  width: 520,
  quality: 70,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const CONTINUE_READING_COVER_INTRINSIC_WIDTH = 480;
const CONTINUE_READING_COVER_INTRINSIC_HEIGHT = 640;
const CONTINUE_READING_COVER_SIZES = '(min-width: 768px) 7rem, (min-width: 640px) 6rem, 5rem';
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

const extractPersistedSessionUserId = (value: unknown, depth = 0): string | null => {
  if (depth > 5 || value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = extractPersistedSessionUserId(entry, depth + 1);
      if (result) {
        return result;
      }
    }

    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const directUser = candidate.user;

  if (
    directUser
    && typeof directUser === 'object'
    && !Array.isArray(directUser)
    && typeof (directUser as Record<string, unknown>).id === 'string'
  ) {
    return (directUser as Record<string, string>).id;
  }

  for (const nested of Object.values(candidate)) {
    const result = extractPersistedSessionUserId(nested, depth + 1);
    if (result) {
      return result;
    }
  }

  return null;
};

const getPersistedSupabaseSessionUserId = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const authStorageKey = getSupabaseAuthStorageKey();
  if (!authStorageKey) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(authStorageKey);
    if (!raw) {
      return null;
    }

    return extractPersistedSessionUserId(JSON.parse(raw));
  } catch {
    return null;
  }
};

const getInitialContinueReadingUserId = () => (
  readHeaderShellSnapshot()?.user?.id || getPersistedSupabaseSessionUserId()
);

const initialContinueReadingUserId = getInitialContinueReadingUserId();
const initialPersistedContinueReadingCache = readPersistedContinueReadingCache(initialContinueReadingUserId);

const getInitialVisibleHomeSectionCardCount = (viewportWidth: number, isCoarsePointer: boolean) => {
  if (viewportWidth >= 1280) {
    return 7;
  }

  if (viewportWidth >= 1024) {
    return 6;
  }

  if (viewportWidth >= 768) {
    return 6;
  }

  if (viewportWidth >= 640) {
    return 5;
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

interface ContinueReadingSpotlightProps {
  entries: ContinueReadingEntry[];
  disableHeavyEffects: boolean;
  blurAdultArtwork: boolean;
}

const ContinueReadingSpotlightSkeleton: React.FC = () => (
  <section aria-hidden>
    <div className="mb-3 flex items-center justify-between gap-3 sm:mb-3.5">
      <div className="min-w-0 flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-6 w-48 max-w-[56vw] sm:h-7 sm:w-56" />
      </div>
      <Skeleton className="h-8 w-20 shrink-0 rounded-lg" />
    </div>

    <div className="rounded-2xl border border-border/60 bg-card/75 p-3.5 shadow-sm sm:p-5">
      <div className="flex items-center gap-3.5 sm:gap-5">
        <Skeleton className="aspect-[2/3] w-20 shrink-0 rounded-xl sm:w-24 md:w-28" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-6 w-3/4 max-w-sm sm:h-7" />
          <Skeleton className="h-5 w-40 rounded-full" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  </section>
);

const ContinueReadingSpotlight: React.FC<ContinueReadingSpotlightProps> = ({
  entries,
  disableHeavyEffects,
  blurAdultArtwork,
}) => {
  const [featured, ...secondaryEntries] = entries;

  if (!featured) {
    return null;
  }

  const featuredCoverSrcSet = getManagedArtworkSrcSet(featured.manga.cover);
  const secondaryItems = secondaryEntries.slice(0, 3);
  const continueHref = `/manga/${featured.manga.id}/chapter/${featured.chapterId}`;
  const detailsHref = `/manga/${featured.manga.id}`;
  const shouldBlurFeaturedArtwork = blurAdultArtwork && featured.manga.isAdult === true;
  const featuredProgressPercent = typeof featured.progressPercent === 'number'
    ? Math.min(100, Math.max(0, Math.round(featured.progressPercent)))
    : null;

  return (
    <section className={disableHeavyEffects ? '' : 'animate-fade-up'}>
      <div className="mb-3 flex items-center justify-between gap-3 sm:mb-3.5">
        <div className="min-w-0 flex items-center gap-2">
          <Play className="h-4 w-4 shrink-0 text-primary sm:h-5 sm:w-5" />
          <h2 className="line-clamp-1 text-lg font-bold tracking-tight sm:text-xl">Kaldığın Yerden Devam Et</h2>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:text-sm">
          <Link to="/history">
            Geçmiş
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/75 p-3.5 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:gap-5">
          <div className="flex min-w-0 flex-1 items-center gap-3.5 sm:gap-5">
            <Link
              to={continueHref}
              className="aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-secondary/40 sm:w-24 md:w-28"
            >
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
                placeholderClassName="rounded-none"
                className={cn(
                  'h-full w-full object-cover',
                  shouldBlurFeaturedArtwork && 'scale-[1.03] blur-md',
                )}
              />
            </Link>

            <div className="min-w-0 flex-1">
              <Link
                to={detailsHref}
                className="block min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <h3 className="line-clamp-1 text-[clamp(1.05rem,0.9rem+0.9vw,1.65rem)] font-bold tracking-tight text-foreground transition-colors hover:text-primary">
                  {featured.manga.title}
                </h3>
              </Link>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="inline-flex max-w-full items-center truncate rounded-full border border-border/50 bg-secondary/60 px-2.5 py-0.5 text-xs font-medium text-foreground/90">
                  Bölüm {featured.chapterNumber} · Sayfa {Math.max(1, featured.page)}
                  {featuredProgressPercent !== null ? ` · %${featuredProgressPercent}` : ''}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {formatContinueReadingLastRead(featured.lastRead)}
                </span>
              </div>

              <div
                className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary/80"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={featuredProgressPercent ?? 0}
                aria-label="Okuma ilerlemesi"
              >
                <div
                  className={cn(
                    'h-full rounded-full bg-primary',
                    !disableHeavyEffects && 'transition-[width] duration-300',
                  )}
                  style={{
                    width: `${featuredProgressPercent !== null ? Math.max(4, featuredProgressPercent) : 0}%`,
                  }}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button asChild size="sm" className="h-9 rounded-lg px-3.5 text-xs font-semibold sm:text-sm">
                  <Link to={continueHref}>
                    <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
                    Devam Et
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-9 rounded-lg border-border/60 bg-background/40 px-3.5 text-xs sm:text-sm">
                  <Link to={detailsHref}>Seri Sayfası</Link>
                </Button>
              </div>
            </div>
          </div>

          {secondaryItems.length > 0 && (
            <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-3 lg:w-72 lg:shrink-0 lg:grid-cols-1 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 xl:w-80">
              {secondaryItems.map((entry, index) => {
                const entryProgressPercent = typeof entry.progressPercent === 'number'
                  ? Math.min(100, Math.max(0, Math.round(entry.progressPercent)))
                  : null;

                return (
                  <Link
                    key={entry.manga.id}
                    to={`/manga/${entry.manga.id}/chapter/${entry.chapterId}`}
                    className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-border/40 bg-secondary/25 p-2 transition-colors hover:border-primary/35 hover:bg-secondary/45"
                  >
                    <OptimizedImage
                      src={entry.manga.cover}
                      alt={entry.manga.title}
                      width={CONTINUE_READING_COVER_INTRINSIC_WIDTH}
                      height={CONTINUE_READING_COVER_INTRINSIC_HEIGHT}
                      srcSet={getManagedArtworkSrcSet(entry.manga.cover)}
                      sizes="40px"
                      priority={index === 0}
                      rootMargin="540px 0px"
                      transform={CONTINUE_READING_COVER_TRANSFORM}
                      containerClassName="h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-border/40"
                      placeholderClassName="rounded-lg"
                      className={cn(
                        'h-full w-full object-cover',
                        blurAdultArtwork && entry.manga.isAdult === true && 'scale-[1.03] blur-sm',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
                        {entry.manga.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Bölüm {entry.chapterNumber} · Sayfa {Math.max(1, entry.page)}
                      </p>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary/80">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${entryProgressPercent !== null ? Math.max(4, entryProgressPercent) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  const gapPx = scrollMetrics.viewportWidth >= 640 ? 12 : 10;
  const effectiveItemWidth = itemWidth > 0
    ? itemWidth
    : getEstimatedHomeCarouselItemWidth(scrollMetrics.viewportWidth, scrollMetrics.clientWidth);
  const itemStride = effectiveItemWidth > 0 ? effectiveItemWidth + gapPx : 0;
  const posterCenterY = effectiveItemWidth > 0 ? Math.round(effectiveItemWidth * 0.75) : undefined;

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
  }

  return (
    <section className={`${withTopSpacing ? 'mt-7 sm:mt-9 ' : ''}${disableHeavyEffects ? '' : 'animate-fade-up'}`} style={sectionStyle}>
      <div className="mb-3.5 flex items-center justify-between gap-3 sm:mb-4">
        <div className="min-w-0 flex items-center gap-2">
          <Icon className={iconClassName} />
          <h2 className="truncate text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:text-sm">
          <Link to={linkTo}>
            Tümünü Gör
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
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
              style={posterCenterY ? { top: `${posterCenterY}px` } : undefined}
              className="group/arrow absolute left-2 sm:left-3 top-[calc((100%-7.25rem)/2)] z-40 -mt-[18px] sm:-mt-5 flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-slate-950/80 text-white/90 border border-white/15 shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-primary hover:border-primary/50 hover:text-white hover:shadow-[0_10px_28px_rgba(37,99,235,0.4)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label={`${title} sola kaydır`}
            >
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5 -translate-x-[0.5px] transition-transform duration-200 group-hover/arrow:-translate-x-0.5" strokeWidth={2.25} />
            </motion.button>
          )}

          {showRightArrow && (
            <motion.button
              key={`${title}-arrow-right`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('right')}
              style={posterCenterY ? { top: `${posterCenterY}px` } : undefined}
              className="group/arrow absolute right-2 sm:right-3 top-[calc((100%-7.25rem)/2)] z-40 -mt-[18px] sm:-mt-5 flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-slate-950/80 text-white/90 border border-white/15 shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-primary hover:border-primary/50 hover:text-white hover:shadow-[0_10px_28px_rgba(37,99,235,0.4)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label={`${title} sağa kaydır`}
            >
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 translate-x-[0.5px] transition-transform duration-200 group-hover/arrow:translate-x-0.5" strokeWidth={2.25} />
            </motion.button>
          )}
        </AnimatePresence>}

        {manga[0] && (
          <div aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
            <div
              ref={probeRef}
              className="w-[8.25rem] shrink-0 min-[400px]:w-[8.75rem] sm:w-[calc((100%-40px)/4.5)] md:w-[calc((100%-50px)/5.5)] lg:w-[calc((100%-60px)/6.5)] xl:w-[calc((100%-72px)/7)]"
            />
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={requestLayoutMetricsUpdate}
          className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain px-0 py-1.5 -my-1.5 scrollbar-hide sm:gap-3"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {visibleManga.map((item, index) => (
            <div
              key={item.id}
              className="w-[8.25rem] shrink-0 snap-start min-[400px]:w-[8.75rem] sm:w-[calc((100%-40px)/4.5)] md:w-[calc((100%-50px)/5.5)] lg:w-[calc((100%-60px)/6.5)] xl:w-[calc((100%-72px)/7)]"
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
  useDocumentTitle('ToonParrot - Ücretsiz Türkçe Manga & Webtoon Oku', false);
  const { user, isLoading: authLoading } = useAuth();
  const { snapshot: offlineSnapshot, isOnline } = useOfflineLibrary();
  const { disableHeavyEffects, isCoarsePointer } = useDeviceProfile();
  const appearancePreferences = useBootstrappedAppearancePreferences({ user, authLoading });
  const adultModeEnabled = Boolean(user?.id) && user?.preferences?.content?.adult_mode === true;
  const canSeeAdultContent = adultModeEnabled;
  const homeAudienceKey = canSeeAdultContent ? 'adult' : 'safe';
  const [homeSections, setHomeSections] = useState<HomePageMangaSections>(() => (
    readHomeFeedSeed().sections?.value ?? EMPTY_HOME_PAGE_SECTIONS
  ));
  const [topTenWeekIds, setTopTenWeekIds] = useState<ReadonlySet<string> | null>(() => (
    readHomeFeedSeed().topTenWeekIds?.value ?? null
  ));
  const [hasPersistedAuthSession, setHasPersistedAuthSession] = useState(() => hasPersistedSupabaseSession());
  const [continueReadingSeed, setContinueReadingSeed] = useState<ContinueReadingCacheEntry[]>(() => (
    initialPersistedContinueReadingCache?.entries ?? []
  ));
  const [continueReadingLoading, setContinueReadingLoading] = useState(() => (
    hasPersistedSupabaseSession() && !initialPersistedContinueReadingCache
  ));
  const [trendingTags, setTrendingTags] = useState<Tag[]>(() => (
    readHomeFeedSeed().trendingTags?.value ?? []
  ));
  const [tagsLoading, setTagsLoading] = useState(() => readHomeFeedSeed().trendingTags === null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogState, setCatalogState] = useState<{
    items: Manga[];
    totalCount: number;
    totalPages: number;
    loading: boolean;
  }>({
    items: [],
    totalCount: 0,
    totalPages: 1,
    loading: true,
  });
  const catalogSectionRef = useRef<HTMLElement | null>(null);
  const blurAdultArtwork = appearancePreferences.adult_cover_blur && user?.preferences?.content?.adult_mode === true;
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
    const latestHomeFeedSeed = readHomeFeedSeed();

    HOME_PAGE_CACHE.sections = latestHomeFeedSeed.sections?.value ?? null;
    HOME_PAGE_CACHE.sectionsFetchedAt = latestHomeFeedSeed.sections?.fetchedAt ?? 0;
    HOME_PAGE_CACHE.trendingTags = latestHomeFeedSeed.trendingTags?.value ?? null;
    HOME_PAGE_CACHE.trendingTagsFetchedAt = latestHomeFeedSeed.trendingTags?.fetchedAt ?? 0;
    HOME_PAGE_CACHE.topTenWeekIds = latestHomeFeedSeed.topTenWeekIds?.value ?? null;
    HOME_PAGE_CACHE.topTenWeekIdsFetchedAt = latestHomeFeedSeed.topTenWeekIds?.fetchedAt ?? 0;
  }, []);

  useEffect(() => {
    if (!initialContinueReadingUserId || !initialPersistedContinueReadingCache) {
      return;
    }

    HOME_PAGE_CACHE.continueReadingByUser[initialContinueReadingUserId] = initialPersistedContinueReadingCache.entries;
  }, []);

  useEffect(() => {
    const handleAdultModeChanged = () => {
      HOME_PAGE_CACHE.sections = null;
      HOME_PAGE_CACHE.sectionsFetchedAt = 0;
      HOME_PAGE_CACHE.topTenWeekIds = null;
      HOME_PAGE_CACHE.topTenWeekIdsFetchedAt = 0;
      if (user?.id) {
        delete HOME_PAGE_CACHE.continueReadingByUser[user.id];
      } else {
        HOME_PAGE_CACHE.continueReadingByUser = {};
      }

      clearPersistedContinueReadingCache();
      setHomeSections(EMPTY_HOME_PAGE_SECTIONS);
      setTopTenWeekIds(null);
      setContinueReadingSeed([]);
      setContinueReadingLoading(Boolean(user?.id));
      setCatalogPage(1);
    };

    window.addEventListener(ADULT_MODE_CHANGED_EVENT, handleAdultModeChanged);
    return () => {
      window.removeEventListener(ADULT_MODE_CHANGED_EVENT, handleAdultModeChanged);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!isOnline) {
      setTopTenWeekIds(null);
      return;
    }

    if (HOME_PAGE_CACHE.sections) {
      setHomeSections(HOME_PAGE_CACHE.sections);
    }

    if (HOME_PAGE_CACHE.topTenWeekIds) {
      setTopTenWeekIds(HOME_PAGE_CACHE.topTenWeekIds);
    }

    let active = true;
    const homeDataPromise = loadHomeDataModule();
    const sectionsAreFresh = HOME_PAGE_CACHE.sections !== null
      && isHomeFeedEntryFresh(HOME_PAGE_CACHE.sectionsFetchedAt, HOME_SECTIONS_CACHE_TTL_MS);
    const topTenIdsAreFresh = HOME_PAGE_CACHE.topTenWeekIds !== null
      && isHomeFeedEntryFresh(HOME_PAGE_CACHE.topTenWeekIdsFetchedAt, TOP_TEN_WEEK_CACHE_TTL_MS);

    const loadMainContent = async () => {
      if (sectionsAreFresh) {
        return;
      }

      try {
        const { getHomePageMangaSections } = await homeDataPromise;
        const sections = await getHomePageMangaSections();
        if (!active) {
          return;
        }

        const fetchedAt = Date.now();
        HOME_PAGE_CACHE.sections = sections;
        HOME_PAGE_CACHE.sectionsFetchedAt = fetchedAt;
        writeHomeSectionsCache(sections, fetchedAt);
        startTransition(() => {
          setHomeSections(sections);
        });
      } catch (err) {
        console.error('Data loading error:', err);
      }
    };

    const loadTopTenWeekIds = async () => {
      if (topTenIdsAreFresh) {
        return;
      }

      try {
        const { getTopTenMangaIds } = await homeDataPromise;
        const ids = await getTopTenMangaIds('week');
        if (active) {
          const fetchedAt = Date.now();
          HOME_PAGE_CACHE.topTenWeekIds = ids;
          HOME_PAGE_CACHE.topTenWeekIdsFetchedAt = fetchedAt;
          writeTopTenWeekIdsCache(ids, fetchedAt);
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
  }, [homeAudienceKey, isOnline]);

  useEffect(() => {
    let active = true;
    const homeDataPromise = loadHomeDataModule();
    const tagsAreFresh = HOME_PAGE_CACHE.trendingTags !== null
      && isHomeFeedEntryFresh(HOME_PAGE_CACHE.trendingTagsFetchedAt, TRENDING_TAGS_CACHE_TTL_MS);

    const loadTrendingTags = async () => {
      if (!isOnline) {
        setTrendingTags([]);
        setTagsLoading(false);
        return;
      }

      if (HOME_PAGE_CACHE.trendingTags) {
        setTrendingTags(HOME_PAGE_CACHE.trendingTags);
      }

      if (HOME_PAGE_CACHE.trendingTags === null) {
        setTagsLoading(true);
      }

      if (tagsAreFresh) {
        setTagsLoading(false);
        return;
      }

      try {
        const { getTrendingTags } = await homeDataPromise;
        const tags = await getTrendingTags(20);
        if (!active) {
          return;
        }

        const fetchedAt = Date.now();
        HOME_PAGE_CACHE.trendingTags = tags;
        HOME_PAGE_CACHE.trendingTagsFetchedAt = fetchedAt;
        writeTrendingTagsCache(tags, fetchedAt);
        setTrendingTags(tags);
      } catch (err) {
        console.error('Trending tag loading error:', err);
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
    if (!isOnline) {
      setCatalogState((prev) => ({ ...prev, loading: false }));
      return;
    }

    let active = true;
    setCatalogState((prev) => ({ ...prev, loading: true }));

    void loadHomeDataModule()
      .then(({ getMangaCatalogPage }) => (
        getMangaCatalogPage({
          page: catalogPage,
          pageSize: 24,
          sort: 'updated',
          includeAdult: canSeeAdultContent,
        })
      ))
      .then((result) => {
        if (!active) return;
        const seenIds = new Set<string>();
        const dedupedItems = result.items.filter((item) => {
          if (seenIds.has(item.id)) return false;
          seenIds.add(item.id);
          return true;
        });
        setCatalogState({
          items: dedupedItems,
          totalCount: result.totalCount,
          totalPages: Math.max(1, result.totalPages),
          loading: false,
        });
      })
      .catch((err) => {
        if (!active) return;
        console.error('Home catalog loading error:', err);
        setCatalogState((prev) => ({ ...prev, loading: false }));
      });

    return () => {
      active = false;
    };
  }, [canSeeAdultContent, catalogPage, isOnline]);

  const handleCatalogPageChange = useCallback((nextPage: number) => {
    setCatalogPage(nextPage);
    if (typeof window !== 'undefined' && catalogSectionRef.current) {
      const top = catalogSectionRef.current.getBoundingClientRect().top + window.scrollY - 76;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }, []);

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
    const homeDataPromise = loadHomeDataModule();
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
        const { getContinueReadingEntries } = await readingHistoryPromise;
        const uniqueEntries = await getContinueReadingEntries(user.id, 1);

        if (!active) {
          return;
        }

        const missingMangaIds = uniqueEntries
          .map((entry) => entry.mangaId)
          .filter((mangaId, index, ids) => (
            ids.indexOf(mangaId) === index
            && !mangaById.has(mangaId)
            && !cachedEntriesByMangaId.get(mangaId)?.mangaSnapshot
          ));
        const fetchedSummaryById = new Map<string, Manga>();

        if (missingMangaIds.length > 0) {
          const { getMangaSummariesByIds } = await homeDataPromise;
          const fetchedSummaries = await getMangaSummariesByIds(missingMangaIds);
          fetchedSummaries.forEach((manga) => {
            fetchedSummaryById.set(manga.id, manga);
          });
        }

        const nextEntries: ContinueReadingCacheEntry[] = uniqueEntries.map((entry) => {
          const liveManga = mangaById.get(entry.mangaId) ?? fetchedSummaryById.get(entry.mangaId);
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
  }, [authLoading, continueReadingSeed.length, hasPersistedAuthSession, homeAudienceKey, isOnline, mangaById, user]);

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
        const liveManga = mangaById.get(entry.mangaId) ?? null;
        const snapshotManga = entry.mangaSnapshot
          ? buildContinueReadingMangaFromSnapshot(entry.mangaSnapshot)
          : null;
        const manga = liveManga
          || snapshotManga
          || buildContinueReadingFallbackManga(entry);

        if (!adultModeEnabled) {
          if (
            liveManga?.isAdult === true
            || entry.mangaSnapshot?.isAdult === true
            || manga?.isAdult === true
            || manga?.type === 'webtoon_hentai'
            || manga?.type === 'manga_hentai'
          ) {
            return null;
          }

          if (!liveManga && !entry.mangaSnapshot) {
            return null;
          }
        }

        if (!manga) {
          return null;
        }

        return {
          manga,
          chapterId: entry.chapterId,
          chapterNumber: entry.chapterNumber,
          page: entry.page,
          progressPercent: typeof entry.progressPercent === 'number' && Number.isFinite(entry.progressPercent)
            ? Math.min(100, Math.max(0, entry.progressPercent))
            : undefined,
          lastRead: entry.lastRead,
        } satisfies ContinueReadingEntry;
      })
      .filter(Boolean) as ContinueReadingEntry[]
  ), [adultModeEnabled, continueReadingSeed, mangaById]);

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

      <main className="container pb-10 pt-20">
        <div className={disableHeavyEffects ? '' : 'animate-fade-up'}>
          <InstallAppBanner className="mb-5 sm:mb-6" />
        </div>

        {!isOnline && (
          <section className={`mb-6 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 shadow-sm sm:p-5 ${disableHeavyEffects ? '' : 'animate-fade-up'}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 sm:h-11 sm:w-11">
                  <WifiOff className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-tight sm:text-xl">Ana sayfa yerel kütüphane ile açıldı</h2>
                  <p className="mt-1 max-w-2xl text-xs text-blue-100/75 sm:text-sm">
                    Bu modda yalnızca indirilen seriler güvenli şekilde açılır. Topluluk, arama ve online içerikler internet isteyebilir.
                  </p>
                </div>
              </div>
              <Button asChild variant="glow" className="h-9 shrink-0 rounded-lg px-4 text-xs sm:text-sm">
                <Link to="/downloads">
                  <Download className="mr-2 h-4 w-4" />
                  İndirilenlere Git
                </Link>
              </Button>
            </div>
          </section>
        )}

        {shouldRenderContinueReadingSlot && (
          <div className="mt-4 sm:mt-6">
            {showContinueReadingSkeleton ? (
              <ContinueReadingSpotlightSkeleton />
            ) : (
            <ContinueReadingSpotlight
              entries={continueReading}
              disableHeavyEffects={disableHeavyEffects}
              blurAdultArtwork={blurAdultArtwork}
            />
            )}
          </div>
        )}

        {isOnline ? (
          <>
            <DeferredMount className="mt-7 sm:mt-9" placeholderMinHeight={340} rootMargin={sectionDeferredRootMargin} disabled>
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

            <DeferredMount className="mt-7 sm:mt-9" placeholderMinHeight={340} rootMargin={sectionDeferredRootMargin}>
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

            <DeferredMount className="mt-7 sm:mt-9" placeholderMinHeight={340} rootMargin={sectionDeferredRootMargin}>
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

            <DeferredMount className="mt-8 sm:mt-10" placeholderMinHeight={160} rootMargin={blockDeferredRootMargin}>
              <section
                className={disableHeavyEffects ? '' : 'animate-fade-up'}
                style={disableHeavyEffects ? undefined : { animationDelay: '0.06s' }}
              >
                <div className="mb-3.5 flex items-center gap-2 sm:mb-4">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-bold tracking-tight sm:text-xl">Trend Etiketler</h2>
                  <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[10px] text-primary">
                    Bu Hafta
                  </Badge>
                </div>
                <div className={`flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-card/50 p-3.5 sm:p-5 ${disableHeavyEffects ? '' : 'backdrop-blur-sm'}`}>
                  {tagsLoading ? (
                    Array.from({ length: 15 }).map((_, i) => (
                      <div key={i} className="h-7 animate-pulse rounded-full bg-secondary/40" style={{ width: `${56 + (i % 5) * 18}px` }} />
                    ))
                  ) : (
                    trendingTags.map((tag) => (
                      <Link
                        key={tag.id}
                        to={`/browse?tags=${tag.slug}`}
                        className="inline-block max-w-full rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>div]:px-2.5 [&>div]:py-1 [&>div]:text-xs [&>div]:hover:border-primary/45"
                      >
                        <TagBadge tag={tag} size="sm" />
                      </Link>
                    ))
                  )}
                </div>
              </section>
            </DeferredMount>

            <section ref={catalogSectionRef} className="mt-8 scroll-mt-20 sm:mt-10">
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 sm:mb-4">
                <div className="min-w-0 flex items-center gap-2">
                  <Layers className="h-5 w-5 shrink-0 text-primary" />
                  <h2 className="truncate text-lg font-bold tracking-tight sm:text-xl">Tüm Seriler</h2>
                  {catalogState.totalCount > 0 && (
                    <span className="rounded-full bg-secondary/80 px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                      {catalogState.totalCount}
                    </span>
                  )}
                </div>

                <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:text-sm">
                  <Link to="/browse">
                    Keşfet
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>

              {catalogState.loading && catalogState.items.length === 0 ? (
                <div className="grid grid-cols-2 gap-2.5 min-[390px]:grid-cols-3 sm:grid-cols-4 sm:gap-3.5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                  {Array.from({ length: 14 }).map((_, index) => (
                    <div key={index} className="space-y-2">
                      <Skeleton className="aspect-[5/7] w-full rounded-xl" />
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : catalogState.items.length > 0 ? (
                <>
                  <div
                    className={cn(
                      'grid grid-cols-2 gap-2.5 min-[390px]:grid-cols-3 sm:grid-cols-4 sm:gap-3.5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 transition-opacity duration-200',
                      catalogState.loading ? 'opacity-60' : 'opacity-100',
                    )}
                  >
                    {catalogState.items.map((item, index) => (
                      <div key={item.id} className={index >= 14 ? 'cv-auto-card min-w-0' : 'min-w-0'}>
                        <MangaCard
                          manga={item}
                          index={index}
                          topTenWeekIds={topTenWeekIds}
                          disableHeavyEffects={disableHeavyEffects}
                          coverPriority={false}
                          coverRootMargin={homeCardImageRootMargin}
                        />
                      </div>
                    ))}
                  </div>

                  <AppPagination
                    currentPage={catalogPage}
                    totalPages={catalogState.totalPages}
                    onPageChange={handleCatalogPageChange}
                    scrollToTop={false}
                    className="mt-8"
                  />
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
                  Gösterilecek seri bulunamadı.
                </div>
              )}
            </section>
          </>
        ) : (
          <DeferredMount className="mt-7 sm:mt-9" placeholderMinHeight={720} rootMargin={blockDeferredRootMargin} disabled>
            <section
              className={disableHeavyEffects ? '' : 'animate-fade-up'}
              style={disableHeavyEffects ? undefined : { animationDelay: '0.04s' }}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <Download className="h-5 w-5 shrink-0 text-primary" />
                  <h2 className="truncate text-lg font-bold tracking-tight sm:text-xl">İndirilen Seriler</h2>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full px-3 py-1">
                  {offlineManga.length} seri
                </Badge>
              </div>

              {offlineManga.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5 min-[390px]:grid-cols-3 sm:grid-cols-4 sm:gap-3.5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                  {offlineManga.map((manga, index) => (
                    <div key={manga.id} className={index >= 14 ? 'cv-auto-card min-w-0' : 'min-w-0'}>
                      <MangaCard
                        manga={manga}
                        index={index}
                        topTenWeekIds={null}
                        disableHeavyEffects={disableHeavyEffects}
                        coverPriority={index < 4}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center">
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
                <img src="/logo.webp" alt="Logo" className="mx-auto h-12 w-auto object-contain md:mx-0" loading="lazy" decoding="async" />
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                En iyi manga, manhwa, manhua ve webtoon okuma deneyimi
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
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
