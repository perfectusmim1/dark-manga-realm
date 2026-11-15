import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import OptimizedImage from '@/components/media/OptimizedImage';
import type { Manga } from '@/lib/types';
import { getMangaTypeLabel, isAdultMangaType } from '@/lib/mangaType';
import { formatGenreDisplayName } from '@/lib/mockData';
import { useAdultImageBlurPreference } from '@/hooks/useAdultImageBlurPreference';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { cn } from '@/lib/utils';

interface MangaDetailDiscoverPanelProps {
  genres: string[];
  loading: boolean;
  similarMangas: Manga[];
}

const MangaDetailDiscoverPanel = ({
  genres,
  loading,
  similarMangas,
}: MangaDetailDiscoverPanelProps) => {
  const { disableHeavyEffects, prefersReducedMotion, isCoarsePointer } = useDeviceProfile();
  const blurAdultArtwork = useAdultImageBlurPreference();
  const reduceMotion = prefersReducedMotion || disableHeavyEffects;

  const formattedGenres = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const genre of genres) {
      const formatted = formatGenreDisplayName(genre).trim();
      if (!formatted) continue;
      const key = formatted.toLocaleLowerCase('tr-TR');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(formatted);
    }
    return result;
  }, [genres]);

  const uniqueSimilarMangas = useMemo(() => {
    const seen = new Set<string>();
    return similarMangas.filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [similarMangas]);

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 sm:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-2xl font-bold">Benzer Seriler</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {formattedGenres.length > 0
              ? `${formattedGenres.slice(0, 3).join(', ')} türlerinde diğer popüler seriler`
              : 'Benzer temalara sahip diğer popüler seriler'}
          </p>
        </div>
        <Button variant="outline" asChild className="w-full shrink-0 sm:w-auto">
          <Link to="/browse">Tüm Serilere Göz At</Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className={cn(!prefersReducedMotion && 'animate-pulse')}>
              <div className="aspect-[2/3] rounded-lg bg-muted" />
              <div className="mt-2 h-4 w-3/4 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : uniqueSimilarMangas.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {uniqueSimilarMangas.map((manga, index) => {
            const shouldBlurAdult =
              blurAdultArtwork && (manga.isAdult === true || isAdultMangaType(manga.type));

            return (
              <Link
                key={manga.id}
                to={`/manga/${manga.id}`}
                className={cn(
                  'group relative block overflow-hidden rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  !prefersReducedMotion &&
                    'transition-[border-color,box-shadow] duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10',
                )}
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-card">
                  <OptimizedImage
                    src={manga.cover}
                    alt={manga.title}
                    priority={index < 2}
                    rootMargin="420px 0px"
                    containerClassName="h-full w-full"
                    placeholderClassName="rounded-none"
                    className={cn(
                      'h-full w-full object-cover',
                      shouldBlurAdult && 'scale-[1.03] blur-md',
                      !reduceMotion && !isCoarsePointer && 'transition-transform duration-300 group-hover:scale-105',
                    )}
                  />
                  <div
                    className={cn(
                      'absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0',
                      !prefersReducedMotion && 'transition-opacity duration-200',
                      !isCoarsePointer && 'group-hover:opacity-100 group-focus-visible:opacity-100',
                    )}
                  />
                </div>
                {!isCoarsePointer && (
                  <div
                    className={cn(
                      'absolute bottom-0 left-0 right-0 translate-y-full p-3 group-hover:translate-y-0 group-focus-visible:translate-y-0',
                      !prefersReducedMotion && 'transition-transform duration-200',
                    )}
                  >
                    <h4 className="line-clamp-2 text-sm font-semibold text-white">{manga.title}</h4>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {getMangaTypeLabel(manga.type)}
                      </Badge>
                      {typeof manga.averageRating === 'number' && manga.averageRating > 0 ? (
                        <span className="flex items-center gap-0.5 text-xs text-yellow-400">
                          <Star className="h-3 w-3 fill-current" />
                          {manga.averageRating}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
                <div
                  className={cn(
                    'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2',
                    !prefersReducedMotion && 'transition-opacity duration-200',
                    !isCoarsePointer && 'group-hover:opacity-0 group-focus-visible:opacity-0',
                  )}
                >
                  <h4 className="line-clamp-2 text-xs font-medium text-white">{manga.title}</h4>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-secondary/10 py-16 text-center">
          <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-20" />
          <p className="text-muted-foreground">Benzer seri bulunamadı.</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Daha fazla içerik eklendiğinde öneriler burada görünecek.
          </p>
        </div>
      )}
    </div>
  );
};

export default MangaDetailDiscoverPanel;
