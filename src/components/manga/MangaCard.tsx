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

interface MangaCardProps {
  manga: Manga;
  index?: number;
}

let topTenWeekIdsCache: Set<string> | null = null;
let topTenWeekIdsPromise: Promise<Set<string>> | null = null;

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

const MangaCardComponent: React.FC<MangaCardProps> = ({ manga, index = 0 }) => {
  const [isTopTenWeek, setIsTopTenWeek] = useState(false);
  const ratings = manga.ratings || [];
  const genres = manga.genres || [];
  const chapters = manga.chapters || [];
  const chapterCount = chapters.length;

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
    return views.toString();
  };

  const averageRating = ratings.length > 0
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

    getTopTenWeekIds().then((ids) => {
      if (isActive) {
        setIsTopTenWeek(ids.has(manga.id));
      }
    });

    return () => {
      isActive = false;
    };
  }, [manga.id]);

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Link
          to={`/manga/${manga.id}`}
          className={`group relative block overflow-hidden rounded-xl bg-card transition-all duration-300 hover-lift animate-fade-up opacity-0`}
          style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'forwards' }}
        >
          {/* Cover Image */}
          <div className="relative aspect-[2/3] overflow-hidden">
            <img
              src={manga.cover}
              alt={manga.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
            />

            <div className="absolute inset-0 bg-black/20" style={{ opacity: 0.9 }} />

            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

            {/* Type Badge */}
            <Badge
              variant="secondary"
              className={cn(
                "absolute left-2 top-2 border-none text-[10px] font-bold backdrop-blur-md",
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
                <Badge className="border-none bg-red-500/90 text-white text-[10px] font-bold shadow-lg shadow-red-500/25 backdrop-blur-md">
                  Top 10
                </Badge>
              )}
              {isNewRelease && (
                <Badge className="border-none bg-emerald-500/90 text-white text-[10px] font-bold shadow-lg shadow-emerald-500/25 backdrop-blur-md">
                  Yeni
                </Badge>
              )}
            </div>

            {/* Status Badge */}
            <Badge
              variant={manga.status === 'completed' ? 'default' : 'outline'}
              className={cn(
                "absolute right-2 bottom-2 text-[10px] font-bold z-10 transition-opacity duration-300 group-hover:opacity-0",
                manga.status === 'completed'
                  ? 'bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 border-none'
                  : 'border-white/20 bg-black/60 text-white backdrop-blur-md'
              )}
            >
              {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam Ediyor' : 'Ara'}
            </Badge>

            {/* Hover Info (Compact) */}
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
          </div>

          {/* Info */}
          <div className="p-2">
            <h3 className="line-clamp-2 text-[13px] font-bold leading-tight text-foreground transition-colors group-hover:text-primary h-8">
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
              <Badge variant="outline" className="h-4 px-1 text-[9px] border-primary/20 bg-primary/5 text-primary">
                {chapterCount} Bölüm
              </Badge>
            </div>
          </div>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={15}
        className="w-80 overflow-hidden border-none bg-background/95 p-0 backdrop-blur-xl shadow-2xl ring-1 ring-white/10 pointer-events-none"
      >
        <div className="relative">
          {/* Background Blur Image */}
          <div className="absolute inset-0 -z-10 h-32 w-full overflow-hidden opacity-20">
            <img src={manga.cover} className="h-full w-full object-cover blur-2xl scale-150" alt="" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
          </div>

          <div className="p-5">
            <div className="flex items-start gap-4">
              {/* Small Cover */}
              <div className="h-24 w-16 flex-shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-white/10">
                <img src={manga.cover} className="h-full w-full object-cover" alt="" />
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold leading-tight text-foreground line-clamp-2">
                  {manga.title}
                </h4>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1 text-[11px] text-primary font-semibold">
                    <Star className="h-3 w-3 fill-current" />
                    {averageRating}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <BookOpen className="h-3 w-3" />
                    {chapterCount} Bölüm
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="h-5 px-1.5 text-[9px] uppercase tracking-wider bg-background/50">
                    {manga.type}
                  </Badge>
                  <Badge variant="outline" className="h-5 px-1.5 text-[9px] bg-background/50">
                    {manga.status === 'completed' ? 'Tamamlandı' : 'Devam Ediyor'}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[11px] leading-relaxed text-muted-foreground/90 line-clamp-4 italic">
                {manga.description || 'Bu seri için henüz bir açıklama girilmemiş.'}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {genres.slice(0, 4).map((genre) => (
                <span key={genre} className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium border border-primary/10">
                  {genre}
                </span>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
                <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[120px]">
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

