import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crown,
  Flame,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import MangaRatingBadge from '@/components/manga/MangaRatingBadge';
import OptimizedImage from '@/components/media/OptimizedImage';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { ADULT_MODE_CHANGED_EVENT, AdultModeChangedDetail } from '@/lib/adultModeEvents';
import { getTopTenPageData } from '@/lib/database';
import { getManagedArtworkSrcSet } from '@/lib/managedArtwork';
import { getMangaTypeLabel, isAdultMangaType } from '@/lib/mangaType';
import { Manga } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { useAdultImageBlurPreference } from '@/hooks/useAdultImageBlurPreference';

type TopTenTimeframe = 'today' | 'week' | 'all';
type TopTenAudience = 'safe' | 'adult';
type TopTenSections = Record<TopTenAudience, Record<TopTenTimeframe, Manga[]>>;

const EMPTY_TOP_TEN_SECTIONS: TopTenSections = {
  safe: {
    today: [],
    week: [],
    all: [],
  },
  adult: {
    today: [],
    week: [],
    all: [],
  },
};

const TOP_TEN_PAGE_CACHE: TopTenSections = {
  safe: {
    today: [],
    week: [],
    all: [],
  },
  adult: {
    today: [],
    week: [],
    all: [],
  },
};

const TOP_TEN_TIMEFRAMES: TopTenTimeframe[] = ['today', 'week', 'all'];

const TOP_TEN_TIMEFRAME_META: Record<
  TopTenTimeframe,
  {
    title: string;
    eyebrow: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClassName: string;
  }
> = {
  today: {
    title: 'Bugün',
    eyebrow: 'Son 24 Saat',
    description: 'Bugün öne çıkan serileri tek bakışta yakala.',
    icon: Flame,
    iconClassName: 'h-4 w-4 text-amber-400',
  },
  week: {
    title: 'Bu Hafta',
    eyebrow: '7 Günlük Tempo',
    description: 'Hafta boyunca hız kesmeden ilgi toplayan seçimler.',
    icon: Clock3,
    iconClassName: 'h-4 w-4 text-sky-400',
  },
  all: {
    title: 'Tüm Zamanlar',
    eyebrow: 'Kalıcı Liderler',
    description: 'Arşivin uzun vadeli en güçlü serileri.',
    icon: Crown,
    iconClassName: 'h-4 w-4 text-primary',
  },
};

const TOP_TEN_AUDIENCE_META: Record<
  TopTenAudience,
  {
    title: string;
    frameClassName: string;
    emptyText: string;
  }
> = {
  safe: {
    title: 'Genel Top 10',
    frameClassName: 'bg-card/55',
    emptyText: 'Bu aralıkta genel Top 10 için seri bulunamadı.',
  },
  adult: {
    title: '18+ Top 10',
    frameClassName: 'border-rose-500/25 bg-card/55',
    emptyText: 'Bu aralıkta yetişkin Top 10 için seri bulunamadı.',
  },
};

