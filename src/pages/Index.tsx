import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles } from 'lucide-react';
import Header from '@/components/layout/Header';
import FeaturedManga from '@/components/manga/FeaturedManga';
import MangaGrid from '@/components/manga/MangaGrid';
import { Button } from '@/components/ui/button';
import { mockMangaList } from '@/lib/mockData';

const Index: React.FC = () => {
  const featuredManga = mockMangaList[0];
  const trendingManga = mockMangaList.slice(0, 6);
  const recentlyUpdated = [...mockMangaList]
    .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
    .slice(0, 6);
  const popularManhwa = mockMangaList.filter(m => m.type === 'manhwa').slice(0, 6);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container pb-12 pt-20">
        {/* Hero Section */}
        <section className="animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
          <FeaturedManga manga={featuredManga} />
        </section>

        {/* Trending Section */}
        <section className="mt-12 animate-fade-up opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
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

        {/* Recently Updated Section */}
        <section className="mt-12 animate-fade-up opacity-0" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
          <div className="mb-6 flex items-center justify-between">
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
          <MangaGrid manga={recentlyUpdated} />
        </section>

        {/* Popular Manhwa Section */}
        <section className="mt-12 animate-fade-up opacity-0" style={{ animationDelay: '0.4s', animationFillMode: 'forwards' }}>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
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
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 py-8">
        <div className="container text-center">
          <p className="text-sm text-muted-foreground">
            © 2024 MangaVerse. Tüm hakları saklıdır.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
