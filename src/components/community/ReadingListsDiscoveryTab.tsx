import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { BookMarked, Heart, Library, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPublicReadingListsCatalog,
  PublicReadingListCard,
  ReadingListDiscoverySort,
  toggleReadingListLike,
} from '@/lib/communityCatalog';
import { dedupeById } from '@/lib/forum';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';
import ReadingListCover from '@/components/manga/ReadingListCover';
import OptimizedImage from '@/components/media/OptimizedImage';
import StaffBadge from '@/components/user/StaffBadge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 18;

const SORT_OPTIONS: Array<{ value: ReadingListDiscoverySort; label: string }> = [
  { value: 'popular', label: 'En Popüler' },
  { value: 'newest', label: 'En Yeni' },
  { value: 'most_items', label: 'En Çok Seri' },
];

const getInitials = (name?: string | null): string => (name || 'U').trim().slice(0, 2).toUpperCase();

const formatRelativeDate = (isoDate?: string | null): string => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDistanceToNow(parsed, { addSuffix: true, locale: tr });
};

const renderCoverPreview = (item: PublicReadingListCard) => {
  if (item.imageUrl) {
    return (
      <ReadingListCover
        imageUrl={item.imageUrl}
        alt={item.name}
        className="h-44 w-full"
        showLabel={false}
      />
    );
  }

  const covers = item.previewCovers.filter(Boolean).slice(0, 4);
  if (covers.length === 0) {
    return <ReadingListCover alt={item.name} className="h-44 w-full" showLabel />;
  }

  if (covers.length === 1) {
    return (
      <div className="relative h-44 w-full overflow-hidden bg-muted/60">
        <OptimizedImage
          src={covers[0]}
          alt={item.name}
          transform={{ width: 480, quality: 80 }}
          containerClassName="h-full w-full"
          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
    );
  }

  if (covers.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5 h-44 w-full overflow-hidden bg-border/40">
        {covers.map((src, idx) => (
          <OptimizedImage
            key={idx}
            src={src}
            alt={`${item.name} kapak ${idx + 1}`}
            transform={{ width: 320, quality: 78 }}
            containerClassName="h-full w-full bg-muted"
            className="h-full w-full object-cover"
          />
        ))}
      </div>
    );
  }

  if (covers.length === 3) {
    return (
      <div className="grid grid-cols-3 gap-0.5 h-44 w-full overflow-hidden bg-border/40">
        {covers.map((src, idx) => (
          <OptimizedImage
            key={idx}
            src={src}
            alt={`${item.name} kapak ${idx + 1}`}
            transform={{ width: 260, quality: 78 }}
            containerClassName="h-full w-full bg-muted"
            className="h-full w-full object-cover"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-0.5 h-44 w-full overflow-hidden bg-border/40">
      {covers.map((src, idx) => (
        <OptimizedImage
          key={idx}
          src={src}
          alt={`${item.name} kapak ${idx + 1}`}
          transform={{ width: 260, quality: 75 }}
          containerClassName="h-full w-full bg-muted"
          className="h-full w-full object-cover"
        />
      ))}
    </div>
  );
};

const ReadingListsDiscoveryTab: React.FC = () => {
  const { user } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<ReadingListDiscoverySort>('popular');

  const [items, setItems] = useState<PublicReadingListCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [likingIds, setLikingIds] = useState<Record<string, boolean>>({});

  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadCatalog = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);

    try {
      const res = await getPublicReadingListsCatalog({
        search: debouncedSearch || undefined,
        sort,
        limit: PAGE_SIZE,
        offset: 0,
      });

      if (requestId !== requestIdRef.current) return;
      setItems(dedupeById(res.items));
      setHasMore(res.hasMore);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error('Okuma listeleri yüklenemedi:', error);
      toast.error('Okuma listeleri yüklenirken bir hata oluştu.');
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [debouncedSearch, sort]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    const requestId = requestIdRef.current;
    setIsLoadingMore(true);

    try {
      const res = await getPublicReadingListsCatalog({
        search: debouncedSearch || undefined,
        sort,
        limit: PAGE_SIZE,
        offset: items.length,
      });

      if (requestId !== requestIdRef.current) return;
      setItems((prev) => dedupeById([...prev, ...res.items]));
      setHasMore(res.hasMore);
    } catch (error) {
      console.error('Daha fazla okuma listesi yüklenemedi:', error);
      toast.error('Listelerin devamı yüklenemedi.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleToggleLike = async (item: PublicReadingListCard) => {
    if (!user) {
      toast.error('Beğenmek için giriş yapmalısınız.');
      return;
    }
    if (likingIds[item.id]) return;

    const currentlyLiked = item.viewerHasLiked;
    const delta = currentlyLiked ? -1 : 1;

    setLikingIds((prev) => ({ ...prev, [item.id]: true }));
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              viewerHasLiked: !currentlyLiked,
              likeCount: Math.max(0, entry.likeCount + delta),
            }
          : entry,
      ),
    );

    try {
      await toggleReadingListLike({
        listId: item.id,
        userId: user.id,
        currentlyLiked,
      });
    } catch (error) {
      console.error('Okuma listesi beğeni hatası:', error);
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                viewerHasLiked: currentlyLiked,
                likeCount: Math.max(0, entry.likeCount - delta),
              }
            : entry,
        ),
      );
      toast.error('Beğeni işlemi tamamlanamadı.');
    } finally {
      setLikingIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      {/* Header & Secondary Link */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Okuma Listeleri</h2>
        </div>

        <Button asChild variant="outline" size="sm" className="w-fit gap-1.5 shrink-0">
          <Link to="/reading-lists">
            <Library className="h-4 w-4" />
            <span>Listelerim</span>
          </Link>
        </Button>
      </div>

      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Liste veya kullanıcı ara..."
            aria-label="Liste veya kullanıcı ara"
            className="pl-9 pr-9 h-10 bg-card/60"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label="Aramayı temizle"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select value={sort} onValueChange={(value) => setSort(value as ReadingListDiscoverySort)}>
          <SelectTrigger className="w-[165px] h-10 bg-card/60 shrink-0" aria-label="Listeleri sırala">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Catalog Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-border/60 bg-card/50 overflow-hidden"
            >
              <Skeleton className="h-44 w-full" />
              <div className="p-4 space-y-2.5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <div className="flex items-center justify-between pt-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/40 p-10 text-center space-y-3">
          <BookMarked className="h-9 w-9 mx-auto text-muted-foreground/60" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Okuma listesi bulunamadı</p>
            <p className="text-sm text-muted-foreground">
              {debouncedSearch
                ? 'Aramanıza uygun herkese açık okuma listesi bulunamadı.'
                : 'Henüz herkese açık paylaşılan bir okuma listesi bulunmuyor.'}
            </p>
          </div>
          {debouncedSearch && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSearchInput('')}
            >
              Aramayı Temizle
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => {
            const dateLabel = formatRelativeDate(item.createdAt);

            return (
              <article
                key={item.id}
                className="rounded-xl border border-border/60 bg-card/60 hover:border-primary/40 transition-colors flex flex-col justify-between overflow-hidden min-w-0"
              >
                <Link to={`/reading-lists/${item.id}`} className="block group min-w-0">
                  <div className="border-b border-border/50 overflow-hidden">
                    {renderCoverPreview(item)}
                  </div>

                  <div className="p-4 space-y-1.5 min-w-0">
                    <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                      {item.name}
                    </h3>

                    {item.description ? (
                      <p className="text-sm text-muted-foreground line-clamp-2 break-words min-h-[2.5rem]">
                        {item.description}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/75 italic min-h-[2.5rem] flex items-center">
                        Açıklama eklenmemiş.
                      </p>
                    )}

                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 flex-wrap">
                      <span className="tabular-nums font-medium text-foreground/85">
                        {item.itemsCount} seri
                      </span>
                      {dateLabel && (
                        <>
                          <span>·</span>
                          <span>{dateLabel}</span>
                        </>
                      )}
                    </div>
                  </div>
                </Link>

                {/* Owner & Like Footer */}
                <div className="px-4 py-2.5 border-t border-border/50 bg-muted/20 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link
                      to={`/profile/${item.userId}`}
                      className="flex items-center gap-2 min-w-0 hover:opacity-90"
                    >
                      <Avatar className="h-6 w-6 shrink-0 border border-border/60">
                        <AvatarImage src={item.ownerAvatar || undefined} alt={item.ownerUsername} />
                        <AvatarFallback className="text-[10px]">
                          {getInitials(item.ownerUsername)}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        className={cn(
                          'text-xs font-medium truncate max-w-[140px]',
                          getStaffTextClassName(item.ownerRole),
                        )}
                      >
                        {item.ownerUsername}
                      </span>
                    </Link>
                    <StaffBadge role={item.ownerRole} compact />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleLike(item)}
                    disabled={Boolean(likingIds[item.id])}
                    aria-label={item.viewerHasLiked ? 'Beğeniyi kaldır' : 'Beğen'}
                    className={cn(
                      'inline-flex items-center gap-1 text-xs transition-colors tabular-nums shrink-0 px-2 py-1 rounded-md hover:bg-muted',
                      item.viewerHasLiked
                        ? 'text-rose-500 font-medium'
                        : 'text-muted-foreground hover:text-rose-500',
                    )}
                  >
                    <Heart
                      className={cn('h-3.5 w-3.5', item.viewerHasLiked && 'fill-current')}
                    />
                    <span>{item.likeCount}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {hasMore && !isLoading && (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="gap-2"
          >
            {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>Daha fazla yükle</span>
          </Button>
        </div>
      )}
    </div>
  );
};

export default ReadingListsDiscoveryTab;
