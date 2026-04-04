import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, List } from 'lucide-react';
import Header from '@/components/layout/Header';
import MangaGrid from '@/components/manga/MangaGrid';
import ReadingListCover from '@/components/manga/ReadingListCover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { getFavorites, refreshFavoritesCache } from '@/lib/storage';
import { getLikedReadingLists, getMangaSummariesByIds, LikedReadingListPreview } from '@/lib/database';
import { getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import { areFavoritesInitialized, getCachedFavoritesState } from '@/lib/offline/userSync';
import OfflineNotice from '@/components/offline/OfflineNotice';
import { Manga, Favorite } from '@/lib/types';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { toast } from 'sonner';
import GridSkeleton from '@/components/skeletons/GridSkeleton';
import VirtualCardGrid from '@/components/performance/VirtualCardGrid';

const FAVORITES_FALLBACK_COVER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="#111827"/><rect x="32" y="32" width="336" height="536" rx="28" fill="#1f2937"/><text x="200" y="286" fill="#93c5fd" font-size="34" font-family="Arial, sans-serif" text-anchor="middle">Toonparrot</text><text x="200" y="332" fill="#e5e7eb" font-size="22" font-family="Arial, sans-serif" text-anchor="middle">Çevrimdışı</text></svg>'
)}`;

const getSixColumnDesktopCount = (width: number) => {
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  if (width >= 430) return 3;
  return 2;
};

const buildFavoriteFallbackManga = (favorite: Favorite): Manga => ({
  id: favorite.mangaId,
  title: favorite.mangaTitle || 'Favori seri',
  alternativeTitles: [],
  cover: favorite.mangaCover || FAVORITES_FALLBACK_COVER,
  banner: favorite.mangaCover || FAVORITES_FALLBACK_COVER,
  author: 'Çevrimdışı önbellek',
  artist: '',
  status: 'ongoing',
  genres: [],
  description: 'Bu seri çevrimdışı modda önbelleğe alınmış temel bilgilerle gösteriliyor.',
  ratings: [],
  views: 0,
  chapters: [],
  lastUpdated: favorite.addedAt,
  createdAt: favorite.addedAt,
  type: 'manga',
  averageRating: 0,
  reviewCount: 0,
});

const createMangaMap = (mangas: Manga[]) =>
  new Map(mangas.map((manga) => [manga.id, manga] as const));

const resolveFavoriteManga = (
  favorites: Favorite[],
  primaryMap?: Map<string, Manga>,
  secondaryMap?: Map<string, Manga>,
) => favorites.map((favorite) => (
  primaryMap?.get(favorite.mangaId)
  || secondaryMap?.get(favorite.mangaId)
  || buildFavoriteFallbackManga(favorite)
));

const hydrateFavoriteMangaFromOffline = async (favorites: Favorite[]) => {
  const offlineEntries = await Promise.all(
    favorites.map((favorite) => getOfflineMangaDetail(favorite.mangaId)),
  );

  return resolveFavoriteManga(
    favorites,
    createMangaMap(offlineEntries.filter(Boolean) as Manga[]),
  );
};

const Favorites: React.FC = () => {
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const initialFavoriteCache = user?.id && areFavoritesInitialized(user.id)
    ? getCachedFavoritesState(user.id)
    : [];
  const [favoriteManga, setFavoriteManga] = React.useState<Manga[]>(() => (
    resolveFavoriteManga(initialFavoriteCache)
  ));
  const [favoriteLists, setFavoriteLists] = React.useState<LikedReadingListPreview[]>([]);
  const [isLoading, setIsLoading] = React.useState(() => !user?.id || !areFavoritesInitialized(user.id));
  const [isListsLoading, setIsListsLoading] = React.useState(false);
  const [hasLoadedLists, setHasLoadedLists] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'manga' | 'lists'>('manga');

  React.useEffect(() => {
    let isCancelled = false;

    const loadFavorites = async () => {
      if (!user?.id) {
        setFavoriteManga([]);
        setIsLoading(false);
        return;
      }

      const hasCachedFavorites = areFavoritesInitialized(user.id);
      let resolvedFavorites: Favorite[] = [];
      let offlineMangaMap = new Map<string, Manga>();

      try {
        if (!hasCachedFavorites) {
          setIsLoading(true);
        }

        resolvedFavorites = hasCachedFavorites
          ? getCachedFavoritesState(user.id)
          : await getFavorites(user.id);

        if (isCancelled) {
          return;
        }

        React.startTransition(() => {
          setFavoriteManga(resolveFavoriteManga(resolvedFavorites));
        });
        setIsLoading(false);

        const offlineHydratedManga = await hydrateFavoriteMangaFromOffline(resolvedFavorites);

        if (isCancelled) {
          return;
        }

        offlineMangaMap = createMangaMap(offlineHydratedManga);

        React.startTransition(() => {
          setFavoriteManga(offlineHydratedManga);
        });
      } catch (err) {
        console.error('Favorites load error:', err);
        toast.error('Favoriler yüklenemedi');
        setFavoriteManga([]);
        setIsLoading(false);
        return;
      } finally {
        setIsLoading(false);
      }

      if (!isOnline) {
        return;
      }

      try {
        const refreshedFavorites = hasCachedFavorites
          ? await refreshFavoritesCache(user.id)
          : resolvedFavorites;
        if (isCancelled) {
          return;
        }
        const summaryManga = await getMangaSummariesByIds(
          refreshedFavorites.map((favorite) => favorite.mangaId),
        );
        if (isCancelled) {
          return;
        }
        const summaryMangaMap = createMangaMap(summaryManga);

        React.startTransition(() => {
          setFavoriteManga(resolveFavoriteManga(refreshedFavorites, summaryMangaMap, offlineMangaMap));
        });
      } catch (error) {
        console.warn('Favorites background refresh failed:', error);
      }
    };

    void loadFavorites();

    return () => {
      isCancelled = true;
    };
  }, [isOnline, user?.id]);

  React.useEffect(() => {
    setFavoriteLists([]);
    setHasLoadedLists(false);
    setIsListsLoading(false);
  }, [user?.id]);

  React.useEffect(() => {
    if (!user?.id || activeTab !== 'lists' || !isOnline || hasLoadedLists) {
      return;
    }

    let isCancelled = false;

    const loadLikedLists = async () => {
      try {
        setIsListsLoading(true);
        const likedLists = await getLikedReadingLists(user.id);

        if (isCancelled) {
          return;
        }

        React.startTransition(() => {
          setFavoriteLists(likedLists);
        });
        setHasLoadedLists(true);
      } catch (error) {
        console.error('Liked reading lists load error:', error);
        toast.error('Beğenilen okuma listeleri yüklenemedi');
      } finally {
        if (!isCancelled) {
          setIsListsLoading(false);
        }
      }
    };

    void loadLikedLists();

    return () => {
      isCancelled = true;
    };
  }, [activeTab, hasLoadedLists, isOnline, user?.id]);

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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Favorilerim</h1>
          <p className="mt-2 text-muted-foreground">
            {favoriteManga.length} manga
            {hasLoadedLists ? ` ve ${favoriteLists.length} beğenilen okuma listesi` : ''}
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'manga' | 'lists')} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-secondary/40 p-1 sm:inline-flex sm:w-auto sm:flex-wrap">
            <TabsTrigger value="manga" className="gap-2 px-3 text-xs sm:text-sm">
              <Heart className="h-4 w-4" />
              <span className="sm:hidden">Mangalar</span>
              <span className="hidden sm:inline">Favori Mangalar</span>
            </TabsTrigger>
            <TabsTrigger value="lists" className="gap-2 px-3 text-xs sm:text-sm">
              <List className="h-4 w-4" />
              <span className="sm:hidden">Listeler</span>
              <span className="hidden sm:inline">Beğenilen Okuma Listeleri</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manga" className="mt-0">
            {activeTab === 'manga' ? (
              favoriteManga.length > 0 ? (
                <MangaGrid
                  manga={favoriteManga}
                  getColumnCount={getSixColumnDesktopCount}
                />
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
              )
            ) : null}
          </TabsContent>

          <TabsContent value="lists" className="mt-0">
            {activeTab === 'lists' ? (
              !isOnline ? (
                <OfflineNotice
                  compact
                  description="Beğendiğiniz okuma listelerini görmek için internete bağlanın."
                />
              ) : isListsLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="overflow-hidden rounded-2xl border border-border bg-card/40">
                      <Skeleton className="h-40 w-full" />
                      <div className="space-y-3 p-4">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <div className="flex gap-2">
                          <Skeleton className="h-5 w-16" />
                          <Skeleton className="h-5 w-20" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : favoriteLists.length > 0 ? (
                <VirtualCardGrid
                  items={favoriteLists}
                  getItemKey={(list) => list.id}
                  gridClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                  getColumnCount={(width) => {
                    if (width >= 1280) return 3;
                    if (width >= 640) return 2;
                    return 1;
                  }}
                  gapPx={16}
                  estimatedItemHeight={260}
                  overscanRows={3}
                  minRowsBeforeVirtualize={4}
                  renderItem={(list, index) => (
                    <Link
                      to={`/reading-lists/${list.id}`}
                      className="group animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/50 opacity-0 transition-all hover:border-primary/40 hover:bg-card"
                      style={{
                        animationDelay: `${0.08 + Math.min(index, 11) * 0.03}s`,
                        animationFillMode: 'forwards',
                      }}
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
                  )}
                />
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
              )
            ) : null}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Favorites;
