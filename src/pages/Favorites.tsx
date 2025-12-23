import React from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import Header from '@/components/layout/Header';
import MangaGrid from '@/components/manga/MangaGrid';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getFavorites } from '@/lib/storage';
import { getMangaById } from '@/lib/database';
import { Manga } from '@/lib/types';
import { toast } from 'sonner';

const Favorites: React.FC = () => {
  const { user } = useAuth();
  const [favoriteManga, setFavoriteManga] = React.useState<Manga[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const loadFavorites = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const favorites = await getFavorites(user.id);
        const mangaPromises = favorites.map(f => getMangaById(f.mangaId));
        const mangas = await Promise.all(mangaPromises);
        setFavoriteManga(mangas.filter(Boolean) as Manga[]);
      } catch (err) {
        console.error('Favorites load error:', err);
        toast.error('Favoriler yüklenemedi');
      } finally {
        setIsLoading(false);
      }
    };

    loadFavorites();
  }, [user]);

  if (isLoading && user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container flex min-h-[60vh] items-center justify-center pt-20">
          <div className="text-center">
            <Heart className="mx-auto h-16 w-16 text-muted-foreground" />
            <h1 className="mt-4 text-2xl font-bold">Favorilerinizi Görüntüleyin</h1>
            <p className="mt-2 text-muted-foreground">
              Favorilerinizi görmek için giriş yapmalısınız
            </p>
            <Button asChild className="mt-4" variant="glow">
              <Link to="/auth">Giriş Yap</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
          <h1 className="text-3xl font-bold tracking-tight">Favorilerim</h1>
          <p className="mt-2 text-muted-foreground">
            {favoriteManga.length} manga favorilerinizde
          </p>
        </div>

        {favoriteManga.length > 0 ? (
          <MangaGrid manga={favoriteManga} />
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="text-center">
              <Heart className="mx-auto h-16 w-16 text-muted-foreground" />
              <h2 className="mt-4 text-xl font-semibold">Henüz favoriniz yok</h2>
              <p className="mt-2 text-muted-foreground">
                Beğendiğiniz mangaları favorilerinize ekleyin
              </p>
              <Button asChild className="mt-4">
                <Link to="/browse">Keşfet</Link>
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Favorites;
