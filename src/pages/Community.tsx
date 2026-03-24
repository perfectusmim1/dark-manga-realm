import React, { useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trophy, BookOpen, MessageSquare, Flame, Heart, List as ListIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface LeaderboardUser {
  id: string; // User ID or List ID
  username: string; // Username or List Name
  avatar: string | null;
  totalChapters: number;
  totalComments: number;
  isList?: boolean;
  listAuthor?: string;
  listLikes?: number;
}

const Community: React.FC = () => {
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<'chapters' | 'comments' | 'reading_lists'>('chapters');

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        setLoading(true);
        let userCounts: Record<string, number> = {};

        if (category === 'reading_lists') {
            const { data: likes } = await supabase.from('reading_list_likes').select('list_id');
            const listCounts: Record<string, number> = {};
            likes?.forEach((r: any) => { listCounts[r.list_id] = (listCounts[r.list_id] || 0) + 1; });
            const topListIds = Object.keys(listCounts).sort((a,b) => listCounts[b] - listCounts[a]).slice(0, 50);

            if (topListIds.length === 0) {
               setUsers([]); setLoading(false); return;
            }

            const { data: listsData } = await supabase.from('reading_lists').select('id, name, user_id').in('id', topListIds);
            
            const userIds = [...new Set(listsData?.map(l => l.user_id))];
            const { data: listAuthors } = await supabase.from('users').select('id, username').in('id', userIds);
            const authorMap = listAuthors?.reduce((acc: any, u: any) => ({...acc, [u.id]: u.username}), {});

            const leaderboard = listsData?.map(l => ({
                id: l.id,
                username: l.name,
                avatar: null,
                totalChapters: 0,
                totalComments: 0,
                isList: true,
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
        
        const topUserIds = Object.keys(userCounts).sort((a,b) => userCounts[b] - userCounts[a]).slice(0, 50);

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
          </div>
        </div>

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
              <span className="flex-1 text-sm font-semibold text-muted-foreground ml-4">{category === 'reading_lists' ? 'Liste Bilgisi' : 'Kullanıcı'}</span>
              <span className="w-32 text-right text-sm font-semibold text-muted-foreground">{category === 'chapters' ? 'Bölüm' : category === 'comments' ? 'Yorum' : 'Beğeni'}</span>
            </div>
            
            <div className="divide-y divide-border">
              {users.length === 0 ? (
                 <div className="p-8 text-center text-muted-foreground">Henüz veri yok. İlk okuyan sen ol!</div>
              ) : (
                users.map((user, index) => (
                  <Link 
                    key={user.id} 
                    to={user.isList ? `/reading-lists/${user.id}` : `/profile/${user.id}`}
                    className="flex items-center px-6 py-4 hover:bg-secondary/40 transition-colors group"
                  >
                    <div className="w-12 flex justify-center">
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
                    
                    <div className="flex-1 flex items-center ml-4 gap-4">
                      {user.isList ? (
                         <div className="h-12 w-12 rounded-lg bg-primary/20 flex flex-shrink-0 items-center justify-center border-2 border-transparent group-hover:border-primary transition-colors text-primary">
                            <ListIcon className="w-6 h-6" />
                         </div>
                      ) : (
                         <Avatar className={`h-12 w-12 border-2 ${index === 0 ? 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-transparent group-hover:border-primary transition-colors'}`}>
                           <AvatarImage src={user.avatar || undefined} />
                           <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                         </Avatar>
                      )}

                      <div>
                        <h3 className={`font-bold text-lg ${index === 0 ? 'text-yellow-500 group-hover:text-yellow-400' : 'group-hover:text-primary transition-colors'}`}>
                          {user.username}
                        </h3>
                        {user.isList && <p className="text-xs text-muted-foreground flex gap-1 items-center mt-1">Oluşturan: <span className="text-primary font-medium">{user.listAuthor}</span></p>}
                        {index === 0 && !user.isList && <Badge variant="outline" className="text-[10px] mt-1 border-yellow-500/30 text-yellow-500 bg-yellow-500/10">Sitenin 1 Numarası</Badge>}
                        {index === 0 && user.isList && <Badge variant="outline" className="text-[10px] mt-1 border-yellow-500/30 text-yellow-500 bg-yellow-500/10">Kral Liste</Badge>}
                      </div>
                    </div>
                    
                    <div className="w-32 flex items-center justify-end gap-2 text-primary font-mono text-lg font-bold">
                      {category === 'chapters' ? <BookOpen className="w-4 h-4 text-muted-foreground" /> : category === 'comments' ? <MessageSquare className="w-4 h-4 text-muted-foreground" /> : <Heart className="w-4 h-4 text-red-500" />}
                      {category === 'chapters' ? user.totalChapters : category === 'comments' ? user.totalComments : user.listLikes}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Community;
