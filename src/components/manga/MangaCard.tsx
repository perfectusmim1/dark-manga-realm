import React, { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Eye, BookOpen, Clock, User } from 'lucide-react';
import { Manga } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { getTopTenMangaIds } from '@/lib/database';
import MangaRatingBadge from '@/components/manga/MangaRatingBadge';
import { cn } from '@/lib/utils';
import { getOfflinePreferences } from '@/lib/offline/preferences';
import { getManagedArtworkSrcSet } from '@/lib/managedArtwork';
import { formatChapterNumberLabel } from '@/lib/chapterTitle';
import OptimizedImage from '@/components/media/OptimizedImage';
import { getMangaTypeLabel, isAdultMangaType } from '@/lib/mangaType';
import { useAdultImageBlurPreference } from '@/hooks/useAdultImageBlurPreference';
import { getSeriesLanguageInfo } from '@/lib/seriesLanguage';

interface MangaCardProps {
  manga: Manga;
  index?: number;
  topTenWeekIds?: ReadonlySet<string> | null;
  disableHeavyEffects?: boolean;
  coverPriority?: boolean;
  coverRootMargin?: string;
  enableEntryAnimation?: boolean;
  entryAnimationClassName?: string;
  entryAnimationDelayStepMs?: number;
  entryAnimationDurationMs?: number;
}

const MANGA_CARD_INTRINSIC_WIDTH = 280;
const MANGA_CARD_INTRINSIC_HEIGHT = 420;

