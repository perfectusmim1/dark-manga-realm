import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Clock, Sparkles, Play, BookOpen, ChevronLeft, ChevronRight, Download, WifiOff } from 'lucide-react';
import Header from '@/components/layout/Header';
import InstallAppBanner from '@/components/pwa/InstallAppBanner';
import TopTenSection from '@/components/manga/TopTenSection';
import MangaGrid from '@/components/manga/MangaGrid';
import MangaCard from '@/components/manga/MangaCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getAllMangas, getTrendingTags } from '@/lib/database';
import TagBadge from '@/components/tags/TagBadge';
import { getReadingHistory, getLatestProgress } from '@/lib/storage';
import { useAuth } from '@/contexts/AuthContext';
import HomeSkeleton from '@/components/skeletons/HomeSkeleton';
import { Manga, Tag } from '@/lib/types';
import { AnimatePresence, motion } from 'framer-motion';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { OfflineMangaGroup } from '@/lib/offline/types';

interface HorizontalMangaSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  linkTo: string;
  manga: Manga[];
  delay: string;
}

const HorizontalMangaSection: React.FC<HorizontalMangaSectionProps> = ({
  title,
  icon: Icon,
  iconClassName,
  linkTo,
  manga,
  delay,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const updateArrows = () => {
    if (!scrollRef.current) {
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 20);
    setShowRightArrow(scrollWidth > clientWidth + 20 && scrollLeft < scrollWidth - clientWidth - 20);
  };

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) {
      return;
    }

    const scrollAmount = scrollRef.current.clientWidth * 0.82;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });

    window.setTimeout(updateArrows, 450);
  };

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [manga.length]);

  return (
    <section className="mt-12 animate-fade-up opacity-0" style={{ animationDelay: delay, animationFillMode: 'forwards' }}>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={iconClassName} />
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to={linkTo}>
            Tümünü Gör
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="relative group/carousel">
        <AnimatePresence>
          {showLeftArrow && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('left')}
              className="absolute left-0 top-0 bottom-0 z-40 w-12 sm:w-16 bg-black/20 hover:bg-black/60 text-white transition-all duration-300 flex items-center justify-center group/arrow opacity-0 group-hover/carousel:opacity-100"
              aria-label={`${title} sola kaydır`}
            >
              <ChevronLeft className="h-10 w-10 transition-transform duration-300 group-hover/arrow:scale-125 group-active/arrow:scale-90" />
            </motion.button>
          )}

          {showRightArrow && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('right')}
              className="absolute right-0 top-0 bottom-0 z-40 w-12 sm:w-16 bg-black/20 hover:bg-black/60 text-white transition-all duration-300 flex items-center justify-center group/arrow opacity-0 group-hover/carousel:opacity-100"
              aria-label={`${title} sağa kaydır`}
            >
              <ChevronRight className="h-10 w-10 transition-transform duration-300 group-hover/arrow:scale-125 group-active/arrow:scale-90" />
            </motion.button>
          )}
        </AnimatePresence>

        <div
          ref={scrollRef}
          onScroll={updateArrows}
          className="flex gap-3 overflow-x-auto px-0 scroll-smooth scrollbar-hide sm:gap-4"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {manga.map((item, index) => (
            <div
              key={item.id}
              className="shrink-0 w-[calc((100%-24px)/3)] sm:w-[calc((100%-48px)/4)] md:w-[calc((100%-64px)/5)] lg:w-[calc((100%-80px)/6)] xl:w-[calc((100%-96px)/7)] 2xl:w-[calc((100%-112px)/8)]"
            >
              <MangaCard manga={item} index={index} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Index: React.FC = () => {
  const { user } = useAuth();
  const { snapshot: offlineSnapshot, isLoading: offlineLibraryLoading, isOnline } = useOfflineLibrary();
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [continueReading, setContinueReading] = useState<{ manga: Manga; chapterId: string; chapterNumber: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [trendingTags, setTrendingTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);

  const offlineManga = React.useMemo<Manga[]>(() => (
    offlineSnapshot.series.map((entry: OfflineMangaGroup) => ({
      id: entry.manga.mangaId,
      title: entry.manga.title,
      alternativeTitles: [],
      cover: entry.manga.cover,
      banner: entry.manga.banner,
      author: entry.manga.author,
      artist: entry.manga.artist,
      status: entry.manga.status,
      genres: entry.manga.genres,
      description: entry.manga.description,
      ratings: [],
      views: 0,
      chapters: entry.chapters
        .slice()
        .sort((a, b) => b.chapterNumber - a.chapterNumber)
        .map((chapter) => ({
          id: chapter.chapterId,
          number: chapter.chapterNumber,
          title: chapter.title,
          pages: chapter.sourcePageUrls,
          releaseDate: chapter.releaseDate,
          views: 0,
        })),
      lastUpdated: entry.manga.lastUpdated,
      createdAt: entry.manga.createdAt,
      type: entry.manga.type,
      averageRating: 0,
      reviewCount: 0,
    }))
  ), [offlineSnapshot.series]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setIsHistoryLoading(true);

        if (!isOnline) {
          setMangas(offlineManga);
          setContinueReading([]);
          setIsLoading(false);
          setIsHistoryLoading(false);
          return;
        }

        // Wave 1: Fetch mangas (Main content)
        const allMangas = await getAllMangas();
        setMangas(allMangas);
        
        // Show page as soon as mangas are ready
        setIsLoading(false);

        // Wave 2: Fetch history in background
        if (user) {
          getReadingHistory(user.id).then(async (history) => {
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
            setIsHistoryLoading(false);
          });
        }
      } catch (err) {
        console.error('Data loading error:', err);
        setIsLoading(false);
      }
    };

    loadData();

    const loadTrendingTags = async () => {
      if (!isOnline) {
        setTrendingTags([]);
        setTagsLoading(false);
        return;
      }

      setTagsLoading(true);
      const tags = await getTrendingTags(20);
      setTrendingTags(tags);
      setTagsLoading(false);
    };
    loadTrendingTags();
  }, [isOnline, offlineManga, user]);

  if ((isLoading && isOnline) || (!isOnline && offlineLibraryLoading)) {
    return (
      <>
        <Header />
        <HomeSkeleton />
      </>
    );
  }

  const trendingManga = [...mangas].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
  const newlyAddedSeries = [...mangas]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);
  const recentlyUpdated = [...mangas]
    .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
    .slice(0, 12);
  const popularManhwa = mangas.filter(m => m.type === 'manhwa').slice(0, 8);
  const popularManhua = mangas.filter(m => m.type === 'manhua').slice(0, 8);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div className="animate-fade-up opacity-0" style={{ animationDelay: '0.06s', animationFillMode: 'forwards' }}>
          <InstallAppBanner className="mb-8" />
        </div>

        {!isOnline && (
          <section className="mb-10 animate-fade-up rounded-[28px] border border-blue-500/20 bg-blue-500/10 p-6 opacity-0 shadow-[0_20px_50px_rgba(14,165,233,0.08)]" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
                  <WifiOff className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300/80">Çevrimdışı Mod</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight">Ana sayfa yerel kütüphane ile açıldı</h2>
                  <p className="mt-2 max-w-2xl text-sm text-blue-100/75">
                    Bu modda yalnızca indirilen seriler güvenli şekilde açılır. Topluluk, arama ve online içerikler internet isteyebilir.
                  </p>
                </div>
              </div>
              <Button asChild variant="glow" className="rounded-full px-5">
                <Link to="/downloads">
                  <Download className="mr-2 h-4 w-4" />
                  İndirilenlere Git
                </Link>
              </Button>
            </div>
          </section>
        )}

        {isOnline && (
          <div className="animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
            <TopTenSection />
          </div>
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
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
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
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-all duration-300 group-hover:opacity-100 backdrop-blur-[2px]">
                      <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/10 border border-white/20 backdrop-blur-md shadow-2xl transition-all duration-300 group-hover:scale-110 group-hover:bg-white/20 group-active:scale-95">
                        <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl opacity-0 group-hover:opacity-50 transition-opacity" />
                        <Play className="h-7 w-7 text-white fill-white ml-1 relative z-10" />
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-3 z-20">
                      <h3 className="font-semibold text-white text-sm line-clamp-1">{manga.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          Bölüm {chapterNumber}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {isOnline ? (
          <>
            <HorizontalMangaSection
              title="Yeni Çıkan Seriler"
              icon={Sparkles}
              iconClassName="h-5 w-5 text-amber-400"
              linkTo="/browse?sort=created"
              manga={newlyAddedSeries}
              delay="0.18s"
            />

            <HorizontalMangaSection
              title="Son Güncellenenler"
              icon={Clock}
              iconClassName="h-5 w-5 text-primary"
              linkTo="/browse?sort=updated"
              manga={recentlyUpdated}
              delay="0.2s"
            />

            <HorizontalMangaSection
              title="Trend Olanlar"
              icon={TrendingUp}
              iconClassName="h-5 w-5 text-primary"
              linkTo="/browse?sort=trending"
              manga={trendingManga}
              delay="0.25s"
            />

            {popularManhwa.length > 0 && (
              <HorizontalMangaSection
                title="Popüler Manhwa"
                icon={Sparkles}
                iconClassName="h-5 w-5 text-purple-500"
                linkTo="/browse?type=manhwa"
                manga={popularManhwa}
                delay="0.3s"
              />
            )}

            {popularManhua.length > 0 && (
              <HorizontalMangaSection
                title="Popüler Manhua"
                icon={BookOpen}
                iconClassName="h-5 w-5 text-green-500"
                linkTo="/browse?type=manhua"
                manga={popularManhua}
                delay="0.35s"
              />
            )}

            <section className="mt-16 animate-fade-up opacity-0" style={{ animationDelay: '0.4s', animationFillMode: 'forwards' }}>
              <div className="mb-6 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <h2 className="text-2xl font-bold tracking-tight">Trend Etiketler</h2>
                <Badge variant="secondary" className="bg-primary/10 text-primary border-none px-2 h-5 text-[10px]">
                  Bu Hafta
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2.5 rounded-2xl border border-border bg-card/30 p-8 backdrop-blur-sm">
                {tagsLoading ? (
                  Array.from({ length: 15 }).map((_, i) => (
                    <div key={i} className="h-8 rounded-full bg-secondary/30 animate-pulse" style={{ width: `${60 + (i % 5) * 20}px` }} />
                  ))
                ) : (
                  trendingTags.map((tag, index) => (
                    <Link key={tag.id} to={`/browse?tags=${tag.slug}`}>
                      <TagBadge tag={tag} size={index < 5 ? 'md' : 'sm'} />
                    </Link>
                  ))
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="mt-10 animate-fade-up opacity-0" style={{ animationDelay: '0.16s', animationFillMode: 'forwards' }}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-bold tracking-tight md:text-2xl">İndirilen Seriler</h2>
              </div>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {offlineManga.length} seri
              </Badge>
            </div>

            {offlineManga.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
                {offlineManga.map((manga, index) => (
                  <MangaCard key={manga.id} manga={manga} index={index} />
                ))}
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-border bg-card/30 p-10 text-center">
                <Download className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-xl font-bold">Henüz indirilen seri yok</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Çevrimdışında ana sayfadan açılabilecek seriler burada görünür.
                </p>
                <Button asChild className="mt-5" variant="outline">
                  <Link to="/downloads">İndirilenler</Link>
                </Button>
              </div>
            )}
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
