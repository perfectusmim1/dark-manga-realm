import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { BookOpen, Loader2, UserCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import StaffBadge from '@/components/user/StaffBadge';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMangaReadersList,
  MangaReaderItem,
  MangaReadersSummary,
} from '@/lib/database';
import { followUser, unfollowUser } from '@/lib/profile';
import { cn } from '@/lib/utils';

interface SeriesReadersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mangaId: string;
  summary: MangaReadersSummary;
}

const PAGE_SIZE = 30;

export const SeriesReadersModal: React.FC<SeriesReadersModalProps> = ({
  open,
  onOpenChange,
  mangaId,
  summary,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'reading' | 'library'>('reading');
  const [items, setItems] = useState<MangaReaderItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pendingFollowIds, setPendingFollowIds] = useState<Record<string, boolean>>({});

  const loadList = useCallback(
    async (tab: 'reading' | 'library', offset = 0, append = false) => {
      if (!mangaId) return;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const res = await getMangaReadersList(mangaId, tab, PAGE_SIZE, offset);
        setItems((prev) => {
          if (!append) return res.items;
          const seen = new Set(prev.map((row) => row.id));
          return [...prev, ...res.items.filter((row) => !seen.has(row.id))];
        });
        setHasMore(res.hasMore);
      } catch (error) {
        console.error('Okurlar listesi alınamadı:', error);
        if (!append) {
          setItems([]);
          setHasMore(false);
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [mangaId],
  );

  useEffect(() => {
    if (!open) return;
    if (summary.activeCount === 0 && summary.libraryCount > 0 && activeTab === 'reading') {
      setActiveTab('library');
      void loadList('library', 0, false);
      return;
    }
    void loadList(activeTab, 0, false);
  }, [open, activeTab, loadList, summary.activeCount, summary.libraryCount]);

  const handleToggleFollow = async (target: MangaReaderItem) => {
    if (!user) {
      toast.error('Takip etmek için giriş yapmalısınız.');
      return;
    }
    if (user.id === target.id || pendingFollowIds[target.id]) {
      return;
    }

    const nextFollowing = !target.isFollowing;
    setPendingFollowIds((prev) => ({ ...prev, [target.id]: true }));
    setItems((prev) =>
      prev.map((row) => (row.id === target.id ? { ...row, isFollowing: nextFollowing } : row)),
    );

    try {
      if (nextFollowing) {
        const { error } = await followUser(user.id, target.id);
        if (error) throw error;
      } else {
        const { error } = await unfollowUser(user.id, target.id);
        if (error) throw error;
      }
    } catch (error) {
      setItems((prev) =>
        prev.map((row) => (row.id === target.id ? { ...row, isFollowing: !nextFollowing } : row)),
      );
      console.error('Takip durumu güncellenemedi:', error);
      toast.error('Takip işlemi başarısız oldu.');
    } finally {
      setPendingFollowIds((prev) => ({ ...prev, [target.id]: false }));
    }
  };

  const formatActivity = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return formatDistanceToNow(d, { addSuffix: true, locale: tr });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-[min(94vw,30rem)] max-w-none flex-col overflow-hidden rounded-2xl border-border/80 bg-card/95 p-0 backdrop-blur-xl">
        <DialogHeader className="shrink-0 px-5 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <BookOpen className="h-4 w-4" />
            </span>
            <span>Okurlar</span>
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 pb-3">
          <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-secondary/40 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('reading')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                activeTab === 'reading'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span>Şu anda okuyanlar</span>
              <span className="text-emerald-400 tabular-nums">{summary.activeCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                activeTab === 'library'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span>Kitaplığında</span>
              <span className="text-muted-foreground tabular-nums">{summary.libraryCount}</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              {activeTab === 'reading'
                ? 'Şu anda aktif bölüm okuyan kullanıcı görünmüyor.'
                : 'Henüz bu seriyi kitaplığına ekleyen kullanıcı yok.'}
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((reader) => {
                const isSelf = user?.id === reader.id;
                const role =
                  reader.role === 'admin' || reader.role === 'moderator' || reader.role === 'user'
                    ? reader.role
                    : undefined;
                return (
                  <div
                    key={reader.id}
                    className="flex items-center justify-between gap-3 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-secondary/40"
                  >
                    <Link
                      to={`/profile/${reader.id}`}
                      onClick={() => onOpenChange(false)}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <Avatar className="h-9 w-9 shrink-0 border border-border/60">
                        <AvatarImage src={reader.avatar || undefined} />
                        <AvatarFallback className="text-xs font-semibold">
                          {reader.username[0]?.toUpperCase() || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-foreground hover:underline">
                            {reader.username}
                          </span>
                          <StaffBadge role={role} compact />
                        </div>
                        {reader.activityAt && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {formatActivity(reader.activityAt)}
                          </p>
                        )}
                      </div>
                    </Link>

                    {!isSelf && (
                      <Button
                        type="button"
                        size="sm"
                        variant={reader.isFollowing ? 'secondary' : 'default'}
                        disabled={Boolean(pendingFollowIds[reader.id])}
                        onClick={() => void handleToggleFollow(reader)}
                        className={cn(
                          'h-8 shrink-0 rounded-full px-3.5 text-xs font-semibold',
                          !reader.isFollowing && 'bg-foreground text-background hover:bg-foreground/90',
                        )}
                      >
                        {reader.isFollowing ? (
                          <>
                            <UserCheck className="mr-1 h-3.5 w-3.5" />
                            Takip
                          </>
                        ) : (
                          <>
                            <UserPlus className="mr-1 h-3.5 w-3.5" />
                            Takip et
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}

              {hasMore && (
                <div className="pt-2 text-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isLoadingMore}
                    onClick={() => void loadList(activeTab, items.length, true)}
                    className="h-8 rounded-lg text-xs"
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Yükleniyor...
                      </>
                    ) : (
                      'Daha fazla göster'
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
