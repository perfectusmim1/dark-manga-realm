import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ChevronLeft, ChevronRight, Clock3, Crown, Flame } from 'lucide-react';
import Header from '@/components/layout/Header';
import OptimizedImage from '@/components/media/OptimizedImage';
import { Badge } from '@/components/ui/badge';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { getTopTenMangas } from '@/lib/database';
import { getManagedArtworkSrcSet } from '@/lib/managedArtwork';
import { Manga } from '@/lib/types';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

type TopTenTimeframe = 'today' | 'week' | 'all';

const TOP_TEN_PAGE_CACHE: Record<TopTenTimeframe, Manga[] | null> = {
  today: null,
  week: null,
  all: null,
};

const TOP_TEN_TIMEFRAMES: TopTenTimeframe[] = ['today', 'week', 'all'];

const TOP_TEN_SECTION_META: Record<
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
    description: 'Anlık etkileşim dalgasını yakalayan ve bugün en çok öne çıkan seriler.',
    icon: Flame,
    iconClassName: 'h-5 w-5 text-amber-400',
  },
  week: {
    title: 'Bu Hafta',
    eyebrow: '7 Günlük Tempo',
    description: 'Haftalık ivmesini koruyan ve topluluk tarafından sürekli öne çıkarılan seçimler.',
    icon: Clock3,
    iconClassName: 'h-5 w-5 text-sky-400',
  },
  all: {
    title: 'Tüm Zamanlar',
    eyebrow: 'Kalıcı Liderler',
    description: 'Uzun vadede iz bırakan, sürekli dönen ve en güçlü arşiv değerini taşıyan seriler.',
    icon: Crown,
    iconClassName: 'h-5 w-5 text-primary',
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
const TOP_TEN_CARD_SIZES = '(min-width: 1280px) 19vw, (min-width: 1024px) 20vw, (min-width: 640px) 24vw, 44vw';

const readCachedTopTenSections = (): Record<TopTenTimeframe, Manga[]> => ({
  today: TOP_TEN_PAGE_CACHE.today ?? [],
  week: TOP_TEN_PAGE_CACHE.week ?? [],
  all: TOP_TEN_PAGE_CACHE.all ?? [],
});

const TOP_TEN_CARD_WIDTH_CLASS = 'w-[calc((100%-16px)/2.22)] min-[480px]:w-[calc((100%-24px)/2.65)] sm:w-[calc((100%-48px)/4)] lg:w-[calc((100%-64px)/5)]';

const TopTenCard: React.FC<{
  manga: Manga;
  index: number;
  priority: boolean;
  disableHeavyEffects: boolean;
}> = ({
  manga,
  index,
  priority,
  disableHeavyEffects,
}) => {
  const engagementLabel = typeof manga.engagementScore === 'number' && Number.isFinite(manga.engagementScore)
    ? `${Math.round(manga.engagementScore)} puan`
    : `${(manga.views || 0).toLocaleString('tr-TR')} görüntülenme`;
  const coverSrcSet = React.useMemo(() => getManagedArtworkSrcSet(manga.cover), [manga.cover]);

  return (
    <Link to={`/manga/${manga.id}`} className="group block">
      <div className="mb-3 flex items-end justify-between gap-3 overflow-visible">
        <span className="inline-flex shrink-0 bg-gradient-to-b from-sky-100 via-sky-300 to-primary bg-clip-text pr-[0.08em] text-[3rem] font-black leading-[0.88] tracking-[-0.05em] text-transparent drop-shadow-[0_0_18px_rgba(59,130,246,0.24)] sm:text-[3.75rem]">
          {String(index + 1).padStart(2, '0')}
        </span>
        <Badge variant="outline" className="h-7 shrink-0 rounded-full border-primary/15 bg-primary/5 px-2.5 text-[10px] uppercase tracking-[0.18em] text-primary">
          {engagementLabel}
        </Badge>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-border/70 bg-card/75 shadow-[0_18px_40px_rgba(15,23,42,0.14)] transition-colors hover:border-primary/20">
        <div className="relative aspect-[3/4] overflow-hidden">
          <OptimizedImage
            src={manga.cover}
            alt={manga.title}
            width={TOP_TEN_CARD_INTRINSIC_WIDTH}
            height={TOP_TEN_CARD_INTRINSIC_HEIGHT}
            srcSet={coverSrcSet}
            sizes={TOP_TEN_CARD_SIZES}
            priority={priority}
            rootMargin="620px 0px"
            transform={TOP_TEN_CARD_TRANSFORM}
            containerClassName="h-full w-full"
            placeholderClassName="rounded-none"
            className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-500 group-hover:scale-105'}`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/28 via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-black via-black/94 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-[36%] bg-black/48" />

          <div className="absolute left-3 top-3">
            <Badge
              variant="secondary"
              className={`border-none text-[10px] font-bold ${
                manga.type === 'manhwa'
                  ? 'bg-orange-600/90 text-white'
                  : manga.type === 'manhua'
                    ? 'bg-emerald-600/90 text-white'
                    : manga.type === 'webtoon'
                      ? 'bg-sky-600/90 text-white'
                      : 'bg-primary text-primary-foreground'
              }`}
            >
              {manga.type.toUpperCase()}
            </Badge>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-4">
            <h3 className="line-clamp-2 text-lg font-black tracking-tight text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.72)]">
              {manga.title}
            </h3>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/84">
              <span className="truncate drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">{manga.author}</span>
              <span className="shrink-0 font-semibold text-white">
                {Number(manga.averageRating || 0).toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
          <span className="truncate">
            {manga.genres[0] || 'Arşiv Seçkisi'}
          </span>
          <span className="shrink-0 font-medium text-primary">
            {manga.chapterCount || manga.chapters.length || 0} bölüm
          </span>
        </div>
      </div>
    </Link>
  );
};

const TopTenSectionBlock: React.FC<{
  timeframe: TopTenTimeframe;
  manga: Manga[];
  isLoading: boolean;
  disableHeavyEffects: boolean;
  isCoarsePointer: boolean;
}> = ({
  timeframe,
  manga,
  isLoading,
  disableHeavyEffects,
  isCoarsePointer,
}) => {
  const meta = TOP_TEN_SECTION_META[timeframe];
  const Icon = meta.icon;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [hasMeasuredArrows, setHasMeasuredArrows] = useState(false);
  const rafRef = useRef<number | null>(null);
  const showArrowControls = !isCoarsePointer && !disableHeavyEffects;
  const estimatedHasOverflow = manga.length > 5;

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
    if (!scrollRef.current) {
      return;
    }

    const scrollAmount = scrollRef.current.clientWidth * 0.92;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });

    window.setTimeout(requestArrowUpdate, 450);
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
  }, [manga.length, requestArrowUpdate, scrollNode, showArrowControls, isLoading]);

  useEffect(() => () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
  }, []);

  useEffect(() => {
    if (!scrollNode) {
      return;
    }

    scrollNode.scrollTo({ left: 0, behavior: 'auto' });
    requestArrowUpdate();
  }, [manga.length, requestArrowUpdate, scrollNode, timeframe, isLoading]);

  return (
    <section
      className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
      style={
        disableHeavyEffects
          ? { contentVisibility: 'auto', containIntrinsicSize: '980px 1120px' }
          : {
              animationDelay: timeframe === 'today' ? '0.12s' : timeframe === 'week' ? '0.18s' : '0.24s',
              animationFillMode: 'forwards',
              contentVisibility: 'auto',
              containIntrinsicSize: '980px 1120px',
            }
      }
    >
      <div className="mb-5 flex flex-col gap-2 sm:mb-6 sm:gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Icon className={meta.iconClassName} />
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {meta.eyebrow}
            </p>
          </div>
          <h2 className="mt-2 text-[2rem] font-black leading-[1.02] tracking-tight sm:text-3xl">{meta.title}</h2>
          <p className="mt-2 hidden max-w-2xl text-sm text-muted-foreground sm:block">{meta.description}</p>
        </div>
        <Badge variant="outline" className="h-8 rounded-full px-3 text-xs uppercase tracking-[0.18em]">
          10 seri
        </Badge>
      </div>

      <div className="relative overflow-visible group/carousel">
        {showArrowControls && (
          <>
            {showLeftArrow && (
              <button
                type="button"
                onClick={() => scroll('left')}
                className="absolute bottom-[4px] left-0 top-[3.42rem] z-30 flex w-[4.5rem] items-center justify-center overflow-hidden rounded-l-[24px] rounded-r-none border border-r-0 border-white/10 bg-black/70 text-white opacity-0 shadow-[0_18px_34px_rgba(0,0,0,0.28)] transition-all duration-300 group/arrow hover:bg-black/80 group-hover/carousel:opacity-100 focus-visible:opacity-100 sm:top-[4.06rem] sm:bottom-[4px] sm:w-[4.9rem]"
                aria-label={`${meta.title} sola kaydır`}
              >
                <ChevronLeft className="h-9 w-9 -translate-x-[1px] transition-transform duration-300 drop-shadow-[0_4px_14px_rgba(0,0,0,0.28)] group-hover/arrow:scale-125 group-active/arrow:scale-90 sm:h-10 sm:w-10" />
              </button>
            )}
            {(showRightArrow || (!hasMeasuredArrows && estimatedHasOverflow && !isLoading)) && (
              <button
                type="button"
                onClick={() => scroll('right')}
                className="absolute bottom-[4px] right-0 top-[3.42rem] z-30 flex w-[4.5rem] items-center justify-center overflow-hidden rounded-r-[24px] rounded-l-none border border-l-0 border-white/10 bg-black/70 text-white opacity-0 shadow-[0_18px_34px_rgba(0,0,0,0.28)] transition-all duration-300 group/arrow hover:bg-black/80 group-hover/carousel:opacity-100 focus-visible:opacity-100 sm:top-[4.06rem] sm:bottom-[4px] sm:w-[4.9rem]"
                aria-label={`${meta.title} sağa kaydır`}
              >
                <ChevronRight className="h-9 w-9 translate-x-[1px] transition-transform duration-300 drop-shadow-[0_4px_14px_rgba(0,0,0,0.28)] group-hover/arrow:scale-125 group-active/arrow:scale-90 sm:h-10 sm:w-10" />
              </button>
            )}
          </>
        )}

        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`${timeframe}-skeleton-${index}`} className={`shrink-0 ${TOP_TEN_CARD_WIDTH_CLASS} animate-pulse`}>
                <div className="mb-3 h-12 w-20 rounded-full bg-secondary/45" />
                <div className="overflow-hidden rounded-[24px] border border-border/60 bg-card/60">
                  <div className="aspect-[3/4] bg-secondary/40" />
                  <div className="space-y-2 border-t border-border/60 px-4 py-3">
                    <div className="h-3 rounded bg-secondary/40" />
                    <div className="h-3 w-2/3 rounded bg-secondary/30" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : manga.length > 0 ? (
          <div
            ref={(node) => {
              scrollRef.current = node;
              setScrollNode(node);
            }}
            onScroll={updateArrows}
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-2 scroll-smooth scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {manga.map((item, index) => (
              <div key={`${timeframe}-${item.id}`} className={`shrink-0 snap-start ${TOP_TEN_CARD_WIDTH_CLASS}`}>
                <TopTenCard
                  manga={item}
                  index={index}
                  priority={timeframe === 'today' && index < 4}
                  disableHeavyEffects={disableHeavyEffects}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-border bg-card/40 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Bu aralık için gösterilecek seri bulunamadı.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};

const TopTen: React.FC = () => {
  const { disableHeavyEffects, isCoarsePointer } = useDeviceProfile();
  const { isOnline } = useEffectiveOnlineStatus();
  const [sections, setSections] = useState<Record<TopTenTimeframe, Manga[]>>(() => readCachedTopTenSections());
  const [isLoading, setIsLoading] = useState(() => Object.values(TOP_TEN_PAGE_CACHE).some((value) => value === null));

  useEffect(() => {
    let active = true;

    if (!isOnline) {
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setSections(readCachedTopTenSections());
    setIsLoading(Object.values(TOP_TEN_PAGE_CACHE).some((value) => value === null));

    const loadTopTenSections = async () => {
      try {
        const [today, week, all] = await Promise.all([
          getTopTenMangas('today'),
          getTopTenMangas('week'),
          getTopTenMangas('all'),
        ]);

        if (!active) {
          return;
        }

        TOP_TEN_PAGE_CACHE.today = today;
        TOP_TEN_PAGE_CACHE.week = week;
        TOP_TEN_PAGE_CACHE.all = all;

        setSections({ today, week, all });
      } catch (error) {
        console.error('Top ten page loading error:', error);
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
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-24">
        <section
          className={disableHeavyEffects ? '' : 'animate-fade-up opacity-0'}
          style={disableHeavyEffects ? undefined : { animationDelay: '0.06s', animationFillMode: 'forwards' }}
        >
          <div className="relative overflow-hidden rounded-[30px] border border-primary/15 bg-card/75 px-4 py-5 shadow-[0_28px_70px_rgba(15,23,42,0.16)] sm:rounded-[34px] sm:px-8 sm:py-10 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.2),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.16),transparent_28%)]" />
            <div className="relative z-10 flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Top 10 Merkezi
                </div>
                <h1 className="mt-3 max-w-[11ch] text-[2.7rem] font-black leading-[0.96] tracking-tight sm:mt-4 sm:max-w-none sm:text-5xl">
                  Günün, haftanın ve tüm zamanların sıralaması tek sayfada.
                </h1>
                <p className="mt-4 hidden max-w-2xl text-sm leading-6 text-muted-foreground sm:block sm:text-[15px]">
                  Üçlü filtre yerine tüm liste akışını aynı ekrana aldık. Mobilde daha rahat, masaüstünde daha hızlı taranır bir sıralama deneyimi sunuyor.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="h-7 rounded-full px-3 text-[11px] sm:h-8 sm:text-xs">
                  Bugün
                </Badge>
                <Badge variant="secondary" className="h-7 rounded-full px-3 text-[11px] sm:h-8 sm:text-xs">
                  Bu Hafta
                </Badge>
                <Badge variant="secondary" className="h-7 rounded-full px-3 text-[11px] sm:h-8 sm:text-xs">
                  Tüm Zamanlar
                </Badge>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-10 space-y-14">
          {TOP_TEN_TIMEFRAMES.map((timeframe) => (
            <TopTenSectionBlock
              key={timeframe}
              timeframe={timeframe}
              manga={sections[timeframe]}
              isLoading={isLoading && sections[timeframe].length === 0}
              disableHeavyEffects={disableHeavyEffects}
              isCoarsePointer={isCoarsePointer}
            />
          ))}
        </div>
      </main>
    </div>
  );
};

export default TopTen;
