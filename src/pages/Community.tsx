import React, { useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trophy, BookOpen, MessageSquare, Flame, Heart, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import TagBadge from '@/components/tags/TagBadge';
import ReadingListCover from '@/components/manga/ReadingListCover';
import { getTrendingTags } from '@/lib/database';
import { Tag } from '@/lib/types';

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
  last_seen_at?: string;
  isOnline?: boolean;
}

interface UserStats {
  online: number;
  offline: number;
}

const Community: React.FC = () => {
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<'chapters' | 'comments' | 'reading_lists' | 'users'>('chapters');
  const [trendingTags, setTrendingTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  
  // Users list state
  const [allUsers, setAllUsers] = useState<LeaderboardUser[]>([]);
  const [userStats, setUserStats] = useState<UserStats>({ online: 0, offline: 0 });
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  useEffect(() => {
    const loadTrendingTags = async () => {
      setTagsLoading(true);
      const tags = await getTrendingTags(15);
      setTrendingTags(tags);
      setTagsLoading(false);
    };
    loadTrendingTags();
  }, []);

  useEffect(() => {
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
          const { data, error } = await supabase.from('reading_activity_log').select('user_id');
          if (error) throw error;
          data.forEach((r: any) => { userCounts[r.user_id] = (userCounts[r.user_id] || 0) + 1; });
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

  const fetchAllUsers = async (pageToFetch: number, isInitial = false) => {
    try {
      if (isInitial) {
        setLoading(true);
      }
      
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      
      // Get counts
      if (isInitial) {
        const { count: onlineCount } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gt('last_seen_at', oneMinuteAgo);
          
        const { count: totalCount } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true });
          
        setUserStats({
          online: onlineCount || 0,
          offline: (totalCount || 0) - (onlineCount || 0)
        });
      }

      // Fetch users with presence sorting
      // We use a custom sort: Online users first, then by last_seen_at
      const { data: usersData, error } = await supabase
        .from('users')
        .select('id, username, avatar, last_seen_at')
        .order('last_seen_at', { ascending: false })
        .range(pageToFetch * PAGE_SIZE, (pageToFetch + 1) * PAGE_SIZE - 1);

      if (error) throw error;

      const mappedUsers = (usersData || []).map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        totalChapters: 0,
        totalComments: 0,
        last_seen_at: u.last_seen_at,
        isOnline: u.last_seen_at ? new Date(u.last_seen_at).getTime() > Date.now() - 60000 : false
      }));

      if (isInitial) {
        setAllUsers(mappedUsers);
      } else {
        setAllUsers(prev => [...prev, ...mappedUsers]);
      }
      
      setHasMore(mappedUsers.length === PAGE_SIZE);
    } catch (err) {
      console.error('All users fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (category === 'users') {
      setPage(0);
      fetchAllUsers(0, true);
    }
  }, [category]);

  // Periodic refresh for presence (every 30s)
  useEffect(() => {
    if (category !== 'users') return;
    
    const interval = setInterval(() => {
      // We only refresh the first page's presence if we're at the top, or just refresh counts
      fetchAllUsers(0, true);
      setPage(0);
    }, 30000);
    
    return () => clearInterval(interval);
  }, [category]);

  const handleLoadMore = () => {
    if (!loading && hasMore && category === 'users') {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchAllUsers(nextPage);
    }
  };

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (category !== 'users' || !hasMore || loading) return;

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
  }, [category, hasMore, loading, page]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="container pt-24 pb-12 max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold tracking-tight flex items-center justify-center gap-3">
            <Trophy className="w-10 h-10 text-yellow-500" />
            Topluluk Liderleri
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl mx-auto mb-8">
            Platformdaki en aktif okuyucular. Zirveye yerleşmek için daha fazla bölüm oku ve serilere yorum yap.
          </p>

          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setCategory('chapters')}
              className={`px-4 py-2 rounded-full border border-border text-sm font-bold flex items-center gap-2 transition-all ${category === 'chapters' ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'hover:bg-secondary/50'}`}
            >
              <BookOpen className="w-4 h-4" /> En Çok Okuyanlar
            </button>
            <button
              onClick={() => setCategory('comments')}
              className={`px-4 py-2 rounded-full border border-border text-sm font-bold flex items-center gap-2 transition-all ${category === 'comments' ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'hover:bg-secondary/50'}`}
            >
              <MessageSquare className="w-4 h-4" /> Lider Birlik
            </button>
            <button
              onClick={() => setCategory('reading_lists')}
              className={`px-4 py-2 rounded-full border border-border text-sm font-bold flex items-center gap-2 transition-all ${category === 'reading_lists' ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'hover:bg-secondary/50'}`}
            >
              <Heart className="w-4 h-4" /> Süper Listeler
            </button>
            <button
              onClick={() => setCategory('users')}
              className={`px-4 py-2 rounded-full border border-border text-sm font-bold flex items-center gap-2 transition-all ${category === 'users' ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'hover:bg-secondary/50'}`}
            >
              <TrendingUp className="w-4 h-4" /> Tüm Üyeler
            </button>
          </div>
        </div>

        {category === 'users' && (
          <div className="flex justify-center gap-6 mb-8 animate-in fade-in zoom-in duration-300">
            <div className="bg-card/50 px-6 py-3 rounded-2xl border border-border flex items-center gap-3 shadow-sm">
              <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse" />
              <span className="text-sm font-semibold">{userStats.online} Aktif Üye</span>
            </div>
            <div className="bg-card/30 px-6 py-3 rounded-2xl border border-border flex items-center gap-3 shadow-sm text-muted-foreground/70">
              <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
              <span className="text-sm font-semibold">{userStats.offline} Çevrimdışı</span>
            </div>
          </div>
        )}



        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 bg-card/50 border border-border rounded-xl p-4">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card/50 border border-border rounded-xl shadow-sm overflow-hidden backdrop-blur-sm">
            <div className="flex items-center px-6 py-4 border-b border-border bg-secondary/20">
              <span className="w-12 text-center text-sm font-semibold text-muted-foreground">Sıra</span>
              <span className="flex-1 text-sm font-semibold text-muted-foreground ml-4">{category === 'reading_lists' ? 'Liste Bilgisi' : category === 'users' ? 'Üye Bilgisi' : 'Kullanıcı'}</span>
              <span className="w-32 text-right text-sm font-semibold text-muted-foreground">
                {category === 'chapters' ? 'Bölüm' : category === 'comments' ? 'Yorum' : category === 'reading_lists' ? 'Beğeni' : 'Durum'}
              </span>
            </div>

            <div className="divide-y divide-border">
              {(category === 'users' ? allUsers : users).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">Henüz veri yok. İlk okuyan sen ol!</div>
              ) : (
                (category === 'users' ? allUsers : users).map((user, index) => (
                  <Link
                    key={user.id}
                    to={user.isList ? `/reading-lists/${user.id}` : `/profile/${user.id}`}
                    className={`flex items-center px-6 py-4 hover:bg-secondary/40 transition-all group ${category === 'users' && !user.isOnline ? 'opacity-60 grayscale-[0.3]' : ''}`}
                  >
                    <div className="w-12 flex justify-center">
                      {category === 'users' ? (
                        <div className={`w-2 h-2 rounded-full ${user.isOnline ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]' : 'bg-muted-foreground/30'}`} />
                      ) : index === 0 ? (
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

                    <div className="flex-1 flex items-center ml-4 gap-4">
                      {user.isList ? (
                        <ReadingListCover
                          imageUrl={user.imageUrl}
                          alt={user.username}
                          className="h-12 w-12 shrink-0 rounded-lg border-2 border-transparent group-hover:border-primary"
                          iconClassName="h-6 w-6"
                        />
                      ) : (
                        <div className="relative">
                          <Avatar className={`h-12 w-12 border-2 ${category !== 'users' && index === 0 ? 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-transparent group-hover:border-primary transition-colors'}`}>
                            <AvatarImage src={user.avatar || undefined} />
                            <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                          </Avatar>
                          {category === 'users' && user.isOnline && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-background rounded-full flex items-center justify-center">
                              <div className="w-2.5 h-2.5 bg-green-500 rounded-full border border-background shadow-[0_0_3px_rgba(34,197,94,0.5)]" />
                            </div>
                          )}
                        </div>
                      )}

                      <div>
                        <h3 className={`font-bold text-lg ${category !== 'users' && index === 0 ? 'text-yellow-500 group-hover:text-yellow-400' : 'group-hover:text-primary transition-colors'}`}>
                          {user.username}
                        </h3>
                        {user.isList && <p className="text-xs text-muted-foreground flex gap-1 items-center mt-1">Oluşturan: <span className="text-primary font-medium">{user.listAuthor}</span></p>}
                        {category !== 'users' && index === 0 && !user.isList && <Badge variant="outline" className="text-[10px] mt-1 border-yellow-500/30 text-yellow-500 bg-yellow-500/10">Sitenin 1 Numarası</Badge>}
                        {category !== 'users' && index === 0 && user.isList && <Badge variant="outline" className="text-[10px] mt-1 border-yellow-500/30 text-yellow-500 bg-yellow-500/10">Kral Liste</Badge>}
                        {category === 'users' && (
                          <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                            {user.isOnline ? <span className="text-green-500">Şu an aktif</span> : <span>Son görülme: {user.last_seen_at ? new Date(user.last_seen_at).toLocaleDateString('tr-TR') : 'Bilinmiyor'}</span>}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="w-40 flex items-center justify-end gap-2 text-primary font-mono text-xs font-bold">
                      {category === 'users' ? (
                        <span className={user.isOnline ? "text-green-500 bg-green-500/10 px-2 py-1 rounded-md" : "text-muted-foreground"}>
                          {user.isOnline ? 'AKTİF' : 'ÇEVRİMDIŞI'}
                        </span>
                      ) : (
                        <>
                          {category === 'chapters' ? <BookOpen className="w-4 h-4 text-muted-foreground" /> : category === 'comments' ? <MessageSquare className="w-4 h-4 text-muted-foreground" /> : <Heart className="w-4 h-4 text-red-500" />}
                          <span className="text-lg font-bold">{category === 'chapters' ? user.totalChapters : category === 'comments' ? user.totalComments : user.listLikes}</span>
                        </>
                      )}
                    </div>
                  </Link>
                ))
              )}

              {category === 'users' && hasMore && (
                <div id="infinite-scroll-loader" className="p-12 flex flex-col items-center justify-center gap-4">
                  <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm font-medium text-muted-foreground animate-pulse text-center">Rakiplerin yükleniyor...</p>
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
