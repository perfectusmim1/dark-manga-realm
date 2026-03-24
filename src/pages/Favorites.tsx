import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, List } from 'lucide-react';
import Header from '@/components/layout/Header';
import MangaGrid from '@/components/manga/MangaGrid';
import ReadingListCover from '@/components/manga/ReadingListCover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { getFavorites } from '@/lib/storage';
import { getLikedReadingLists, getMangaById, LikedReadingListPreview } from '@/lib/database';
import { Manga } from '@/lib/types';
import { toast } from 'sonner';
import GridSkeleton from '@/components/skeletons/GridSkeleton';

const Favorites: React.FC = () => {
  const { user } = useAuth();
  const [favoriteManga, setFavoriteManga] = React.useState<Manga[]>([]);
  const [favoriteLists, setFavoriteLists] = React.useState<LikedReadingListPreview[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const loadFavorites = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const [favorites, likedLists] = await Promise.all([
          getFavorites(user.id),
          getLikedReadingLists(user.id),
        ]);
        const mangaPromises = favorites.map(f => getMangaById(f.mangaId));
        const mangas = await Promise.all(mangaPromises);
        setFavoriteManga(mangas.filter(Boolean) as Manga[]);
        setFavoriteLists(likedLists);
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
      <>
        <Header />
        <GridSkeleton />
      </>
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
            {favoriteManga.length} manga ve {favoriteLists.length} beğenilen okuma listesi
          </p>
        </div>

        <Tabs defaultValue="manga" className="space-y-6">
          <TabsList className="h-auto flex-wrap gap-2 rounded-2xl bg-secondary/40 p-1">
            <TabsTrigger value="manga" className="gap-2">
              <Heart className="h-4 w-4" />
              Favori Mangalar
            </TabsTrigger>
            <TabsTrigger value="lists" className="gap-2">
              <List className="h-4 w-4" />
              Beğenilen Okuma Listeleri
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manga" className="mt-0">
            {favoriteManga.length > 0 ? (
              <MangaGrid manga={favoriteManga} />
            ) : (
              <div className="flex min-h-[40vh] items-center justify-center">
                <div className="text-center">
                  <Heart className="mx-auto h-16 w-16 text-muted-foreground" />
                  <h2 className="mt-4 text-xl font-semibold">Henüz favori mangan yok</h2>
                  <p className="mt-2 text-muted-foreground">
                    Beğendiğin mangaları favorilerine ekleyebilirsin.
                  </p>
                  <Button asChild className="mt-4">
                    <Link to="/browse">Keşfet</Link>
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="lists" className="mt-0">
            {favoriteLists.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {favoriteLists.map((list, index) => (
                  <Link
                    key={list.id}
                    to={`/reading-lists/${list.id}`}
                    className="group animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/50 opacity-0 transition-all hover:border-primary/40 hover:bg-card"
                    style={{ animationDelay: `${0.08 + Math.min(index, 10) * 0.03}s`, animationFillMode: 'forwards' }}
                  >
                    <ReadingListCover
                      imageUrl={list.imageUrl}
                      alt={list.name}
                      className="h-40 w-full"
                      iconClassName="h-10 w-10"
                    />
                    <div className="space-y-3 p-4">
                      <div>
                        <h2 className="line-clamp-1 font-semibold transition-colors group-hover:text-primary">
                          {list.name}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {list.description || 'Açıklama yok.'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{list.itemsCount} seri</Badge>
                        <Badge variant="outline">{list.likesCount} beğeni</Badge>
                        {list.ownerUsername && (
                          <span className="truncate">liste sahibi: {list.ownerUsername}</span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {new Date(list.likedAt).toLocaleDateString('tr-TR')} tarihinde beğenildi
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[40vh] items-center justify-center">
                <div className="text-center">
                  <List className="mx-auto h-16 w-16 text-muted-foreground" />
                  <h2 className="mt-4 text-xl font-semibold">Henüz beğenilmiş listen yok</h2>
                  <p className="mt-2 text-muted-foreground">
                    Beğendiğin okuma listeleri burada ayrı bir sekmede görünecek.
                  </p>
                  <Button asChild className="mt-4" variant="outline">
                    <Link to="/community">Topluluğa Git</Link>
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Favorites;