const TOP_TEN_CARD_TRANSFORM = Object.freeze({
  width: 420,
  quality: 70,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const TOP_TEN_CARD_INTRINSIC_WIDTH = 480;
const TOP_TEN_CARD_INTRINSIC_HEIGHT = 640;
const TOP_TEN_CARD_IMAGE_SIZES = '(max-width: 639px) 38vw, (max-width: 1023px) 180px, 204px';
const TOP_TEN_CARD_WIDTH_CLASS = 'w-[38vw] max-w-[9.25rem] min-[400px]:w-[34vw] min-[400px]:max-w-[9.75rem] sm:w-[11.25rem] sm:max-w-none lg:w-[12rem] xl:w-[12.75rem]';

const readCachedTopTenSections = (): TopTenSections => ({
  safe: {
    today: TOP_TEN_PAGE_CACHE.safe.today ?? [],
    week: TOP_TEN_PAGE_CACHE.safe.week ?? [],
    all: TOP_TEN_PAGE_CACHE.safe.all ?? [],
  },
  adult: {
    today: TOP_TEN_PAGE_CACHE.adult.today ?? [],
    week: TOP_TEN_PAGE_CACHE.adult.week ?? [],
    all: TOP_TEN_PAGE_CACHE.adult.all ?? [],
  },
});

const TopTenTimeframeTabs: React.FC<{
  audience: TopTenAudience;
  activeTimeframe: TopTenTimeframe;
  onChange: (timeframe: TopTenTimeframe) => void;
  disableHeavyEffects: boolean;
}> = ({
  audience,
  activeTimeframe,
  onChange,
  disableHeavyEffects,
}) => {
  const activePillClassName = audience === 'adult'
    ? 'bg-rose-500 text-white shadow-sm'
    : 'bg-primary text-primary-foreground shadow-sm';

  return (
    <div className="flex w-full max-w-full min-w-0 items-center gap-1 rounded-xl border border-border/60 bg-background/60 p-1 sm:inline-flex sm:w-auto">
      {TOP_TEN_TIMEFRAMES.map((timeframe) => {
        const meta = TOP_TEN_TIMEFRAME_META[timeframe];
        const Icon = meta.icon;
        const isActive = timeframe === activeTimeframe;

        return (
          <button
            key={`${audience}-${timeframe}`}
            type="button"
            onClick={() => {
              if (timeframe === activeTimeframe) {
                return;
              }

              onChange(timeframe);
            }}
            className={cn(
              'relative min-h-8 flex-1 overflow-hidden whitespace-nowrap rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition-colors duration-150 sm:flex-initial sm:px-3',
              isActive
                ? audience === 'adult'
                  ? 'text-white'
                  : 'text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={isActive}
          >
            {isActive ? (
              <motion.span
                layoutId={`top-ten-page-timeframe-pill-${audience}`}
                className={`absolute inset-0 rounded-lg ${activePillClassName}`}
                transition={
                  disableHeavyEffects
                    ? { duration: 0.16, ease: 'easeOut' }
                    : { type: 'spring', stiffness: 380, damping: 30, mass: 0.72 }
                }
              />
            ) : null}
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{meta.title}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

const TopTenCard: React.FC<{
  manga: Manga;
  index: number;
  audience: TopTenAudience;
  disableHeavyEffects: boolean;
}> = ({
  manga,
  index,
  audience,
}) => {
  const blurAdultArtwork = useAdultImageBlurPreference();
  const engagementLabel = typeof manga.engagementScore === 'number' && Number.isFinite(manga.engagementScore)
    ? `${Math.round(manga.engagementScore)} puan`
    : 'Skor yok';
  const coverSrcSet = React.useMemo(() => getManagedArtworkSrcSet(manga.cover), [manga.cover]);
  const rankClassName = index === 0
    ? 'bg-gradient-to-b from-amber-100 via-amber-300 to-amber-500 bg-clip-text text-transparent'
    : index === 1
      ? 'bg-gradient-to-b from-slate-50 via-slate-300 to-slate-500 bg-clip-text text-transparent'
      : index === 2
        ? 'bg-gradient-to-b from-orange-100 via-amber-400 to-orange-700 bg-clip-text text-transparent'
        : audience === 'adult'
          ? 'bg-gradient-to-b from-rose-100 via-rose-300 to-rose-500 bg-clip-text text-transparent'
          : 'bg-gradient-to-b from-sky-100 via-sky-300 to-primary bg-clip-text text-transparent';
  const engagementBadgeClassName = audience === 'adult'
    ? 'border-rose-400/20 bg-rose-500/10 text-rose-300'
    : 'border-primary/20 bg-primary/10 text-primary';
  const cardFrameClassName = audience === 'adult'
    ? 'border-rose-500/15 bg-card/85 hover:border-rose-400/35'
    : 'border-border/60 bg-card/85 hover:border-primary/40';
  const chapterCountClassName = audience === 'adult' ? 'text-rose-300' : 'text-primary';
  const showAdultLabel = manga.isAdult === true || isAdultMangaType(manga.type);
  const shouldBlurAdultArtwork = blurAdultArtwork && showAdultLabel;
  const typeBadgeLabel = showAdultLabel ? 'Yetişkin' : getMangaTypeLabel(manga.type);
  const typeBadgeClassName = showAdultLabel
    ? 'bg-rose-600/90 text-white'
    : manga.type === 'manhwa'
      ? 'bg-orange-600/90 text-white'
      : manga.type === 'manhua'
        ? 'bg-emerald-600/90 text-white'
        : manga.type === 'webtoon'
          ? 'bg-sky-600/90 text-white'
          : 'bg-primary text-primary-foreground';

  return (
    <Link
      to={`/manga/${manga.id}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="mb-1.5 flex h-8 items-end justify-between gap-1.5 overflow-visible sm:mb-2 sm:h-10 sm:gap-2">
        <span className={cn('inline-flex shrink-0 text-xl font-black leading-none tracking-[-0.04em] sm:text-2xl lg:text-3xl', rankClassName)}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <Badge
          variant="outline"
          className={cn(
            'h-5 shrink-0 rounded-full px-1.5 text-[10px] font-medium tracking-normal sm:h-6 sm:px-2 sm:text-[11px]',
            engagementBadgeClassName,
          )}
        >
          {engagementLabel}
        </Badge>
      </div>

      <div className={cn('overflow-hidden rounded-xl border transition-colors duration-150', cardFrameClassName)}>
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-black">
          <OptimizedImage
            src={manga.cover}
            alt={manga.title}
            width={TOP_TEN_CARD_INTRINSIC_WIDTH}
            height={TOP_TEN_CARD_INTRINSIC_HEIGHT}
            srcSet={coverSrcSet}
            sizes={TOP_TEN_CARD_IMAGE_SIZES}
            priority
            rootMargin="620px 0px"
            transform={TOP_TEN_CARD_TRANSFORM}
            containerClassName="h-full w-full"
            placeholderClassName="rounded-none"
            className={cn(
              'h-full w-full object-cover',
              shouldBlurAdultArtwork && 'scale-[1.03] blur-md',
            )}
          />
          <div className="pointer-events-none absolute -inset-x-px -bottom-px top-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          <div className="pointer-events-none absolute -inset-x-px -bottom-px h-[68%] bg-gradient-to-t from-black via-black/85 to-transparent" />

          <div className="absolute left-1.5 top-1.5 flex items-center gap-1 sm:left-2 sm:top-2">
            <Badge
              variant="secondary"
              className={`border-none px-1.5 py-0.5 text-[9px] font-bold shadow-sm ${typeBadgeClassName}`}
            >
              {typeBadgeLabel}
            </Badge>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-2 sm:p-2.5">
            <h3 className="line-clamp-2 text-xs font-bold leading-snug tracking-tight text-white transition-colors group-hover:text-primary group-focus-visible:text-primary sm:text-[13px]">
              {manga.title}
            </h3>
            <div className="mt-1 flex items-center justify-between gap-1.5 text-[10px] text-white/80 sm:text-[11px]">
              <span className="min-w-0 truncate">{manga.author}</span>
              <MangaRatingBadge value={Number(manga.averageRating || 0)} className="shrink-0 text-[10px]" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-1.5 border-t border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground sm:px-2.5 sm:py-2 sm:text-[11px]">
          <span className="min-w-0 truncate">
            {manga.genres?.[0] || 'Arşiv Seçkisi'}
          </span>
          <span className={cn('shrink-0 font-medium', chapterCountClassName)}>
            {manga.chapterCount || manga.chapters?.length || 0} bölüm
          </span>
        </div>
      </div>
    </Link>
  );
};

const TopTenAudienceBlock: React.FC<{
  audience: TopTenAudience;
  timeframe: TopTenTimeframe;
  onTimeframeChange: (timeframe: TopTenTimeframe) => void;
  manga: Manga[];
  isLoading: boolean;
  disableHeavyEffects: boolean;
  isCoarsePointer: boolean;
  isSinglePanel?: boolean;
}> = ({
  audience,
  timeframe,
  onTimeframeChange,
  manga,
  isLoading,
  disableHeavyEffects,
  isCoarsePointer,
  isSinglePanel = false,
}) => {
  const audienceMeta = TOP_TEN_AUDIENCE_META[audience];
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const uniqueMangas = useMemo(() => {
    const seenIds = new Set<string>();
    return manga.filter((item) => {
      if (!item?.id || seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });
  }, [manga]);

  const updateArrows = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = scroller;
    setShowLeftArrow(scrollLeft > 15);
    setShowRightArrow(scrollWidth > clientWidth + 15 && scrollLeft < scrollWidth - clientWidth - 15);
  }, []);

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
    const scroller = scrollRef.current;
    if (scroller) {
      const scrollAmount = Math.max(260, scroller.clientWidth * 0.75);
      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const target = direction === 'left'
        ? Math.max(0, scroller.scrollLeft - scrollAmount)
        : Math.min(maxScrollLeft, scroller.scrollLeft + scrollAmount);

      scroller.scrollTo({
        left: target,
        behavior: 'smooth',
      });
      window.setTimeout(requestArrowUpdate, 450);
    }
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    scroller.scrollTo({ left: 0, behavior: 'auto' });
    requestArrowUpdate();

    const handleResize = () => requestArrowUpdate();
    window.addEventListener('resize', handleResize, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        requestArrowUpdate();
      });
      observer.observe(scroller);
    }

    const timer = window.setTimeout(requestArrowUpdate, 200);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, [timeframe, audience, uniqueMangas.length, requestArrowUpdate]);

  useEffect(() => () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
  }, []);

  return (
    <section
      className={`min-w-0 ${disableHeavyEffects ? '' : 'animate-fade-up'}`}
      style={
        disableHeavyEffects
          ? undefined
          : {
              animationDelay: audience === 'safe' ? '0.02s' : '0.05s',
            }
      }
    >
      <div className={cn(
        'relative min-w-0 max-w-full overflow-hidden rounded-2xl border border-border/60 p-3.5 sm:p-5',
        isSinglePanel && 'xl:mx-auto xl:max-w-[76rem]',
        audienceMeta.frameClassName,
      )}>
        <div className="relative z-10">
          <div className="mb-3.5 flex flex-col gap-2.5 border-b border-border/50 pb-3.5 sm:mb-4 sm:flex-row sm:items-center sm:justify-between sm:pb-4">
            <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              {audienceMeta.title}
            </h2>
            <div className="w-full min-w-0 sm:w-auto">
              <TopTenTimeframeTabs
                audience={audience}
                activeTimeframe={timeframe}
                onChange={onTimeframeChange}
                disableHeavyEffects={disableHeavyEffects}
              />
            </div>
          </div>

          <div className="relative min-w-0 overflow-visible group/carousel">
            {/* Sola Kaydır Butonu */}
            <AnimatePresence>
              {showLeftArrow && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => scroll('left')}
                  className="absolute left-1 sm:left-2 top-[54%] -translate-y-1/2 z-30 flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-background/90 text-foreground border border-border/70 shadow-lg backdrop-blur-md transition-colors duration-150 hover:bg-primary hover:border-primary/50 hover:text-primary-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-label="Sola kaydır"
                >
                  <ChevronLeft className="h-4 w-4 -translate-x-[0.5px]" strokeWidth={2.25} />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Sağa Kaydır Butonu */}
            <AnimatePresence>
              {showRightArrow && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => scroll('right')}
                  className="absolute right-1 sm:right-2 top-[54%] -translate-y-1/2 z-30 flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-background/90 text-foreground border border-border/70 shadow-lg backdrop-blur-md transition-colors duration-150 hover:bg-primary hover:border-primary/50 hover:text-primary-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-label="Sağa kaydır"
                >
                  <ChevronRight className="h-4 w-4 translate-x-[0.5px]" strokeWidth={2.25} />
                </motion.button>
              )}
            </AnimatePresence>

            {isLoading ? (
              <div
                key={`${audience}-${timeframe}-loading`}
                className="flex w-full max-w-full min-w-0 gap-2.5 overflow-x-auto pb-1.5 scrollbar-hide sm:gap-3.5 sm:pb-2"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={`${audience}-${timeframe}-skeleton-${index}`} className={`shrink-0 ${TOP_TEN_CARD_WIDTH_CLASS} animate-pulse`}>
                    <div className="mb-1.5 flex h-8 items-end justify-between sm:mb-2 sm:h-10">
                      <div className="h-6 w-8 rounded bg-white/10 sm:h-7" />
                      <div className="h-5 w-14 rounded-full bg-white/10" />
                    </div>
                    <div className="overflow-hidden rounded-xl border border-border/50 bg-white/5">
                      <div className="aspect-[3/4] bg-white/10" />
                      <div className="space-y-1.5 border-t border-border/50 px-2.5 py-2">
                        <div className="h-3 rounded bg-white/10" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {uniqueMangas.length > 0 ? (
                  <motion.div
                    key={`${audience}-${timeframe}-content`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className="min-w-0"
                  >
                    <div
                      ref={scrollRef}
                      onScroll={updateArrows}
                      className="flex w-full max-w-full min-w-0 snap-x snap-proximity gap-2.5 overflow-x-auto pb-1.5 scrollbar-hide sm:gap-3.5 sm:pb-2 scroll-smooth"
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
                    >
                      {uniqueMangas.map((item, index) => (
                        <div
                          key={`${audience}-${item.id}`}
                          data-top-ten-card
                          className={`shrink-0 snap-start ${TOP_TEN_CARD_WIDTH_CLASS}`}
                        >
                          <TopTenCard
                            manga={item}
                            index={index}
                            audience={audience}
                            disableHeavyEffects={disableHeavyEffects}
                          />
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={`${audience}-${timeframe}-empty`}
                    initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: disableHeavyEffects ? 0.12 : 0.16 }}
                    className="rounded-xl border border-dashed border-border/60 bg-background/40 p-6 text-center sm:p-8"
                  >
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {audienceMeta.emptyText}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const TopTen: React.FC = () => {
  const { disableHeavyEffects, isCoarsePointer } = useDeviceProfile();
  const { isOnline } = useEffectiveOnlineStatus();
  const { user } = useAuth();
  const [activeTimeframes, setActiveTimeframes] = useState<Record<TopTenAudience, TopTenTimeframe>>({
    safe: 'today',
    adult: 'today',
  });
  const [sections, setSections] = useState<TopTenSections>(() => readCachedTopTenSections());
  const [isLoading, setIsLoading] = useState(() => {
    const cached = readCachedTopTenSections();
    return cached.safe.today.length === 0 && cached.adult.today.length === 0;
  });
  const [adultModeEnabled, setAdultModeEnabled] = useState(
    () => user?.preferences?.content?.adult_mode === true,
  );

  useEffect(() => {
    setAdultModeEnabled(user?.preferences?.content?.adult_mode === true);
  }, [user?.preferences?.content?.adult_mode]);

  useEffect(() => {
    const handleAdultModeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<AdultModeChangedDetail>;
      if (typeof customEvent.detail?.enabled === 'boolean') {
        setAdultModeEnabled(customEvent.detail.enabled);
      }
    };

    window.addEventListener(ADULT_MODE_CHANGED_EVENT, handleAdultModeChanged);
    return () => {
      window.removeEventListener(ADULT_MODE_CHANGED_EVENT, handleAdultModeChanged);
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!isOnline) {
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    const cachedSections = readCachedTopTenSections();
    const hasCachedCards = cachedSections.safe.today.length > 0 || cachedSections.adult.today.length > 0;
    setSections(cachedSections);
    setIsLoading(!hasCachedCards);

    const loadTopTenSections = async () => {
      try {
        const nextSections = await getTopTenPageData();

        if (!active) {
          return;
        }

        TOP_TEN_PAGE_CACHE.safe.today = nextSections.safe.today;
        TOP_TEN_PAGE_CACHE.safe.week = nextSections.safe.week;
        TOP_TEN_PAGE_CACHE.safe.all = nextSections.safe.all;
        TOP_TEN_PAGE_CACHE.adult.today = nextSections.adult.today;
        TOP_TEN_PAGE_CACHE.adult.week = nextSections.adult.week;
        TOP_TEN_PAGE_CACHE.adult.all = nextSections.adult.all;

        setSections(nextSections);
      } catch (error) {
        console.error('Top ten page loading error:', error);
        if (active && !hasCachedCards) {
          setSections(EMPTY_TOP_TEN_SECTIONS);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadTopTenSections();

    return () => {
      active = false;
    };
  }, [isOnline]);

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        title="Top 10 çevrimdışında açılamaz"
        description="Top 10 sayfası canlı etkileşim verisiyle hazırlanır. Bağlantı tekrar geldiğinde günün, haftanın ve tüm zamanların sıralaması yeniden yüklenir."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <Header />

      <main className="container overflow-x-clip pb-10 pt-16 sm:pb-12">
        <div className={cn('py-5 sm:py-6', !adultModeEnabled && 'mx-auto max-w-7xl xl:max-w-[76rem]')}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Crown className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Top 10</h1>
          </div>
        </div>

        <div className={`grid min-w-0 gap-4 sm:gap-6 ${adultModeEnabled ? 'xl:grid-cols-2' : 'max-w-7xl mx-auto'}`}>
          <TopTenAudienceBlock
            audience="safe"
            timeframe={activeTimeframes.safe}
            onTimeframeChange={(timeframe) => setActiveTimeframes((current) => ({ ...current, safe: timeframe }))}
            manga={sections.safe[activeTimeframes.safe]}
            isLoading={isLoading}
            disableHeavyEffects={disableHeavyEffects}
            isCoarsePointer={isCoarsePointer}
            isSinglePanel={!adultModeEnabled}
          />

          {adultModeEnabled ? (
            <TopTenAudienceBlock
              audience="adult"
              timeframe={activeTimeframes.adult}
              onTimeframeChange={(timeframe) => setActiveTimeframes((current) => ({ ...current, adult: timeframe }))}
              manga={sections.adult[activeTimeframes.adult]}
              isLoading={isLoading}
              disableHeavyEffects={disableHeavyEffects}
              isCoarsePointer={isCoarsePointer}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
};

export default TopTen;
