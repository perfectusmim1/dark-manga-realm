import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Heart, Layers, ListOrdered, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPublicTierListsCatalog,
  PublicTierListCard,
  TierListDiscoverySort,
  TierListTypeFilter,
  toggleTierListLike,
} from '@/lib/communityCatalog';
import { dedupeById } from '@/lib/forum';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';
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

const TYPE_FILTERS: Array<{ value: TierListTypeFilter; label: string }> = [
  { value: 'all', label: 'Tümü' },
  { value: 'manga', label: 'Manga' },
  { value: 'character', label: 'Karakter' },
];

const SORT_OPTIONS: Array<{ value: TierListDiscoverySort; label: string }> = [
  { value: 'popular', label: 'En Popüler' },
  { value: 'newest', label: 'En Yeni' },
  { value: 'most_items', label: 'En Çok Öğeli' },
];

const TIER_BADGE_CLASSES: Record<'S' | 'A' | 'B' | 'C' | 'D' | 'F', string> = {
  S: 'bg-rose-500 text-zinc-950',
  A: 'bg-orange-400 text-zinc-950',
  B: 'bg-amber-300 text-zinc-950',
  C: 'bg-emerald-400 text-zinc-950',
  D: 'bg-sky-400 text-zinc-950',
  F: 'bg-violet-400 text-zinc-950',
};

const getInitials = (name?: string | null): string => (name || 'U').trim().slice(0, 2).toUpperCase();

const formatRelativeDate = (isoDate?: string | null): string => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDistanceToNow(parsed, { addSuffix: true, locale: tr });
};

const TierListsDiscoveryTab: React.FC = () => {
  const { user } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TierListTypeFilter>('all');
  const [sort, setSort] = useState<TierListDiscoverySort>('popular');

  const [items, setItems] = useState<PublicTierListCard[]>([]);
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
      const res = await getPublicTierListsCatalog({
        search: debouncedSearch || undefined,
        type: typeFilter,
        sort,
        limit: PAGE_SIZE,
        offset: 0,
      });

      if (requestId !== requestIdRef.current) return;
      setItems(dedupeById(res.items));
      setHasMore(res.hasMore);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error('Tier listeleri yüklenemedi:', error);
      toast.error('Tier listeleri yüklenirken bir hata oluştu.');
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [debouncedSearch, typeFilter, sort]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    const requestId = requestIdRef.current;
    setIsLoadingMore(true);

    try {
      const res = await getPublicTierListsCatalog({
        search: debouncedSearch || undefined,
        type: typeFilter,
        sort,
        limit: PAGE_SIZE,
        offset: items.length,
      });

      if (requestId !== requestIdRef.current) return;
      setItems((prev) => dedupeById([...prev, ...res.items]));
      setHasMore(res.hasMore);
    } catch (error) {
      console.error('Daha fazla tier list yüklenemedi:', error);
      toast.error('Sıralamaların devamı yüklenemedi.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleToggleLike = async (item: PublicTierListCard) => {
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
      await toggleTierListLike({
        tierListId: item.id,
        userId: user.id,
        currentlyLiked,
      });
    } catch (error) {
      console.error('Tier list beğeni hatası:', error);
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
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Tier Listeler</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Topluluk üyelerinin paylaştığı manga ve karakter sıralamalarını keşfet.
          </p>
        </div>

        <Button asChild variant="outline" size="sm" className="w-fit gap-1.5 shrink-0">
          <Link to="/tier-lists">
            <ListOrdered className="h-4 w-4" />
            <span>Sıralamalarım</span>
          </Link>
        </Button>
      </div>

      {/* Filters Row */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Sıralama veya kullanıcı ara..."
            aria-label="Sıralama veya kullanıcı ara"
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

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Sıralama tipi filtresi"
            className="inline-flex items-center rounded-lg border border-border/60 bg-card/60 p-0.5"
          >
            {TYPE_FILTERS.map((option) => {
              const active = typeFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTypeFilter(option.value)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <Select value={sort} onValueChange={(value) => setSort(value as TierListDiscoverySort)}>
            <SelectTrigger className="w-[155px] h-10 bg-card/60" aria-label="Sıralama ölçütü">
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
      </div>

      {/* Catalog Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3"
            >
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-5 w-2/3" />
              <div className="flex items-center justify-between pt-1">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-12" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/40 p-10 text-center space-y-3">
          <Layers className="h-9 w-9 mx-auto text-muted-foreground/60" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Tier list bulunamadı</p>
            <p className="text-sm text-muted-foreground">
              {debouncedSearch || typeFilter !== 'all'
                ? 'Filtrelerinize uygun herkese açık sıralama bulunamadı.'
                : 'Henüz herkese açık paylaşılan bir tier list bulunmuyor.'}
            </p>
          </div>
          {(debouncedSearch || typeFilter !== 'all') && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setTypeFilter('all');
              }}
            >
              Filtreleri Temizle
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => {
            const visiblePreviewTiers = item.previewTiers
              .filter((tierRow) => tierRow.items && tierRow.items.length > 0)
              .slice(0, 3);
            const dateLabel = formatRelativeDate(item.createdAt);

            return (
              <article
                key={item.id}
                className="rounded-xl border border-border/60 bg-card/60 hover:border-primary/40 transition-colors flex flex-col justify-between overflow-hidden min-w-0"
              >
                <Link to={`/tier-lists/${item.id}`} className="block p-4 space-y-3 group">
                  {/* S / A / B Mini Preview Strips */}
                  <div className="rounded-lg border border-border/50 bg-background/60 overflow-hidden divide-y divide-border/50">
                    {visiblePreviewTiers.length === 0 ? (
                      <div className="h-[92px] flex items-center justify-center text-xs text-muted-foreground">
                        Görsel önizleme bulunmuyor
                      </div>
                    ) : (
                      visiblePreviewTiers.map((tierRow) => (
                        <div key={tierRow.tier} className="flex items-stretch min-h-[44px]">
                          <div
                            className={cn(
                              'w-10 shrink-0 flex items-center justify-center px-1 text-[11px] font-bold truncate',
                              TIER_BADGE_CLASSES[tierRow.tier],
                            )}
                            title={tierRow.label}
                          >
                            <span className="truncate">{tierRow.label || tierRow.tier}</span>
                          </div>
                          <div className="flex-1 flex items-center gap-1.5 px-2 py-1 overflow-hidden">
                            {tierRow.items.slice(0, 12).map((entry) => (
                              <div
                                key={entry.id}
                                className="h-9 w-7 sm:h-10 sm:w-8 rounded-[4px] overflow-hidden shrink-0 bg-muted border border-border/40"
                                title={entry.name}
                              >
                                {entry.image ? (
                                  <OptimizedImage
                                    src={entry.image}
                                    alt={entry.name}
                                    allowProxy
                                    transform={{ width: 80, quality: 75 }}
                                    containerClassName="h-full w-full"
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="h-full w-full flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                                    {entry.name.slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Title & Metadata */}
                  <div className="space-y-1 min-w-0">
                    <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span className="font-medium text-foreground/80">
                        {item.type === 'character' ? 'Karakter' : 'Manga'}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">{item.itemsCount} öğe</span>
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

export default TierListsDiscoveryTab;
