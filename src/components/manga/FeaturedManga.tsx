import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Star, BookOpen, Heart } from 'lucide-react';
import { Manga } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { addFavorite, removeFavorite, isFavorite } from '@/lib/storage';
import { toast } from 'sonner';
import { getMangaTypeLabel } from '@/lib/mangaType';
import { useAdultImageBlurPreference } from '@/hooks/useAdultImageBlurPreference';

interface FeaturedMangaProps {
  manga: Manga;
}

const FeaturedManga: React.FC<FeaturedMangaProps> = ({ manga }) => {
  const { user } = useAuth();
  const [favorite, setFavorite] = React.useState(false);
  const blurAdultArtwork = useAdultImageBlurPreference();
  const shouldBlurAdultArtwork = blurAdultArtwork && manga.isAdult === true;

  React.useEffect(() => {
    setFavorite(false);
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
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-r from-card to-card/50">
      <div className="absolute inset-0">
        <img
          src={manga.banner || manga.cover}
          alt=""
          className={`h-full w-full object-cover opacity-20 blur-2xl ${shouldBlurAdultArtwork ? 'scale-[1.03] blur-[30px]' : ''}`}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent" />
      </div>

      <div className="relative flex flex-col gap-5 p-4 md:flex-row md:items-center md:p-6">
        <Link
          to={`/manga/${manga.id}`}
          className="group relative shrink-0 overflow-hidden rounded-lg shadow-xl shadow-primary/10"
        >
          <img
            src={manga.cover}
            alt={manga.title}
            className={`h-52 w-36 object-cover md:h-64 md:w-44 ${shouldBlurAdultArtwork ? 'scale-[1.03] blur-md' : ''}`}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-all duration-200 group-hover:opacity-100 backdrop-blur-[2px]">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/15 border border-white/25 backdrop-blur-md shadow-xl transition-transform duration-200 group-hover:scale-105">
              <Play className="h-6 w-6 text-white fill-white ml-0.5 relative z-10" />
            </div>
          </div>
        </Link>

        <div className="flex flex-1 flex-col gap-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="default"
              className={`border-none font-bold text-xs ${manga.type === 'manhwa' ? 'bg-orange-600 text-white' :
                manga.type === 'manhua' ? 'bg-emerald-600 text-white' :
                  manga.type === 'webtoon' ? 'bg-sky-600 text-white' :
                    manga.type === 'hentai' ? 'bg-pink-600 text-white' :
                      manga.type === 'webtoon_hentai' ? 'bg-rose-600 text-white' :
                    'bg-primary text-primary-foreground'
                }`}
            >
              {getMangaTypeLabel(manga.type)}
            </Badge>
            <Badge variant="outline" className="border-primary/40 text-xs">
              {manga.status === 'completed' ? 'Tamamlandı' : 'Devam Ediyor'}
            </Badge>
            <div className="flex items-center gap-1 text-xs text-primary">
              <Star className="h-3.5 w-3.5 fill-primary" />
              <span className="font-semibold">
                {manga.ratings && manga.ratings.length > 0
                  ? (manga.ratings.reduce((acc, curr) => acc + curr.rating, 0) / manga.ratings.length).toFixed(1)
                  : '0.0'}
              </span>
            </div>
          </div>

          <Link to={`/manga/${manga.id}`}>
            <h2 className="text-xl font-bold tracking-tight text-foreground transition-colors hover:text-primary md:text-2xl line-clamp-1">
              {manga.title}
            </h2>
          </Link>

          <p className="text-xs text-muted-foreground">
            {manga.author} {manga.artist && `• ${manga.artist}`}
          </p>

          <p className="line-clamp-2 text-xs leading-relaxed text-foreground/80 md:text-sm">
            {manga.description}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {manga.genres.slice(0, 5).map((genre) => (
              <Badge key={genre} variant="secondary" className="bg-secondary/50 text-[11px]">
                {genre}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button asChild variant="glow" size="sm" className="h-9 px-4">
              <Link to={manga.chapters[0]?.id ? `/manga/${manga.id}/chapter/${manga.chapters[0].id}` : `/manga/${manga.id}`}>
                <Play className="h-3.5 w-3.5" />
                Okumaya Başla
              </Link>
            </Button>
            <Button
              variant={favorite ? 'default' : 'outline'}
              size="sm"
              onClick={toggleFavorite}
              className={`h-9 px-4 ${favorite ? 'bg-destructive hover:bg-destructive/90' : ''}`}
            >
              <Heart className={`h-3.5 w-3.5 ${favorite ? 'fill-current' : ''}`} />
              {favorite ? 'Favorilerde' : 'Favorilere Ekle'}
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
              <BookOpen className="h-3.5 w-3.5" />
              {manga.chapters.length} Bölüm
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeaturedManga;
