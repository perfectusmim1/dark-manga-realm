import React, { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import HeatMap from '@/components/profile/HeatMap';
import { Shield, Settings, Calendar, BookOpen, Trophy, Info, Book, MessageSquare, History, Globe, Lock, ChevronRight, List } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getUserProfile, getReadingActivity, syncAchievements } from '@/lib/profile';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { supabase } from '@/lib/supabase';

const Profile: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [profileData, setProfileData] = useState<any>(null);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [readingLists, setReadingLists] = useState<any[]>([]);
  const [tierLists, setTierLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const isOwnProfile = currentUser?.id === userId;

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        if (!userId) {
          setError('Kullanıcı bulunamadı');
          return;
        }
        
        setLoading(true);
        const [profile, activity] = await Promise.all([
          getUserProfile(userId),
          getReadingActivity(userId, 365) // Last 1 year
        ]);
        
        // Sync & Fetch Achievements in background
        const { data: unlockedData } = await syncAchievements(userId, profile.stats);
        
        // Fetch Reading Lists
        const { data: rLists } = await supabase
           .from('reading_lists')
           .select('*')
           .eq('user_id', userId)
           .eq(isOwnProfile ? 'user_id' : 'is_public', isOwnProfile ? userId : true);

        // Fetch Tier Lists
        const { data: tLists } = await supabase
           .from('tier_lists')
           .select('*')
           .eq('user_id', userId)
           .eq(isOwnProfile ? 'user_id' : 'is_public', isOwnProfile ? userId : true);

        setProfileData(profile);
        setActivityData(activity);
        setAchievements(unlockedData || []);
        setReadingLists(rLists || []);
        setTierLists(tLists || []);
      } catch (err) {
        console.error('Profile fetch error:', err);
        setError('Profil yüklenirken bir hata oluştu veya gizli tutuluyor.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProfile();
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container pt-24 pb-12 animate-pulse">
           <div className="flex flex-col md:flex-row items-center md:items-start gap-8 border-b border-border pb-8">
             <Skeleton className="w-32 h-32 md:w-40 md:h-40 rounded-full" />
             <div className="flex-1 space-y-4 w-full">
                <Skeleton className="h-8 w-48 mx-auto md:mx-0" />
                <Skeleton className="h-4 w-32 mx-auto md:mx-0" />
             </div>
           </div>
           <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
             {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
           </div>
        </main>
      </div>
    );
  }

  if (error || !profileData) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-24 text-center">
          <Shield className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-2xl font-bold mb-2">Profil Bulunamadı</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const visibility = profileData.preferences?.privacy?.visibility || 'public';
  const canView = isOwnProfile || visibility === 'public' || (visibility === 'members' && currentUser);
  
  const joinDate = new Date(profileData.created_at).toLocaleDateString('tr-TR', {
    month: 'long', 
    year: 'numeric'
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Profile Header */}
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8 border-b border-border pb-8">
          <Avatar className="w-32 h-32 md:w-40 md:h-40 border-4 border-background shadow-xl">
            <AvatarImage src={profileData.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${profileData.username}`} />
            <AvatarFallback>{profileData.username?.substring(0,2).toUpperCase()}</AvatarFallback>
          </Avatar>
          
          <div className="flex-1 text-center md:text-left space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{profileData.username}</h1>
                <p className="text-muted-foreground flex items-center justify-center md:justify-start gap-2 mt-1">
                  <Calendar className="w-4 h-4" />
                  {joinDate}'den beri üye
                </p>
              </div>
              
              {isOwnProfile && (
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/settings">
                    <Settings className="w-4 h-4" />
                    Profili Düzenle
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Content Tabs */}
        {!canView ? (
          <div className="py-24 text-center">
            <Shield className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-medium mb-2">Gizli Profil</h3>
            <p className="text-muted-foreground">Bu kullanıcının profili gizlilik ayarları nedeniyle görüntülenemez.</p>
          </div>
        ) : (
          <Tabs 
            defaultValue={searchParams.get('tab') || "overview"} 
            onValueChange={(value) => setSearchParams({ tab: value })}
            className="mt-8"
          >
            <TabsList className="bg-transparent border-b border-border w-full justify-start rounded-none p-0 h-auto gap-8 mb-8 overflow-x-auto custom-scrollbar">
              <TabsTrigger 
                value="overview" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent px-0 pb-3 text-base font-semibold transition-all"
              >
                Genel Bakış
              </TabsTrigger>

              <TabsTrigger 
                value="achievements" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent px-0 pb-3 text-base font-semibold transition-all"
              >
                Başarımlar
              </TabsTrigger>
              <TabsTrigger 
                value="tierlists" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent px-0 pb-3 text-base font-semibold transition-all flex items-center gap-2"
              >
                Listelerim
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview" className="mt-0 space-y-8">
              {/* Detailed Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                  <Calendar className="w-6 h-6 text-primary mb-3 mx-auto" />
                  <p className="text-2xl font-bold">{joinDate}</p>
                  <p className="text-sm text-muted-foreground mt-1">Kayıt Tarihi</p>
                </div>
                
                <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                  <BookOpen className="w-6 h-6 text-primary mb-3 mx-auto" />
                  <p className="text-2xl font-bold">{profileData.stats.totalChapters}</p>
                  <p className="text-sm text-muted-foreground mt-1">Bölüm Okundu</p>
                </div>
                
                <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                  <Book className="w-6 h-6 text-primary mb-3 mx-auto" />
                  <p className="text-2xl font-bold">{profileData.stats.totalSeries}</p>
                  <p className="text-sm text-muted-foreground mt-1">Farklı Seri</p>
                </div>
                
                <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                  <MessageSquare className="w-6 h-6 text-primary mb-3 mx-auto" />
                  <p className="text-2xl font-bold">{profileData.stats.totalComments || 0}</p>
                  <p className="text-sm text-muted-foreground mt-1">Yorum Yapıldı</p>
                </div>
              </div>

              {/* Heat Map Section */}
              <div className="rounded-xl border border-border bg-card/50 p-6 md:p-8 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                  <Calendar className="w-5 h-5 text-primary" />
                  <h3 className="text-xl font-semibold">Okuma Geçmişi (Son 1 Yıl)</h3>
                </div>
                {activityData.length > 0 ? (
                  <HeatMap data={activityData} days={365} />
                ) : (
                  <div className="text-center py-12 bg-secondary/30 rounded-lg border border-border border-dashed">
                    <p className="text-muted-foreground">Henüz kaydedilmiş okuma aktivitesi yok.</p>
                  </div>
                )}
              </div>

              {/* Recent Reads Section */}
              {profileData.recentReads && profileData.recentReads.length > 0 && (
                <div className="rounded-xl border border-border bg-card/50 p-6 md:p-8 shadow-sm mt-8">
                  <div className="flex items-center gap-2 mb-6">
                    <History className="w-5 h-5 text-primary" />
                    <h3 className="text-xl font-semibold">En Son Neler Okudu?</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {profileData.recentReads.map((read: any) => (
                      <Link key={read.manga_id} to={`/manga/${read.manga_id}`} className="group block rounded-lg overflow-hidden border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors">
                        <div className="relative aspect-[3/4] overflow-hidden">
                          <img src={read.mangas?.cover} alt={read.mangas?.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-3">
                            <p className="text-white font-medium text-sm line-clamp-1">{read.mangas?.title}</p>
                            <p className="text-primary text-xs font-bold mt-0.5">Bölüm {read.chapter_number}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="favorites" className="mt-0">
               <div className="text-center py-16 rounded-xl border border-border bg-card/50">
                 <Info className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                 <h3 className="text-lg font-medium">Yakında</h3>
                 <p className="text-muted-foreground mt-2 max-w-md mx-auto">Kullanıcının kendine özel manga sıralamaları ve Tier List'leri burada sergilenecek.</p>
               </div>
            </TabsContent>
            
            <TabsContent value="achievements" className="mt-0">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {Object.values(ACHIEVEMENTS).map((achievement) => {
                   const unlockedRecord = achievements.find(a => a.achievement_id === achievement.id);
                   const isUnlocked = !!unlockedRecord;
                   
                   // Determine current progress depending on stats
                   let currentProgress = 0;
                   if (achievement.id === 'first_blood' || achievement.id === 'manga_worm' || achievement.id === 'veteran') currentProgress = profileData.stats.totalChapters;
                   if (achievement.id === 'critic') currentProgress = profileData.stats.totalComments;
                   if (achievement.id === 'explorer') currentProgress = profileData.stats.totalSeries;
                   // Ensure it does not exceed max directly for the bar
                   let displayProgress = Math.min(currentProgress, achievement.maxProgress);
                   let percent = (displayProgress / achievement.maxProgress) * 100;
                   if (isUnlocked) {
                     displayProgress = achievement.maxProgress;
                     percent = 100;
                   }

                   const Icon = achievement.icon;

                   return (
                     <div 
                       key={achievement.id}
                       className={`rounded-xl border border-border bg-card/50 p-6 flex flex-col md:flex-row items-start gap-4 transition-all ${!isUnlocked ? 'opacity-50 grayscale border-dashed bg-transparent' : ''}`}
                     >
                       <div className={`p-3 rounded-full shrink-0 ${isUnlocked ? achievement.bgColor : 'bg-secondary'} ${isUnlocked ? achievement.color : 'text-muted-foreground'}`}>
                         <Icon className="w-8 h-8" />
                       </div>
                       <div className="w-full">
                         <h4 className="font-bold flex items-center gap-2">
                           {achievement.title}
                           {isUnlocked && <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full whitespace-nowrap">Açıldı</span>}
                         </h4>
                         <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{achievement.description}</p>
                         
                         <div className="flex justify-between items-end text-xs mt-3 font-mono">
                           <span>{displayProgress}</span>
                           <span>{achievement.maxProgress}</span>
                         </div>
                         <div className="mt-1 w-full bg-secondary rounded-full h-1.5 break-hidden shadow-inner">
                           <div 
                             className={`${isUnlocked ? 'bg-primary' : 'bg-muted-foreground'} h-full rounded-full transition-all duration-1000`} 
                             style={{ width: `${percent}%` }} 
                           />
                         </div>
                         {isUnlocked && unlockedRecord.unlocked_at && (
                           <p className="text-[10px] text-muted-foreground mt-2 text-right">
                             {new Date(unlockedRecord.unlocked_at).toLocaleDateString('tr-TR')} tarihinde kazanıldı
                           </p>
                         )}
                       </div>
                     </div>
                   );
                 })}
               </div>
            </TabsContent>
            <TabsContent value="tierlists" className="mt-0">
               <div className="space-y-8">
                 {/* Reading Lists */}
                 <div className="rounded-xl border border-border bg-card/50 p-6 md:p-8 shadow-sm">
                   <div className="flex items-center gap-2 mb-6">
                     <List className="w-6 h-6 text-primary" />
                     <h3 className="text-xl font-bold">Okuma Listeleri</h3>
                   </div>
                   
                   {readingLists.length === 0 ? (
                     <div className="text-center py-12 bg-secondary/30 rounded-lg border border-border border-dashed">
                       <p className="text-muted-foreground mb-4">Henüz oluşturulmuş açık bir okuma listesi bulunmuyor.</p>
                       {isOwnProfile && (
                         <Button asChild variant="outline">
                           <Link to="/library">Kütüphanene Git</Link>
                         </Button>
                       )}
                     </div>
                   ) : (
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {readingLists.map(list => (
                         <Link key={list.id} to={`/reading-lists/${list.id}`} className="block rounded-lg border border-border bg-secondary/20 p-5 hover:bg-secondary/40 hover:border-primary/50 transition-all group">
                           <div className="flex justify-between items-start mb-2">
                             <h4 className="font-bold text-lg group-hover:text-primary transition-colors line-clamp-1">{list.name}</h4>
                             <Badge variant="outline" className="text-[10px] bg-background">
                               {list.is_public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1 text-red-400" />} {list.is_public ? 'Açık' : 'Gizli'}
                             </Badge>
                           </div>
                           <p className="text-sm text-muted-foreground line-clamp-2 mb-4 h-10">{list.description || 'Açıklama belirtilmemiş.'}</p>
                           <div className="flex justify-between items-center text-xs text-muted-foreground">
                             <span>{new Date(list.created_at).toLocaleDateString()}</span>
                             <span className="flex items-center text-primary font-medium">İncele <ChevronRight className="w-3 h-3 ml-1" /></span>
                           </div>
                         </Link>
                       ))}
                     </div>
                   )}
                 </div>

                 {/* Tier Lists */}
                 <div className="rounded-xl border border-border bg-card/50 p-6 md:p-8 shadow-sm">
                   <div className="flex items-center justify-between mb-6">
                     <div className="flex items-center gap-2">
                       <Book className="w-6 h-6 text-yellow-500" />
                       <h3 className="text-xl font-bold">Tier Listeleri</h3>
                     </div>
                     {isOwnProfile && (
                       <Button size="sm" variant="outline" className="gap-2" onClick={() => navigate('/tier-lists/create')}>
                         Yeni Tier Listesi
                       </Button>
                     )}
                   </div>
                   
                   {tierLists.length === 0 ? (
                     <div className="rounded-xl border border-border border-dashed bg-card/10 p-12 flex flex-col items-center justify-center text-center">
                       <div className="p-4 bg-primary/10 text-primary rounded-full mb-4">
                         <Trophy className="w-8 h-8" />
                       </div>
                       <h3 className="text-xl font-bold mb-2">Tier Listesi Yok</h3>
                       <p className="text-muted-foreground max-w-md">Kullanıcının yarattığı özel manga/karakter sıralamaları varsa burada gözükecektir!</p>
                     </div>
                   ) : (
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {tierLists.map(list => (
                         <div key={list.id} onClick={() => navigate(`/tier-lists/${list.id}`)} className="block rounded-lg border border-border bg-secondary/20 p-5 hover:bg-secondary/40 hover:border-primary/50 transition-all cursor-pointer group">
                           <div className="flex justify-between items-start mb-2">
                             <h4 className="font-bold text-lg group-hover:text-primary transition-colors line-clamp-1">{list.title}</h4>
                             <Badge variant="outline" className="text-[10px] bg-background">
                               {list.is_public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1 text-red-400" />} {list.type === 'character' ? 'Karakter' : 'Manga'}
                             </Badge>
                           </div>
                           <p className="text-sm text-muted-foreground line-clamp-2 mb-4 h-10">Kendi sıralamasını oluşturdu.</p>
                           <div className="flex justify-between items-center text-xs text-muted-foreground border-t border-border pt-3">
                             <span>Sıralamayı Göster <ChevronRight className="w-3 h-3 inline pb-0.5" /></span>
                             <span>{new Date(list.created_at).toLocaleDateString()}</span>
                           </div>
                         </div>
                       ))}
                     </div>
                   )}
                 </div>
               </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
};

export default Profile;
