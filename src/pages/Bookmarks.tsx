import React from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Search, Trash2 } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { getBookmarks, removeBookmark } from '../lib/storage';
import { getMangaById } from '@/lib/database';
import { getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { toast } from 'sonner';
import { Manga, Bookmark } from '@/lib/types';
import ListSkeleton from '@/components/skeletons/ListSkeleton';
import OfflineNotice from '@/components/offline/OfflineNotice';
import OptimizedImage from '@/components/media/OptimizedImage';
import ProxyImage from '@/components/media/ProxyImage';
import VirtualCardGrid from '@/components/performance/VirtualCardGrid';
import { formatChapterNumberLabel, sanitizeChapterTitle } from '@/lib/chapterTitle';

type EnrichedBookmark = Bookmark & {
  manga?: Manga;
  chapter?: Manga['chapters'][number];
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

      const enrichedBookmarks = await Promise.all(bks.map(async (b) => {
        const manga = (isOnline ? await getMangaById(b.mangaId) : undefined) || await getOfflineMangaDetail(b.mangaId);
        if (manga) {
          const chapter = manga.chapters.find(c => c.id === b.chapterId);
          return { ...b, manga, chapter };
        }
        return { ...b };
      }));

      setBookmarks(enrichedBookmarks.filter((bookmark): bookmark is EnrichedBookmark => Boolean(bookmark)));
    } catch (err) {
      console.error('Bookmarks load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isOnline, user]);

  React.useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  const filteredBookmarks = React.useMemo(() => {
    if (!deferredSearchQuery) {
      return bookmarks;
    }

    return bookmarks.filter((bookmark) => {
      const mangaTitle = (bookmark.manga?.title || bookmark.mangaTitle || '').toLocaleLowerCase('tr-TR');
      const alternativeTitles = (bookmark.manga?.alternativeTitles || bookmark.mangaAlternativeTitles || [])
        .join(' ')
        .toLocaleLowerCase('tr-TR');

      return mangaTitle.includes(deferredSearchQuery) || alternativeTitles.includes(deferredSearchQuery);
    });
  }, [bookmarks, deferredSearchQuery]);

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

      <main className="container pb-12 pt-20">
        <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Yer İmleri</h1>
          <p className="mt-2 text-muted-foreground">
            {searchQuery.trim()
              ? `${filteredBookmarks.length} sonuç gösteriliyor`
              : `${bookmarks.length} yer imi kaydedildi`}
          </p>
          <div className="relative mt-4 max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Seri adına göre ara..."
              className="h-11 rounded-xl pl-10"
            />
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
            <div className="mb-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{filteredBookmarks.length} yer imi gösteriliyor</span>
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Aramayı temizle
                </button>
              )}
            </div>

            <VirtualCardGrid
              items={filteredBookmarks}
              getItemKey={(item) => item.id}
              gridClassName="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              getColumnCount={(width) => {
                if (width >= 1280) return 5;
                if (width >= 1024) return 4;
                if (width >= 768) return 3;
                return 2;
              }}
              gapPx={16}
              estimatedItemHeight={348}
              overscanRows={4}
              renderItem={(item, index) => {
                const { manga, chapter } = item;
                const mangaTitle = manga?.title || item.mangaTitle || 'Seri';
                const chapterLabel = chapter?.number || item.chapterNumber;
                const chapterNumberLabel = formatChapterNumberLabel(chapterLabel);
                const chapterTitle = sanitizeChapterTitle(chapterLabel, chapter?.title || item.chapterTitle);
                const previewImage = !isOnline
                  ? (manga?.cover || item.mangaCover)
                  : (chapter?.pages && chapter.pages.length >= item.page)
                    ? chapter.pages[item.page - 1]
                    : (manga?.cover || item.mangaCover);

                return (
                  <div
                    className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card/50 transition-all hover:shadow-xl animate-fade-up opacity-0"
                    style={{
                      animationDelay: `${0.08 + Math.min(index, 11) * 0.03}s`,
                      animationFillMode: 'forwards',
                    }}
                  >
                    <Link to={`/manga/${item.mangaId}/chapter/${item.chapterId}?page=${item.page}`} className="relative block aspect-[4/3] w-full overflow-hidden sm:aspect-square">
                      {previewImage ? (
                        !isOnline
                          ? (
                            <OptimizedImage
                              src={previewImage}
                              alt={mangaTitle}
                              rootMargin="520px 0px"
                              containerClassName="h-full w-full"
                              placeholderClassName="rounded-none"
                              sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 22vw, (min-width: 640px) 28vw, 48vw"
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                          ) : (
                            <ProxyImage
                              src={previewImage}
                              alt={mangaTitle}
                              transform={chapter?.pages && chapter.pages.length >= item.page ? BOOKMARK_PAGE_THUMBNAIL_TRANSFORM : undefined}
                              loading="lazy"
                              decoding="async"
                              fetchPriority="low"
                              width={480}
                              height={480}
                              sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 22vw, (min-width: 640px) 28vw, 48vw"
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                          )
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-secondary/50 to-background text-lg font-bold text-muted-foreground">
                          {mangaTitle.slice(0, 1).toLocaleUpperCase('tr-TR')}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

                      <div className="absolute left-2 top-2 flex rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-bold text-white shadow-md backdrop-blur-md sm:left-3 sm:top-3 sm:text-xs">
                        Sayfa {item.page}
                      </div>

                      <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md sm:bottom-3 sm:right-3 sm:text-xs">
                        {formatDate(item.createdAt)}
                      </div>
                    </Link>

                    <div className="flex flex-1 flex-col p-3 sm:p-4">
                      <Link to={`/manga/${item.mangaId}`} className="transition-colors hover:text-primary">
                        <h3 className="line-clamp-2 text-sm font-bold leading-5 sm:line-clamp-1 sm:text-base">{mangaTitle}</h3>
                      </Link>

                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-xs font-medium text-primary sm:text-sm">
                          Bölüm {chapterNumberLabel}
                        </p>
                      </div>

                      {chapterTitle && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground sm:text-sm">
                          {chapterTitle}
                        </p>
                      )}

                      {item.note && (
                        <div className="mt-2 line-clamp-2 rounded-lg border border-border/50 bg-secondary/50 p-2 text-center text-xs italic text-muted-foreground sm:mt-3 sm:text-sm">
                          "{item.note}"
                        </div>
                      )}

                      <div className="mt-auto flex w-full gap-2 pt-3 sm:pt-4">
                        <Button
                          variant="default"
                          size="sm"
                          className="h-9 flex-1 text-xs sm:text-sm"
                          asChild
                        >
                          <Link to={`/manga/${item.mangaId}/chapter/${item.chapterId}?page=${item.page}`}>
                            Oku
                          </Link>
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => handleRemoveBookmark(item.id)}
                          className="h-9 w-9 shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
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
                {searchQuery.trim() ? 'Aramaya uygun yer imi bulunamadı' : 'Henüz yer iminiz yok'}
              </h2>
              <p className="mt-2 text-muted-foreground">
                {searchQuery.trim()
                  ? 'Başka bir seri adı deneyin veya aramayı temizleyin.'
                  : 'Okurken önemli sayfaları işaretleyin'}
              </p>
              {searchQuery.trim() ? (
                <Button className="mt-4" onClick={() => setSearchQuery('')}>
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
