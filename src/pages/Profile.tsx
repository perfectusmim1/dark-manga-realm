import React, { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import HeatMap from '@/components/profile/HeatMap';
import { Shield, Settings, Calendar, BookOpen, Trophy, Info, Book, MessageSquare, History, Globe, Lock, ChevronRight, List, Sparkles, Image as ImageIcon, Film, Reply, Clock3, Flag } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatReadingDuration, getUserProfile, syncAchievements, followUser, unfollowUser, blockUser, unblockUser } from '@/lib/profile';
import { createProfileReport } from '@/lib/database';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { useToast } from "@/components/ui/use-toast";
import UserListModal from '@/components/profile/UserListModal';
import ReadingListCover from '@/components/manga/ReadingListCover';
import StaffBadge from '@/components/user/StaffBadge';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';
import { UserPlus, UserMinus, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

const Profile: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const navigate = useNavigate();
  
  const [profileData, setProfileData] = useState<any>(null);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [readingLists, setReadingLists] = useState<any[]>([]);
  const [tierLists, setTierLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [isBlockLoading, setIsBlockLoading] = useState(false);
  const [isProfileReportDialogOpen, setIsProfileReportDialogOpen] = useState(false);
  const [profileReportReason, setProfileReportReason] = useState('Sahte veya yanıltıcı profil');
  const [profileReportDetails, setProfileReportDetails] = useState('');
  const [isSubmittingProfileReport, setIsSubmittingProfileReport] = useState(false);
  const [listModalType, setListModalType] = useState<'followers' | 'following' | null>(null);
  const { toast } = useToast();
  
  const isOwnProfile = currentUser?.id === userId;
  const profileReportReasons = [
    'Sahte veya yanıltıcı profil',
    'Taciz veya tehdit',
    'Spam / bot hesap',
    'Uygunsuz profil içeriği',
    'Taklit / impersonation',
    'Diğer',
  ];

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Profil sayfasını görüntülemek için internete bağlanın."
        actionHref="/library"
        actionLabel="Kütüphaneye Git"
      />
    );
  }

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        if (!userId) {
          setError('Kullanıcı bulunamadı');
          return;
        }
        
        setLoading(true);
        const profile = await getUserProfile(userId, currentUser?.id);
        const profileVisible = profile.sectionAccess?.profile ?? true;
        const canLoadAchievements = profileVisible;

        if (!profileVisible) {
          setProfileData(profile);
          setActivityData([]);
          setAchievements([]);
          setReadingLists([]);
          setTierLists([]);
          return;
        }

        const { data: unlockedData } = canLoadAchievements
          ? await syncAchievements(userId, profile.stats)
          : { data: [] };
        
        setProfileData(profile);
        setActivityData(profile.activity || []);
        setAchievements(unlockedData || []);
        setReadingLists(profile.readingLists || []);
        setTierLists(profile.tierLists || []);
      } catch (err) {
        console.error('Profile fetch error:', err);
        setError('Profil yüklenirken bir hata oluştu veya gizli tutuluyor.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProfile();
  }, [userId, currentUser?.id]);

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

  const canView = profileData.sectionAccess?.profile ?? true;
  const canViewReadingHistory = profileData.sectionAccess?.readingHistory ?? true;
  const canViewReadingLists = profileData.sectionAccess?.readingLists ?? true;
  const canViewTierLists = profileData.sectionAccess?.tierLists ?? true;
  const canViewComments = profileData.sectionAccess?.comments ?? true;
  const canViewFollowedManga = profileData.sectionAccess?.followedManga ?? true;
  const canViewAnyLists = canViewReadingLists || canViewTierLists;
  const canViewAchievements = canView;
  const visibleTabs = [
    'overview',
    ...(canViewAchievements ? ['achievements'] : []),
    ...(canViewAnyLists ? ['tierlists'] : []),
    ...(canViewComments ? ['comments'] : []),
    ...(canViewFollowedManga ? ['following-manga'] : []),
  ];
  const requestedTab = searchParams.get('tab') || 'overview';
  const activeTab = visibleTabs.includes(requestedTab) ? requestedTab : visibleTabs[0];
  
  const joinDate = new Date(profileData.created_at).toLocaleDateString('tr-TR', {
    month: 'long', 
    year: 'numeric'
  });

  const openProfileReportDialog = () => {
    if (!currentUser) {
      toast({ title: 'Giriş gerekli', description: 'Profil bildirmek için giriş yapmalısınız.', variant: 'destructive' });
      return;
    }

    if (isOwnProfile) {
      toast({ title: 'Geçersiz işlem', description: 'Kendi profilinizi bildiremezsiniz.', variant: 'destructive' });
      return;
    }

    setProfileReportReason('Sahte veya yanıltıcı profil');
    setProfileReportDetails('');
    setIsProfileReportDialogOpen(true);
  };

  const handleSubmitProfileReport = async () => {
    if (!currentUser || !profileData?.id) {
      toast({ title: 'Giriş gerekli', description: 'Profil bildirmek için giriş yapmalısınız.', variant: 'destructive' });
      return;
    }

    if (!profileReportReason.trim()) {
      toast({ title: 'Neden seçilmeli', description: 'Profil bildirimi için bir neden seçmelisiniz.', variant: 'destructive' });
      return;
    }

    try {
      setIsSubmittingProfileReport(true);
      await createProfileReport({
        reporterId: currentUser.id,
        reportedUserId: profileData.id,
        reason: profileReportReason,
        details: profileReportDetails,
      });
      toast({ title: 'Profil bildirildi', description: 'Profil bildirimi admin ekibine iletildi.' });
      setIsProfileReportDialogOpen(false);
      setProfileReportDetails('');
    } catch (error) {
      console.error('Profile report submit error:', error);
      toast({ title: 'Hata', description: 'Profil bildirimi gönderilemedi.', variant: 'destructive' });
    } finally {
      setIsSubmittingProfileReport(false);
    }
  };

  if (profileData.relationship.isBlockedByOwner) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container pt-24 pb-12 text-center animate-in fade-in duration-500">
           <div className="max-w-md mx-auto py-16 px-6 bg-card border border-border rounded-2xl shadow-xl">
             <ShieldAlert className="w-16 h-16 mx-auto text-red-500 mb-6" />
             <h1 className="text-2xl font-bold mb-4">Profil Erişilemez</h1>
             <p className="text-muted-foreground leading-relaxed">
               Bu kullanıcı tarafından engellendiğiniz için profilini ve paylaşımlarını görüntüleyemezsiniz.
             </p>
             <Button asChild variant="outline" className="mt-8">
               <Link to="/">Ana Sayfaya Dön</Link>
             </Button>
           </div>
        </main>
      </div>
    );
  }

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
                <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
                  <h1
                    className={cn(
                      'text-3xl md:text-4xl font-bold tracking-tight',
                      profileData.role ? getStaffTextClassName(profileData.role, false) : ''
                    )}
                  >
                    {profileData.username}
                  </h1>
                  <StaffBadge role={profileData.role} />
                  {profileData.relationship.isBlocked && (
                    <Badge variant="destructive" className="flex items-center gap-1.5 px-3 py-1 font-bold shadow-lg shadow-red-500/20">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Engellendi
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  <p className="text-muted-foreground flex items-center justify-center md:justify-start gap-2 text-sm">
                    <Calendar className="w-4 h-4" />
                    {joinDate}'den beri üye
                  </p>
                  {profileData.relationship.isBlocked && (
                    <p className="text-red-500 text-xs font-medium mt-1 animate-pulse">
                      Bu kullanıcıyı engellediniz. Paylaşımları otomatik olarak blurlanır.
                    </p>
                  )}
                  
                  <div className="flex gap-4 justify-center md:justify-start text-sm">
                    <button 
                      onClick={() => setListModalType('followers')}
                      className="hover:text-primary transition-colors flex items-center gap-1.5 py-1"
                    >
                      <span className="font-bold text-foreground">{profileData.stats.followersCount}</span>
                      <span className="text-muted-foreground">Takipçi</span>
                    </button>
                    <button 
                      onClick={() => setListModalType('following')}
                      className="hover:text-primary transition-colors flex items-center gap-1.5 py-1"
                    >
                      <span className="font-bold text-foreground">{profileData.stats.followingCount}</span>
                      <span className="text-muted-foreground">Takip Edilen</span>
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center justify-center md:justify-end gap-3">
                {isOwnProfile ? (
                  <Button asChild variant="outline" className="gap-2">
                    <Link to="/settings">
                      <Settings className="w-4 h-4" />
                      Profili Düzenle
                    </Link>
                  </Button>
                ) : currentUser && (
                  <>
                    <Button 
                      onClick={async () => {
                        if (!currentUser) return;
                        setIsFollowLoading(true);
                        try {
                          if (profileData.relationship.isFollowing) {
                            await unfollowUser(currentUser.id, profileData.id);
                            setProfileData((prev: any) => ({
                              ...prev,
                              stats: { ...prev.stats, followersCount: Math.max(0, prev.stats.followersCount - 1) },
                              relationship: {
                                ...prev.relationship,
                                isFollowing: false,
                                isMutualFollow: false,
                              }
                            }));
                            toast({ title: "Takipten Çıkarıldı", description: `${profileData.username} artık takip edilmiyor.` });
                          } else {
                            await followUser(currentUser.id, profileData.id);
                            setProfileData((prev: any) => ({
                              ...prev,
                              stats: { ...prev.stats, followersCount: prev.stats.followersCount + 1 },
                              relationship: {
                                ...prev.relationship,
                                isFollowing: true,
                                isMutualFollow: Boolean(prev.relationship.isFollowedBy),
                              }
                            }));
                            toast({ title: "Takip Edildi", description: `${profileData.username} başarıyla takip edildi.` });
                          }
                        } catch (err: any) {
                          toast({ title: "Hata", description: "İşlem başarısız oldu.", variant: "destructive" });
                        } finally {
                          setIsFollowLoading(false);
                        }
                      }}
                      disabled={isFollowLoading || profileData.relationship.isBlocked}
                      className={`gap-2 min-w-[120px] transition-all ${
                        profileData.relationship.isFollowing 
                        ? 'bg-secondary hover:bg-secondary/80 text-secondary-foreground' 
                        : 'bg-[#a3e635] hover:bg-[#bef264] text-black font-bold'
                      }`}
                    >
                      {isFollowLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                        profileData.relationship.isFollowing ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />
                      )}
                      {profileData.relationship.isFollowing ? 'Takipten Çık' : 'Takip Et'}
                    </Button>

                    <Button 
                      variant="outline"
                      onClick={async () => {
                        if (!currentUser) return;
                        setIsBlockLoading(true);
                        try {
                          if (profileData.relationship.isBlocked) {
                            await unblockUser(currentUser.id, profileData.id);
                            setProfileData((prev: any) => ({
                              ...prev,
                              relationship: { ...prev.relationship, isBlocked: false }
                            }));
                            toast({ title: "Engel Kaldırıldı", description: `${profileData.username} engeli kaldırıldı.` });
                          } else {
                            await blockUser(currentUser.id, profileData.id);
                            setProfileData((prev: any) => ({
                              ...prev,
                              stats: { 
                                ...prev.stats, 
                                followersCount: profileData.relationship.isFollowing ? Math.max(0, prev.stats.followersCount - 1) : prev.stats.followersCount 
                              },
                              relationship: {
                                ...prev.relationship,
                                isBlocked: true,
                                isFollowing: false,
                                isFollowedBy: false,
                                isMutualFollow: false,
                              }
                            }));
                            toast({ title: "Engellendi", description: `${profileData.username} başarıyla engellendi.` });
                          }
                        } catch (err) {
                          toast({ title: "Hata", description: "Bir hata oluştu.", variant: "destructive" });
                        } finally {
                          setIsBlockLoading(false);
                        }
                      }}
                      disabled={isBlockLoading}
                      className={`gap-2 min-w-[100px] border-red-500/50 hover:bg-red-500/10 text-red-500 hover:text-red-600 transition-colors`}
                    >
                      {isBlockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                        profileData.relationship.isBlocked ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />
                      )}
                      {profileData.relationship.isBlocked ? 'Engeli Kaldır' : 'Engelle'}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={openProfileReportDialog}
                      className="gap-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                    >
                      <Flag className="w-4 h-4" />
                      Bildir
                    </Button>
                  </>
                )}
              </div>
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
            value={activeTab}
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

              {canViewAchievements && (
                <TabsTrigger 
                  value="achievements" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent px-0 pb-3 text-base font-semibold transition-all"
                >
                  Başarımlar
                </TabsTrigger>
              )}
              {canViewAnyLists && (
                <TabsTrigger 
                  value="tierlists" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent px-0 pb-3 text-base font-semibold transition-all flex items-center gap-2"
                >
                  Listelerim
                </TabsTrigger>
              )}
              {canViewComments && (
                <TabsTrigger 
                  value="comments" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent px-0 pb-3 text-base font-semibold transition-all"
                >
                  Yorumlar
                </TabsTrigger>
              )}
              {canViewFollowedManga && (
                <TabsTrigger 
                  value="following-manga" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent px-0 pb-3 text-base font-semibold transition-all"
                >
                  Takip Edilenler
                </TabsTrigger>
              )}
            </TabsList>
            
            <TabsContent value="overview" className="mt-0 space-y-8">
              {/* Detailed Stats Grid */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                  <Calendar className="w-6 h-6 text-primary mb-3 mx-auto" />
                  <p className="text-2xl font-bold">{joinDate}</p>
                  <p className="text-sm text-muted-foreground mt-1">Kayıt Tarihi</p>
                </div>

                {canViewReadingHistory && (
                  <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                    <BookOpen className="w-6 h-6 text-primary mb-3 mx-auto" />
                    <p className="text-2xl font-bold">{profileData.stats.totalChapters}</p>
                    <p className="text-sm text-muted-foreground mt-1">Bölüm Okundu</p>
                  </div>
                )}

                {canViewReadingHistory && (
                  <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                    <Book className="w-6 h-6 text-primary mb-3 mx-auto" />
                    <p className="text-2xl font-bold">{profileData.stats.totalSeries}</p>
                    <p className="text-sm text-muted-foreground mt-1">Farklı Seri</p>
                  </div>
                )}

                {canViewComments && (
                  <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center">
                    <MessageSquare className="w-6 h-6 text-primary mb-3 mx-auto" />
                    <p className="text-2xl font-bold">{profileData.stats.totalComments || 0}</p>
                    <p className="text-sm text-muted-foreground mt-1">Yorum Yapıldı</p>
                  </div>
                )}

                {canViewReadingHistory && (
                  <Link
                    to="/reading-time"
                    className="rounded-xl border border-border bg-card/50 p-6 flex flex-col justify-center items-center text-center transition-colors hover:border-primary/40 hover:bg-card"
                  >
                    <Clock3 className="w-6 h-6 text-primary mb-3 mx-auto" />
                    <p className="text-2xl font-bold">{formatReadingDuration(profileData.stats.totalReadingSeconds || 0)}</p>
                    <p className="text-sm text-muted-foreground mt-1">Toplam Okuma Süresi</p>
                  </Link>
                )}
              </div>

              {canViewReadingHistory && (
                <>
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
                </>
              )}
            </TabsContent>
            
            <TabsContent value="favorites" className="mt-0">
               <div className="text-center py-16 rounded-xl border border-border bg-card/50">
                 <Info className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                 <h3 className="text-lg font-medium">Yakında</h3>
                 <p className="text-muted-foreground mt-2 max-w-md mx-auto">Kullanıcının kendine özel manga sıralamaları ve Tier List'leri burada sergilenecek.</p>
               </div>
            </TabsContent>
            
            {canViewAchievements && (
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
            )}
            {canViewAnyLists && (
            <TabsContent value="tierlists" className="mt-0">
               <div className="space-y-8">
                 {canViewReadingLists && (
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
                           <Link key={list.id} to={`/reading-lists/${list.id}`} className="block overflow-hidden rounded-lg border border-border bg-secondary/20 transition-all group hover:bg-secondary/40 hover:border-primary/50">
                             <ReadingListCover
                               imageUrl={list.image_url}
                               alt={list.name}
                               className="h-32 w-full"
                               iconClassName="h-8 w-8"
                             />
                             <div className="p-5">
                               <div className="flex justify-between items-start mb-2 gap-3">
                                 <h4 className="font-bold text-lg group-hover:text-primary transition-colors line-clamp-1">{list.name}</h4>
                                 <Badge variant="outline" className="text-[10px] bg-background shrink-0">
                                   {list.is_public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1 text-red-400" />} {list.is_public ? 'Açık' : 'Gizli'}
                                 </Badge>
                               </div>
                               <p className="text-sm text-muted-foreground line-clamp-2 mb-4 h-10">{list.description || 'Açıklama belirtilmemiş.'}</p>
                               <div className="flex justify-between items-center text-xs text-muted-foreground">
                                 <span>{new Date(list.created_at).toLocaleDateString()}</span>
                                 <span className="flex items-center text-primary font-medium">İncele <ChevronRight className="w-3 h-3 ml-1" /></span>
                               </div>
                             </div>
                           </Link>
                         ))}
                       </div>
                     )}
                   </div>
                 )}

                 {canViewTierLists && (
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
                 )}
                </div>
             </TabsContent>
            )}
            {canViewComments && (
            <TabsContent value="comments" className="mt-0">
                <div className="rounded-xl border border-border bg-card/50 p-4 shadow-sm sm:p-6 md:p-8">
                 <div className="mb-4 flex items-center justify-between gap-3 sm:mb-6">
                   <div className="flex items-center gap-2">
                     <MessageSquare className="w-5 h-5 text-primary" />
                     <h3 className="text-xl font-bold">Son Yorumlar</h3>
                   </div>
                   <Badge variant="secondary" className="rounded-full px-3 py-1">
                     {profileData.recentComments?.length || 0} yorum
                   </Badge>
                 </div>

                 {profileData.recentComments?.length > 0 ? (
                   <div className="space-y-4">
                     {profileData.recentComments.map((comment: any) => (
                       <Link
                         key={`${comment.entityType}-${comment.id}`}
                         to={comment.targetHref}
                         className="group block rounded-2xl border border-border/70 bg-background/40 p-3 transition-all hover:border-primary/40 hover:bg-background/70 sm:p-4"
                       >
                         <div className="flex items-start gap-3 sm:gap-4">
                           <Avatar className="h-9 w-9 border border-border/70 sm:h-11 sm:w-11">
                             <AvatarImage src={profileData.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${profileData.username}`} />
                             <AvatarFallback>{profileData.username?.substring(0, 2).toUpperCase()}</AvatarFallback>
                           </Avatar>

                           <div className="min-w-0 flex-1">
                             <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <span
                                className={cn(
                                  'text-sm font-semibold transition-colors sm:text-base',
                                  profileData.role
                                    ? getStaffTextClassName(profileData.role)
                                    : 'text-foreground group-hover:text-primary'
                                )}
                              >
                                {profileData.username}
                              </span>
                              <StaffBadge role={profileData.role} compact />
                              <span className="text-[11px] text-muted-foreground">
                                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: tr })}
                              </span>
                               {comment.parentId && (
                                 <Badge variant="outline" className="rounded-full text-[10px]">
                                   <Reply className="w-3 h-3 mr-1" />
                                   Yanit
                                 </Badge>
                               )}
                               {comment.isSpoiler && (
                                 <Badge variant="outline" className="rounded-full border-amber-500/40 text-[10px] text-amber-300">
                                   <Sparkles className="w-3 h-3 mr-1" />
                                   Spoiler
                                 </Badge>
                               )}
                               {comment.hasMedia && (
                                 <Badge variant="outline" className="rounded-full text-[10px]">
                                   <ImageIcon className="w-3 h-3 mr-1" />
                                   Gorsel
                                 </Badge>
                               )}
                               {comment.hasGif && (
                                 <Badge variant="outline" className="rounded-full text-[10px]">
                                   <Film className="w-3 h-3 mr-1" />
                                   GIF
                                 </Badge>
                               )}
                             </div>

                             <p className="mt-2 line-clamp-2 text-sm leading-5 text-foreground/90">
                               {comment.preview}
                             </p>

                             <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                               <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary hover:bg-primary/10">
                                 {comment.entityType === 'manga' ? 'Seri' : comment.entityType === 'character' ? 'Karakter' : comment.entityType === 'author' ? 'Yazar' : 'Cizer'}
                               </Badge>
                               <span className="max-w-full truncate font-medium text-foreground/80">{comment.targetName}</span>
                               <span className="hidden sm:inline text-muted-foreground/50">•</span>
                               <span>{comment.likes || 0} begeni</span>
                             </div>
                           </div>

                           <ChevronRight className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary sm:block" />
                         </div>
                       </Link>
                     ))}
                   </div>
                 ) : (
                   <div className="rounded-xl border border-border border-dashed bg-card/10 p-12 text-center">
                     <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/60 mb-4" />
                     <h3 className="text-lg font-semibold">Henuz yorum yok</h3>
                     <p className="text-muted-foreground mt-2">Kullanicinin attigi son yorumlar burada gorunecek.</p>
                   </div>
                 )}
                </div>
             </TabsContent>
            )}
            {canViewFollowedManga && (
            <TabsContent value="following-manga" className="mt-0">
                <div className="rounded-xl border border-border bg-card/50 p-6 md:p-8 shadow-sm">
                 <div className="mb-6 flex items-center justify-between gap-3">
                   <div className="flex items-center gap-2">
                     <BookOpen className="w-5 h-5 text-primary" />
                     <h3 className="text-xl font-bold">Takip Edilen İçerikler</h3>
                   </div>
                   <Badge variant="secondary" className="rounded-full px-3 py-1">
                     {profileData.followedManga?.length || 0} seri
                   </Badge>
                 </div>

                 {profileData.followedManga?.length > 0 ? (
                   <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                     {profileData.followedManga.map((manga: any) => (
                       <Link
                         key={manga.id}
                         to={manga.href}
                         className="group"
                       >
                         <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/40 transition-all hover:border-primary/40 hover:bg-background/70">
                           <div className="relative aspect-[3/4] overflow-hidden">
                             <img
                               src={manga.cover}
                               alt={manga.title}
                               className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                             />
                             <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                             <Badge className="absolute left-3 top-3 rounded-full bg-black/70 text-[10px] text-white hover:bg-black/70">
                               {manga.type === 'manhwa' ? 'Manhwa' : manga.type === 'manhua' ? 'Manhua' : manga.type === 'webtoon' ? 'Webtoon' : 'Manga'}
                             </Badge>
                           </div>

                           <div className="space-y-2 p-3">
                             <h4 className="line-clamp-2 font-semibold leading-5 group-hover:text-primary transition-colors">
                               {manga.title}
                             </h4>
                             <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                               <span>
                                 {formatDistanceToNow(new Date(manga.followedAt), { addSuffix: true, locale: tr })}
                               </span>
                               {manga.status && (
                                 <>
                                   <span className="text-muted-foreground/50">•</span>
                                   <span>{manga.status === 'ongoing' ? 'Devam Ediyor' : manga.status === 'completed' ? 'Tamamlandi' : 'Ara Verdi'}</span>
                                 </>
                               )}
                             </div>
                           </div>
                         </div>
                       </Link>
                     ))}
                   </div>
                 ) : (
                   <div className="rounded-xl border border-border border-dashed bg-card/10 p-12 text-center">
                     <BookOpen className="w-10 h-10 mx-auto text-muted-foreground/60 mb-4" />
                     <h3 className="text-lg font-semibold">Henuz takip edilen seri yok</h3>
                     <p className="text-muted-foreground mt-2">Favorilere eklenenler degil, sadece takip edilen seriler burada gorunecek.</p>
                   </div>
                 )}
                </div>
             </TabsContent>
            )}
          </Tabs>
        )}
        <UserListModal 
          isOpen={listModalType !== null} 
          onClose={() => setListModalType(null)} 
          userId={userId || ''} 
          type={listModalType || 'followers'} 
        />

        <Dialog open={isProfileReportDialogOpen} onOpenChange={setIsProfileReportDialogOpen}>
          <DialogContent className="max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-border/70 p-4 sm:max-w-[560px] sm:p-6">
            <DialogHeader className="space-y-2 pr-6 text-left sm:pr-8">
              <DialogTitle className="text-xl font-bold sm:text-2xl">Profili Bildir</DialogTitle>
              <DialogDescription>
                Problemli, sahte veya uygunsuz profilleri buradan admin ekibine iletebilirsiniz.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1 sm:space-y-5 sm:py-2">
              <div className="rounded-xl border border-border/60 bg-card/60 p-3 sm:p-4">
                <p className="text-sm font-medium">{profileData.username}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Aynı profil için tekrar bildirim gönderirseniz son notunuzla güncellenir.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Neden</label>
                <div className="grid grid-cols-2 gap-2">
                  {profileReportReasons.map((reason) => (
                    <Button
                      key={reason}
                      type="button"
                      variant={profileReportReason === reason ? 'default' : 'outline'}
                      size="sm"
                      className="h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left leading-snug"
                      onClick={() => setProfileReportReason(reason)}
                    >
                      {reason}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Detay</label>
                <Textarea
                  value={profileReportDetails}
                  onChange={(event) => setProfileReportDetails(event.target.value)}
                  placeholder="Sorunu biraz daha açıklayın. Örnek: başka bir kullanıcıyı taklit ediyor."
                  className="min-h-[128px] sm:min-h-[140px]"
                  maxLength={600}
                />
                <p className="text-xs text-muted-foreground">{profileReportDetails.length}/600</p>
              </div>
            </div>

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
              <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setIsProfileReportDialogOpen(false)}>
                İptal
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleSubmitProfileReport} disabled={isSubmittingProfileReport}>
                {isSubmittingProfileReport ? 'Gönderiliyor...' : 'Bildirimi Gönder'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Profile;
