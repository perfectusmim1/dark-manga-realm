import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
    emptyText: string;
  }
> = {
  safe: {
    title: 'Genel Sıralama',
    emptyText: 'Bu aralıkta genel Top 10 için seri bulunamadı.',
  },
  adult: {
    title: '18+ Sıralama',
    emptyText: 'Bu aralıkta yetişkin Top 10 için seri bulunamadı.',
  },
};

const TOP_TEN_CARD_TRANSFORM = Object.freeze({
  width: 440,
  quality: 75,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const TOP_TEN_CARD_INTRINSIC_WIDTH = 400;
const TOP_TEN_CARD_INTRINSIC_HEIGHT = 560;
const TOP_TEN_CARD_SIZES = '(min-width: 1280px) 220px, (min-width: 768px) 22vw, 45vw';

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
    <div className="inline-flex w-full sm:w-auto items-center rounded-lg border border-border/60 bg-card/70 p-0.5">
      {TOP_TEN_TIMEFRAMES.map((timeframe) => {
        const meta = TOP_TEN_TIMEFRAME_META[timeframe];
        const Icon = meta.icon;
        const isActive = timeframe === activeTimeframe;

        return (
          <button
            key={`${audience}-${timeframe}`}
            type="button"
            onClick={() => {
              if (timeframe !== activeTimeframe) {
                onChange(timeframe);
              }
            }}
            className={cn(
              'relative flex-1 sm:flex-initial overflow-hidden rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors',
              isActive ? 'text-white' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={isActive}
          >
            {isActive ? (
              <span className={`absolute inset-0 rounded-md transition-all ${activePillClassName}`} />
            ) : null}
            <span className="relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{meta.title}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

const getRankBadgeStyle = (index: number, audience: TopTenAudience) => {
  if (index === 0) return 'bg-amber-500 text-black border-amber-300/60';
  if (index === 1) return 'bg-zinc-200 text-zinc-950 border-white/60';
  if (index === 2) return 'bg-amber-700 text-white border-amber-500/50';
  return audience === 'adult'
    ? 'bg-black/80 text-rose-100 border-rose-400/30'
    : 'bg-black/80 text-white border-white/15';
};

const TopTenCard: React.FC<{
  manga: Manga;
  index: number;
  audience: TopTenAudience;
}> = ({
  manga,
  index,
  audience,
}) => {
  const blurAdultArtwork = useAdultImageBlurPreference();
  const engagementLabel = typeof manga.engagementScore === 'number' && Number.isFinite(manga.engagementScore)
    ? `${Math.round(manga.engagementScore)} puan`
    : null;
  const coverSrcSet = useMemo(() => getManagedArtworkSrcSet(manga.cover), [manga.cover]);
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
  const chapterCount = manga.chapterCount || manga.chapters?.length || 0;

  return (
    <Link
      to={`/manga/${manga.id}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 min-w-0"
    >
      <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg border border-border/60 bg-muted transition-colors group-hover:border-primary/50">
        <OptimizedImage
          src={manga.cover}
          alt={manga.title}
          width={TOP_TEN_CARD_INTRINSIC_WIDTH}
          height={TOP_TEN_CARD_INTRINSIC_HEIGHT}
          srcSet={coverSrcSet}
          sizes={TOP_TEN_CARD_SIZES}
          priority={index < 5}
          rootMargin="480px 0px"
          transform={TOP_TEN_CARD_TRANSFORM}
          containerClassName="h-full w-full"
          placeholderClassName="rounded-none"
          className={cn(
            'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
            shouldBlurAdultArtwork && 'scale-[1.03] blur-md',
          )}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="absolute left-2 top-2">
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums shadow-sm',
              getRankBadgeStyle(index, audience),
            )}
          >
            #{index + 1}
          </span>
        </div>

        <div className="absolute right-2 top-2">
          <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold', typeBadgeClassName)}>
            {typeBadgeLabel}
          </span>
        </div>

        {engagementLabel && (
          <div className="absolute bottom-2 right-2">
            <span className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white/90 tabular-nums backdrop-blur-sm">
              {engagementLabel}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-0.5 min-w-0 px-0.5">
        <h3 className="line-clamp-1 text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          {manga.title}
        </h3>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <MangaRatingBadge value={Number(manga.averageRating || 0)} className="text-[11px]" />
            <span className="opacity-50">·</span>
            <span className="truncate tabular-nums">{chapterCount} bölüm</span>
          </div>
          {manga.genres?.[0] && (
            <span className="hidden sm:inline truncate max-w-[78px] text-[10px] text-muted-foreground/80">
              {manga.genres[0]}
            </span>
          )}
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
}> = ({
  audience,
  timeframe,
  onTimeframeChange,
  manga,
  isLoading,
  disableHeavyEffects,
}) => {
  const audienceMeta = TOP_TEN_AUDIENCE_META[audience];

  const uniqueMangas = useMemo(() => {
    const seen = new Set<string>();
    return manga.filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 10);
  }, [manga]);

  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-col gap-3 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">
            {audienceMeta.title}
          </h2>
          {audience === 'adult' && (
            <Badge variant="outline" className="border-rose-500/35 bg-rose-500/10 text-rose-400 text-[10px] px-1.5 py-0">
              18+
            </Badge>
          )}
        </div>

        <TopTenTimeframeTabs
          audience={audience}
          activeTimeframe={timeframe}
          onChange={onTimeframeChange}
          disableHeavyEffects={disableHeavyEffects}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 sm:gap-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={`${audience}-${timeframe}-skeleton-${index}`} className="space-y-2 animate-pulse">
              <div className="aspect-[5/7] w-full rounded-lg bg-muted/60" />
              <div className="h-4 w-4/5 rounded bg-muted/60" />
              <div className="h-3 w-1/2 rounded bg-muted/60" />
            </div>
          ))}
        </div>
      ) : uniqueMangas.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 sm:gap-4">
          {uniqueMangas.map((item, index) => (
            <TopTenCard
              key={`${audience}-${item.id}`}
              manga={item}
              index={index}
              audience={audience}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {audienceMeta.emptyText}
          </p>
        </div>
      )}
    </section>
  );
};

const TopTen: React.FC = () => {
  const { disableHeavyEffects } = useDeviceProfile();
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

      <main className="container mx-auto max-w-7xl px-4 pb-12 pt-20">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Popüler Sıralama</h1>
        </div>

        <div className="space-y-10 min-w-0">
          <TopTenAudienceBlock
            audience="safe"
            timeframe={activeTimeframes.safe}
            onTimeframeChange={(timeframe) => setActiveTimeframes((current) => ({ ...current, safe: timeframe }))}
            manga={sections.safe[activeTimeframes.safe]}
            isLoading={isLoading}
            disableHeavyEffects={disableHeavyEffects}
          />

          {adultModeEnabled ? (
            <TopTenAudienceBlock
              audience="adult"
              timeframe={activeTimeframes.adult}
              onTimeframeChange={(timeframe) => setActiveTimeframes((current) => ({ ...current, adult: timeframe }))}
              manga={sections.adult[activeTimeframes.adult]}
              isLoading={isLoading}
              disableHeavyEffects={disableHeavyEffects}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
};

export default TopTen;
