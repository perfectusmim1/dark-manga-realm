import React, { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Eye, BookOpen, Clock, User } from 'lucide-react';
import { Manga } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { getTopTenMangaIds } from '@/lib/database';
import MangaRatingBadge from '@/components/manga/MangaRatingBadge';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from '@/lib/utils';
import { getOfflinePreferences } from '@/lib/offline/preferences';
import { getManagedArtworkSrcSet } from '@/lib/managedArtwork';
import { formatChapterNumberLabel } from '@/lib/chapterTitle';
import OptimizedImage from '@/components/media/OptimizedImage';
import ProxyImage from '@/components/media/ProxyImage';
import { getMangaTypeLabel, isAdultMangaType } from '@/lib/mangaType';

interface MangaCardProps {
  manga: Manga;
  index?: number;
  topTenWeekIds?: ReadonlySet<string> | null;
  hoverPreviewEnabled?: boolean;
  disableHeavyEffects?: boolean;
  coverPriority?: boolean;
  coverRootMargin?: string;
  enableEntryAnimation?: boolean;
  entryAnimationClassName?: string;
  entryAnimationDelayStepMs?: number;
  entryAnimationDurationMs?: number;
}

const MANGA_CARD_COVER_TRANSFORM = Object.freeze({
  width: 420,
  quality: 68,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const MANGA_CARD_HOVER_COVER_TRANSFORM = Object.freeze({
  width: 192,
  quality: 66,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const MANGA_CARD_HOVER_BG_TRANSFORM = Object.freeze({
  width: 320,
  quality: 52,
  format: 'webp' as const,
  fit: 'cover' as const,
});

const MANGA_CARD_INTRINSIC_WIDTH = 420;
const MANGA_CARD_INTRINSIC_HEIGHT = 630;
const MANGA_CARD_HOVER_INTRINSIC_WIDTH = 192;
const MANGA_CARD_HOVER_INTRINSIC_HEIGHT = 288;
const MANGA_CARD_HOVER_BG_INTRINSIC_WIDTH = 320;
const MANGA_CARD_HOVER_BG_INTRINSIC_HEIGHT = 480;
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
  hoverPreviewEnabled = false,
  disableHeavyEffects = false,
  coverPriority,
  coverRootMargin = '520px 0px',
  enableEntryAnimation = true,
  entryAnimationClassName = 'animate-fade-up',
  entryAnimationDelayStepMs = 50,
  entryAnimationDurationMs = 500,
}) => {
  const [isTopTenWeek, setIsTopTenWeek] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
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
  const typeBadgeLabel = showAdultLabel ? 'Yetişkin' : getMangaTypeLabel(manga.type);

  const typeBadgeClassName = cn(
    `absolute left-2 z-10 border-none text-[10px] font-bold ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`,
    'top-2',
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

  useEffect(() => {
    if ((!hoverPreviewEnabled || disableHeavyEffects) && isPreviewOpen) {
      setIsPreviewOpen(false);
    }
  }, [disableHeavyEffects, hoverPreviewEnabled, isPreviewOpen]);

  const cardContent = (
    <div
      className={`group relative block cursor-pointer overflow-hidden rounded-xl bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background [transform:translateZ(0)] ${disableHeavyEffects ? '' : 'transition-all duration-300 hover-lift'} ${disableHeavyEffects || !enableEntryAnimation ? '' : `${entryAnimationClassName} opacity-0`}`}
      style={disableHeavyEffects || !enableEntryAnimation ? undefined : {
        animationDelay: `${index * entryAnimationDelayStepMs}ms`,
        animationDuration: `${entryAnimationDurationMs}ms`,
        animationFillMode: 'forwards',
      }}
    >
      <Link
        to={`/manga/${manga.id}`}
        aria-label={`${manga.title} detay sayfasını aç`}
        className="absolute inset-0 z-[1] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <div className="pointer-events-none relative aspect-[2/3] overflow-hidden">
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
          className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-500 group-hover:scale-110'}`}
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

        <Badge
          variant="secondary"
          className={typeBadgeClassName}
        >
          {typeBadgeLabel}
        </Badge>

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
        <h3 className={`h-8 line-clamp-2 text-[13px] font-bold leading-tight text-foreground ${disableHeavyEffects ? '' : 'transition-colors group-hover:text-primary'}`}>
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
            <div className="pointer-events-auto relative z-20 grid grid-cols-2 gap-1.5">
              {latestChapterLinks.map((chapter) => (
                <Link
                  key={chapter.id}
                  to={`/manga/${manga.id}/chapter/${chapter.id}`}
                  className="relative z-10 inline-flex min-h-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-[10px] font-bold text-primary shadow-[0_8px_18px_rgba(37,99,235,0.12)] transition-all duration-200 hover:-translate-y-px hover:border-primary/45 hover:bg-primary/18 hover:shadow-[0_12px_24px_rgba(37,99,235,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.98]"
                >
                  <span className="truncate">Bölüm {formatChapterNumberLabel(chapter.number)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Badge variant="outline" className="min-h-7 w-full justify-center rounded-lg border-primary/20 bg-primary/5 px-2 py-1.5 text-[10px] font-semibold text-primary">
              {chapterCount} Bölüm
            </Badge>
          )}
        </div>
      </div>
    </div>
  );

  if (disableHeavyEffects || !hoverPreviewEnabled) {
    return cardContent;
  }

  return (
    <HoverCard open={isPreviewOpen} onOpenChange={setIsPreviewOpen} openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {cardContent}
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={15}
        className="pointer-events-none w-80 overflow-hidden border-none bg-background/95 p-0 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      >
        <div className="relative">
          <div className="absolute inset-0 -z-10 h-32 w-full overflow-hidden opacity-20">
            {isPreviewOpen ? (
              <ProxyImage
                src={manga.cover}
                alt=""
                width={MANGA_CARD_HOVER_BG_INTRINSIC_WIDTH}
                height={MANGA_CARD_HOVER_BG_INTRINSIC_HEIGHT}
                transform={MANGA_CARD_HOVER_BG_TRANSFORM}
                className="h-full w-full scale-150 object-cover blur-2xl"
                decoding="async"
                loading="lazy"
              />
            ) : (
              <div aria-hidden className="h-full w-full bg-muted/30" />
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
          </div>

          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-24 w-16 flex-shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-white/10">
                {isPreviewOpen ? (
                  <ProxyImage
                    src={manga.cover}
                    alt=""
                    width={MANGA_CARD_HOVER_INTRINSIC_WIDTH}
                    height={MANGA_CARD_HOVER_INTRINSIC_HEIGHT}
                    transform={MANGA_CARD_HOVER_COVER_TRANSFORM}
                    className="h-full w-full object-cover"
                    decoding="async"
                    loading="lazy"
                  />
                ) : (
                  <div aria-hidden className="h-full w-full bg-muted/30" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h4 className="line-clamp-2 text-sm font-bold leading-tight text-foreground">
                  {manga.title}
                </h4>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
                    <Star className="h-3 w-3 fill-current" />
                    {averageRating}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <BookOpen className="h-3 w-3" />
                    {chapterCount} Bölüm
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="h-5 bg-background/50 px-1.5 text-[9px] uppercase tracking-wider">
                    {manga.type}
                  </Badge>
                  <Badge variant="outline" className="h-5 bg-background/50 px-1.5 text-[9px]">
                    {manga.status === 'completed' ? 'Tamamlandı' : 'Devam Ediyor'}
                  </Badge>
                  {manga.isAdult ? (
                    <Badge variant="outline" className="h-5 border-rose-500/30 bg-rose-500/10 px-1.5 text-[9px] text-rose-400">
                      18+
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <p className="line-clamp-4 text-[11px] italic leading-relaxed text-muted-foreground/90">
                {manga.description || 'Bu seri için henüz bir açıklama girilmemiş.'}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {genres.slice(0, 4).map((genre) => (
                <span key={genre} className="rounded border border-primary/10 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {genre}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
                <span className="max-w-[120px] truncate text-[10px] font-medium text-muted-foreground">
                  {manga.author}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{new Date(manga.lastUpdated).toLocaleDateString('tr-TR')}</span>
              </div>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

const MangaCard = memo(MangaCardComponent);

export default MangaCard;

