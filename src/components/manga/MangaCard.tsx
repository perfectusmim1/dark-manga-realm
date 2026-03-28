import React, { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Eye, BookOpen, Clock, User, Sparkles } from 'lucide-react';
import { Manga } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { getTopTenMangas } from '@/lib/database';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from '@/lib/utils';
import { getOfflinePreferences } from '@/lib/offline/preferences';
import { getManagedArtworkSrcSet } from '@/lib/managedArtwork';
import OptimizedImage from '@/components/media/OptimizedImage';
import ProxyImage from '@/components/media/ProxyImage';

interface MangaCardProps {
  manga: Manga;
  index?: number;
  topTenWeekIds?: ReadonlySet<string> | null;
  disableHeavyEffects?: boolean;
  coverPriority?: boolean;
}

let topTenWeekIdsCache: Set<string> | null = null;
let topTenWeekIdsPromise: Promise<Set<string>> | null = null;

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

const HIGHLIGHT_BADGE_BASE =
  'relative h-auto overflow-hidden border px-2.5 pb-[0.28rem] pt-[0.34rem] text-[8px] font-black uppercase leading-none tracking-[0.18em] shadow-[0_10px_26px_rgba(0,0,0,0.22)]';

const getTopTenWeekIds = async () => {
  if (topTenWeekIdsCache) return topTenWeekIdsCache;

  if (!topTenWeekIdsPromise) {
    topTenWeekIdsPromise = getTopTenMangas('week')
      .then((mangas) => {
        const ids = new Set(mangas.map((item) => item.id));
        topTenWeekIdsCache = ids;
        return ids;
      })
      .catch(() => new Set<string>());
  }

  return topTenWeekIdsPromise;
};

