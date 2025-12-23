import React from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Trash2 } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getBookmarks, removeBookmark } from '../lib/storage';
import { getMangaById, getChapterById } from '@/lib/mockData';
import { toast } from 'sonner';

const Bookmarks: React.FC = () => {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = React.useState(getBookmarks());

  const handleRemoveBookmark = (id: string) => {
    removeBookmark(id);
    setBookmarks(getBookmarks());
    toast.success('Yer imi silindi');
  };

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
            {bookmarks.map((bookmark, index) => {
              const manga = getMangaById(bookmark.mangaId);
              const chapter = getChapterById(bookmark.mangaId, bookmark.chapterId);

              if (!manga || !chapter) return null;

              return (
                <div
                  key={bookmark.id}
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
                        Bölüm {chapter.number} • Sayfa {bookmark.page}
                      </p>
                      {bookmark.note && (
                        <p className="mt-1 text-sm text-foreground/70">
                          "{bookmark.note}"
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">
                        {formatDate(bookmark.createdAt)}
                      </Badge>
                      <div className="flex gap-2">
                        <Button asChild size="sm">
                          <Link to={`/manga/${manga.id}/chapter/${chapter.id}?page=${bookmark.page}`}>
                            Sayfa {bookmark.page}'e Git
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveBookmark(bookmark.id)}
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
