import useDocumentTitle from '@/hooks/useDocumentTitle';
import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookCopy,
  History as HistoryIcon,
  Layers3,
  Play,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
import { flushPendingReaderSync, initializeOfflineReaderSync } from '@/lib/offline/offlineReaderSync';
import OfflineNotice from '@/components/offline/OfflineNotice';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import OptimizedImage from '@/components/media/OptimizedImage';
import VirtualCardGrid from '@/components/performance/VirtualCardGrid';

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
    className={cn(
      'group relative animate-fade-up overflow-hidden rounded-2xl border border-border/60 bg-card/75 p-3 sm:p-4 transition-colors duration-200 hover:border-primary/40 hover:bg-card',
      index >= 8 && 'cv-auto-row',
    )}
    style={{
      animationDelay: `${0.04 + Math.min(index, 6) * 0.02}s`,
    }}
  >
    <div className="relative flex items-start gap-3 sm:items-center">
      <Link to={`/manga/${item.mangaId}`} className="shrink-0">
        {item.mangaCover ? (
          <OptimizedImage
            src={item.mangaCover}
            alt={item.mangaTitle}
            priority={index < 4}
            rootMargin="520px 0px"
            containerClassName="h-24 w-16 sm:h-28 sm:w-20"
            placeholderClassName="rounded-xl"
            sizes="80px"
            className="h-24 w-16 sm:h-28 sm:w-20 rounded-xl object-cover ring-1 ring-border/50"
          />
        ) : (
          <div className="flex h-24 w-16 sm:h-28 sm:w-20 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 via-secondary/50 to-background text-xl font-bold text-muted-foreground ring-1 ring-border/50">
            {(item.mangaTitle || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
          </div>
        )}
      </Link>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={`/manga/${item.mangaId}`}
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <h2 className="line-clamp-1 text-base sm:text-lg font-bold tracking-tight transition-colors group-hover:text-primary">
                {item.mangaTitle}
              </h2>
            </Link>
            <p className="mt-0.5 line-clamp-1 text-xs sm:text-sm text-muted-foreground">
              {formatChapterDisplayTitle(item.chapterNumber, item.chapterTitle)}
              {' • '}
              Sayfa {item.page}
              {typeof item.progressPercent === 'number' ? ` · %${Math.round(item.progressPercent)}` : ''}
            </p>
          </div>

          <Badge variant="outline" className="shrink-0 rounded-full border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            {formatRelativeTime(item.lastRead)}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="rounded-full bg-secondary/80 px-2 py-0.5 text-[11px]">
              Son kaldığın yer
            </Badge>
            {item.mangaAlternativeTitles?.[0] && (
              <Badge variant="outline" className="max-w-[150px] truncate rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">
                {item.mangaAlternativeTitles[0]}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button asChild variant="outline" size="sm" className="h-8 sm:h-9 px-2.5 text-xs rounded-lg">
              <Link to={`/manga/${item.mangaId}`}>
                Seri
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild size="sm" className="h-8 sm:h-9 px-3 text-xs rounded-lg" variant="glow">
              <Link to={`/manga/${item.mangaId}/chapter/${item.chapterId}?page=${item.page}${item.pageOffsetRatio && item.pageOffsetRatio > 0.005 ? `&offset=${item.pageOffsetRatio.toFixed(3)}` : ''}`}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Devam Et
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  </article>
);

const ChapterHistoryCard = ({ item, index }: { item: ChapterHistoryEntry; index: number }) => (
  <Link
    to={`/manga/${item.mangaId}/chapter/${item.chapterId}?page=${item.page}${item.pageOffsetRatio && item.pageOffsetRatio > 0.005 ? `&offset=${item.pageOffsetRatio.toFixed(3)}` : ''}`}
    className={cn(
      'group flex flex-col animate-fade-up overflow-hidden rounded-xl border border-border/60 bg-card/75 transition-colors duration-200 hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      index >= 12 && 'cv-auto-card',
    )}
    style={{
      animationDelay: `${0.04 + Math.min(index, 8) * 0.015}s`,
    }}
  >
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
      {item.mangaCover ? (
        <OptimizedImage
          src={item.mangaCover}
          alt={item.mangaTitle}
          priority={index < 6}
          rootMargin="520px 0px"
          containerClassName="h-full w-full"
          placeholderClassName="rounded-none"
          sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 640px) 25vw, (min-width: 420px) 33vw, 48vw"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-secondary/40 to-background text-3xl font-bold text-muted-foreground">
          {(item.mangaTitle || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
        </div>
      )}
      <div className="pointer-events-none absolute -inset-x-px -bottom-px top-0 bg-gradient-to-t from-black via-black/60 via-[48%] to-black/10" />
      <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
        <Badge
          variant="secondary"
          className={cn(
            'px-1.5 py-0.5 text-[10px] font-semibold',
            item.isRead
              ? 'border-emerald-300/80 bg-emerald-500/95 text-white'
              : 'border-primary/70 bg-primary/90 text-white',
          )}
        >
          {item.isRead ? 'Okundu' : `%${Math.round(item.readProgressPercent || 0)}`}
        </Badge>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-white/95 [text-shadow:0_2px_8px_rgba(0,0,0,0.98),0_1px_2px_rgba(0,0,0,0.95)]">
          Bölüm {item.chapterNumber}
        </p>
        <h3 className="mt-0.5 line-clamp-1 text-xs sm:text-sm font-bold text-white transition-colors [text-shadow:0_2px_8px_rgba(0,0,0,0.98),0_1px_2px_rgba(0,0,0,0.95)] group-hover:text-primary group-focus-visible:text-primary">
          {item.mangaTitle}
        </h3>
      </div>
    </div>

    <div className="p-2.5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Sayfa {item.page}</span>
        <span>{formatRelativeTime(item.lastRead)}</span>
      </div>
    </div>
  </Link>
);

const History: React.FC = () => {
  useDocumentTitle('Geçmiş');
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [seriesHistory, setSeriesHistory] = React.useState<ReadingHistoryEntry[]>([]);
  const [chapterHistory, setChapterHistory] = React.useState<ChapterHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<'series' | 'chapters'>('series');

  const deferredSearchQuery = React.useDeferredValue(normalizeSearchValue(searchQuery));

  React.useEffect(() => {
    initializeOfflineReaderSync();
  }, []);

  React.useEffect(() => {
    const fetchHistory = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        if (seriesHistory.length === 0 && chapterHistory.length === 0) {
          setIsLoading(true);
        }
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
  }, [user?.id]);

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

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-16">
        <div
          className="py-6 sm:py-8 animate-fade-up"
        >
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Okuma Geçmişi
                </h1>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 sm:px-4 sm:py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Seri</p>
                  <p className="mt-0.5 text-lg font-bold sm:text-xl">{seriesHistory.length}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 sm:px-4 sm:py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Bölüm</p>
                  <p className="mt-0.5 text-lg font-bold sm:text-xl">{chapterHistory.length}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 sm:px-4 sm:py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Okundu</p>
                  <p className="mt-0.5 text-lg font-bold sm:text-xl">{chapterHistory.filter((item) => item.isRead).length}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {!isOnline && (
          <OfflineNotice
            compact
            className="mb-6 text-left"
            description="Okuma geçmişi çevrimdışında yerel ilerleme kayıtlarından yükleniyor. Kart görselleri daha önce indirilen veya önbelleğe alınan kapaklardan gösterilir."
          />
        )}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'series' | 'chapters')} className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="h-auto flex-wrap gap-1.5 rounded-xl bg-secondary/40 p-1">
              <TabsTrigger value="series" className="gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm">
                <HistoryIcon className="h-4 w-4" />
                Seri Geçmişi
              </TabsTrigger>
              <TabsTrigger value="chapters" className="gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm">
                <Layers3 className="h-4 w-4" />
                Bölüm Geçmişi
              </TabsTrigger>
            </TabsList>

            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Seri veya alternatif isim ara..."
                className="h-10 rounded-xl border-border/70 pl-9 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Aramayı temizle"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <TabsContent value="series" className="mt-0 space-y-4">
            {activeTab === 'series' ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                    {filteredSeriesHistory.length} seri
                  </Badge>
                </div>

                {filteredSeriesHistory.length > 0 ? (
                  <VirtualCardGrid
                    items={filteredSeriesHistory}
                    getItemKey={(item) => `${item.mangaId}-${item.chapterId}`}
                    renderItem={(item, index) => <SeriesHistoryCard item={item} index={index} />}
                    gridClassName="grid gap-3 md:grid-cols-2"
                    getColumnCount={(width) => (width >= 768 ? 2 : 1)}
                    gapPx={12}
                    estimatedItemHeight={152}
                    overscanRows={6}
                    minRowsBeforeVirtualize={4}
                  />
                ) : (
                  <div className="flex min-h-[36vh] items-center justify-center rounded-2xl border border-dashed border-border bg-card/30">
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
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="chapters" className="mt-0 space-y-4">
            {activeTab === 'chapters' ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                    {filteredChapterHistory.length} bölüm
                  </Badge>
                </div>

                {filteredChapterHistory.length > 0 ? (
                  <VirtualCardGrid
                    items={filteredChapterHistory}
                    getItemKey={(item) => `${item.chapterId}-${item.lastRead}`}
                    renderItem={(item, index) => <ChapterHistoryCard item={item} index={index} />}
                    gridClassName="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3.5"
                    getColumnCount={(width) => {
                      if (width >= 1280) return 6;
                      if (width >= 1024) return 5;
                      if (width >= 640) return 4;
                      if (width >= 420) return 3;
                      return 2;
                    }}
                    gapPx={14}
                    estimatedItemHeight={240}
                    overscanRows={4}
                  />
                ) : (
                  <div className="flex min-h-[36vh] items-center justify-center rounded-2xl border border-dashed border-border bg-card/30">
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
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default History;
