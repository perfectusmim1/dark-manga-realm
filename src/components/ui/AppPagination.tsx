import React from 'react';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

export interface AppPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  scrollToTop?: boolean;
}

export const AppPagination: React.FC<AppPaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  className,
  scrollToTop = true,
}) => {
  if (totalPages <= 1) {
    return null;
  }

  const handlePageSelect = (page: number, e?: React.MouseEvent) => {
    e?.preventDefault();
    if (page < 1 || page > totalPages || page === currentPage) {
      return;
    }
    onPageChange(page);
    if (scrollToTop && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Generate visible page numbers
  const getPageNumbers = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | 'ellipsis')[] = [1];

    if (currentPage > 3) {
      pages.push('ellipsis');
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push('ellipsis');
    }

    pages.push(totalPages);
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-8', className)}>
      {/* Mobile compact view: Previous - Page X/Y - Next */}
      <div className="flex sm:hidden items-center justify-between w-full max-w-xs px-2">
        <button
          type="button"
          onClick={(e) => handlePageSelect(currentPage - 1, e)}
          disabled={currentPage <= 1}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
            currentPage <= 1
              ? 'pointer-events-none opacity-40 border-border bg-card/20 text-muted-foreground'
              : 'border-border bg-card/60 text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary'
          )}
        >
          Önceki
        </button>

        <span className="text-xs font-semibold text-muted-foreground">
          Sayfa <span className="text-foreground">{currentPage}</span> / {totalPages}
        </span>

        <button
          type="button"
          onClick={(e) => handlePageSelect(currentPage + 1, e)}
          disabled={currentPage >= totalPages}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
            currentPage >= totalPages
              ? 'pointer-events-none opacity-40 border-border bg-card/20 text-muted-foreground'
              : 'border-border bg-card/60 text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary'
          )}
        >
          Sonraki
        </button>
      </div>

      {/* Desktop & tablet standard pagination view */}
      <div className="hidden sm:block">
        <Pagination>
          <PaginationContent className="flex-wrap justify-center gap-1.5">
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => handlePageSelect(currentPage - 1, e)}
                className={cn(
                  'cursor-pointer select-none rounded-lg border border-border bg-card/40 transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground',
                  currentPage <= 1 && 'pointer-events-none opacity-40 hover:bg-card/40 hover:text-inherit'
                )}
              />
            </PaginationItem>

            {pages.map((p, idx) => {
              if (p === 'ellipsis') {
                return (
                  <PaginationItem key={`ellipsis-${idx}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                );
              }

              const isActive = p === currentPage;
              return (
                <PaginationItem key={`page-${p}`}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => handlePageSelect(p, e)}
                    isActive={isActive}
                    className={cn(
                      'cursor-pointer select-none h-9 w-9 rounded-lg border text-sm font-semibold transition-all duration-150',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground'
                        : 'border-border bg-card/40 text-foreground hover:border-primary/50 hover:bg-secondary/70'
                    )}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              );
            })}

            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => handlePageSelect(currentPage + 1, e)}
                className={cn(
                  'cursor-pointer select-none rounded-lg border border-border bg-card/40 transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground',
                  currentPage >= totalPages && 'pointer-events-none opacity-40 hover:bg-card/40 hover:text-inherit'
                )}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
};

export default AppPagination;
