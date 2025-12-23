import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles, Play, BookOpen } from 'lucide-react';
import Header from '@/components/layout/Header';
import FeaturedManga from '@/components/manga/FeaturedManga';
import MangaGrid from '@/components/manga/MangaGrid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getAllMangas } from '@/lib/database';
import { getReadingHistory, getLatestProgress } from '@/lib/storage';
import { useAuth } from '@/contexts/AuthContext';
import { Manga } from '@/lib/types';

const Index: React.FC = () => {
  const { user } = useAuth();
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [continueReading, setContinueReading] = useState<{ manga: Manga; chapterId: string; chapterNumber: number }[]>([]);

  useEffect(() => {
    const allMangas = getAllMangas();
    setMangas(allMangas);

    // Get continue reading list
    if (user) {
      const history = getReadingHistory();
      const uniqueMangaIds = [...new Set(history.map(h => h.mangaId))].slice(0, 6);
      const continueList = uniqueMangaIds.map(mangaId => {
        const manga = allMangas.find(m => m.id === mangaId);
        const progress = getLatestProgress(mangaId);
        if (manga && progress) {
          return { manga, chapterId: progress.chapterId, chapterNumber: progress.chapterNumber };
        }
        return null;
      }).filter(Boolean) as { manga: Manga; chapterId: string; chapterNumber: number }[];
      setContinueReading(continueList);
    }
  }, [user]);

  const featuredManga = mangas[0];
  const trendingManga = mangas.slice(0, 8);
  const recentlyUpdated = [...mangas]
    .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
    .slice(0, 12);
  const popularManhwa = mangas.filter(m => m.type === 'manhwa').slice(0, 8);
  const popularManhua = mangas.filter(m => m.type === 'manhua').slice(0, 8);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        {/* Hero Section */}
        {featuredManga && (
          <section className="animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <FeaturedManga manga={featuredManga} />
          </section>
        )}

        {/* Continue Reading Section */}
        {user && continueReading.length > 0 && (
          <section className="mt-10 animate-fade-up opacity-0" style={{ animationDelay: '0.15s', animationFillMode: 'forwards' }}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Play className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-bold tracking-tight md:text-2xl">Kaldığın Yerden Devam Et</h2>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/history">
                  Tümünü Gör
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {continueReading.map(({ manga, chapterId, chapterNumber }) => (
                <Link
                  key={manga.id}
                  to={`/manga/${manga.id}/chapter/${chapterId}`}
                  className="group relative"
                >
                  <div className="relative aspect-[3/4] overflow-hidden rounded-xl">
                    <img
                      src={manga.cover}
                      alt={manga.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <h3 className="font-semibold text-white text-sm line-clamp-1">{manga.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          Bölüm {chapterNumber}
                        </Badge>
                      </div>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary">
                        <Play className="h-6 w-6 text-white" />
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Recently Updated Section */}
        <section className="mt-10 animate-fade-up opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold tracking-tight md:text-2xl">Son Güncellenenler</h2>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/browse?sort=updated">
                Tümünü Gör
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {recentlyUpdated.map((manga) => (
              <Link key={manga.id} to={`/manga/${manga.id}`} className="group">
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-secondary">
                  <img
                    src={manga.cover}
                    alt={manga.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <Badge
                      variant="secondary"
                      className={`mb-2 text-xs ${manga.type === 'manhwa' ? 'bg-purple-500/20 text-purple-400' :
                          manga.type === 'manhua' ? 'bg-green-500/20 text-green-400' :
                            'bg-blue-500/20 text-blue-400'
                        }`}
                    >
                      {manga.type.toUpperCase()}
                    </Badge>
                    <h3 className="font-semibold text-white text-sm line-clamp-2">{manga.title}</h3>
                    <p className="text-xs text-white/70 mt-1">Bölüm {manga.chapters.length}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Trending Section */}
        <section className="mt-12 animate-fade-up opacity-0" style={{ animationDelay: '0.25s', animationFillMode: 'forwards' }}>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold tracking-tight md:text-2xl">Trend Olanlar</h2>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/browse?sort=trending">
                Tümünü Gör
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <MangaGrid manga={trendingManga} />
        </section>

        {/* Popular Manhwa Section */}
        {popularManhwa.length > 0 && (
          <section className="mt-12 animate-fade-up opacity-0" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                <h2 className="text-xl font-bold tracking-tight md:text-2xl">Popüler Manhwa</h2>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/browse?type=manhwa">
                  Tümünü Gör
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <MangaGrid manga={popularManhwa} />
          </section>
        )}

        {/* Popular Manhua Section */}
        {popularManhua.length > 0 && (
          <section className="mt-12 animate-fade-up opacity-0" style={{ animationDelay: '0.35s', animationFillMode: 'forwards' }}>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-green-500" />
                <h2 className="text-xl font-bold tracking-tight md:text-2xl">Popüler Manhua</h2>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/browse?type=manhua">
                  Tümünü Gör
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <MangaGrid manga={popularManhua} />
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 py-8">
        <div className="container">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="text-center md:text-left">
              <h3 className="text-lg font-bold">
                <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                  MangaVerse
                </span>
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                En iyi manga, manhwa ve manhua okuma deneyimi
              </p>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link to="/browse" className="hover:text-foreground transition-colors">Keşfet</Link>
              <Link to="/browse?type=manhwa" className="hover:text-foreground transition-colors">Manhwa</Link>
              <Link to="/browse?type=manga" className="hover:text-foreground transition-colors">Manga</Link>
              <Link to="/browse?type=manhua" className="hover:text-foreground transition-colors">Manhua</Link>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-border text-center">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} MangaVerse. Tüm hakları saklıdır.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
