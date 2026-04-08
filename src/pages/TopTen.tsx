import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  Clock3,
  Crown,
  Flame,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import MangaRatingBadge from '@/components/manga/MangaRatingBadge';
import OptimizedImage from '@/components/media/OptimizedImage';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getTopTenMangaBuckets } from '@/lib/database';
import { getManagedArtworkSrcSet } from '@/lib/managedArtwork';
import { getMangaTypeLabel, isAdultMangaType } from '@/lib/mangaType';
import { Manga } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

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
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    eyebrow: string;
    frameClassName: string;
    iconWrapClassName: string;
    badgeClassName: string;
    emptyText: string;
  }
> = {
  safe: {
    title: 'Genel Top 10',
    description: 'Yetişkin içerik karışmadan, herkes için uygun ana sıralama.',
    icon: ShieldCheck,
    eyebrow: 'Standart Seri Akışı',
    frameClassName: 'border-primary/15 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_48%),linear-gradient(180deg,rgba(9,18,38,0.98),rgba(6,11,22,0.98))]',
    iconWrapClassName: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
    badgeClassName: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
    emptyText: 'Bu aralıkta genel Top 10 için seri bulunamadı.',
  },
  adult: {
    title: '18+ Top 10',
    description: 'Yalnızca yetişkin olarak işaretlenmiş serilerin ayrı sıralaması.',
    icon: Sparkles,
    eyebrow: 'Yetişkin Seri Akışı',
    frameClassName: 'border-rose-500/20 bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.16),transparent_48%),linear-gradient(180deg,rgba(33,8,17,0.98),rgba(18,5,10,0.98))]',
    iconWrapClassName: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
    badgeClassName: 'border-rose-400/35 bg-rose-500/10 text-rose-100',
    emptyText: 'Bu aralıkta yetişkin Top 10 için seri bulunamadı.',
  },
};

