import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Crown, Heart, ListChecks, Medal, MessageSquare, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCompletedChapterCountsByUser } from '@/lib/storage';
import { dedupeById } from '@/lib/forum';
import { getStaffTextClassName } from '@/lib/staffRoles';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';
import ReadingListCover from '@/components/manga/ReadingListCover';
import StaffBadge from '@/components/user/StaffBadge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type LeaderCategory = 'chapters' | 'comments' | 'reading_lists';

interface UserSummary {
  id: string;
  username: string;
  avatar?: string;
  role?: User['role'];
}

interface LeaderboardEntry {
  id: string;
  title: string;
  subtitle?: string;
  link: string;
  ownerLink?: string;
  ownerName?: string;
  ownerRole?: User['role'];
  avatarUrl?: string;
  coverUrl?: string;
  value: number;
  unitLabel: string;
  role?: User['role'];
}

const INITIAL_VISIBLE_COUNT = 20;
const LOAD_MORE_STEP = 20;

const LEADER_TABS: Array<{ id: LeaderCategory; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'chapters', label: 'En Çok Okuyanlar', icon: BookOpen },
  { id: 'comments', label: 'En Çok Yorum', icon: MessageSquare },
  { id: 'reading_lists', label: 'Süper Listeler', icon: ListChecks },
];

const normalizeRole = (role: unknown): User['role'] | undefined => {
  if (role === 'admin' || role === 'moderator' || role === 'user') return role;
  return undefined;
};

const getInitials = (name?: string | null): string => (name || 'U').trim().slice(0, 2).toUpperCase();

const fetchUsersMap = async (userIds: string[]): Promise<Map<string, UserSummary>> => {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const map = new Map<string, UserSummary>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from('users')
    .select('id, username, avatar, role')
    .in('id', uniqueIds);

  if (error) {
    console.error('Liderlik kullanıcı bilgisi hatası:', error);
    return map;
  }

  for (const row of (data || []) as Record<string, unknown>[]) {
    map.set(String(row.id), {
      id: String(row.id),
      username: String(row.username || 'Kullanıcı'),
      avatar: typeof row.avatar === 'string' && row.avatar ? row.avatar : undefined,
      role: normalizeRole(row.role),
    });
  }

  return map;
};

