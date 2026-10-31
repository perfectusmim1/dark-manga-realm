import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, Search, Trophy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';
import OptimizedImage from '@/components/media/OptimizedImage';
import { normalizeComparableText, normalizeLooseComparableText } from '@/lib/textMatching';
import AppPagination from '@/components/ui/AppPagination';

interface EntityBrowseGridItem {
  id: string;
  name: string;
  imageUrl?: string;
  likesCount?: number;
  rank?: number;
}

interface EntityBrowseGridProps {
  title: string;
  description: string;
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
      <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h1 className="mb-2 text-4xl font-black">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>

        <div className="flex w-full items-center gap-4 md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              className="rounded-xl pl-10"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[...Array(10)].map((_, index) => (
            <div key={index} className="aspect-[3/4] rounded-2xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : filteredItems.length > 0 ? (
        <>
          <div className="mb-5 flex items-center justify-between gap-3 text-sm text-muted-foreground">
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

          <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleItems.map((item, index) => {
              const rank = resolveRank ? resolveRank(item, index) : item.rank;

              return (
                <Link
                  key={item.id}
                  to={buildHref(item)}
                  className="group relative flex flex-col items-center pt-2 text-center animate-fade-up opacity-0"
                  style={{
                    animationDelay: `${0.06 + Math.min(index, PAGE_SIZE - 1) * 0.025}s`,
                    animationFillMode: 'forwards',
                    contentVisibility: 'auto',
                    containIntrinsicSize: '220px 380px',
                  }}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-card shadow-lg [transform:translateZ(0)] transition-colors duration-200 group-hover:border-primary/40">
                    {item.imageUrl ? (
                      <OptimizedImage
                        src={item.imageUrl}
                        alt={item.name}
                        allowProxy
                        priority={index < 6}
                        rootMargin="560px 0px"
                        containerClassName="h-full w-full"
                        placeholderClassName="rounded-[inherit]"
                        className="h-full w-full rounded-[inherit] object-cover object-cover"
                      />
                    ) : (
                      <EntityPlaceholderArt
                        name={item.name}
                        className="rounded-[inherit]"
                        initialClassName="text-5xl sm:text-6xl"
                      />
                    )}

                    <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 transition-opacity group-hover:opacity-90" />

                    {typeof rank === 'number' && (
                      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs font-bold backdrop-blur-md">
                        <Trophy className={`h-3 w-3 ${rank <= 3 ? 'text-yellow-400' : 'text-gray-400'}`} />
                        <span>#{rank}</span>
                      </div>
                    )}

                    <div className="absolute bottom-3 right-3 flex items-center gap-1 text-xs font-medium text-white">
                      <Heart className="h-4 w-4 fill-primary text-primary" />
                      {item.likesCount || 0}
                    </div>
                  </div>

                  <h3 className="mt-4 line-clamp-1 text-lg font-bold transition-colors group-hover:text-primary">
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
