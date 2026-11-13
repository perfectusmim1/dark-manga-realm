import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getMangaTypeLabel } from '@/lib/mangaType';
import type { ProfileLibraryItem } from '@/lib/profile';
import { cn } from '@/lib/utils';

interface ProfileLibraryTabProps {
  items: ProfileLibraryItem[];
  canViewHistory: boolean;
}

type LibraryFilter = 'all' | 'ongoing' | 'completed';

/**
 * Profile `Kitaplık` tab with search, status filtering, and per-series chapter progress bars.
 */
const ProfileLibraryTab: React.FC<ProfileLibraryTabProps> = ({ items, canViewHistory }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LibraryFilter>('all');

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.title.toLowerCase().includes(q)) return false;
      if (statusFilter === 'completed') {
        const isSeriesCompleted =
          (item.status || '').toLowerCase().includes('tamam') ||
          (canViewHistory && item.chapterCount > 0 && item.readChaptersCount >= item.chapterCount);
        if (!isSeriesCompleted) return false;
      } else if (statusFilter === 'ongoing') {
        const isOngoing = !(item.status || '').toLowerCase().includes('tamam');
        if (!isOngoing) return false;
      }
      return true;
    });
  }, [canViewHistory, items, search, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kitaplıkta ara..."
            className="h-9 bg-card/60 pl-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-1">
          {(
            [
              { id: 'all', label: 'Tümü' },
              { id: 'ongoing', label: 'Devam Ediyor' },
              { id: 'completed', label: 'Tamamlandı' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setStatusFilter(option.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                statusFilter === option.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? 'Kitaplıkta takip edilen seri bulunmuyor.'
            : 'Arama kriterine uyan seri bulunamadı.'}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredItems.map((item) => {
            const total = Math.max(0, item.chapterCount);
            const read = Math.min(total || item.readChaptersCount, item.readChaptersCount);
            const progressPct =
              canViewHistory && total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;

            return (
              <Link
                key={item.id}
                to={`/manga/${item.id}`}
                className="group flex gap-3 rounded-xl border border-border/75 bg-card/65 p-3 transition-colors hover:border-primary/40 hover:bg-card"
              >
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {item.cover ? (
                    <img
                      src={item.cover}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                  <div>
                    <h3 className="line-clamp-1 text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                      {item.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[getMangaTypeLabel(item.type), item.status].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  {canViewHistory && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                        <span>
                          {total > 0 ? `${read} / ${total} bölüm` : `${read} bölüm`}
                        </span>
                        {item.lastReadChapter ? (
                          <span className="font-medium text-foreground/85">
                            Son: Bl. {item.lastReadChapter}
                          </span>
                        ) : null}
                      </div>
                      {total > 0 && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProfileLibraryTab;
