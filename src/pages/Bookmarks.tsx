import React from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Trash2 } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getBookmarks, removeBookmark } from '../lib/storage';
import { getMangaById } from '@/lib/database';
import { toast } from 'sonner';
import { Manga, Bookmark } from '@/lib/types';
import ListSkeleton from '@/components/skeletons/ListSkeleton';

const Bookmarks: React.FC = () => {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const loadBookmarks = React.useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const bks = await getBookmarks(user.id);

      const enrichedBookmarks = await Promise.all(bks.map(async (b) => {
        const manga = await getMangaById(b.mangaId);
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
  }, [user]);

  React.useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const handleRemoveBookmark = async (id: string) => {
    if (!user) return;
    try {
      await removeBookmark(user.id, id);
      toast.success('Yer imi silindi');
      loadBookmarks();
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
          <h1 className="text-3xl font-bold tracking-tight">Yer İmleri</h1>
          <p className="mt-2 text-muted-foreground">
            {bookmarks.length} yer imi kaydedildi
          </p>
        </div>

        {bookmarks.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
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
                  <Link to={`/manga/${manga.id}/chapter/${chapter.id}?page=${item.page}`} className="relative aspect-square w-full overflow-hidden block">
                    <img
                      src={previewImage}
                      alt={manga.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    
                    <div className="absolute top-3 left-3 flex px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg text-xs font-bold border border-white/10 text-white shadow-md">
                        Sayfa {item.page}
                    </div>
                    
                    <div className="absolute bottom-3 right-3 text-xs text-muted-foreground bg-black/60 backdrop-blur-md px-2 py-1 rounded-md">
                        {formatDate(item.createdAt)}
                    </div>
                  </Link>

                  <div className="p-4 flex flex-col flex-1">
                    <Link to={`/manga/${manga.id}`} className="hover:text-primary transition-colors">
                        <h3 className="font-bold line-clamp-1">{manga.title}</h3>
                    </Link>
                    
                    <div className="flex items-center justify-between mt-1">
                        <p className="text-sm text-primary font-medium">
                            Bölüm {chapter.number}
                        </p>
                    </div>
                    
                    {item.note && (
                        <div className="mt-3 text-sm text-muted-foreground italic line-clamp-2 bg-secondary/50 p-2 text-center rounded-lg border border-border/50">
                          "{item.note}"
                        </div>
                    )}

                    <div className="mt-auto pt-4 flex gap-2 w-full">
                        <Button 
                            variant="default" 
                            size="sm" 
                            className="flex-1"
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
                            className="shrink-0"
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
