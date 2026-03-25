import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookCopy,
  History as HistoryIcon,
  Layers3,
  Play,
  Search,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import {
  ChapterHistoryEntry,
  ReadingHistoryEntry,
  getChapterHistoryEntries,
  getReadingHistoryEntries,
} from '@/lib/storage';
import ListSkeleton from '@/components/skeletons/ListSkeleton';
import { formatChapterDisplayTitle, sanitizeChapterTitle } from '@/lib/chapterTitle';
import { flushPendingReaderSync } from '@/lib/offline/offlineReaderSync';

const PAGE_SIZE = 20;

const normalizeSearchValue = (value?: string | null) =>
  (value || '').toLocaleLowerCase('tr-TR').trim();

const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Az önce';
  if (diffMinutes < 60) return `${diffMinutes} dk önce`;
  if (diffHours < 24) return `${diffHours} sa önce`;
  if (diffDays < 7) return `${diffDays} gün önce`;
  return date.toLocaleDateString('tr-TR');
};

const matchesHistorySearch = (
  query: string,
  mangaTitle?: string,
  alternativeTitles?: string[],
  chapterTitle?: string,
  chapterNumber?: number,
) => {
  if (!query) {
    return true;
  }

  const haystack = [
    mangaTitle || '',
    ...(alternativeTitles || []),
    chapterTitle || '',
    chapterNumber ? `bölüm ${chapterNumber}` : '',
    chapterNumber ? chapterNumber.toString() : '',
  ]
    .map(normalizeSearchValue)
    .join(' ');

  return haystack.includes(query);
};

