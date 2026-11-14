import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, Search, Trophy, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';
import OptimizedImage from '@/components/media/OptimizedImage';
import { normalizeComparableText, normalizeLooseComparableText } from '@/lib/textMatching';
import AppPagination from '@/components/ui/AppPagination';
import { cn } from '@/lib/utils';

interface EntityBrowseGridItem {
  id: string;
  name: string;
  imageUrl?: string;
  likesCount?: number;
  rank?: number;
}

interface EntityBrowseGridProps {
  title: string;
  description?: string;
  searchPlaceholder: string;
  emptyMessage: string;
  countLabel: string;
  items: EntityBrowseGridItem[];
  loading: boolean;
  buildHref: (item: EntityBrowseGridItem) => string;
  resolveRank?: (item: EntityBrowseGridItem, index: number) => number | undefined;
}

const PAGE_SIZE = 24;

const normalizeSearchValue = (value: string) => normalizeComparableText(value);

const matchesGridSearch = (value: string, query: string) => (
  normalizeSearchValue(value).includes(query)
  || normalizeLooseComparableText(value).includes(normalizeLooseComparableText(query))
);

const EntityBrowseGrid: React.FC<EntityBrowseGridProps> = ({
  title,
  description,
  searchPlaceholder,
  emptyMessage,
  countLabel,
  items,
  loading,
  buildHref,
  resolveRank,
}) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [currentPage, setCurrentPage] = React.useState(1);
  const deferredSearchQuery = React.useDeferredValue(normalizeSearchValue(searchQuery));

  const filteredItems = React.useMemo(() => {
    if (!deferredSearchQuery) {
      return items;
    }

    return items.filter((item) => matchesGridSearch(item.name, deferredSearchQuery));
  }, [deferredSearchQuery, items]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));

  React.useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearchQuery, items.length]);

  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const visibleItems = React.useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, currentPage]);

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>

        <div className="flex w-full items-center gap-3 md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              className="h-9 rounded-xl pl-9 pr-9 text-sm"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Aramayı temizle"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 min-[390px]:grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
          {[...Array(14)].map((_, index) => (
            <div key={index} className="rounded-xl border border-border/60 bg-card/60 p-2">
              <div className="mb-2 aspect-[2/3] w-full rounded-lg bg-secondary/60 animate-pulse" />
              <div className="mx-auto h-4 w-3/4 rounded bg-secondary/60 animate-pulse" />
            </div>
          ))}
        </div>
      ) : filteredItems.length > 0 ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground sm:text-sm">
            <span>Toplam {filteredItems.length} {countLabel}{totalPages > 1 ? ` • Sayfa ${currentPage} / ${totalPages}` : ''}</span>
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

          <div className="grid grid-cols-2 min-[390px]:grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {visibleItems.map((item, index) => {
              const rank = resolveRank ? resolveRank(item, index) : item.rank;

              return (
                <Link
                  key={item.id}
                  to={buildHref(item)}
                  className={cn(
                    'group relative flex flex-col rounded-xl border border-border/60 bg-card/85 p-2 text-center transition-colors duration-150 hover:border-primary/40 hover:bg-card animate-fade-up',
                    index >= 14 && 'cv-auto-card',
                  )}
                  style={{
                    animationDelay: `${0.04 + Math.min(index, PAGE_SIZE - 1) * 0.02}s`,
                  }}
                >
                  <div className="relative mb-2 aspect-[2/3] w-full overflow-hidden rounded-lg bg-secondary/40">
                    {item.imageUrl ? (
                      <OptimizedImage
                        src={item.imageUrl}
                        alt={item.name}
                        allowProxy
                        priority={index < 6}
                        rootMargin="560px 0px"
                        containerClassName="h-full w-full"
                        placeholderClassName="rounded-[inherit]"
                        className="h-full w-full rounded-[inherit] object-cover"
                      />
                    ) : (
                      <EntityPlaceholderArt
                        name={item.name}
                        className="rounded-[inherit]"
                        initialClassName="text-3xl sm:text-4xl"
                      />
                    )}

                    <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-60 transition-opacity group-hover:opacity-85" />

                    {typeof rank === 'number' && (
                      <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md border border-white/10 bg-black/65 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm">
                        <Trophy className={cn('h-2.5 w-2.5', rank <= 3 ? 'text-yellow-400' : 'text-gray-300')} />
                        <span>#{rank}</span>
                      </div>
                    )}

                    <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                      <Heart className="h-3 w-3 fill-primary text-primary" />
                      {item.likesCount || 0}
                    </div>
                  </div>

                  <h3 className="line-clamp-1 text-xs font-semibold text-foreground transition-colors group-hover:text-primary sm:text-sm">
                    {item.name}
                  </h3>
                </Link>
              );
            })}
          </div>

          {totalPages > 1 && (
            <AppPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      ) : (
        <div className="py-20 text-center">
          <p className="text-2xl font-bold text-muted-foreground">{emptyMessage}</p>
        </div>
      )}
    </>
  );
};

export default EntityBrowseGrid;
