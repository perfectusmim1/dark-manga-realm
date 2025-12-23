import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Star, BookOpen, Heart } from 'lucide-react';
import { Manga } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { addFavorite, removeFavorite, isFavorite } from '@/lib/storage';
import { toast } from 'sonner';

interface FeaturedMangaProps {
  manga: Manga;
}

const FeaturedManga: React.FC<FeaturedMangaProps> = ({ manga }) => {
  const { user } = useAuth();
  const [favorite, setFavorite] = React.useState(isFavorite(manga.id));

  const toggleFavorite = () => {
    if (!user) {
      toast.error('Favorilere eklemek için giriş yapmalısınız');
      return;
    }

    if (favorite) {
      removeFavorite(manga.id);
      setFavorite(false);
      toast.success('Favorilerden kaldırıldı');
    } else {
      addFavorite(manga.id);
      setFavorite(true);
      toast.success('Favorilere eklendi');
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-card to-card/50">
      {/* Background Image */}
      <div className="absolute inset-0">
        <img
          src={manga.cover}
          alt=""
          className="h-full w-full object-cover opacity-20 blur-2xl"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
      </div>

      <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:p-8">
        {/* Cover */}
        <Link
          to={`/manga/${manga.id}`}
          className="group relative shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-primary/10 transition-transform duration-300 hover:scale-[1.02]"
        >
          <img
            src={manga.cover}
            alt={manga.title}
            className="h-64 w-44 object-cover md:h-80 md:w-56"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <Play className="h-12 w-12 fill-primary text-primary" />
          </div>
        </Link>

        {/* Info */}
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default" className="bg-primary text-primary-foreground">
              {manga.type.toUpperCase()}
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
              <Link to={`/manga/${manga.id}/chapter/${manga.chapters[0]?.id}`}>
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