const TOP_TEN_CARD_TRANSFORM = Object.freeze({
  width: 520,
  quality: 70,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const TOP_TEN_CARD_INTRINSIC_WIDTH = 480;
const TOP_TEN_CARD_INTRINSIC_HEIGHT = 640;
const TOP_TEN_CARD_SIZES = '(min-width: 1536px) 18.5rem, (min-width: 1280px) 18rem, (min-width: 1024px) 17rem, (min-width: 640px) 16rem, 46vw';
const TOP_TEN_CARD_WIDTH_CLASS = 'w-[46vw] max-w-[10.5rem] min-[420px]:w-[42vw] min-[420px]:max-w-[11rem] sm:w-[16rem] sm:max-w-none lg:w-[17rem] xl:w-[18rem] 2xl:w-[18.5rem]';

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
    ? 'bg-rose-500 text-white shadow-[0_16px_34px_rgba(244,63,94,0.24)]'
    : 'bg-primary text-primary-foreground shadow-[0_16px_34px_rgba(37,99,235,0.24)]';

  return (
    <div className={`flex w-full max-w-full min-w-0 items-stretch justify-start gap-1 overflow-x-auto rounded-[1rem] border border-white/12 bg-black/18 p-1 scrollbar-hide sm:grid sm:w-[21rem] sm:grid-cols-3 sm:gap-0 sm:overflow-visible sm:rounded-full ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`}>
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
              'relative min-h-[2.1rem] min-w-[5.25rem] shrink-0 overflow-hidden rounded-[0.85rem] px-1.5 py-1 text-center text-[7px] font-black uppercase leading-none tracking-[0.08em] transition-colors duration-200 sm:min-h-[2.9rem] sm:min-w-0 sm:flex-1 sm:rounded-full sm:px-3 sm:py-2 sm:text-[10px] sm:tracking-[0.14em]',
              isActive ? 'text-white' : 'text-white/48 hover:text-white/86',
            )}
            aria-pressed={isActive}
          >
            {isActive ? (
              <motion.span
                layoutId={`top-ten-page-timeframe-pill-${audience}`}
                className={`absolute inset-0 rounded-full ${activePillClassName}`}
                transition={
                  disableHeavyEffects
                    ? { duration: 0.16, ease: 'easeOut' }
                    : { type: 'spring', stiffness: 380, damping: 30, mass: 0.72 }
                }
              />
            ) : null}
            <span className="relative z-10 flex items-center justify-center gap-1 sm:gap-2">
              <Icon className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
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
  disableHeavyEffects,
}) => {
  const engagementLabel = typeof manga.engagementScore === 'number' && Number.isFinite(manga.engagementScore)
    ? `${Math.round(manga.engagementScore)} puan`
    : 'Skor yok';
  const coverSrcSet = React.useMemo(() => getManagedArtworkSrcSet(manga.cover), [manga.cover]);
  const rankClassName = audience === 'adult'
    ? 'bg-gradient-to-b from-rose-50 via-rose-300 to-rose-500 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(244,63,94,0.24)]'
    : 'bg-gradient-to-b from-sky-100 via-sky-300 to-primary bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(59,130,246,0.24)]';
  const engagementBadgeClassName = audience === 'adult'
    ? 'border-rose-400/18 bg-rose-500/8 text-rose-300'
    : 'border-primary/15 bg-primary/5 text-primary';
  const cardFrameClassName = audience === 'adult'
    ? 'border-rose-500/12 bg-card/75 hover:border-rose-400/28'
    : 'border-border/70 bg-card/75 hover:border-primary/20';
  const chapterCountClassName = audience === 'adult' ? 'text-rose-300' : 'text-primary';
  const showAdultLabel = manga.isAdult === true || isAdultMangaType(manga.type);
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
    <Link to={`/manga/${manga.id}`} className="group block">
      <div className="mb-1.5 flex items-end justify-between gap-1.5 overflow-visible sm:mb-3 sm:gap-3">
        <span className={cn('inline-flex shrink-0 pr-[0.04em] text-[1.6rem] font-black leading-[0.86] tracking-[-0.05em] sm:pr-[0.08em] sm:text-[3.75rem]', rankClassName)}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <Badge variant="outline" className={cn('h-4.5 shrink-0 rounded-full px-1.5 text-[7px] uppercase tracking-[0.08em] sm:h-7 sm:px-2.5 sm:text-[10px] sm:tracking-[0.18em]', engagementBadgeClassName)}>
          {engagementLabel}
        </Badge>
      </div>

      <div className={cn('overflow-hidden rounded-[17px] border shadow-[0_18px_40px_rgba(15,23,42,0.14)] transition-colors sm:rounded-[24px]', cardFrameClassName)}>
        <div className="relative aspect-[3/4] overflow-hidden">
          <OptimizedImage
            src={manga.cover}
            alt={manga.title}
            width={TOP_TEN_CARD_INTRINSIC_WIDTH}
            height={TOP_TEN_CARD_INTRINSIC_HEIGHT}
            srcSet={coverSrcSet}
            sizes={TOP_TEN_CARD_SIZES}
            priority
            rootMargin="620px 0px"
            transform={TOP_TEN_CARD_TRANSFORM}
            containerClassName="h-full w-full"
            placeholderClassName="rounded-none"
            className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-500 group-hover:scale-105'}`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/28 via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-black via-black/94 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-[36%] bg-black/48" />

          <div className="absolute left-2 top-2 flex items-center gap-1 sm:left-3 sm:top-3 sm:gap-2">
            <Badge
              variant="secondary"
              className={`border-none px-1.5 py-0.5 text-[7px] font-bold sm:px-2 sm:py-1 sm:text-[10px] ${typeBadgeClassName}`}
            >
              {typeBadgeLabel}
            </Badge>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-4">
            <h3 className="line-clamp-2 text-[0.82rem] font-black tracking-tight text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.72)] sm:text-lg">
              {manga.title}
            </h3>
            <div className="mt-1 flex items-center justify-between gap-1.5 text-[8px] text-white/84 sm:mt-2 sm:gap-3 sm:text-xs">
              <span className="truncate drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">{manga.author}</span>
              <MangaRatingBadge value={Number(manga.averageRating || 0)} className="text-[10px] sm:text-xs" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-1.5 border-t border-border/70 px-2.5 py-2 text-[8px] text-muted-foreground sm:gap-3 sm:px-4 sm:py-3 sm:text-xs">
          <span className="min-w-0 truncate">
            {manga.genres[0] || 'Arşiv Seçkisi'}
          </span>
          <span className={cn('shrink-0 font-medium', chapterCountClassName)}>
            {manga.chapterCount || manga.chapters.length || 0} bölüm
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
  const timeframeMeta = TOP_TEN_TIMEFRAME_META[timeframe];
  const AudienceIcon = audienceMeta.icon;
  const TimeframeIcon = timeframeMeta.icon;
  const timeframeIconClassName = audience === 'adult'
    ? timeframe === 'today'
      ? 'h-4 w-4 text-rose-300'
      : timeframe === 'week'
        ? 'h-4 w-4 text-rose-200'
        : 'h-4 w-4 text-rose-400'
    : timeframeMeta.iconClassName;
  const timeframeBadgeClassName = audience === 'adult'
    ? 'border-rose-400/15 bg-rose-500/5 text-rose-50'
    : 'border-white/15 bg-white/5 text-white/88';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canUseWheelCarousel = !isCoarsePointer;

  const handleCarouselWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!canUseWheelCarousel) {
      return;
    }

    const scroller = event.currentTarget;

    const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    if (maxScrollLeft <= 0) {
      return;
    }

    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
    if (Math.abs(dominantDelta) < 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    scroller.scrollLeft = Math.max(0, Math.min(maxScrollLeft, scroller.scrollLeft + (dominantDelta * 1.1)));
  }, [canUseWheelCarousel]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTo({ left: 0, behavior: 'auto' });
  }, [timeframe, audience]);

  return (
    <section
      className={`min-w-0 ${disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}`}
      style={
        disableHeavyEffects
          ? { contentVisibility: 'auto', containIntrinsicSize: '920px 1000px' }
          : {
              animationDelay: audience === 'safe' ? '0.12s' : '0.18s',
              animationFillMode: 'forwards',
              contentVisibility: 'auto',
              containIntrinsicSize: '920px 1000px',
            }
      }
    >
      <div className={`relative min-w-0 max-w-full overflow-hidden rounded-[18px] border p-3 shadow-[0_28px_70px_rgba(15,23,42,0.22)] sm:rounded-[30px] sm:p-6 lg:p-7 ${isSinglePanel ? 'xl:mx-auto xl:max-w-[68rem]' : ''} ${audienceMeta.frameClassName}`}>
        <div className="relative z-10">
          <div className="mb-3 flex flex-col gap-3 border-b border-white/10 pb-3 sm:mb-6 sm:gap-5 sm:pb-6">
            <div className="flex min-w-0 flex-col items-start gap-2.5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.9rem] border backdrop-blur-sm sm:h-11 sm:w-11 sm:rounded-2xl ${audienceMeta.iconWrapClassName}`}>
                    <AudienceIcon className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/65 sm:text-[11px] sm:tracking-[0.24em]">
                      {audienceMeta.eyebrow}
                    </p>
                    <h2 className="mt-0.5 text-[0.98rem] font-black leading-[1.02] tracking-tight text-white sm:mt-1 sm:text-[2.2rem]">
                      {audienceMeta.title}
                    </h2>
                  </div>
                </div>
                <p className="mt-1.5 max-w-2xl text-[10px] leading-4.5 text-white/72 sm:mt-3 sm:text-sm sm:leading-6">
                  {audienceMeta.description}
                </p>
              </div>
              <div className="w-full min-w-0 xl:w-auto xl:min-w-[20rem]">
                <TopTenTimeframeTabs
                  audience={audience}
                  activeTimeframe={timeframe}
                  onChange={onTimeframeChange}
                  disableHeavyEffects={disableHeavyEffects}
                />
              </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${audience}-${timeframe}-meta`}
                initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: disableHeavyEffects ? 0 : -6 }}
                transition={{ duration: disableHeavyEffects ? 0.14 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-start gap-2 text-white sm:flex-row sm:flex-wrap sm:items-center"
              >
                <Badge variant="outline" className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[7px] uppercase tracking-[0.08em] sm:h-8 sm:gap-2 sm:px-3 sm:text-[11px] sm:tracking-[0.18em]', timeframeBadgeClassName)}>
                  <TimeframeIcon className={timeframeIconClassName} />
                  {timeframeMeta.title}
                </Badge>
                <p className="hidden text-[12px] leading-5 text-white/62 sm:block sm:text-sm">
                  {timeframeMeta.description}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="relative min-w-0 overflow-visible">
            <AnimatePresence mode="wait" initial={false}>
              {isLoading ? (
                <motion.div
                  key={`${audience}-${timeframe}-loading`}
                  initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: disableHeavyEffects ? 0 : -8 }}
                  transition={{ duration: disableHeavyEffects ? 0.14 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="flex w-full max-w-full min-w-0 gap-2 overflow-x-auto pb-1.5 scrollbar-hide sm:gap-4 sm:pb-2"
                >
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`${audience}-${timeframe}-skeleton-${index}`} className={`shrink-0 ${TOP_TEN_CARD_WIDTH_CLASS} animate-pulse`}>
                      <div className="mb-3 h-12 w-20 rounded-full bg-white/10" />
                      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                        <div className="aspect-[3/4] bg-white/10" />
                        <div className="space-y-2 border-t border-white/10 px-4 py-3">
                          <div className="h-3 rounded bg-white/10" />
                          <div className="h-3 w-2/3 rounded bg-white/10" />
                        </div>
                      </div>
                    </div>
                  ))}
                </motion.div>
              ) : manga.length > 0 ? (
                <motion.div
                  key={`${audience}-${timeframe}-content`}
                  initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: disableHeavyEffects ? 0 : -10 }}
                  transition={{ duration: disableHeavyEffects ? 0.14 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="min-w-0"
                >
                  <div
                    ref={scrollRef}
                    onWheelCapture={handleCarouselWheel}
                    className="flex w-full max-w-full min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto overscroll-contain pb-1.5 scrollbar-hide sm:gap-4 sm:pb-2"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {manga.map((item, index) => (
                      <motion.div
                        key={`${audience}-${timeframe}-${item.id}`}
                        data-top-ten-card
                        className={`shrink-0 snap-start ${TOP_TEN_CARD_WIDTH_CLASS}`}
                        initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 18, scale: disableHeavyEffects ? 1 : 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{
                          duration: disableHeavyEffects ? 0.14 : 0.22,
                          delay: disableHeavyEffects ? 0 : Math.min(index * 0.04, 0.16),
                          ease: [0.22, 1, 0.36, 1],
                        }}
                      >
                        <TopTenCard
                          manga={item}
                          index={index}
                          audience={audience}
                          disableHeavyEffects={disableHeavyEffects}
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={`${audience}-${timeframe}-empty`}
                  initial={{ opacity: 0, y: disableHeavyEffects ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: disableHeavyEffects ? 0 : -8 }}
                  transition={{ duration: disableHeavyEffects ? 0.14 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-[24px] border border-dashed border-white/15 bg-black/18 p-6 text-center sm:rounded-[28px] sm:p-8"
                >
                  <p className="text-[13px] text-white/68 sm:text-sm">
                    {audienceMeta.emptyText}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
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
  const [isLoading, setIsLoading] = useState(true);
  const adultModeEnabled = user?.preferences?.content?.adult_mode === true;

  useEffect(() => {
    let active = true;

    if (!isOnline) {
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setSections(readCachedTopTenSections());
    setIsLoading(true);

    const loadTopTenSections = async () => {
      try {
        const [todayBuckets, weekBuckets, allBuckets] = await Promise.all([
          getTopTenMangaBuckets('today'),
          getTopTenMangaBuckets('week'),
          getTopTenMangaBuckets('all'),
        ]);

        if (!active) {
          return;
        }

        const nextSections: TopTenSections = {
          safe: {
            today: todayBuckets.safe,
            week: weekBuckets.safe,
            all: allBuckets.safe,
          },
          adult: {
            today: todayBuckets.adult,
            week: weekBuckets.adult,
            all: allBuckets.adult,
          },
        };

        TOP_TEN_PAGE_CACHE.safe.today = nextSections.safe.today;
        TOP_TEN_PAGE_CACHE.safe.week = nextSections.safe.week;
        TOP_TEN_PAGE_CACHE.safe.all = nextSections.safe.all;
        TOP_TEN_PAGE_CACHE.adult.today = nextSections.adult.today;
        TOP_TEN_PAGE_CACHE.adult.week = nextSections.adult.week;
        TOP_TEN_PAGE_CACHE.adult.all = nextSections.adult.all;

        setSections(nextSections);
      } catch (error) {
        console.error('Top ten page loading error:', error);
        if (active) {
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

      <main className="container overflow-x-clip pb-8 pt-[4.5rem] sm:pb-12 sm:pt-24">
        <section
          className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
          style={disableHeavyEffects ? undefined : { animationDelay: '0.06s', animationFillMode: 'forwards' }}
        >
          <div className="relative overflow-hidden rounded-[18px] border border-primary/15 bg-card/75 px-3.5 py-3.5 shadow-[0_28px_70px_rgba(15,23,42,0.16)] sm:rounded-[34px] sm:px-8 sm:py-10 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.2),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.16),transparent_28%)]" />
            <div className="relative z-10 flex flex-col gap-4 sm:gap-5">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary sm:px-3 sm:py-1 sm:text-[11px] sm:tracking-[0.24em]">
                  <BarChart3 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  Top 10 Merkezi
                </div>
                <h1 className="mt-2.5 max-w-[11ch] text-[1.2rem] font-black leading-[1] tracking-tight sm:mt-4 sm:max-w-none sm:text-5xl">
                  Her panel kendi zaman akışını yönetsin.
                </h1>
                <p className="mt-2 max-w-2xl text-[10px] leading-4.5 text-muted-foreground sm:mt-4 sm:text-[15px] sm:leading-6">
                  Genel listeyi ve gerekiyorsa 18+ listesini birbirinden bağımsız filtrele. Butonlar doğrudan kart bloğunun içinde durur, geçişler de daha akıcı akar.
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className={`mt-4 grid min-w-0 gap-4 sm:mt-10 sm:gap-8 ${adultModeEnabled ? 'xl:grid-cols-2' : ''}`}>
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
          ) : (
            <section
              className={`rounded-[30px] border border-dashed border-border bg-card/50 p-6 shadow-[0_18px_40px_rgba(15,23,42,0.12)] ${adultModeEnabled ? 'hidden' : ''}`}
            >
              <div className="flex items-start gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background/70 text-muted-foreground">
                  <Lock className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-xl font-black tracking-tight">
                    18+ Top 10 kilitli
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Yetişkin modu açık değilse ayrı 18+ sıralama gösterilmez. Ayarı açan kullanıcılar burada yalnızca yetişkin serilere özel Top 10 listesini görür.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default TopTen;
