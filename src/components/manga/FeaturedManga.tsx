import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Star, BookOpen, Heart } from 'lucide-react';
import { Manga } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { addFavorite, removeFavorite, isFavorite } from '@/lib/storage';
import { toast } from 'sonner';
import { getMangaTypeLabel, isAdultMangaType } from '@/lib/mangaType';
import { formatGenreDisplayName, formatMangaStatusLabel } from '@/lib/mockData';
import { useAdultImageBlurPreference } from '@/hooks/useAdultImageBlurPreference';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import OptimizedImage from '@/components/media/OptimizedImage';
import { cn } from '@/lib/utils';

interface FeaturedMangaProps {
  manga: Manga;
}

const FeaturedManga: React.FC<FeaturedMangaProps> = ({ manga }) => {
  const { user } = useAuth();
  const [favorite, setFavorite] = React.useState(false);
  const { disableHeavyEffects, prefersReducedMotion, isCoarsePointer } = useDeviceProfile();
  const blurAdultArtwork = useAdultImageBlurPreference();
  const shouldBlurAdultArtwork =
    blurAdultArtwork && (manga.isAdult === true || isAdultMangaType(manga.type));
  const reduceMotion = prefersReducedMotion || disableHeavyEffects;

  const formattedGenres = React.useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const genre of manga.genres || []) {
      const label = formatGenreDisplayName(genre).trim();
      if (!label) continue;
      const key = label.toLocaleLowerCase('tr-TR');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(label);
    }
    return result;
  }, [manga.genres]);

  const ratingLabel = React.useMemo(() => {
    if (manga.ratings && manga.ratings.length > 0) {
      return (manga.ratings.reduce((acc, curr) => acc + curr.rating, 0) / manga.ratings.length).toFixed(1);
    }
    if (typeof manga.averageRating === 'number' && manga.averageRating > 0) {
      return manga.averageRating.toFixed(1);
    }
    return '0.0';
  }, [manga.averageRating, manga.ratings]);

  const chapterCount = manga.chapterCount ?? manga.chapters?.length ?? 0;

  const authorArtistLine = React.useMemo(() => {
    const author = manga.author?.trim();
    const artist = manga.artist?.trim();
    if (author && artist && author.toLocaleLowerCase('tr-TR') !== artist.toLocaleLowerCase('tr-TR')) {
      return `${author} • ${artist}`;
    }
    return author || artist || '';
  }, [manga.author, manga.artist]);

  React.useEffect(() => {
    setFavorite(false); // Reset state immediately when user or manga changes
    const checkFavorite = async () => {
      if (user && manga.id) {
        const favorited = await isFavorite(user.id, manga.id);
        setFavorite(favorited);
      }
    };
    checkFavorite();
  }, [user, manga.id]);

  const toggleFavorite = async () => {
    if (!user) {
      toast.error('Favorilere eklemek için giriş yapmalısınız');
      return;
    }

    try {
      if (favorite) {
        await removeFavorite(user.id, manga.id);
        setFavorite(false);
        toast.success('Favorilerden kaldırıldı');
      } else {
        await addFavorite(user.id, manga.id);
        setFavorite(true);
        toast.success('Favorilere eklendi');
      }
    } catch (error) {
      toast.error('İşlem başarısız oldu');
    }
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-r from-card to-card/50',
        !prefersReducedMotion && (disableHeavyEffects ? 'animate-route-fade' : 'animate-fade-up'),
      )}
    >
      {/* Background Image */}
      <div className="pointer-events-none absolute inset-0">
        <OptimizedImage
          src={manga.banner || manga.cover}
          alt=""
          priority
          containerClassName="h-full w-full"
          placeholderClassName="rounded-none bg-transparent"
          className={cn(
            'h-full w-full object-cover opacity-20',
            shouldBlurAdultArtwork ? 'scale-[1.03] blur-[30px]' : !disableHeavyEffects ? 'blur-2xl' : 'blur-md opacity-15',
          )}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/20" />
      </div>

      <div className="relative flex flex-col gap-5 p-4 sm:p-6 md:flex-row md:items-center md:gap-6 md:p-8">
        {/* Cover */}
        <Link
          to={`/manga/${manga.id}`}
          aria-label={`${manga.title} detay sayfasını aç`}
          className="group relative shrink-0 self-center overflow-hidden rounded-xl bg-muted/30 shadow-2xl shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background md:self-auto"
        >
          <OptimizedImage
            src={manga.cover}
            alt={manga.title}
            priority
            containerClassName="h-64 w-44 md:h-80 md:w-56"
            placeholderClassName="rounded-xl"
            className={cn(
              'h-full w-full object-cover',
              shouldBlurAdultArtwork && 'scale-[1.03] blur-md',
              !reduceMotion && !isCoarsePointer && 'transition-transform duration-300 group-hover:scale-[1.03]',
            )}
          />
          {!isCoarsePointer && (
            <div
              className={cn(
                'absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                !disableHeavyEffects && 'backdrop-blur-[2px]',
                !prefersReducedMotion && 'transition-opacity duration-200',
              )}
            >
              <div
                className={cn(
                  'relative flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10 shadow-2xl',
                  !disableHeavyEffects && 'backdrop-blur-md',
                  !reduceMotion &&
                    'transition-transform duration-200 group-hover:scale-110 group-hover:bg-white/20 group-active:scale-95',
                )}
              >
                {!disableHeavyEffects && (
                  <div className="absolute inset-0 rounded-full bg-primary/20 opacity-0 blur-2xl transition-opacity group-hover:opacity-70" />
                )}
                <Play className="relative z-10 ml-1 h-8 w-8 fill-white text-white" />
              </div>
            </div>
          )}
        </Link>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="default"
              className={`border-none font-bold ${manga.type === 'manhwa' ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/20' :
                manga.type === 'manhua' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' :
                  manga.type === 'webtoon' ? 'bg-sky-600 text-white shadow-lg shadow-sky-500/20' :
                    manga.type === 'hentai' ? 'bg-pink-600 text-white shadow-lg shadow-pink-500/20' :
                      manga.type === 'webtoon_hentai' ? 'bg-rose-600 text-white shadow-lg shadow-rose-500/20' :
                    'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                }`}
            >
              {getMangaTypeLabel(manga.type)}
            </Badge>
            <Badge variant="outline" className="border-primary/50">
              {formatMangaStatusLabel(manga.status)}
            </Badge>
            <div className="flex items-center gap-1 text-sm text-primary">
              <Star className="h-4 w-4 fill-primary" />
              <span className="font-semibold">
                {ratingLabel}
              </span>
            </div>
          </div>

          <Link to={`/manga/${manga.id}`}>
            <h2 className="text-2xl font-bold tracking-tight text-foreground transition-colors hover:text-primary md:text-4xl">
              {manga.title}
            </h2>
          </Link>

          {authorArtistLine ? (
            <p className="text-sm text-muted-foreground">
              {authorArtistLine}
            </p>
          ) : null}

          <p className="line-clamp-3 text-sm leading-relaxed text-foreground/80 md:text-base">
            {manga.description}
          </p>

          {formattedGenres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {formattedGenres.map((genre) => (
                <Badge key={genre} variant="secondary" className="bg-secondary/50">
                  {genre}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            <span>{chapterCount} Bölüm</span>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild variant="glow" size="lg">
              <Link to={manga.chapters?.[0]?.id ? `/manga/${manga.id}/chapter/${manga.chapters[0].id}` : `/manga/${manga.id}`}>
                <Play className="h-4 w-4" />
                Okumaya Başla
              </Link>
            </Button>
            <Button
              variant={favorite ? 'default' : 'outline'}
              size="lg"
              onClick={toggleFavorite}
              className={favorite ? 'bg-destructive hover:bg-destructive/90' : ''}
            >
              <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
              {favorite ? 'Favorilerde' : 'Favorilere Ekle'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeaturedManga;
