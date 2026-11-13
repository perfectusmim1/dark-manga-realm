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
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-card to-card/50">
      {/* Background Image */}
      <div className="absolute inset-0">
        <img
          src={manga.banner || manga.cover}
          alt=""
          className={`h-full w-full object-cover opacity-20 blur-2xl ${shouldBlurAdultArtwork ? 'scale-[1.03] blur-[30px]' : ''}`}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
      </div>

      <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:p-8">
        {/* Cover */}
        <Link
          to={`/manga/${manga.id}`}
          className="group relative shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-primary/10 "
        >
          <img
            src={manga.cover}
            alt={manga.title}
            className={`h-64 w-44 object-cover md:h-80 md:w-56 ${shouldBlurAdultArtwork ? 'scale-[1.03] blur-md' : ''}`}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-all duration-300 group-hover:opacity-100 backdrop-blur-[2px]">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/10 border border-white/20 backdrop-blur-md shadow-2xl transition-all duration-300 group-hover:scale-110 group-hover:bg-white/20 group-active:scale-95">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl opacity-0 group-hover:opacity-70 transition-opacity" />
              <Play className="h-8 w-8 text-white fill-white ml-1 relative z-10" />
            </div>
          </div>
        </Link>

        {/* Info */}
        <div className="flex flex-1 flex-col gap-4">
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
              {manga.status === 'completed' ? 'Tamamlandı' : 'Devam Ediyor'}
            </Badge>
            <div className="flex items-center gap-1 text-sm text-primary">
              <Star className="h-4 w-4 fill-primary" />
              <span className="font-semibold">
                {manga.ratings && manga.ratings.length > 0
                  ? (manga.ratings.reduce((acc, curr) => acc + curr.rating, 0) / manga.ratings.length).toFixed(1)
                  : '0.0'}
              </span>
            </div>
          </div>

          <Link to={`/manga/${manga.id}`}>
            <h2 className="text-2xl font-bold tracking-tight text-foreground transition-colors hover:text-primary md:text-4xl">
              {manga.title}
            </h2>
          </Link>

          <p className="text-sm text-muted-foreground">
            {manga.author} {manga.artist && `• ${manga.artist}`}
          </p>

          <p className="line-clamp-3 text-sm leading-relaxed text-foreground/80 md:text-base">
            {manga.description}
          </p>

          <div className="flex flex-wrap gap-2">
            {manga.genres.map((genre) => (
              <Badge key={genre} variant="secondary" className="bg-secondary/50">
                {genre}
              </Badge>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            <span>{manga.chapters.length} Bölüm</span>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild variant="glow" size="lg">
              <Link to={manga.chapters[0]?.id ? `/manga/${manga.id}/chapter/${manga.chapters[0].id}` : `/manga/${manga.id}`}>
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