const LeadersTab: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<LeaderCategory>('chapters');
  const [entriesByCategory, setEntriesByCategory] = useState<
    Partial<Record<LeaderCategory, LeaderboardEntry[]>>
  >({});
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [isLoading, setIsLoading] = useState(true);
  const [presenceCounts, setPresenceCounts] = useState<{ online: number; offline: number }>({
    online: 0,
    offline: 0,
  });

  // Fetch public user presence counts once
  useEffect(() => {
    let cancelled = false;
    const loadPresence = async () => {
      try {
        const { data, error } = await supabase.rpc('get_public_user_presence_counts');
        if (error || cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        setPresenceCounts({
          online: Number(row?.online_count || 0),
          offline: Number(row?.offline_count || 0),
        });
      } catch (err) {
        console.error('Kullanıcı çevrimiçi sayıları alınamadı:', err);
      }
    };

    loadPresence();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset visible pagination when switching leaderboard category
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [activeCategory]);

  // Fetch leaderboard for active category if not yet cached
  useEffect(() => {
    if (entriesByCategory[activeCategory]) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const loadLeaderboard = async () => {
      setIsLoading(true);
      try {
        let loaded: LeaderboardEntry[] = [];

        if (activeCategory === 'chapters') {
          const countsByUser = await getCompletedChapterCountsByUser();
          const ranked = Object.entries(countsByUser)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 60);

          const usersMap = await fetchUsersMap(ranked.map(([userId]) => userId));
          loaded = ranked
            .map(([userId, count]): LeaderboardEntry | null => {
              const profile = usersMap.get(userId);
              if (!profile) return null;
              return {
                id: profile.id,
                title: profile.username,
                link: `/profile/${profile.id}`,
                avatarUrl: profile.avatar,
                role: profile.role,
                value: count,
                unitLabel: 'bölüm',
              };
            })
            .filter((item): item is LeaderboardEntry => item !== null);
        } else if (activeCategory === 'comments') {
          const { data, error } = await supabase.from('comments').select('user_id');
          if (error) throw error;

          const countMap = new Map<string, number>();
          for (const row of (data || []) as Array<{ user_id: string | null }>) {
            if (!row.user_id) continue;
            countMap.set(row.user_id, (countMap.get(row.user_id) || 0) + 1);
          }

          const ranked = Array.from(countMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 60);

          const usersMap = await fetchUsersMap(ranked.map(([userId]) => userId));
          loaded = ranked
            .map(([userId, count]): LeaderboardEntry | null => {
              const profile = usersMap.get(userId);
              if (!profile) return null;
              return {
                id: profile.id,
                title: profile.username,
                link: `/profile/${profile.id}`,
                avatarUrl: profile.avatar,
                role: profile.role,
                value: count,
                unitLabel: 'yorum',
              };
            })
            .filter((item): item is LeaderboardEntry => item !== null);
        } else {
          const { data: likeRows, error: likesError } = await supabase
            .from('reading_list_likes')
            .select('list_id');
          if (likesError) throw likesError;

          const likeCountMap = new Map<string, number>();
          for (const row of (likeRows || []) as Array<{ list_id: string | null }>) {
            if (!row.list_id) continue;
            likeCountMap.set(row.list_id, (likeCountMap.get(row.list_id) || 0) + 1);
          }

          const topListIds = Array.from(likeCountMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 60)
            .map(([listId]) => listId);

          if (topListIds.length > 0) {
            const { data: listsData, error: listsError } = await supabase
              .from('reading_lists')
              .select('id, name, user_id, image_url, is_public')
              .in('id', topListIds)
              .eq('is_public', true);
            if (listsError) throw listsError;

            const listRows = (listsData || []) as Array<{
              id: string;
              name: string;
              user_id: string;
              image_url?: string | null;
            }>;
            const listMap = new Map(listRows.map((row) => [row.id, row]));
            const usersMap = await fetchUsersMap(listRows.map((row) => row.user_id));

            loaded = topListIds
              .map((listId): LeaderboardEntry | null => {
                const list = listMap.get(listId);
                if (!list) return null;
                const owner = usersMap.get(list.user_id);
                return {
                  id: list.id,
                  title: list.name,
                  link: `/reading-lists/${list.id}`,
                  ownerLink: owner ? `/profile/${owner.id}` : undefined,
                  ownerName: owner?.username || 'Kullanıcı',
                  ownerRole: owner?.role,
                  coverUrl: list.image_url || undefined,
                  value: likeCountMap.get(listId) || 0,
                  unitLabel: 'beğeni',
                };
              })
              .filter((item): item is LeaderboardEntry => item !== null);
          }
        }

        if (!cancelled) {
          const deduped = dedupeById(loaded);
          setEntriesByCategory((prev) => ({
            ...prev,
            [activeCategory]: deduped,
          }));
        }
      } catch (err) {
        console.error('Liderlik verisi yüklenemedi:', err);
        if (!cancelled) {
          setEntriesByCategory((prev) => ({
            ...prev,
            [activeCategory]: [],
          }));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadLeaderboard();
    return () => {
      cancelled = true;
    };
  }, [activeCategory, entriesByCategory]);

  const entries = useMemo(
    () => entriesByCategory[activeCategory] || [],
    [entriesByCategory, activeCategory],
  );

  const podiumEntries = entries.slice(0, 3);
  const restEntries = entries.slice(3, visibleCount);
  const hasMore = entries.length > visibleCount;
  const isReadingListMode = activeCategory === 'reading_lists';

  return (
    <div className="space-y-6 min-w-0">
      {/* Header & Online Presence */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Liderler</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            En aktif okurlar, yorumcular ve en çok beğenilen okuma listeleri.
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/60 px-4 py-2.5 text-sm shrink-0 w-fit">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-muted-foreground">Aktif:</span>
            <span className="font-semibold tabular-nums">{presenceCounts.online}</span>
          </div>
          <div className="h-4 w-px bg-border/70" />
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Çevrimdışı:</span>
            <span className="font-semibold tabular-nums">{presenceCounts.offline}</span>
          </div>
        </div>
      </div>

      {/* Category Switcher */}
      <div className="flex flex-wrap gap-2">
        {LEADER_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeCategory === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCategory(tab.id)}
              className={cn(
                'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card/60 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/40',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Leaderboard Content */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-40 w-full rounded-xl" />
            ))}
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/40 p-10 text-center text-sm text-muted-foreground">
          Bu kategori için henüz sıralama verisi bulunmuyor.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top-3 Podium */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            {podiumEntries.map((entry, index) => {
              const rank = index + 1;
              const desktopOrderClass =
                rank === 1 ? 'sm:order-2' : rank === 2 ? 'sm:order-1' : 'sm:order-3';

              const rankAccentClass =
                rank === 1
                  ? 'border-amber-400/60 bg-amber-500/5'
                  : rank === 2
                    ? 'border-slate-400/50 bg-card/60'
                    : 'border-amber-700/40 bg-card/60';

              const nameRole = isReadingListMode ? entry.ownerRole : entry.role;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    'rounded-xl border p-4 sm:p-5 flex flex-col items-center text-center gap-3 min-w-0',
                    rankAccentClass,
                    desktopOrderClass,
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {rank === 1 ? (
                      <Crown className="h-4 w-4 text-amber-400" />
                    ) : (
                      <Medal
                        className={cn(
                          'h-4 w-4',
                          rank === 2 ? 'text-slate-300' : 'text-amber-600',
                        )}
                      />
                    )}
                    <span>#{rank}</span>
                  </div>

                  <Link to={entry.link} className="shrink-0">
                    {isReadingListMode ? (
                      <ReadingListCover
                        imageUrl={entry.coverUrl}
                        alt={entry.title}
                        className="h-16 w-16 rounded-xl border border-border/60"
                        showLabel={false}
                      />
                    ) : (
                      <Avatar
                        className={cn(
                          'border-2',
                          rank === 1
                            ? 'h-16 w-16 border-amber-400/70'
                            : 'h-14 w-14 border-border',
                        )}
                      >
                        <AvatarImage src={entry.avatarUrl || undefined} alt={entry.title} />
                        <AvatarFallback>{getInitials(entry.title)}</AvatarFallback>
                      </Avatar>
                    )}
                  </Link>

                  <div className="w-full min-w-0 space-y-1">
                    <div className="flex items-center justify-center gap-1.5 min-w-0">
                      <Link
                        to={entry.link}
                        className={cn(
                          'font-semibold text-sm sm:text-base hover:underline truncate',
                          !isReadingListMode && getStaffTextClassName(nameRole),
                        )}
                      >
                        {entry.title}
                      </Link>
                      {!isReadingListMode && <StaffBadge role={entry.role} compact />}
                    </div>

                    {isReadingListMode && entry.ownerName && entry.ownerLink && (
                      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground min-w-0">
                        <Link
                          to={entry.ownerLink}
                          className={cn(
                            'hover:underline truncate max-w-[160px]',
                            getStaffTextClassName(entry.ownerRole),
                          )}
                        >
                          {entry.ownerName}
                        </Link>
                        <StaffBadge role={entry.ownerRole} compact />
                      </div>
                    )}
                  </div>

                  <div className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground tabular-nums">
                    {isReadingListMode && <Heart className="h-3.5 w-3.5 text-rose-500 fill-current" />}
                    <span>{entry.value.toLocaleString('tr-TR')}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {entry.unitLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ranked List #4+ */}
          {restEntries.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card/40 divide-y divide-border/50">
              {restEntries.map((entry, idx) => {
                const rank = idx + 4;

                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 text-xs font-semibold text-muted-foreground tabular-nums shrink-0">
                        #{rank}
                      </span>

                      <Link to={entry.link} className="shrink-0">
                        {isReadingListMode ? (
                          <ReadingListCover
                            imageUrl={entry.coverUrl}
                            alt={entry.title}
                            className="h-9 w-9 rounded-lg border border-border/60"
                            showLabel={false}
                          />
                        ) : (
                          <Avatar className="h-9 w-9 border border-border/60">
                            <AvatarImage src={entry.avatarUrl || undefined} alt={entry.title} />
                            <AvatarFallback className="text-xs">
                              {getInitials(entry.title)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </Link>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Link
                            to={entry.link}
                            className={cn(
                              'text-sm font-medium hover:underline truncate',
                              !isReadingListMode && getStaffTextClassName(entry.role),
                            )}
                          >
                            {entry.title}
                          </Link>
                          {!isReadingListMode && <StaffBadge role={entry.role} compact />}
                        </div>

                        {isReadingListMode && entry.ownerName && entry.ownerLink && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                            <Link
                              to={entry.ownerLink}
                              className={cn(
                                'hover:underline truncate',
                                getStaffTextClassName(entry.ownerRole),
                              )}
                            >
                              {entry.ownerName}
                            </Link>
                            <StaffBadge role={entry.ownerRole} compact />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 tabular-nums">
                      <span className="text-sm font-semibold text-foreground">
                        {entry.value.toLocaleString('tr-TR')}
                      </span>{' '}
                      <span className="text-xs text-muted-foreground">{entry.unitLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_STEP)}
              >
                Daha fazla yükle
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LeadersTab;
