import React from 'react';
import { Link } from 'react-router-dom';
import { History as HistoryIcon, Play } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getReadingHistory } from '@/lib/storage';
import { getMangaById, getChapterById } from '@/lib/mockData';

const History: React.FC = () => {
  const { user } = useAuth();
  const history = getReadingHistory();

  // Group history by manga
  const groupedHistory = history.reduce((acc, item) => {
    if (!acc[item.mangaId]) {
      acc[item.mangaId] = item;
    }
    return acc;
  }, {} as Record<string, typeof history[0]>);

  const historyItems = Object.values(groupedHistory).slice(0, 20);

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container flex min-h-[60vh] items-center justify-center pt-20">
          <div className="text-center">
            <HistoryIcon className="mx-auto h-16 w-16 text-muted-foreground" />
            <h1 className="mt-4 text-2xl font-bold">Okuma Geçmişiniz</h1>
            <p className="mt-2 text-muted-foreground">
              Okuma geçmişinizi görmek için giriş yapmalısınız
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
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins} dakika önce`;
    if (diffHours < 24) return `${diffHours} saat önce`;
    if (diffDays < 7) return `${diffDays} gün önce`;
    return date.toLocaleDateString('tr-TR');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container pb-12 pt-20">
        <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
          <h1 className="text-3xl font-bold tracking-tight">Okuma Geçmişi</h1>
          <p className="mt-2 text-muted-foreground">
            Son okuduğunuz mangalar
          </p>
        </div>

        {historyItems.length > 0 ? (
          <div className="space-y-4">
            {historyItems.map((item, index) => {
              const manga = getMangaById(item.mangaId);
              const chapter = getChapterById(item.mangaId, item.chapterId);
              
              if (!manga || !chapter) return null;

              return (
                <div
                  key={`${item.mangaId}-${item.chapterId}`}
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
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">
                        {formatDate(item.lastRead)}
                      </Badge>
                      <Button asChild size="sm">
                        <Link to={`/manga/${manga.id}/chapter/${chapter.id}`}>
                          <Play className="mr-1 h-3 w-3" />
                          Devam Et
                        </Link>
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
              <HistoryIcon className="mx-auto h-16 w-16 text-muted-foreground" />
              <h2 className="mt-4 text-xl font-semibold">Henüz okuma geçmişiniz yok</h2>
              <p className="mt-2 text-muted-foreground">
                Manga okumaya başlayın
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

export default History;
