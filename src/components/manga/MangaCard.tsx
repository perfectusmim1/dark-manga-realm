import React, { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Eye, BookOpen, Clock, User } from 'lucide-react';
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
import OptimizedImage from '@/components/media/OptimizedImage';
import ProxyImage from '@/components/media/ProxyImage';

interface MangaCardProps {
  manga: Manga;
  index?: number;
  topTenWeekIds?: ReadonlySet<string>;
  disableHeavyEffects?: boolean;
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
}) => {
  const [isTopTenWeek, setIsTopTenWeek] = useState(false);
  const ratings = manga.ratings || [];
  const genres = manga.genres || [];
  const chapters = manga.chapters || [];
  const chapterCount = typeof manga.chapterCount === 'number' ? manga.chapterCount : chapters.length;

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

  useEffect(() => {
    let isActive = true;

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
          priority={index < 6}
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
          className={cn(
            `absolute left-2 top-2 border-none text-[10px] font-bold ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`,
            manga.type === 'manhwa' ? 'bg-purple-600/90 text-white shadow-lg shadow-purple-500/20' :
              manga.type === 'manhua' ? 'bg-emerald-600/90 text-white shadow-lg shadow-emerald-500/20' :
                manga.type === 'webtoon' ? 'bg-sky-600/90 text-white shadow-lg shadow-sky-500/20' :
                  'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
          )}
        >
          {manga.type.toUpperCase()}
        </Badge>

        <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
          {isTopTenWeek && (
            <Badge className={`border-none bg-red-500/90 text-white text-[10px] font-bold shadow-lg shadow-red-500/25 ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`}>
              Top 10
            </Badge>
          )}
          {isNewRelease && (
            <Badge className={`border-none bg-emerald-500/90 text-white text-[10px] font-bold shadow-lg shadow-emerald-500/25 ${disableHeavyEffects ? '' : 'backdrop-blur-md'}`}>
              Yeni
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
    <HoverCard openDelay={200} closeDelay={100}>
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
            <ProxyImage
              src={manga.cover}
              alt=""
              transform={MANGA_CARD_HOVER_BG_TRANSFORM}
              className="h-full w-full scale-150 object-cover blur-2xl"
              decoding="async"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
          </div>

          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-24 w-16 flex-shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-white/10">
                <ProxyImage
                  src={manga.cover}
                  alt=""
                  transform={MANGA_CARD_HOVER_COVER_TRANSFORM}
                  className="h-full w-full object-cover"
                  decoding="async"
                  loading="lazy"
                />
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