const MangaCardComponent: React.FC<MangaCardProps> = ({
  manga,
  index = 0,
  topTenWeekIds,
  disableHeavyEffects = false,
  coverPriority,
}) => {
  const [isTopTenWeek, setIsTopTenWeek] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const ratings = manga.ratings || [];
  const genres = manga.genres || [];
  const chapters = manga.chapters || [];
  const chapterCount = typeof manga.chapterCount === 'number' ? manga.chapterCount : chapters.length;
  const coverSrcSet = useMemo(() => getManagedArtworkSrcSet(manga.cover), [manga.cover]);

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
    return views.toString();
  };

  const averageRating = typeof manga.averageRating === 'number'
    ? manga.averageRating.toFixed(1)
    : ratings.length > 0
      ? (ratings.reduce((acc, curr) => acc + curr.rating, 0) / ratings.length).toFixed(1)
      : '0.0';

  const isNewRelease = useMemo(() => {
    if (!manga.createdAt) return false;

    const createdTime = new Date(manga.createdAt).getTime();
    if (Number.isNaN(createdTime)) return false;

    const ageMs = Date.now() - createdTime;
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    return ageMs >= 0 && ageMs < oneWeekMs;
  }, [manga.createdAt]);

  const typeBadgeClassName = cn(
    `absolute left-2 top-2 border-none text-[10px] font-bold ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`,
    manga.type === 'manhwa' ? 'bg-orange-600/90 text-white shadow-lg shadow-orange-500/20' :
      manga.type === 'manhua' ? 'bg-emerald-600/90 text-white shadow-lg shadow-emerald-500/20' :
        manga.type === 'webtoon' ? 'bg-sky-600/90 text-white shadow-lg shadow-sky-500/20' :
          'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
  );

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
    <Link
      to={`/manga/${manga.id}`}
      className={`group relative block overflow-hidden rounded-xl bg-card ${disableHeavyEffects ? '' : 'transition-all duration-300 hover-lift animate-fade-up opacity-0'}`}
      style={disableHeavyEffects ? undefined : { animationDelay: `${index * 0.05}s`, animationFillMode: 'forwards' }}
    >
      <div className="relative aspect-[2/3] overflow-hidden">
        <OptimizedImage
          src={manga.cover}
          alt={manga.title}
          width={MANGA_CARD_INTRINSIC_WIDTH}
          height={MANGA_CARD_INTRINSIC_HEIGHT}
          srcSet={coverSrcSet}
          sizes={MANGA_CARD_SIZES}
          priority={coverPriority ?? index < 6}
          rootMargin="520px 0px"
          transform={MANGA_CARD_COVER_TRANSFORM}
          containerClassName="h-full w-full"
          placeholderClassName="rounded-none"
          className={`h-full w-full object-cover ${disableHeavyEffects ? '' : 'transition-transform duration-500 group-hover:scale-110'}`}
        />

        <div className="absolute inset-0 bg-black/20" style={{ opacity: 0.9 }} />

        <div className={`absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent ${disableHeavyEffects ? '' : 'opacity-0 transition-opacity duration-300 group-hover:opacity-100'}`} />

        <Badge
          variant="secondary"
          className={typeBadgeClassName}
        >
          {manga.type.toUpperCase()}
        </Badge>

        <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
          {isTopTenWeek && (
            <Badge
              className={cn(
                HIGHLIGHT_BADGE_BASE,
                'border-amber-200/55 bg-[linear-gradient(135deg,rgba(252,211,77,0.96),rgba(251,191,36,0.96),rgba(249,115,22,0.92))] text-slate-950',
                disableHeavyEffects
                  ? 'shadow-[0_10px_24px_rgba(251,191,36,0.26)]'
                  : 'shadow-[0_10px_28px_rgba(251,191,36,0.3)] backdrop-blur-md before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_left,rgba(255,255,255,0.46),transparent_52%)] before:opacity-90',
              )}
            >
              <span className="relative z-10 block">
                Top 10
              </span>
            </Badge>
          )}
          {isNewRelease && (
            <Badge
              className={cn(
                HIGHLIGHT_BADGE_BASE,
                'pr-[1.15rem]',
                'border-cyan-200/45 bg-[linear-gradient(135deg,rgba(103,232,249,0.94),rgba(34,211,238,0.94),rgba(52,211,153,0.9))] text-slate-950',
                disableHeavyEffects
                  ? 'shadow-[0_10px_24px_rgba(34,211,238,0.22)]'
                  : 'shadow-[0_10px_28px_rgba(34,211,238,0.26)] backdrop-blur-md before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_left,rgba(255,255,255,0.42),transparent_54%)] before:opacity-90',
              )}
            >
              <span className="pointer-events-none absolute right-[0.22rem] top-[0.16rem] z-10">
                <Sparkles className="h-[0.55rem] w-[0.55rem]" />
              </span>
              <span className="relative z-10 block">
                Yeni
              </span>
            </Badge>
          )}
        </div>

        <Badge
          variant={manga.status === 'completed' ? 'default' : 'outline'}
          className={cn(
            `absolute right-2 bottom-2 text-[10px] font-bold z-10 ${disableHeavyEffects ? '' : 'transition-opacity duration-300 group-hover:opacity-0'}`,
            manga.status === 'completed'
              ? 'bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 border-none'
              : `border-white/20 bg-black/60 text-white ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`
          )}
        >
          {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam Ediyor' : 'Ara'}
        </Badge>

        {!disableHeavyEffects && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-full p-3 transition-transform duration-300 group-hover:translate-y-0">
            <div className="flex items-center gap-3 text-xs text-white">
              <span className="flex items-center gap-1 font-medium drop-shadow-md">
                <Star className="h-3 w-3 fill-primary text-primary" />
                {averageRating}
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

      <div className="p-2">
        <h3 className={`h-8 line-clamp-2 text-[13px] font-bold leading-tight text-foreground ${disableHeavyEffects ? '' : 'transition-colors group-hover:text-primary'}`}>
          {manga.title}
        </h3>
        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
          {manga.author}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {genres.slice(0, 1).map((genre) => (
            <span
              key={genre}
              className="rounded-md bg-secondary/50 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
            >
              {genre}
            </span>
          ))}
          <Badge variant="outline" className="h-4 border-primary/20 bg-primary/5 px-1 text-[9px] text-primary">
            {chapterCount} Bölüm
          </Badge>
        </div>
      </div>
    </Link>
  );

  if (disableHeavyEffects) {
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

