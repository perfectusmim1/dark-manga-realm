import React from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { getBookmarks, removeBookmark } from '../lib/storage';
import { getChapterPagesByIds } from '@/lib/database';
import { getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { toast } from 'sonner';
import { Bookmark } from '@/lib/types';
import ListSkeleton from '@/components/skeletons/ListSkeleton';
import OfflineNotice from '@/components/offline/OfflineNotice';
import OptimizedImage from '@/components/media/OptimizedImage';
import ProxyImage from '@/components/media/ProxyImage';
import VirtualCardGrid from '@/components/performance/VirtualCardGrid';
import { formatChapterNumberLabel, sanitizeChapterTitle } from '@/lib/chapterTitle';
import { buildChapterResumePath } from '@/lib/bookmarkLocation';

type EnrichedBookmark = Bookmark & {
  pagePreview?: string | null;
};

const BOOKMARK_PAGE_THUMBNAIL_TRANSFORM = Object.freeze({
  width: 480,
  quality: 72,
  format: 'webp' as const,
  fit: 'scale-down' as const,
});

const Bookmarks: React.FC = () => {
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [bookmarks, setBookmarks] = React.useState<EnrichedBookmark[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedMangaId, setSelectedMangaId] = React.useState<string>('all');
  const deferredSearchQuery = React.useDeferredValue(searchQuery.trim().toLocaleLowerCase('tr-TR'));

  const loadBookmarks = React.useCallback(async () => {
    if (!user) {
      setBookmarks([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const bks = await getBookmarks(user.id);
      const uniqueChapterIds = [...new Set(bks.map((bookmark) => bookmark.chapterId).filter(Boolean))];
      const uniqueMangaIds = [...new Set(bks.map((bookmark) => bookmark.mangaId).filter(Boolean))];
      const [pagesByChapterId, offlineMangas] = await Promise.all([
        isOnline && uniqueChapterIds.length > 0
          ? getChapterPagesByIds(uniqueChapterIds).catch((error) => {
              console.error('Bookmark preview fetch error:', error);
              return {} as Record<string, string[]>;
            })
          : Promise.resolve({} as Record<string, string[]>),
        !isOnline && uniqueMangaIds.length > 0
          ? Promise.all(uniqueMangaIds.map(async (mangaId) => [mangaId, await getOfflineMangaDetail(mangaId)] as const))
          : Promise.resolve([] as ReadonlyArray<readonly [string, Awaited<ReturnType<typeof getOfflineMangaDetail>>]>),
      ]);

      const offlineMangaMap = new Map(offlineMangas);

      const enrichedBookmarks = bks.map((bookmark) => {
        const onlinePreviewPages = pagesByChapterId[bookmark.chapterId];
        const onlinePagePreview = Array.isArray(onlinePreviewPages) && bookmark.page > 0 && bookmark.page <= onlinePreviewPages.length
          ? onlinePreviewPages[bookmark.page - 1]
          : null;
        const offlineChapter = offlineMangaMap.get(bookmark.mangaId)?.chapters.find((chapter) => chapter.id === bookmark.chapterId);
        const offlinePagePreview = Array.isArray(offlineChapter?.pages) && bookmark.page > 0 && bookmark.page <= offlineChapter.pages.length
          ? offlineChapter.pages[bookmark.page - 1]
          : null;

        return {
          ...bookmark,
          pagePreview: bookmark.pageImage || onlinePagePreview || offlinePagePreview,
        };
      });

      setBookmarks(enrichedBookmarks);
    } catch (err) {
      console.error('Bookmarks load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isOnline, user]);

  React.useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  const seriesOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const bookmark of bookmarks) {
      if (bookmark.mangaId && !map.has(bookmark.mangaId)) {
        map.set(bookmark.mangaId, bookmark.mangaTitle || 'Seri');
      }
    }
    return Array.from(map.entries())
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title, 'tr-TR'));
  }, [bookmarks]);

  const effectiveSelectedMangaId = React.useMemo(
    () => (selectedMangaId !== 'all' && seriesOptions.some((series) => series.id === selectedMangaId)
      ? selectedMangaId
      : 'all'),
    [selectedMangaId, seriesOptions],
  );

  const hasActiveFilter = Boolean(searchQuery.trim()) || effectiveSelectedMangaId !== 'all';

  const filteredBookmarks = React.useMemo(() => {
    return bookmarks.filter((bookmark) => {
      if (effectiveSelectedMangaId !== 'all' && bookmark.mangaId !== effectiveSelectedMangaId) {
        return false;
      }

      if (!deferredSearchQuery) {
        return true;
      }

      const mangaTitle = (bookmark.mangaTitle || '').toLocaleLowerCase('tr-TR');
      const alternativeTitles = (bookmark.mangaAlternativeTitles || [])
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      const chapterTitle = (bookmark.chapterTitle || '').toLocaleLowerCase('tr-TR');
      const chapterNumberText = bookmark.chapterNumber !== undefined
        ? `bölüm ${formatChapterNumberLabel(bookmark.chapterNumber)} ${bookmark.chapterNumber}`.toLocaleLowerCase('tr-TR')
        : '';
      const note = (bookmark.note || '').toLocaleLowerCase('tr-TR');

      return (
        mangaTitle.includes(deferredSearchQuery)
        || alternativeTitles.includes(deferredSearchQuery)
        || chapterTitle.includes(deferredSearchQuery)
        || chapterNumberText.includes(deferredSearchQuery)
        || note.includes(deferredSearchQuery)
      );
    });
  }, [bookmarks, deferredSearchQuery, effectiveSelectedMangaId]);

  const handleRemoveBookmark = async (id: string) => {
    if (!user) return;
    try {
      await removeBookmark(user.id, id);
      toast.success(
        isOnline
          ? 'Yer imi silindi'
          : 'Yer imi silindi, tekrar çevrimiçi olduğunda eşitlenecek',
      );
      await loadBookmarks();
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

      <main className="container pb-12 pt-16">
        <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-end sm:justify-between sm:py-8 animate-fade-up" style={{ animationDelay: '0.04s' }}>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Yer İmleri</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasActiveFilter
                ? `${filteredBookmarks.length} / ${bookmarks.length} yer imi`
                : `${bookmarks.length} yer imi kaydedildi`}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Yer imlerinde ara..."
                className="h-10 rounded-xl pl-9 pr-8"
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

            {seriesOptions.length > 0 && (
              <Select value={effectiveSelectedMangaId} onValueChange={setSelectedMangaId}>
                <SelectTrigger className="h-10 w-full rounded-xl bg-card/60 sm:w-56" aria-label="Seriye göre filtrele">
                  <SelectValue placeholder="Tüm seriler" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm seriler ({bookmarks.length})</SelectItem>
                  {seriesOptions.map((series) => (
                    <SelectItem key={series.id} value={series.id}>
                      {series.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {!isOnline && (
          <OfflineNotice
            compact
            className="mb-6 text-left"
            description="Çevrimdışıyken yer imleri yerel önbellekten gösterilir. Bu sırada yaptığınız silme işlemleri bağlantı geri geldiğinde otomatik eşitlenir."
          />
        )}

        {filteredBookmarks.length > 0 ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3 text-xs sm:text-sm text-muted-foreground">
              <span>{filteredBookmarks.length} yer imi gösteriliyor</span>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedMangaId('all');
                  }}
                  className="font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Filtreleri temizle
                </button>
              )}
            </div>

            <VirtualCardGrid
              items={filteredBookmarks}
              getItemKey={(item) => item.id}
              gridClassName="grid grid-cols-2 min-[420px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3.5"
              getColumnCount={(width) => {
                if (width >= 1280) return 6;
                if (width >= 1024) return 5;
                if (width >= 768) return 4;
                if (width >= 420) return 3;
                return 2;
              }}
              gapPx={14}
              estimatedItemHeight={280}
              overscanRows={4}
              renderItem={(item, index) => {
                const mangaTitle = item.mangaTitle || 'Seri';
                const chapterLabel = item.chapterNumber;
                const chapterNumberLabel = formatChapterNumberLabel(chapterLabel);
                const chapterTitle = sanitizeChapterTitle(chapterLabel, item.chapterTitle);
                const previewImage = item.pagePreview || item.mangaCover;
                const hasPagePreview = Boolean(item.pagePreview);

                const bookmarkHref = buildChapterResumePath({
                  mangaId: item.mangaId,
                  chapterId: item.chapterId,
                  page: item.page,
                  pageOffsetRatio: item.pageOffsetRatio,
                  progressPercent: item.progressPercent,
                });

                return (
                  <div
                    className={cn(
                      'group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/75 transition-colors hover:border-primary/40 hover:bg-card animate-fade-up',
                      index >= 12 && 'cv-auto-card',
                    )}
                    style={{
                      animationDelay: `${0.08 + Math.min(index, 11) * 0.03}s`,
                    }}
                  >
                    <Link
                      to={bookmarkHref}
                      className="relative block aspect-[4/3] w-full overflow-hidden bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
                    >
                      {previewImage ? (
                        !isOnline
                          ? (
                            <OptimizedImage
                              src={previewImage}
                              alt={mangaTitle}
                              rootMargin="520px 0px"
                              containerClassName="h-full w-full"
                              placeholderClassName="rounded-none"
                              sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 19vw, (min-width: 768px) 24vw, (min-width: 420px) 32vw, 48vw"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ProxyImage
                              src={previewImage}
                              alt={mangaTitle}
                              transform={hasPagePreview ? BOOKMARK_PAGE_THUMBNAIL_TRANSFORM : undefined}
                              loading="lazy"
                              decoding="async"
                              fetchPriority="low"
                              width={480}
                              height={360}
                              sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 19vw, (min-width: 768px) 24vw, (min-width: 420px) 32vw, 48vw"
                              className="block h-full w-full object-cover"
                            />
                          )
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-secondary/50 to-background text-lg font-bold text-muted-foreground">
                          {mangaTitle.slice(0, 1).toLocaleUpperCase('tr-TR')}
                        </div>
                      )}
                      <div className="pointer-events-none absolute -inset-x-px -bottom-px top-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

                      <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md border border-white/10 bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-md">
                        {typeof item.progressPercent === 'number' ? (
                          <>
                            <span className="text-primary">%{item.progressPercent.toFixed(1)}</span>
                            <span className="text-white/75">· Sayfa {item.page}</span>
                          </>
                        ) : (
                          <span>Sayfa {item.page}</span>
                        )}
                      </div>

                      <div className="absolute bottom-2 right-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur-md">
                        {formatDate(item.createdAt)}
                      </div>
                    </Link>

                    <div className="flex flex-1 flex-col p-2.5 sm:p-3">
                      <Link
                        to={`/manga/${item.mangaId}`}
                        className="rounded transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none"
                      >
                        <h3 className="line-clamp-1 text-xs font-semibold leading-snug transition-colors group-hover:text-primary sm:text-sm">{mangaTitle}</h3>
                      </Link>

                      <div className="mt-0.5 flex items-center justify-between">
                        <p className="text-[11px] font-medium text-primary sm:text-xs">
                          Bölüm {chapterNumberLabel}
                        </p>
                      </div>

                      {chapterTitle && (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">
                          {chapterTitle}
                        </p>
                      )}

                      {item.note && (
                        <div className="mt-1.5 line-clamp-2 rounded-lg border border-border/50 bg-secondary/45 px-2 py-1 text-[11px] italic text-muted-foreground">
                          "{item.note}"
                        </div>
                      )}

                      <div className="mt-auto flex w-full gap-1.5 pt-2.5">
                        <Button
                          variant="default"
                          size="sm"
                          className="h-8 flex-1 text-xs"
                          asChild
                        >
                          <Link to={bookmarkHref}>
                            Oku
                          </Link>
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => handleRemoveBookmark(item.id)}
                          aria-label="Yer imini sil"
                          className="h-8 w-8 shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
          </>
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="text-center">
              <BookMarked className="mx-auto h-16 w-16 text-muted-foreground" />
              <h2 className="mt-4 text-xl font-semibold">
                {hasActiveFilter ? 'Aramaya uygun yer imi bulunamadı' : 'Henüz yer iminiz yok'}
              </h2>
              <p className="mt-2 text-muted-foreground">
                {hasActiveFilter
                  ? 'Başka bir arama deneyin veya filtreleri temizleyin.'
                  : 'Okurken önemli sayfaları işaretleyin'}
              </p>
              {hasActiveFilter ? (
                <Button
                  className="mt-4"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedMangaId('all');
                  }}
                >
                  Tüm Yer İmlerine Dön
                </Button>
              ) : (
                <Button asChild className="mt-4">
                  <Link to="/browse">Keşfet</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Bookmarks;
