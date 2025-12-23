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
          <div className="space-y-4">
            {bookmarks.map((item, index) => {
              const { manga, chapter } = item;

              if (!manga || !chapter) return null;

              return (
                <div
                  key={item.id}
                  className="flex gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-card animate-fade-up opacity-0"
                  style={{ animationDelay: `${0.1 + index * 0.05}s`, animationFillMode: 'forwards' }}
                >
                  <Link to={`/manga/${manga.id}`} className="shrink-0">
                    <img
                      src={manga.cover}
                      alt={manga.title}
                      className="h-24 w-16 rounded-lg object-cover"
                    />
                  </Link>

                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <Link to={`/manga/${manga.id}`}>
                        <h3 className="font-semibold hover:text-primary">{manga.title}</h3>
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        Bölüm {chapter.number} • Sayfa {item.page}
                      </p>
                      {item.note && (
                        <p className="mt-1 text-sm text-foreground/70">
                          "{item.note}"
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">
                        {formatDate(item.createdAt)}
                      </Badge>
                      <div className="flex gap-2">
                        <Button asChild size="sm">
                          <Link to={`/manga/${manga.id}/chapter/${chapter.id}?page=${item.page}`}>
                            Sayfa {item.page}'e Git
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveBookmark(item.id)}
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
