import React from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Trash2 } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getBookmarks, removeBookmark } from '../lib/storage';
import { getMangaById } from '@/lib/database';
import { getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { toast } from 'sonner';
import { Manga, Bookmark } from '@/lib/types';
import ListSkeleton from '@/components/skeletons/ListSkeleton';

type EnrichedBookmark = Bookmark & {
  manga?: Manga;
  chapter?: Manga['chapters'][number];
};

const Bookmarks: React.FC = () => {
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [bookmarks, setBookmarks] = React.useState<EnrichedBookmark[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const loadBookmarks = React.useCallback(async () => {
    if (!user) {
      setBookmarks([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const bks = await getBookmarks(user.id);

      const enrichedBookmarks = await Promise.all(bks.map(async (b) => {
        const manga = (isOnline ? await getMangaById(b.mangaId) : undefined) || await getOfflineMangaDetail(b.mangaId);
        if (manga) {
          const chapter = manga.chapters.find(c => c.id === b.chapterId);
          return { ...b, manga, chapter };
        }
        return null;
      }));

      setBookmarks(enrichedBookmarks.filter(Boolean));
    } catch (err) {
      console.error('Bookmarks load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isOnline, user]);

  React.useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  const handleRemoveBookmark = async (id: string) => {
    if (!user) return;
    try {
      await removeBookmark(user.id, id);
      toast.success(
        isOnline
          ? 'Yer imi silindi'
          : 'Yer imi silindi, tekrar çevrimiçi olduğunda eşitlenecek',
      );
      await loadBookmarks();
    } catch (err) {
      toast.error('Yer imi silinemedi');
    }
  };

  if (isLoading && user) {
    return (
      <>
        <Header />
        <ListSkeleton />
      </>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container flex min-h-[60vh] items-center justify-center pt-20">
          <div className="text-center">
            <BookMarked className="mx-auto h-16 w-16 text-muted-foreground" />
            <h1 className="mt-4 text-2xl font-bold">Yer İmleriniz</h1>
            <p className="mt-2 text-muted-foreground">
              Yer imlerinizi görmek için giriş yapmalısınız
            </p>
            <Button asChild className="mt-4" variant="glow">
              <Link to="/auth">Giriş Yap</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Yer İmleri</h1>
          <p className="mt-2 text-muted-foreground">
            {bookmarks.length} yer imi kaydedildi
          </p>
        </div>

        {bookmarks.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {bookmarks.map((item, index) => {
              const { manga, chapter } = item;

              if (!manga || !chapter) return null;
              
              const previewImage = (chapter.pages && chapter.pages.length >= item.page) 
                ? chapter.pages[item.page - 1] 
                : manga.cover;

              return (
                <div
                  key={item.id}
                  className="group relative flex flex-col rounded-xl border border-border bg-card/50 overflow-hidden transition-all hover:shadow-xl animate-fade-up opacity-0"
                  style={{ animationDelay: `${0.1 + index * 0.05}s`, animationFillMode: 'forwards' }}
                >
                  <Link to={`/manga/${manga.id}/chapter/${chapter.id}?page=${item.page}`} className="relative aspect-[4/3] w-full overflow-hidden block sm:aspect-square">
                    <img
                      src={previewImage}
                      alt={manga.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    
                    <div className="absolute left-2 top-2 flex rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-bold text-white shadow-md backdrop-blur-md sm:left-3 sm:top-3 sm:text-xs">
                        Sayfa {item.page}
                    </div>
                    
                    <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md sm:bottom-3 sm:right-3 sm:text-xs">
                        {formatDate(item.createdAt)}
                    </div>
                  </Link>

                  <div className="flex flex-1 flex-col p-3 sm:p-4">
                    <Link to={`/manga/${manga.id}`} className="hover:text-primary transition-colors">
                        <h3 className="line-clamp-2 text-sm font-bold leading-5 sm:line-clamp-1 sm:text-base">{manga.title}</h3>
                    </Link>
                    
                    <div className="mt-1 flex items-center justify-between">
                        <p className="text-xs font-medium text-primary sm:text-sm">
                            Bölüm {chapter.number}
                        </p>
                    </div>
                    
                    {item.note && (
                        <div className="mt-2 line-clamp-2 rounded-lg border border-border/50 bg-secondary/50 p-2 text-center text-xs italic text-muted-foreground sm:mt-3 sm:text-sm">
                          "{item.note}"
                        </div>
                    )}

                    <div className="mt-auto flex w-full gap-2 pt-3 sm:pt-4">
                        <Button 
                            variant="default" 
                            size="sm" 
                            className="h-9 flex-1 text-xs sm:text-sm"
                            asChild
                        >
                            <Link to={`/manga/${manga.id}/chapter/${chapter.id}?page=${item.page}`}>
                                Oku
                            </Link>
                        </Button>
                        <Button
                            variant="destructive"
                            size="icon"
                            onClick={() => handleRemoveBookmark(item.id)}
                            className="h-9 w-9 shrink-0"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="text-center">
              <BookMarked className="mx-auto h-16 w-16 text-muted-foreground" />
              <h2 className="mt-4 text-xl font-semibold">Henüz yer iminiz yok</h2>
              <p className="mt-2 text-muted-foreground">
                Okurken önemli sayfaları işaretleyin
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

export default Bookmarks;
