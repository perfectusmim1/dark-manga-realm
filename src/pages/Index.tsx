import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles, Play, BookOpen } from 'lucide-react';
import Header from '@/components/layout/Header';
import FeaturedManga from '@/components/manga/FeaturedManga';
import MangaGrid from '@/components/manga/MangaGrid';
import MangaCard from '@/components/manga/MangaCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getAllMangas } from '@/lib/database';
import { getReadingHistory, getLatestProgress } from '@/lib/storage';
import { useAuth } from '@/contexts/AuthContext';
import HomeSkeleton from '@/components/skeletons/HomeSkeleton';
import { Manga } from '@/lib/types';

const Index: React.FC = () => {
  const { user } = useAuth();
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [continueReading, setContinueReading] = useState<{ manga: Manga; chapterId: string; chapterNumber: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const allMangas = await getAllMangas();
        setMangas(allMangas);

        if (user) {
          const history = await getReadingHistory(user.id);
          const uniqueMangaIds = [...new Set(history.map(h => h.mangaId))].slice(0, 6);

          const continueList = await Promise.all(uniqueMangaIds.map(async (mangaId) => {
            const manga = allMangas.find(m => m.id === mangaId);
            const progress = await getLatestProgress(user.id, mangaId);
            if (manga && progress) {
              return { manga, chapterId: progress.chapterId, chapterNumber: progress.chapterNumber };
            }
            return null;
          }));

          setContinueReading(continueList.filter(Boolean) as { manga: Manga; chapterId: string; chapterNumber: number }[]);
        }
      } catch (err) {
        console.error('Data loading error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [user]);

  if (isLoading) {
    return (
      <>
        <Header />
        <HomeSkeleton />
      </>
    );
  }

  const featuredManga = mangas[0];
  const trendingManga = mangas.sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
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
            {recentlyUpdated.map((manga, index) => (
              <MangaCard key={manga.id} manga={manga} index={index} />
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
                <img src="/logo.png" alt="Logo" className="h-12 w-auto object-contain" />
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
              © {new Date().getFullYear()} ToonParrot. Tüm hakları saklıdır.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