const SeriesHistoryCard = ({ item, index }: { item: ReadingHistoryEntry; index: number }) => (
  <article
    className="group relative animate-fade-up overflow-hidden rounded-[28px] border border-border/70 bg-card/60 opacity-0 shadow-[0_20px_50px_rgba(0,0,0,0.18)] transition-all duration-300 hover:border-primary/35 hover:bg-card"
    style={{ animationDelay: `${0.08 + Math.min(index, 9) * 0.03}s`, animationFillMode: 'forwards' }}
  >
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_45%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <Link to={`/manga/${item.mangaId}`} className="shrink-0">
        <img
          src={item.mangaCover}
          alt={item.mangaTitle}
          className="h-28 w-20 rounded-[22px] object-cover shadow-[0_16px_30px_rgba(0,0,0,0.28)] ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-[1.02]"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Link to={`/manga/${item.mangaId}`}>
              <h2 className="line-clamp-2 text-xl font-black tracking-tight transition-colors group-hover:text-primary">
                {item.mangaTitle}
              </h2>
            </Link>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {formatChapterDisplayTitle(item.chapterNumber, item.chapterTitle)}
              {' • '}
              Sayfa {item.page}
            </p>
          </div>

          <Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">
            {formatRelativeTime(item.lastRead)}
          </Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-full bg-secondary/80 px-3 py-1 text-xs">
            Son kaldığın yer
          </Badge>
          {item.mangaAlternativeTitles?.[0] && (
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs text-muted-foreground">
              alt: {item.mangaAlternativeTitles[0]}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:shrink-0">
        <Button asChild variant="outline" size="sm" className="w-full rounded-full px-4 sm:w-auto">
          <Link to={`/manga/${item.mangaId}`}>
            Seri
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button asChild size="sm" className="w-full rounded-full px-5 sm:w-auto" variant="glow">
          <Link to={`/manga/${item.mangaId}/chapter/${item.chapterId}?page=${item.page}`}>
            <Play className="mr-2 h-4 w-4" />
            Devam Et
          </Link>
        </Button>
      </div>
    </div>
  </article>
);

const ChapterHistoryCard = ({ item, index }: { item: ChapterHistoryEntry; index: number }) => (
  <Link
    to={`/manga/${item.mangaId}/chapter/${item.chapterId}?page=${item.page}`}
    className="group animate-fade-up overflow-hidden rounded-[24px] border border-border/70 bg-card/60 opacity-0 shadow-[0_18px_40px_rgba(0,0,0,0.18)] transition-all duration-300 hover:-translate-y-1 hover:border-primary/35 hover:bg-card"
    style={{ animationDelay: `${0.08 + Math.min(index, 11) * 0.02}s`, animationFillMode: 'forwards' }}
  >
    <div className="relative aspect-square overflow-hidden">
      <img
        src={item.mangaCover}
        alt={item.mangaTitle}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
      <div className="absolute left-3 top-3 flex flex-wrap gap-2">
        <Badge
          variant="secondary"
          className={item.isRead
            ? 'border-emerald-300/80 bg-emerald-500/95 text-white shadow-lg shadow-emerald-500/25'
            : 'border-primary/70 bg-primary/90 text-white shadow-lg shadow-primary/20'}
        >
          {item.isRead ? 'Okundu' : `%${Math.round(item.readProgressPercent || 0)}`}
        </Badge>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Bölüm {item.chapterNumber}
        </p>
        <h3 className="mt-1 line-clamp-2 text-sm font-bold text-white">
          {item.mangaTitle}
        </h3>
      </div>
    </div>

    <div className="space-y-2 p-3">
      <p className="line-clamp-1 text-xs text-muted-foreground">
        {sanitizeChapterTitle(item.chapterNumber, item.chapterTitle) || `Bölüm ${item.chapterNumber}`}
      </p>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Sayfa {item.page}</span>
        <span>{formatRelativeTime(item.lastRead)}</span>
      </div>
    </div>
  </Link>
);

const History: React.FC = () => {
  const { user } = useAuth();
  const [seriesHistory, setSeriesHistory] = React.useState<ReadingHistoryEntry[]>([]);
  const [chapterHistory, setChapterHistory] = React.useState<ChapterHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [seriesVisibleCount, setSeriesVisibleCount] = React.useState(PAGE_SIZE);
  const [chapterVisibleCount, setChapterVisibleCount] = React.useState(PAGE_SIZE);

  const deferredSearchQuery = React.useDeferredValue(normalizeSearchValue(searchQuery));
  const seriesSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const chapterSentinelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const fetchHistory = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        await flushPendingReaderSync();
        const [seriesEntries, chapterEntries] = await Promise.all([
          getReadingHistoryEntries(user.id),
          getChapterHistoryEntries(user.id),
        ]);
        setSeriesHistory(seriesEntries);
        setChapterHistory(chapterEntries);
      } catch (err) {
        console.error('History fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchHistory();
  }, [user]);

  const filteredSeriesHistory = React.useMemo(
    () => seriesHistory.filter((item) => matchesHistorySearch(
      deferredSearchQuery,
      item.mangaTitle,
      item.mangaAlternativeTitles,
      item.chapterTitle,
      item.chapterNumber,
    )),
    [deferredSearchQuery, seriesHistory],
  );

  const filteredChapterHistory = React.useMemo(
    () => chapterHistory.filter((item) => matchesHistorySearch(
      deferredSearchQuery,
      item.mangaTitle,
      item.mangaAlternativeTitles,
      item.chapterTitle,
      item.chapterNumber,
    )),
    [chapterHistory, deferredSearchQuery],
  );

  React.useEffect(() => {
    setSeriesVisibleCount(PAGE_SIZE);
  }, [deferredSearchQuery, seriesHistory.length]);

  React.useEffect(() => {
    setChapterVisibleCount(PAGE_SIZE);
  }, [chapterHistory.length, deferredSearchQuery]);

  React.useEffect(() => {
    if (seriesVisibleCount >= filteredSeriesHistory.length) {
      return;
    }

    const node = seriesSentinelRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setSeriesVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredSeriesHistory.length));
        }
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [filteredSeriesHistory.length, seriesVisibleCount]);

  React.useEffect(() => {
    if (chapterVisibleCount >= filteredChapterHistory.length) {
      return;
    }

    const node = chapterSentinelRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setChapterVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredChapterHistory.length));
        }
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [chapterVisibleCount, filteredChapterHistory.length]);

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

  const visibleSeriesHistory = filteredSeriesHistory.slice(0, seriesVisibleCount);
  const visibleChapterHistory = filteredChapterHistory.slice(0, chapterVisibleCount);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div
          className="mb-8 animate-fade-up opacity-0"
          style={{ animationDelay: '0.08s', animationFillMode: 'forwards' }}
        >
          <div className="rounded-[32px] border border-border/60 bg-card/40 p-6 shadow-[0_30px_60px_rgba(0,0,0,0.16)] backdrop-blur-sm sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary/80">
                  Okuma Arşivin
                </p>
                <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-4xl">
                  Okuma Geçmişi
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Seri bazında kaldığın yeri gör, tüm okuduğun bölümleri ayrı sekmede tarat
                  ve arama ile istediğin geçmişe hızlıca dön.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Seri</p>
                  <p className="mt-2 text-2xl font-black">{seriesHistory.length}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Bölüm</p>
                  <p className="mt-2 text-2xl font-black">{chapterHistory.length}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Okundu</p>
                  <p className="mt-2 text-2xl font-black">{chapterHistory.filter((item) => item.isRead).length}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Filtre</p>
                  <p className="mt-2 text-2xl font-black">{deferredSearchQuery ? 'Açık' : 'Kapalı'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="series" className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="h-auto flex-wrap gap-2 rounded-2xl bg-secondary/40 p-1">
              <TabsTrigger value="series" className="gap-2 rounded-xl px-4 py-2.5">
                <HistoryIcon className="h-4 w-4" />
                Seri Geçmişi
              </TabsTrigger>
              <TabsTrigger value="chapters" className="gap-2 rounded-xl px-4 py-2.5">
                <Layers3 className="h-4 w-4" />
                Bölüm Geçmişi
              </TabsTrigger>
            </TabsList>

            <div className="relative w-full lg:max-w-md">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Seri veya alternatif isim ara..."
                className="h-12 rounded-2xl border-border/70 pl-11"
              />
            </div>
          </div>

          <TabsContent value="series" className="mt-0 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                {filteredSeriesHistory.length} seri
              </Badge>
              <span>Her seriden son kaldığın tek kayıt gösterilir.</span>
            </div>

            {filteredSeriesHistory.length > 0 ? (
              <>
                <div className="space-y-4">
                  {visibleSeriesHistory.map((item, index) => (
                    <SeriesHistoryCard key={`${item.mangaId}-${item.chapterId}`} item={item} index={index} />
                  ))}
                </div>
                {seriesVisibleCount < filteredSeriesHistory.length && (
                  <div ref={seriesSentinelRef} className="h-10" />
                )}
              </>
            ) : (
              <div className="flex min-h-[36vh] items-center justify-center rounded-[28px] border border-dashed border-border bg-card/30">
                <div className="max-w-md px-6 text-center">
                  <BookCopy className="mx-auto h-14 w-14 text-muted-foreground" />
                  <h2 className="mt-4 text-xl font-semibold">
                    {deferredSearchQuery ? 'Eşleşen seri bulunamadı' : 'Henüz seri geçmişiniz yok'}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {deferredSearchQuery
                      ? 'Başlık ya da alternatif isim aramasını değiştirip tekrar deneyin.'
                      : 'Bir seri okumaya başladığınızda burada son kaldığınız yer görünecek.'}
                  </p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="chapters" className="mt-0 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                {filteredChapterHistory.length} bölüm
              </Badge>
              <span>Okuduğun bölümler tek tek listelenir ve 20’li akışla yüklenir.</span>
            </div>

            {filteredChapterHistory.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {visibleChapterHistory.map((item, index) => (
                    <ChapterHistoryCard key={`${item.chapterId}-${item.lastRead}`} item={item} index={index} />
                  ))}
                </div>
                {chapterVisibleCount < filteredChapterHistory.length && (
                  <div ref={chapterSentinelRef} className="h-10" />
                )}
              </>
            ) : (
              <div className="flex min-h-[36vh] items-center justify-center rounded-[28px] border border-dashed border-border bg-card/30">
                <div className="max-w-md px-6 text-center">
                  <Layers3 className="mx-auto h-14 w-14 text-muted-foreground" />
                  <h2 className="mt-4 text-xl font-semibold">
                    {deferredSearchQuery ? 'Eşleşen bölüm bulunamadı' : 'Henüz bölüm geçmişiniz yok'}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {deferredSearchQuery
                      ? 'Arama metnini değiştirip tekrar deneyin.'
                      : 'Bölüm ilerlemeleri oluştukça burada tek tek listelenecek.'}
                  </p>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default History;