const MANGA_CARD_COVER_TRANSFORM = Object.freeze({
  width: 420,
  quality: 68,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const MANGA_CARD_SIZES = '(min-width: 1536px) 14vw, (min-width: 1280px) 15vw, (min-width: 1024px) 17vw, (min-width: 768px) 20vw, (min-width: 640px) 25vw, 42vw';

const TOP_TEN_CORNER_CLIP_PATH = 'polygon(100% 0, 100% 100%, 0 0)';
const TOP_TEN_CORNER_SIZE = 'clamp(3rem, 28%, 4.3rem)';

const getLatestChapterLinks = (chapters: Manga['chapters']) => {
  const latest: Manga['chapters'] = [];

  for (const chapter of chapters) {
    if (latest.length === 0 || chapter.number >= latest[0].number) {
      latest.unshift(chapter);
      if (latest.length > 2) {
        latest.length = 2;
      }
      continue;
    }

    if (latest.length === 1 || chapter.number > latest[1].number) {
      latest.splice(1, 0, chapter);
      if (latest.length > 2) {
        latest.length = 2;
      }
    }
  }

  return latest;
};

const getTopTenWeekIds = async () => {
  return getTopTenMangaIds('week');
};

const MangaCardComponent: React.FC<MangaCardProps> = ({
  manga,
  index = 0,
  topTenWeekIds,
  disableHeavyEffects = false,
  coverPriority,
  coverRootMargin = '520px 0px',
  enableEntryAnimation = true,
  entryAnimationClassName = 'animate-fade-up',
  entryAnimationDelayStepMs = 50,
  entryAnimationDurationMs = 500,
}) => {
  const [isTopTenWeek, setIsTopTenWeek] = useState(false);
  const blurAdultArtwork = useAdultImageBlurPreference();
  const ratings = manga.ratings || [];
  const genres = manga.genres || [];
  const chapters = manga.chapters || [];
  const chapterCount = typeof manga.chapterCount === 'number' ? manga.chapterCount : chapters.length;
  const coverSrcSet = useMemo(() => getManagedArtworkSrcSet(manga.cover), [manga.cover]);
  const latestChapterLinks = useMemo(() => getLatestChapterLinks(chapters), [chapters]);
  const cardMetaLine = useMemo(() => {
    const primaryPerson = [manga.author, manga.artist]
      .map((value) => value?.trim())
      .find(Boolean);

    return primaryPerson || '\u00A0';
  }, [manga.artist, manga.author]);

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
    return views.toString();
  };

  const averageRatingValue = typeof manga.averageRating === 'number'
    ? manga.averageRating
    : ratings.length > 0
      ? ratings.reduce((acc, curr) => acc + curr.rating, 0) / ratings.length
      : 0;
  const averageRating = averageRatingValue.toFixed(1);
  const reviewCount = Math.max(
    typeof manga.reviewCount === 'number' ? manga.reviewCount : 0,
    ratings.length,
  );
  const hasVisibleRating = averageRatingValue > 0 || reviewCount > 0;

  const showAdultLabel = manga.isAdult === true || isAdultMangaType(manga.type);
  const shouldBlurAdultArtwork = blurAdultArtwork && showAdultLabel;
  const typeBadgeLabel = showAdultLabel ? 'Yetişkin' : getMangaTypeLabel(manga.type);
  const langInfo = useMemo(() => getSeriesLanguageInfo(manga), [manga]);

  const typeBadgeClassName = cn(
    `border-none text-[10px] font-bold ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`,
    showAdultLabel ? 'bg-rose-600/90 text-white shadow-lg shadow-rose-500/20' :
    manga.type === 'manhwa' ? 'bg-orange-600/90 text-white shadow-lg shadow-orange-500/20' :
        manga.type === 'manhua' ? 'bg-emerald-600/90 text-white shadow-lg shadow-emerald-500/20' :
          manga.type === 'webtoon' ? 'bg-sky-600/90 text-white shadow-lg shadow-sky-500/20' :
          'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
  );
  const topTenCornerClassName = manga.isAdult
    ? 'absolute inset-0 overflow-hidden border-l border-b border-rose-100/18 bg-[linear-gradient(220deg,rgba(255,228,236,0.98)_0%,rgba(251,113,133,0.96)_44%,rgba(225,29,72,0.95)_72%,rgba(136,19,55,0.94)_100%)] shadow-[0_8px_18px_rgba(190,24,93,0.24)]'
    : 'absolute inset-0 overflow-hidden border-l border-b border-sky-100/20 bg-[linear-gradient(220deg,rgba(239,246,255,0.98)_0%,rgba(125,211,252,0.96)_42%,rgba(59,130,246,0.95)_72%,rgba(29,78,216,0.94)_100%)] shadow-[0_8px_18px_rgba(37,99,235,0.24)]';
  const topTenCornerTextClassName = manga.isAdult ? 'text-white' : 'text-slate-950';
  const topTenCornerEyebrowClassName = manga.isAdult ? 'text-white/72' : 'text-slate-900/62';

  useEffect(() => {
    let isActive = true;

    if (topTenWeekIds === null) {
      setIsTopTenWeek(false);
      return () => {
        isActive = false;
      };
    }

    if (topTenWeekIds) {
      setIsTopTenWeek(topTenWeekIds.has(manga.id));
      return () => {
        isActive = false;
      };
    }

    const isEffectivelyOnline = typeof navigator === 'undefined'
      || (navigator.onLine && !getOfflinePreferences().forceOfflineMode);

    if (!isEffectivelyOnline) {
      setIsTopTenWeek(false);
      return () => {
        isActive = false;
      };
    }

    getTopTenWeekIds().then((ids) => {
      if (isActive) {
        setIsTopTenWeek(ids.has(manga.id));
      }
    });

    return () => {
      isActive = false;
    };
  }, [manga.id, topTenWeekIds]);

  const cardContent = (
    <div
      className={`group relative block cursor-pointer overflow-hidden rounded-xl bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${disableHeavyEffects ? '' : 'transition-[transform,box-shadow,border-color,background-color] duration-300 hover-lift'} ${disableHeavyEffects || !enableEntryAnimation ? '' : entryAnimationClassName}`}
      style={disableHeavyEffects || !enableEntryAnimation ? undefined : {
        animationDelay: `${index * entryAnimationDelayStepMs}ms`,
        animationDuration: `${entryAnimationDurationMs}ms`,
      }}
    >
      <Link
        to={`/manga/${manga.id}`}
        aria-label={`${manga.title} detay sayfasını aç`}
        className="absolute inset-0 z-[1] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <div className="pointer-events-none relative aspect-[2/3] w-full overflow-hidden bg-card">
        <OptimizedImage
          src={manga.cover}
          alt={manga.title}
          width={MANGA_CARD_INTRINSIC_WIDTH}
          height={MANGA_CARD_INTRINSIC_HEIGHT}
          srcSet={coverSrcSet}
          sizes={MANGA_CARD_SIZES}
          priority={coverPriority ?? index < 6}
          rootMargin={coverRootMargin}
          transform={MANGA_CARD_COVER_TRANSFORM}
          containerClassName="h-full w-full"
          placeholderClassName="rounded-none"
          className={cn(
            'h-full w-full object-cover',
            shouldBlurAdultArtwork && 'scale-[1.03] blur-md',
            ''
          )}
        />

        <div className="absolute inset-0 bg-black/20" style={{ opacity: 0.9 }} />

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(6,8,14,0.56)_0%,rgba(6,8,14,0.26)_55%,rgba(6,8,14,0)_100%)] sm:h-28"
        />

        <div
          className={cn(
            'absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background/95 via-background/50 to-transparent',
            disableHeavyEffects ? '' : 'opacity-0 transition-opacity duration-200 group-hover:opacity-100',
          )}
        />

        <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className={typeBadgeClassName}
          >
            {typeBadgeLabel}
          </Badge>
          {langInfo.language === 'raw' && (
            <Badge
              variant="outline"
              className={cn(
                'border text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 shadow-sm',
                disableHeavyEffects ? '' : 'backdrop-blur-md',
                langInfo.badgeClassName,
              )}
            >
              {langInfo.shortLabel}
            </Badge>
          )}
        </div>

        {isTopTenWeek && (
          <div
            className="pointer-events-none absolute right-0 top-0 z-10"
            style={{ width: TOP_TEN_CORNER_SIZE, height: TOP_TEN_CORNER_SIZE }}
          >
            <div
              className={cn(
                topTenCornerClassName,
                disableHeavyEffects ? '' : 'before:absolute before:inset-0 before:bg-[linear-gradient(225deg,rgba(255,255,255,0.18),transparent_55%)] before:opacity-80',
              )}
              style={{
                clipPath: TOP_TEN_CORNER_CLIP_PATH,
              }}
            >
              <div className={cn('absolute right-[clamp(0.3rem,2.6vw,0.58rem)] top-[clamp(0.18rem,1.6vw,0.34rem)] flex flex-col items-end', topTenCornerTextClassName)}>
                <span className={cn('text-[0.35rem] font-black uppercase tracking-[0.28em]', topTenCornerEyebrowClassName)}>
                  Top
                </span>
                <span className="mt-[-0.02rem] text-[clamp(0.98rem,7vw,1.42rem)] font-black leading-none tracking-[-0.1em]">
                  10
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-end justify-between gap-2">
          <Badge
            variant={manga.status === 'completed' ? 'default' : 'outline'}
            className={cn(
              `max-w-[60%] text-[10px] font-bold ${disableHeavyEffects ? '' : 'transition-opacity duration-300 group-hover:opacity-0'}`,
              manga.status === 'completed'
                ? 'bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 border-none'
                : `border-white/20 bg-black/60 text-white ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`
            )}
          >
            <span className="truncate">
              {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam Ediyor' : 'Ara'}
            </span>
          </Badge>

          {hasVisibleRating ? (
            <MangaRatingBadge
              value={averageRatingValue}
              className={cn(
                `text-[11px] ${disableHeavyEffects ? '' : 'transition-opacity duration-300 group-hover:opacity-0'}`
              )}
            />
          ) : null}
        </div>

        {!disableHeavyEffects && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-3 p-3 opacity-0 transition-[transform,opacity] duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <div className="flex items-center gap-3 text-xs text-white">
              <span className="flex items-center gap-1 font-medium drop-shadow-md">
                <Star className="h-3 w-3 fill-primary text-primary" />
                {averageRating} ({reviewCount})
              </span>
              <span className="flex items-center gap-1 font-medium drop-shadow-md">
                <Eye className="h-3 w-3" />
                {formatViews(manga.views)}
              </span>
              <span className="flex items-center gap-1 font-medium drop-shadow-md">
                <BookOpen className="h-3 w-3" />
                {chapterCount}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-none p-2">
        <h3 className={`h-8 line-clamp-2 text-[13px] font-bold leading-tight text-foreground transition-colors group-hover:text-primary group-focus-visible:text-primary`}>
          {manga.title}
        </h3>
        <p className="mt-1 min-h-[16px] line-clamp-1 text-[11px] text-muted-foreground">
          {cardMetaLine}
        </p>
        <div className="mt-1.5 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {genres.slice(0, 1).map((genre) => (
              <span
                key={genre}
                className="rounded-md bg-secondary/50 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
              >
                {genre}
              </span>
            ))}
          </div>

          {latestChapterLinks.length > 0 ? (
            <div className={`pointer-events-auto relative z-20 gap-1.5 ${latestChapterLinks.length === 1 ? 'flex w-full' : 'grid grid-cols-2'}`}>
              {latestChapterLinks.map((chapter) => (
                <Link
                  key={chapter.id}
                  to={`/manga/${manga.id}/chapter/${chapter.id}`}
                  className="relative z-10 flex flex-1 min-h-7 w-full items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-[10px] font-bold text-primary shadow-none transition-none hover:border-primary/45 hover:bg-primary/18 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                >
                  <span className="truncate">Bölüm {formatChapterNumberLabel(chapter.number)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Badge variant="outline" className="min-h-7 w-full justify-center rounded-lg border-primary/20 bg-primary/5 px-2 py-1.5 text-[10px] font-semibold text-primary">
              {chapterCount > 0 ? `${chapterCount} Bölüm` : 'Bölümler Yakında'}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );

  return cardContent;
};

const MangaCard = memo(MangaCardComponent);

export default MangaCard;

