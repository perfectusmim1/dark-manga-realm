import React, { useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trophy, BookOpen, MessageSquare, Flame, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import ReadingListCover from '@/components/manga/ReadingListCover';
import { getCompletedChapterCountsByUser } from '@/lib/storage';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

interface LeaderboardUser {
  id: string;
  username: string;
  avatar: string | null;
  imageUrl?: string | null;
  totalChapters: number;
  totalComments: number;
  isList?: boolean;
  listAuthor?: string;
  listLikes?: number;
}

interface UserStats {
  online: number;
  offline: number;
}

const Community: React.FC = () => {
  const { isOnline } = useEffectiveOnlineStatus();
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<'chapters' | 'comments' | 'reading_lists'>('chapters');
  const [visibleCount, setVisibleCount] = useState(20);
  const [userStats, setUserStats] = useState<UserStats>({ online: 0, offline: 0 });
  const PAGE_SIZE = 20;

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Topluluk sıralamaları için internet bağlantısı gerekiyor."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setUsers([]);
    const fetchLeaderboard = async () => {
      try {
        setLoading(true);
        let userCounts: Record<string, number> = {};

        if (category === 'reading_lists') {
          const { data: likes } = await supabase.from('reading_list_likes').select('list_id');
          const listCounts: Record<string, number> = {};
          likes?.forEach((r: any) => { listCounts[r.list_id] = (listCounts[r.list_id] || 0) + 1; });
          const topListIds = Object.keys(listCounts).sort((a, b) => listCounts[b] - listCounts[a]).slice(0, 50);

          if (topListIds.length === 0) {
            setUsers([]); setLoading(false); return;
          }

          const { data: listsData } = await supabase.from('reading_lists').select('id, name, user_id, image_url').in('id', topListIds);
          const userIds = [...new Set(listsData?.map(l => l.user_id))];
          const { data: listAuthors } = await supabase.from('users').select('id, username').in('id', userIds);
          const authorMap = listAuthors?.reduce((acc: any, u: any) => ({ ...acc, [u.id]: u.username }), {});

          const leaderboard = listsData?.map(l => ({
            id: l.id,
            username: l.name,
            avatar: null,
            totalChapters: 0,
            totalComments: 0,
            isList: true,
            imageUrl: l.image_url,
            listAuthor: authorMap?.[l.user_id] || 'Bilinmiyor',
            listLikes: listCounts[l.id] || 0
          })).sort((a, b) => (b.listLikes || 0) - (a.listLikes || 0)) || [];

          setUsers(leaderboard as any);
          return;
        }

        if (category === 'chapters') {
          userCounts = await getCompletedChapterCountsByUser();
        } else {
          const { data, error } = await supabase.from('comments').select('user_id');
          if (error) throw error;
          data.forEach((r: any) => { userCounts[r.user_id] = (userCounts[r.user_id] || 0) + 1; });
        }

        const topUserIds = Object.keys(userCounts).sort((a, b) => userCounts[b] - userCounts[a]).slice(0, 50);

        if (topUserIds.length === 0) {
          setUsers([]);
          setLoading(false);
          return;
        }

        const { data: userDetails } = await supabase
          .from('users')
          .select('id, username, avatar')
          .in('id', topUserIds);

        const leaderboard = userDetails?.map(u => ({
          id: u.id,
          username: u.username,
          avatar: u.avatar,
          totalChapters: category === 'chapters' ? (userCounts[u.id] || 0) : 0,
          totalComments: category === 'comments' ? (userCounts[u.id] || 0) : 0
        })).sort((a, b) => category === 'chapters' ? (b.totalChapters - a.totalChapters) : (b.totalComments - a.totalComments)) || [];

        setUsers(leaderboard);
      } catch (err) {
        console.error('Leaderboard error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [category]);

  useEffect(() => {
    const fetchUserStats = async () => {
      try {
        const { data: presenceCounts, error: presenceError } = await supabase
          .rpc('get_public_user_presence_counts');

        if (presenceError) throw presenceError;

        const presenceRow = Array.isArray(presenceCounts) ? presenceCounts[0] : presenceCounts;
        setUserStats({
          online: Number(presenceRow?.online_count || 0),
          offline: Number(presenceRow?.offline_count || 0),
        });
      } catch (err) {
        console.error('User stats fetch error:', err);
      }
    };

    fetchUserStats();

    const interval = setInterval(() => {
      fetchUserStats();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const handleLoadMore = () => {
    if (loading) {
      return;
    }

    setVisibleCount(prev => prev + PAGE_SIZE);
  };

  const visibleItems = users.slice(0, visibleCount);
  const canLoadMore = users.length > visibleCount;

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!canLoadMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleLoadMore();
        }
      },
      { threshold: 1.0 }
    );

    const loader = document.getElementById('infinite-scroll-loader');
    if (loader) observer.observe(loader);

    return () => observer.disconnect();
  }, [canLoadMore, loading, users.length, visibleCount]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="container max-w-4xl animate-in fade-in slide-in-from-bottom-4 px-3 pb-12 pt-20 duration-500 sm:px-4 sm:pt-24">
        <div className="mb-8 text-center sm:mb-12">
          <h1 className="flex items-center justify-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            <Trophy className="h-8 w-8 text-yellow-500 sm:h-10 sm:w-10" />
            Topluluk Liderleri
          </h1>
          <p className="mx-auto mb-6 mt-2 max-w-xl text-muted-foreground sm:mb-8">
            Platformdaki en aktif okuyucular. Zirveye yerleşmek için daha fazla bölüm oku ve serilere yorum yap.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-4">
            <button
              onClick={() => setCategory('chapters')}
              className={`rounded-full border border-border px-4 py-2 text-sm font-bold transition-all ${category === 'chapters' ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'hover:bg-secondary/50'}`}
            >
              <span className="flex items-center justify-center gap-2">
                <BookOpen className="h-4 w-4 shrink-0" />
                <span>En Çok Okuyanlar</span>
              </span>
            </button>
            <button
              onClick={() => setCategory('comments')}
              className={`rounded-full border border-border px-4 py-2 text-sm font-bold transition-all ${category === 'comments' ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'hover:bg-secondary/50'}`}
            >
              <span className="flex items-center justify-center gap-2">
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span>En Çok Yorum</span>
              </span>
            </button>
            <button
              onClick={() => setCategory('reading_lists')}
              className={`rounded-full border border-border px-4 py-2 text-sm font-bold transition-all ${category === 'reading_lists' ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'hover:bg-secondary/50'}`}
            >
              <span className="flex items-center justify-center gap-2">
                <Heart className="h-4 w-4 shrink-0" />
                <span>Süper Listeler</span>
              </span>
            </button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 animate-in fade-in zoom-in duration-300 sm:mb-8 sm:flex sm:justify-center sm:gap-6">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/50 px-4 py-3 shadow-sm sm:px-6">
            <div className="h-3 w-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse" />
            <span className="text-sm font-semibold">{userStats.online} Aktif Üye</span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/30 px-4 py-3 text-muted-foreground/70 shadow-sm sm:px-6">
            <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
            <span className="text-sm font-semibold">{userStats.offline} Çevrimdışı</span>
          </div>
        </div>
        {loading && visibleItems.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-border bg-card/30 animate-fade-in">
            <div className="flex flex-col items-center gap-4">
              <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground animate-pulse">Topluluk verileri yükleniyor...</p>
            </div>
          </div>
        ) : (
          <div className={`overflow-hidden rounded-xl border border-border bg-card/50 shadow-sm backdrop-blur-sm transition-opacity duration-200 ${loading ? 'opacity-75' : 'opacity-100'}`}>
            <div className="hidden items-center border-b border-border bg-secondary/20 px-6 py-4 sm:flex">
              <span className="w-12 text-center text-sm font-semibold text-muted-foreground">Sıra</span>
              <span className="ml-4 flex-1 text-sm font-semibold text-muted-foreground">{category === 'reading_lists' ? 'Liste Bilgisi' : 'Kullanıcı'}</span>
              <span className="w-32 text-right text-sm font-semibold text-muted-foreground">
                {category === 'chapters' ? 'Bölüm' : category === 'comments' ? 'Yorum' : 'Beğeni'}
              </span>
            </div>

            <div className="divide-y divide-border">
              {visibleItems.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">Henüz veri yok. İlk okuyan sen ol!</div>
              ) : (
                visibleItems.map((user, index) => (
                  <Link
                    key={user.id}
                    to={user.isList ? `/reading-lists/${user.id}` : `/profile/${user.id}`}
                    className="group flex items-start gap-3 px-3 py-3 transition-all hover:bg-secondary/40 sm:items-center sm:px-6 sm:py-4"
                  >
                    <div className="flex w-8 shrink-0 justify-center pt-1 sm:w-12 sm:pt-0">
                      {index === 0 ? (
                        <div className="relative">
                          <Flame className="w-8 h-8 text-orange-500 animate-pulse absolute -top-1 -left-1 opacity-50 blur-sm" />
                          <Trophy className="w-6 h-6 text-yellow-500 relative z-10" />
                        </div>
                      ) : index === 1 ? (
                        <Trophy className="w-6 h-6 text-slate-300" />
                      ) : index === 2 ? (
                        <Trophy className="w-6 h-6 text-amber-600" />
                      ) : (
                        <span className="text-xl font-bold text-muted-foreground/50">{index + 1}</span>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 items-start gap-3 sm:ml-4 sm:items-center sm:gap-4">
                      {user.isList ? (
                        <ReadingListCover
                          imageUrl={user.imageUrl}
                          alt={user.username}
                          className="h-10 w-10 shrink-0 rounded-lg border-2 border-transparent group-hover:border-primary sm:h-12 sm:w-12"
                          iconClassName="h-6 w-6"
                        />
                      ) : (
                        <div className="relative">
                          <Avatar className={`h-10 w-10 border-2 ${index === 0 ? 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-transparent group-hover:border-primary transition-colors'} sm:h-12 sm:w-12`}>
                            <AvatarImage src={user.avatar || undefined} />
                            <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                          </Avatar>
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <h3 className={`line-clamp-2 text-base font-bold leading-5 sm:text-lg ${index === 0 ? 'text-yellow-500 group-hover:text-yellow-400' : 'group-hover:text-primary transition-colors'}`}>
                          {user.username}
                        </h3>
                        {user.isList && <p className="text-xs text-muted-foreground flex gap-1 items-center mt-1">Oluşturan: <span className="text-primary font-medium">{user.listAuthor}</span></p>}
                        {index === 0 && !user.isList && <Badge variant="outline" className="text-[10px] mt-1 border-yellow-500/30 text-yellow-500 bg-yellow-500/10">Sitenin 1 Numarası</Badge>}
                        {index === 0 && user.isList && <Badge variant="outline" className="text-[10px] mt-1 border-yellow-500/30 text-yellow-500 bg-yellow-500/10">Kral Liste</Badge>}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 self-center text-xs font-bold font-mono text-primary sm:w-40">
                      <>
                        {category === 'chapters' ? <BookOpen className="h-4 w-4 text-muted-foreground" /> : category === 'comments' ? <MessageSquare className="h-4 w-4 text-muted-foreground" /> : <Heart className="h-4 w-4 text-red-500" />}
                        <span className="text-base font-bold sm:text-lg">{category === 'chapters' ? user.totalChapters : category === 'comments' ? user.totalComments : user.listLikes}</span>
                      </>
                    </div>
                  </Link>
                ))
              )}

              {canLoadMore && (
                <div id="infinite-scroll-loader" className="p-12 flex flex-col items-center justify-center gap-4">
                  <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm font-medium text-muted-foreground animate-pulse text-center">
                    Daha fazla lider yükleniyor...
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Community;
