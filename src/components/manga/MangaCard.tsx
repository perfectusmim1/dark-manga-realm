import React, { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Eye, BookOpen } from 'lucide-react';
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

export interface MangaCardProps {
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

export const MANGA_CARD_SIZES = '(max-width: 389px) 46vw, (max-width: 639px) 31vw, (max-width: 767px) 23vw, (max-width: 1023px) 19vw, (max-width: 1279px) 15vw, 13.5vw';

const TOP_TEN_CORNER_CLIP_PATH = 'polygon(100% 0, 100% 100%, 0 0)';
const TOP_TEN_CORNER_SIZE = 'clamp(2.35rem, 24%, 3.35rem)';

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
    `border-none px-1.5 py-0.5 text-[9px] font-bold tracking-wide shadow-sm ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`,
    showAdultLabel ? 'bg-rose-600/90 text-white' :
    manga.type === 'manhwa' ? 'bg-orange-600/90 text-white' :
        manga.type === 'manhua' ? 'bg-emerald-600/90 text-white' :
          manga.type === 'webtoon' ? 'bg-sky-600/90 text-white' :
          'bg-primary text-primary-foreground'
  );
  const topTenCornerClassName = manga.isAdult
    ? 'absolute inset-0 overflow-hidden border-l border-b border-rose-100/18 bg-[linear-gradient(220deg,rgba(255,228,236,0.98)_0%,rgba(251,113,133,0.96)_44%,rgba(225,29,72,0.95)_72%,rgba(136,19,55,0.94)_100%)] shadow-sm'
    : 'absolute inset-0 overflow-hidden border-l border-b border-sky-100/20 bg-[linear-gradient(220deg,rgba(239,246,255,0.98)_0%,rgba(125,211,252,0.96)_42%,rgba(59,130,246,0.95)_72%,rgba(29,78,216,0.94)_100%)] shadow-sm';
  const topTenCornerTextClassName = manga.isAdult ? 'text-white' : 'text-slate-950';
  const topTenCornerEyebrowClassName = manga.isAdult ? 'text-white/72' : 'text-slate-900/62';

  useEffect(() => {
    let isActive = true;

    if (topTenWeekIds !== undefined) {
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

  const effectiveIsTopTenWeek = topTenWeekIds !== undefined
    ? Boolean(topTenWeekIds?.has(manga.id))
    : isTopTenWeek;

  const cardContent = (
    <div
      className={`group relative block cursor-pointer overflow-hidden rounded-xl border border-border/60 bg-card/85 hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${disableHeavyEffects ? '' : 'transition-colors duration-150'} ${disableHeavyEffects || !enableEntryAnimation ? '' : entryAnimationClassName}`}
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
          )}
        />

        <div className="absolute inset-0 bg-black/15" />

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(6,8,14,0.52)_0%,rgba(6,8,14,0.22)_55%,rgba(6,8,14,0)_100%)] sm:h-24"
        />

        <div
          className={cn(
            'absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background/95 via-background/45 to-transparent',
            disableHeavyEffects ? '' : 'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
          )}
        />

        <div className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1">
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
                'border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider shadow-sm',
                disableHeavyEffects ? '' : 'backdrop-blur-md',
                langInfo.badgeClassName,
              )}
            >
              {langInfo.shortLabel}
            </Badge>
          )}
        </div>

        {effectiveIsTopTenWeek && (
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
              <div className={cn('absolute right-[clamp(0.22rem,1.8vw,0.42rem)] top-[clamp(0.14rem,1.2vw,0.26rem)] flex flex-col items-end', topTenCornerTextClassName)}>
                <span className={cn('text-[0.3rem] font-black uppercase tracking-[0.22em]', topTenCornerEyebrowClassName)}>
                  Top
                </span>
                <span className="mt-[-0.02rem] text-[clamp(0.76rem,4.6vw,1.08rem)] font-black leading-none tracking-[-0.08em]">
                  10
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-10 flex items-end justify-between gap-1">
          <Badge
            variant={manga.status === 'completed' ? 'default' : 'outline'}
            className={cn(
              `max-w-[58%] px-1.5 py-0.5 text-[9px] font-bold shadow-sm ${disableHeavyEffects ? '' : 'transition-opacity duration-200 group-hover:opacity-0'}`,
              manga.status === 'completed'
                ? 'border-none bg-primary/90 text-primary-foreground'
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
              iconClassName="h-2.5 w-2.5"
              className={cn(
                `gap-1 rounded-md px-1.5 py-0.5 text-[10px] ${disableHeavyEffects ? '' : 'transition-opacity duration-200 group-hover:opacity-0'}`
              )}
            />
          ) : null}
        </div>

        {!disableHeavyEffects && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-2 p-2 opacity-0 transition-[transform,opacity] duration-150 group-hover:translate-y-0 group-hover:opacity-100 sm:p-2.5">
            <div className="flex items-center gap-2 text-[11px] text-white">
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

      <div className="pointer-events-none p-2 sm:p-2.5">
        <h3 className="min-h-[1.15rem] line-clamp-1 text-xs font-semibold leading-snug text-foreground transition-colors group-hover:text-primary group-focus-visible:text-primary sm:text-[13px]">
          {manga.title}
        </h3>
        <p className="mt-0.5 min-h-[14px] line-clamp-1 text-[10px] text-muted-foreground sm:text-[11px]">
          {cardMetaLine}
        </p>

        {genres.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {genres.slice(0, 1).map((genre) => (
              <span
                key={genre}
                className="max-w-full truncate rounded bg-secondary/50 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1.5 space-y-1">
          {latestChapterLinks.length > 0 ? (
            <div className="pointer-events-auto relative z-20 space-y-1">
              {latestChapterLinks.map((chapter) => (
                <Link
                  key={chapter.id}
                  to={`/manga/${manga.id}/chapter/${chapter.id}`}
                  className="relative z-10 flex min-h-6 w-full items-center justify-center rounded-md bg-secondary/45 px-1.5 py-0.5 text-[10px] font-medium text-foreground/90 transition-colors hover:bg-primary/[0.12] hover:text-primary focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:text-[11px]"
                >
                  <span className="truncate">Bölüm {formatChapterNumberLabel(chapter.number)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex min-h-6 w-full items-center justify-center rounded-md border border-border/50 bg-secondary/35 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
              {chapterCount > 0 ? `${chapterCount} Bölüm` : 'Bölümler Yakında'}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return cardContent;
};

const MangaCard = memo(MangaCardComponent);

export default MangaCard;

