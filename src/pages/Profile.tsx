import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import HeatMap from '@/components/profile/HeatMap';
import OptimizedImage from '@/components/media/OptimizedImage';
import { Shield, Settings, Calendar, BookOpen, Book, MessageSquare, History, Globe, Lock, ChevronRight, List, Sparkles, Image as ImageIcon, Film, Reply, Clock3, Flag, Star, ThumbsUp, ThumbsDown, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { renderRichContent } from '@/lib/richTextRender';
import { formatReadingDuration, getUserProfile, followUser, unfollowUser, blockUser, unblockUser, type ProfileRecentComment, type ProfileRecentReview } from '@/lib/profile';
import { createProfileReport } from '@/lib/database';
import { useToast } from "@/components/ui/use-toast";
import UserListModal from '@/components/profile/UserListModal';
import ReadingListCover from '@/components/manga/ReadingListCover';
import StaffBadge from '@/components/user/StaffBadge';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';
import { getCompactMangaTypeLabel } from '@/lib/mangaType';
import { formatMangaStatusLabel } from '@/lib/mockData';
import { UserPlus, UserMinus, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import useDocumentTitle from '@/hooks/useDocumentTitle';

const Profile: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser, updatePreferences } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const navigate = useNavigate();
  
  const [profileData, setProfileData] = useState<any>(null);
  const [activityData, setActivityData] = useState<any[]>([]);
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
  const [revealedCommentSpoilers, setRevealedCommentSpoilers] = useState<Record<string, boolean>>({});
  const [tabDirection, setTabDirection] = useState<'left' | 'right'>('right');
  const prevTabIndexRef = useRef<number>(0);
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  const profileTabParam = searchParams.get('tab') || 'overview';

  const measureProfileTabIndicator = useCallback((shouldCenterHorizontally = false) => {
    const listEl = tabsListRef.current;
    if (!listEl) {
      return;
    }

    const activeTrigger = listEl.querySelector<HTMLElement>('[data-state="active"]');
    if (!activeTrigger) {
      return;
    }

    setTabIndicator((prev) => {
      const nextLeft = activeTrigger.offsetLeft;
      const nextWidth = activeTrigger.offsetWidth;
      if (prev.ready && Math.abs(prev.left - nextLeft) < 0.5 && Math.abs(prev.width - nextWidth) < 0.5) {
        return prev;
      }
      return { left: nextLeft, width: nextWidth, ready: true };
    });

    if (shouldCenterHorizontally && listEl.scrollWidth > listEl.clientWidth + 4) {
      const triggerLeft = activeTrigger.offsetLeft;
      const triggerRight = triggerLeft + activeTrigger.offsetWidth;
      const viewLeft = listEl.scrollLeft;
      const viewRight = viewLeft + listEl.clientWidth;

      if (triggerLeft < viewLeft + 12 || triggerRight > viewRight - 12) {
        const targetScrollLeft = Math.max(
          0,
          triggerLeft - (listEl.clientWidth - activeTrigger.offsetWidth) / 2,
        );
        listEl.scrollTo({
          left: targetScrollLeft,
          behavior: 'smooth',
        });
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (loading || !profileData) {
      return;
    }

    measureProfileTabIndicator(true);
    const listEl = tabsListRef.current;
    if (!listEl || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => measureProfileTabIndicator(false));
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [loading, measureProfileTabIndicator, profileData, profileTabParam, readingLists.length, tierLists.length]);
  const [heroBannerLoadFailed, setHeroBannerLoadFailed] = useState(false);
  const [isQuickEditOpen, setIsQuickEditOpen] = useState(false);
  const [quickBannerUrl, setQuickBannerUrl] = useState('');
  const [quickBio, setQuickBio] = useState('');
  const [quickBannerPreviewFailed, setQuickBannerPreviewFailed] = useState(false);
  const [isSavingQuickEdit, setIsSavingQuickEdit] = useState(false);
  const { toast } = useToast();

  useDocumentTitle(profileData?.username ? `${profileData.username} - Profil` : 'Profil');
  
  const isOwnProfile = currentUser?.id === userId;

  const isValidOptionalBannerUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return trimmed.length <= 1000 && /^https?:\/\/[^\s<>"'`]+$/i.test(trimmed);
  };

  const openQuickEditDialog = () => {
    setQuickBannerUrl(profileData?.bannerUrl || currentUser?.preferences?.profile?.banner_url || '');
    setQuickBio(profileData?.bio || currentUser?.preferences?.profile?.bio || '');
    setQuickBannerPreviewFailed(false);
    setIsQuickEditOpen(true);
  };

  const handleSaveQuickProfile = async () => {
    if (!currentUser || !isOwnProfile) return;
    if (!isValidOptionalBannerUrl(quickBannerUrl)) {
      toast({
        title: 'Geçersiz bağlantı',
        description: 'Banner URL geçerli bir http:// veya https:// bağlantısı olmalıdır.',
        variant: 'destructive',
      });
      return;
    }

    const nextBio = quickBio.trim().slice(0, 280);
    const nextBannerUrl = quickBannerUrl.trim().slice(0, 1000);

    try {
      setIsSavingQuickEdit(true);
      const result = await updatePreferences({
        ...(currentUser.preferences || {}),
        profile: {
          bio: nextBio,
          banner_url: nextBannerUrl,
        },
      });
      if (!result.success) {
        toast({
          title: 'Hata',
          description: result.error || 'Profil güncellenemedi.',
          variant: 'destructive',
        });
        return;
      }

      setHeroBannerLoadFailed(false);
      setProfileData((prev: Record<string, unknown> | null) => (prev ? { ...prev, bio: nextBio, bannerUrl: nextBannerUrl } : prev));
      setIsQuickEditOpen(false);
      toast({ title: 'Profil güncellendi' });
    } catch {
      toast({
        title: 'Hata',
        description: 'Profil güncellenemedi.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingQuickEdit(false);
    }
  };
  const profileReportReasons = [
    'Sahte veya yanıltıcı profil',
    'Taciz veya tehdit',
    'Spam / bot hesap',
    'Uygunsuz profil içeriği',
    'Taklit / impersonation',
    'Diğer',
  ];

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    const fetchProfile = async () => {
      try {
        if (!userId) {
          setError('Kullanıcı bulunamadı');
          return;
        }
        
        setLoading(true);
        setHeroBannerLoadFailed(false);
        setRevealedCommentSpoilers({});
        const profile = await getUserProfile(userId, currentUser?.id);
        const profileVisible = profile.sectionAccess?.profile ?? true;

        if (!profileVisible) {
          setProfileData(profile);
          setActivityData([]);
          setReadingLists([]);
          setTierLists([]);
          return;
        }
        
        setProfileData(profile);
        setActivityData(profile.activity || []);
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
  }, [isOnline, userId, currentUser?.id]);

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Profil sayfasını görüntülemek için internete bağlanın."
        actionHref="/library"
        actionLabel="Kütüphaneye Git"
      />
    );
  }

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
  const canViewReadingDetails = canViewReadingHistory && Boolean(currentUser);
  const canViewReadingLists = profileData.sectionAccess?.readingLists ?? true;
  const canViewTierLists = profileData.sectionAccess?.tierLists ?? true;
  const canViewComments = profileData.sectionAccess?.comments ?? true;
  const canViewReviews = profileData.sectionAccess?.reviews ?? canViewComments;
  const canViewFollowedManga = profileData.sectionAccess?.followedManga ?? true;
  const canViewAnyLists = canViewReadingLists || canViewTierLists;
  const visibleTabs = [
    'overview',
    ...(canViewAnyLists ? ['tierlists'] : []),
    ...(canViewComments ? ['comments'] : []),
    ...(canViewReviews ? ['reviews'] : []),
    ...(canViewFollowedManga ? ['following-manga'] : []),
  ];
  const requestedTab = searchParams.get('tab') || 'overview';
  const activeTab = visibleTabs.includes(requestedTab) ? requestedTab : visibleTabs[0];
  const customBannerUrl = !heroBannerLoadFailed && profileData.bannerUrl ? profileData.bannerUrl : null;
  const fallbackBackdropImage =
    profileData.recentReads?.[0]?.mangas?.banner
    || profileData.recentReads?.[0]?.mangas?.cover
    || profileData.followedManga?.[0]?.cover
    || profileData.avatar
    || null;
  const heroBackdropImage = customBannerUrl || fallbackBackdropImage;
  const hasCustomBanner = Boolean(customBannerUrl);
  const listTotalCount = (canViewReadingLists ? readingLists.length : 0) + (canViewTierLists ? tierLists.length : 0);
  const reviewsCount = (profileData.recentReviews || []).length;
  const followedMangaCount = (profileData.followedManga || []).length;
  const totalCommentsAndReviews = (profileData.stats.totalComments || 0) + reviewsCount;
  const statCardBaseClass = 'min-w-0 rounded-2xl border border-border/60 bg-gradient-to-br from-card/95 via-card/85 to-background/95 p-4 sm:p-5 transition-colors hover:border-border';
  const readingTimeStatCardClassName = cn(
    statCardBaseClass,
    isOwnProfile && 'block hover:border-primary/45',
  );
  
  const joinDate = new Date(profileData.created_at).toLocaleDateString('tr-TR', {
    month: 'long', 
    year: 'numeric'
  });
  const profileReviews = (profileData.recentReviews || []) as ProfileRecentReview[];
  const getReviewAverageScore = (review: ProfileRecentReview) => (
    Math.round((((review.ratingStory + review.ratingCharacters + review.ratingArt + review.ratingProgression + review.ratingEngagement) / 5) * 10)) / 10
  );
  const isEditedReview = (review: ProfileRecentReview) => {
    const createdAt = new Date(review.createdAt).getTime();
    const updatedAt = new Date(review.updatedAt).getTime();

    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
      return false;
    }

    return updatedAt - createdAt > 1000;
  };
  const getMangaStatusLabel = (status?: string | null) => {
    if (!status) {
      return null;
    }
    const label = formatMangaStatusLabel(status);
    return label === 'Belirsiz' ? null : label;
  };

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
        <main className="container pt-24 pb-12 text-center">
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
    <div className="min-h-screen overflow-x-clip bg-background">
      <Header />
      
      <main className="overflow-x-clip pb-12">
        {/* KoUp TV+-Style Full-Width Fading Hero */}
        <section className="relative w-full overflow-hidden bg-background pt-16 sm:pt-20">
          {heroBackdropImage ? (
            <>
              <img
                src={heroBackdropImage}
                alt={`${profileData.username} profil bannerı`}
                fetchPriority="high"
                onError={() => {
                  if (hasCustomBanner) {
                    setHeroBannerLoadFailed(true);
                  }
                }}
                className={cn(
                  'pointer-events-none absolute inset-0 h-full w-full object-cover object-center select-none transition-opacity duration-300',
                  hasCustomBanner
                    ? 'opacity-95 brightness-95'
                    : 'scale-105 opacity-45 blur-[1px] brightness-90'
                )}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/35 to-transparent"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(95%_65%_at_15%_100%,hsl(var(--background)/0.55)_0%,transparent_70%)]"
              />
            </>
          ) : (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(var(--primary)/0.14),transparent_60%),linear-gradient(to_bottom,hsl(var(--card)/0.7),hsl(var(--background)))]"
            />
          )}

          <div className="container relative z-10 flex min-h-[260px] flex-col justify-end pt-10 pb-5 sm:min-h-[320px] sm:pt-14 sm:pb-6 md:min-h-[360px]">
            <div className="flex flex-col items-center gap-5 md:flex-row md:items-end md:gap-7">
              <Avatar className="h-24 w-24 shrink-0 rounded-2xl border-2 border-white/15 bg-secondary shadow-2xl sm:h-28 sm:w-28">
                <AvatarImage
                  src={profileData.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${profileData.username}`}
                  className="image-downscale-quality object-cover"
                />
                <AvatarFallback className="rounded-2xl text-xl font-bold">
                  {profileData.username?.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1 text-center md:text-left">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center justify-center gap-2.5 md:justify-start">
                      <h1
                        className={cn(
                          'truncate text-2xl font-extrabold tracking-tight drop-shadow-[0_1px_8px_rgba(0,0,0,0.65)] sm:text-3xl md:text-4xl',
                          profileData.role ? getStaffTextClassName(profileData.role, false) : ''
                        )}
                      >
                        {profileData.username}
                      </h1>
                      <StaffBadge role={profileData.role} />
                      {!canView && (
                        <Badge variant="outline" className="gap-1 border-amber-500/35 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                          <Lock className="h-3 w-3" />
                          Gizli Hesap
                        </Badge>
                      )}
                      {profileData.relationship.isBlocked && (
                        <Badge variant="destructive" className="flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Engellendi
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
                      <span className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        @{profileData.username}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-3 py-0.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                        <Calendar className="h-3.5 w-3.5 text-primary/80" />
                        {joinDate} tarihinde katıldı
                      </span>
                    </div>

                    {profileData.bio && (
                      <p className="max-w-2xl text-sm leading-relaxed text-foreground/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
                        {profileData.bio}
                      </p>
                    )}

                    {profileData.relationship.isBlocked && (
                      <p className="text-xs font-medium text-red-400">
                        Bu kullanıcıyı engellediniz. Paylaşımları otomatik olarak gizlenir.
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 text-xs sm:text-sm md:justify-start">
                      <button
                        type="button"
                        onClick={() => setListModalType('followers')}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/55 px-3 py-1 backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <span className="font-bold text-foreground tabular-nums">{profileData.stats.followersCount}</span>
                        <span className="text-muted-foreground">Takipçi</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setListModalType('following')}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/55 px-3 py-1 backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <span className="font-bold text-foreground tabular-nums">{profileData.stats.followingCount}</span>
                        <span className="text-muted-foreground">Takip Edilen</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-center gap-2.5 md:justify-end">
                  {isOwnProfile ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openQuickEditDialog}
                      className="gap-2 rounded-xl border-white/15 bg-background/60 backdrop-blur-sm hover:bg-background/80"
                    >
                      <Settings className="w-4 h-4" />
                      Profili Düzenle
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
                        variant={profileData.relationship.isFollowing ? 'secondary' : 'glow'}
                        size="sm"
                        className="gap-2 min-w-[116px] rounded-xl"
                      >
                        {isFollowLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                          profileData.relationship.isFollowing ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />
                        )}
                        {profileData.relationship.isFollowing ? 'Takipten Çık' : 'Takip Et'}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
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
                        className="gap-2 min-w-[100px] rounded-xl border-red-500/40 hover:bg-red-500/10 text-red-400 hover:text-red-300"
                      >
                        {isBlockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                          profileData.relationship.isBlocked ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />
                        )}
                        {profileData.relationship.isBlocked ? 'Engeli Kaldır' : 'Engelle'}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openProfileReportDialog}
                        className="gap-2 rounded-xl border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
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
          </div>
        </section>

        <div className="container overflow-x-clip">
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
            onValueChange={(value) => {
              const currentIdx = visibleTabs.indexOf(activeTab);
              const nextIdx = visibleTabs.indexOf(value);
              if (currentIdx !== -1 && nextIdx !== -1 && currentIdx !== nextIdx) {
                setTabDirection(nextIdx > currentIdx ? 'right' : 'left');
                prevTabIndexRef.current = nextIdx;
              }
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (value === 'overview') {
                    next.delete('tab');
                  } else {
                    next.set('tab', value);
                  }
                  return next;
                },
                { replace: true },
              );
            }}
            className="mt-2 min-w-0 sm:mt-4"
          >
            <TabsList
              ref={tabsListRef}
              className="relative mb-6 flex h-auto w-full max-w-full justify-start gap-1 overflow-x-auto horizontal-scroll-smooth scrollbar-hide rounded-none border-b border-border/60 bg-transparent p-0 sm:mb-8"
            >
              <TabsTrigger 
                value="overview" 
                className={cn(
                  'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:px-4 sm:text-sm',
                  !tabIndicator.ready && 'data-[state=active]:border-primary',
                )}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                <span>Genel Bakış</span>
              </TabsTrigger>
              {canViewAnyLists && (
                <TabsTrigger 
                  value="tierlists" 
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:px-4 sm:text-sm',
                    !tabIndicator.ready && 'data-[state=active]:border-primary',
                  )}
                >
                  <List className="h-3.5 w-3.5 shrink-0" />
                  <span>Listelerim ({listTotalCount})</span>
                </TabsTrigger>
              )}
              {canViewComments && (
                <TabsTrigger 
                  value="comments" 
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:px-4 sm:text-sm',
                    !tabIndicator.ready && 'data-[state=active]:border-primary',
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span>Yorumlar ({profileData.stats.totalComments || 0})</span>
                </TabsTrigger>
              )}
              {canViewReviews && (
                <TabsTrigger 
                  value="reviews" 
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:px-4 sm:text-sm',
                    !tabIndicator.ready && 'data-[state=active]:border-primary',
                  )}
                >
                  <Star className="h-3.5 w-3.5 shrink-0" />
                  <span>İncelemeler ({reviewsCount})</span>
                </TabsTrigger>
              )}
              {canViewFollowedManga && (
                <TabsTrigger 
                  value="following-manga" 
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:px-4 sm:text-sm',
                    !tabIndicator.ready && 'data-[state=active]:border-primary',
                  )}
                >
                  <Book className="h-3.5 w-3.5 shrink-0" />
                  <span>Takip Edilenler ({followedMangaCount})</span>
                </TabsTrigger>
              )}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-primary transition-[transform,width,opacity] duration-200 ease-out-smooth motion-reduce:transition-none"
                style={{
                  width: `${tabIndicator.width}px`,
                  transform: `translate3d(${tabIndicator.left}px, 0, 0)`,
                  opacity: tabIndicator.ready ? 1 : 0,
                }}
              />
            </TabsList>
            
            <TabsContent
              value="overview"
              className={cn(
                'mt-0 min-h-[360px] min-w-0 space-y-6 overflow-x-clip sm:space-y-8',
                tabDirection === 'left' ? 'animate-tab-slide-left' : 'animate-tab-slide-right',
              )}
            >
              {/* Detailed Stats Grid */}
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4 sm:gap-4">
                {canViewReadingHistory && (
                  <div className={statCardBaseClass}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                      Toplam Okunan Bölüm
                    </p>
                    <p className="mt-2 text-2xl font-extrabold tracking-tight text-sky-400 tabular-nums sm:text-3xl">
                      {profileData.stats.totalChapters} Bölüm
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Manga &amp; Webtoon arşivi
                    </p>
                  </div>
                )}

                {canViewReadingHistory && (
                  isOwnProfile ? (
                    <Link to="/reading-time" className={readingTimeStatCardClassName}>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                        Toplam Okuma Süresi
                      </p>
                      <p className="mt-2 text-2xl font-extrabold tracking-tight text-blue-400 tabular-nums sm:text-3xl">
                        {formatReadingDuration(profileData.stats.totalReadingSeconds || 0)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Gerçek okuma geçmişi
                      </p>
                    </Link>
                  ) : (
                    <div className={readingTimeStatCardClassName}>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                        Toplam Okuma Süresi
                      </p>
                      <p className="mt-2 text-2xl font-extrabold tracking-tight text-blue-400 tabular-nums sm:text-3xl">
                        {formatReadingDuration(profileData.stats.totalReadingSeconds || 0)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Gerçek okuma geçmişi
                      </p>
                    </div>
                  )
                )}

                {canViewReadingHistory && (
                  <div className={statCardBaseClass}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-violet-400">
                      Okunan Seri
                    </p>
                    <p className="mt-2 text-2xl font-extrabold tracking-tight text-violet-400 tabular-nums sm:text-3xl">
                      {profileData.stats.totalSeries} Seri
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Kütüphane &amp; okuma kaydı
                    </p>
                  </div>
                )}

                {(canViewComments || canViewReviews) && (
                  <div className={statCardBaseClass}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-rose-400">
                      Yorum &amp; İnceleme
                    </p>
                    <p className="mt-2 text-2xl font-extrabold tracking-tight text-rose-400 tabular-nums sm:text-3xl">
                      {totalCommentsAndReviews} Katkı
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Topluluk etkileşimi
                    </p>
                  </div>
                )}
              </div>

              {canViewReadingDetails && (
                <>
                  {/* Heat Map Section */}
                  <div className="min-w-0 rounded-2xl border border-border/60 bg-card/65 p-5 md:p-7">
                    <div className="flex items-center gap-2 mb-5">
                      <Calendar className="w-5 h-5 text-primary" />
                      <h3 className="text-lg sm:text-xl font-semibold">Okuma Geçmişi (Son 1 Yıl)</h3>
                    </div>
                    {activityData.length > 0 ? (
                      <HeatMap data={activityData} days={365} />
                    ) : (
                      <div className="text-center py-12 bg-secondary/25 rounded-xl border border-border/60 border-dashed">
                        <p className="text-muted-foreground">Henüz kaydedilmiş okuma aktivitesi yok.</p>
                      </div>
                    )}
                  </div>

                  {/* Recent Reads Section */}
                  {profileData.recentReads && profileData.recentReads.length > 0 && (
                    <div className="rounded-2xl border border-border/60 bg-card/65 p-5 md:p-7">
                      <div className="flex items-center gap-2 mb-5">
                        <History className="w-5 h-5 text-primary" />
                        <h3 className="text-lg sm:text-xl font-semibold">En Son Okunanlar</h3>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                        {profileData.recentReads.map((read: any) => (
                          <Link key={read.manga_id} to={`/manga/${read.manga_id}`} className="group block overflow-hidden rounded-xl border border-border/60 bg-secondary/25 transition-[border-color,background-color] duration-200 hover:border-primary/40 hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                            <div className="relative aspect-[3/4] overflow-hidden bg-black">
                              {read.mangas?.cover ? (
                                <OptimizedImage
                                  src={read.mangas.cover}
                                  alt={read.mangas?.title || 'Kapak'}
                                  allowProxy
                                  transform={{ width: 320, quality: 84, format: 'webp', fit: 'cover' }}
                                  containerClassName="h-full w-full"
                                  placeholderClassName="rounded-none"
                                  className="block h-full w-full object-cover"
                                />
                              ) : null}
                              <div className="pointer-events-none absolute -inset-x-px -bottom-px top-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/30 to-transparent p-2.5 sm:p-3">
                                <p className="line-clamp-1 text-xs sm:text-sm font-semibold text-white transition-colors group-hover:text-primary group-focus-visible:text-primary">{read.mangas?.title}</p>
                                <p className="mt-0.5 text-[11px] sm:text-xs font-semibold text-primary">Bölüm {read.chapter_number}</p>
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
            {canViewAnyLists && (
            <TabsContent
              value="tierlists"
              className={cn(
                'mt-0 min-h-[360px] overflow-x-clip',
                tabDirection === 'left' ? 'animate-tab-slide-left' : 'animate-tab-slide-right',
              )}
            >
               <div className="space-y-6 sm:space-y-8">
                 {canViewReadingLists && (
                   <div className="rounded-2xl border border-border/60 bg-card/65 p-5 md:p-7">
                     <div className="flex items-center gap-2 mb-5">
                       <List className="w-5 h-5 text-primary" />
                       <h3 className="text-lg sm:text-xl font-bold">Okuma Listeleri</h3>
                     </div>
                     
                     {readingLists.length === 0 ? (
                       <div className="text-center py-12 bg-secondary/25 rounded-xl border border-border/60 border-dashed">
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
                           <Link key={list.id} to={`/reading-lists/${list.id}`} className="block overflow-hidden rounded-xl border border-border/60 bg-background/45 transition-all group hover:bg-background/70 hover:border-primary/40">
                             <ReadingListCover
                               imageUrl={list.image_url}
                               alt={list.name}
                               className="h-32 w-full"
                               iconClassName="h-8 w-8"
                             />
                             <div className="p-4 sm:p-5">
                               <div className="flex justify-between items-start mb-2 gap-3">
                                 <h4 className="font-bold text-base sm:text-lg group-hover:text-primary transition-colors line-clamp-1">{list.name}</h4>
                                 <Badge variant="outline" className="text-[10px] bg-background shrink-0">
                                   {list.is_public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1 text-red-400" />} {list.is_public ? 'Açık' : 'Gizli'}
                                 </Badge>
                               </div>
                               <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-4 h-9 sm:h-10">{list.description || 'Açıklama belirtilmemiş.'}</p>
                               <div className="flex justify-between items-center text-xs text-muted-foreground">
                                 <span>{new Date(list.created_at).toLocaleDateString('tr-TR')}</span>
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
                   <div className="rounded-2xl border border-border/60 bg-card/65 p-5 md:p-7">
                     <div className="flex items-center justify-between mb-5">
                       <div className="flex items-center gap-2">
                         <Book className="w-5 h-5 text-yellow-500" />
                         <h3 className="text-lg sm:text-xl font-bold">Tier Listeleri</h3>
                       </div>
                       {isOwnProfile && (
                         <Button size="sm" variant="outline" className="gap-2" onClick={() => navigate('/tier-lists/create')}>
                           Yeni Tier Listesi
                         </Button>
                       )}
                     </div>
                     
                     {tierLists.length === 0 ? (
                       <div className="rounded-2xl border border-border/60 border-dashed bg-card/20 p-12 flex flex-col items-center justify-center text-center">
                         <div className="p-4 bg-primary/10 text-primary rounded-full mb-4">
                           <List className="w-8 h-8" />
                         </div>
                         <h3 className="text-lg sm:text-xl font-bold mb-2">Tier Listesi Yok</h3>
                         <p className="text-sm text-muted-foreground max-w-md">Kullanıcının yarattığı özel manga veya karakter sıralamaları burada gözükecek.</p>
                       </div>
                     ) : (
                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {tierLists.map(list => (
                           <div key={list.id} onClick={() => navigate(`/tier-lists/${list.id}`)} className="block rounded-xl border border-border/60 bg-background/45 p-4 sm:p-5 hover:bg-background/70 hover:border-primary/40 transition-all cursor-pointer group">
                             <div className="flex justify-between items-start mb-2">
                               <h4 className="font-bold text-base sm:text-lg group-hover:text-primary transition-colors line-clamp-1">{list.title}</h4>
                               <Badge variant="outline" className="text-[10px] bg-background">
                                 {list.is_public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1 text-red-400" />} {list.type === 'character' ? 'Karakter' : 'Manga'}
                               </Badge>
                             </div>
                             <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-4 h-9 sm:h-10">Kendi sıralamasını oluşturdu.</p>
                             <div className="flex justify-between items-center text-xs text-muted-foreground border-t border-border/60 pt-3">
                               <span>Sıralamayı Göster <ChevronRight className="w-3 h-3 inline pb-0.5" /></span>
                               <span>{new Date(list.created_at).toLocaleDateString('tr-TR')}</span>
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
            <TabsContent
              value="comments"
              className={cn(
                'mt-0 min-h-[360px] overflow-x-clip',
                tabDirection === 'left' ? 'animate-tab-slide-left' : 'animate-tab-slide-right',
              )}
            >
                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-6 md:p-7">
                 <div className="mb-4 flex items-center gap-2 sm:mb-5">
                   <MessageSquare className="w-5 h-5 text-primary" />
                   <h3 className="text-lg sm:text-xl font-bold">Son Yorumlar</h3>
                 </div>

                 {profileData.recentComments?.length > 0 ? (
                   <div className="space-y-3">
                     {(profileData.recentComments as ProfileRecentComment[]).map((comment) => {
                       const entityLabel =
                         comment.entityType === 'manga'
                           ? comment.mangaType
                             ? getCompactMangaTypeLabel(comment.mangaType)
                             : 'Seri'
                           : 'Karakter';

                       return (
                         <Link
                           key={`${comment.entityType}-${comment.id}`}
                           to={comment.targetHref}
                           className="group block rounded-xl border border-border/60 bg-background/45 p-3.5 transition-colors hover:border-primary/40 hover:bg-background/70 sm:p-4"
                         >
                           <div className="flex items-start gap-3.5">
                             <div className="h-20 w-14 sm:h-24 sm:w-16 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-secondary/40">
                               {comment.targetImage ? (
                                 <OptimizedImage
                                   src={comment.targetImage}
                                   alt={comment.targetName}
                                   allowProxy
                                   transform={{ width: 144, quality: 85, format: 'webp', fit: 'cover' }}
                                   containerClassName="h-full w-full"
                                   placeholderClassName="rounded-xl p-1 text-[8px] leading-tight"
                                   className="h-full w-full object-cover"
                                 />
                               ) : (
                                 <div className="flex h-full w-full items-center justify-center bg-secondary/40 text-muted-foreground/70">
                                   {comment.entityType === 'manga' ? (
                                     <BookOpen className="h-5 w-5" />
                                   ) : (
                                     <UserIcon className="h-5 w-5" />
                                   )}
                                 </div>
                               )}
                             </div>

                             <div className="min-w-0 flex-1">
                               <div className="flex flex-wrap items-start justify-between gap-2">
                                 <div className="min-w-0">
                                   <h4 className="line-clamp-1 text-sm sm:text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                                     {comment.targetName}
                                   </h4>
                                   <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs text-muted-foreground">
                                     <span>{entityLabel}</span>
                                     {typeof comment.chapterNumber === 'number' && (
                                       <>
                                         <span className="text-muted-foreground/50">·</span>
                                         <span className="font-medium text-foreground/85">Bölüm {comment.chapterNumber}</span>
                                       </>
                                     )}
                                     {typeof comment.pageNumber === 'number' && (
                                       <>
                                         <span className="text-muted-foreground/50">·</span>
                                         <span>Sayfa {comment.pageNumber}</span>
                                       </>
                                     )}
                                     <span className="text-muted-foreground/50">·</span>
                                     <span>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: tr })}</span>
                                   </div>
                                 </div>

                                 <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                                   <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 tabular-nums">
                                     <ThumbsUp className="h-3 w-3 text-primary" />
                                     <span>{comment.likes || 0}</span>
                                   </span>
                                   <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                                 </div>
                               </div>

                               {(() => {
                                 const previewText = comment.richPreview || comment.preview || (comment.hasGif ? 'GIF yorumu' : comment.hasMedia ? 'Görsel yorumu' : '');
                                 const isBlurred = Boolean(comment.isSpoiler && !revealedCommentSpoilers[comment.id]);
                                 const toggleCommentSpoiler = (event: React.MouseEvent | React.KeyboardEvent) => {
                                   if (!comment.isSpoiler) return;
                                   const target = event.target as HTMLElement | null;
                                   if (!isBlurred && target?.closest('a, button')) {
                                     return;
                                   }
                                   event.preventDefault();
                                   event.stopPropagation();
                                   setRevealedCommentSpoilers((prev) => ({
                                     ...prev,
                                     [comment.id]: !prev[comment.id],
                                   }));
                                 };

                                 return (
                                   <div
                                     role={comment.isSpoiler ? 'button' : undefined}
                                     tabIndex={comment.isSpoiler ? 0 : undefined}
                                     aria-expanded={comment.isSpoiler ? !isBlurred : undefined}
                                     aria-label={isBlurred ? 'Spoiler içeren yorumu göster' : undefined}
                                     onClick={toggleCommentSpoiler}
                                     onKeyDown={(event) => {
                                       if (!comment.isSpoiler) return;
                                       if (event.key === 'Enter' || event.key === ' ') {
                                         toggleCommentSpoiler(event);
                                       }
                                     }}
                                     className={cn(
                                       'mt-2.5 line-clamp-2 rounded-lg bg-secondary/25 px-3 py-2 text-xs sm:text-sm leading-relaxed text-foreground/90 sm:line-clamp-3 transition-[filter,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                       comment.isSpoiler && 'cursor-pointer',
                                       isBlurred && 'blur-[5px] opacity-80 select-none [&_*]:pointer-events-none',
                                     )}
                                   >
                                     {renderRichContent(previewText)}
                                   </div>
                                 );
                               })()}

                               {(comment.parentId || comment.hasMedia || comment.hasGif) && (
                                 <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                   {comment.parentId && (
                                     <Badge variant="outline" className="rounded-md text-[10px]">
                                       <Reply className="mr-1 h-3 w-3" />
                                       Yanıt
                                     </Badge>
                                   )}
                                   {comment.hasMedia && (
                                     <Badge variant="outline" className="rounded-md text-[10px]">
                                       <ImageIcon className="mr-1 h-3 w-3" />
                                       Görsel
                                     </Badge>
                                   )}
                                   {comment.hasGif && (
                                     <Badge variant="outline" className="rounded-md text-[10px]">
                                       <Film className="mr-1 h-3 w-3" />
                                       GIF
                                     </Badge>
                                   )}
                                 </div>
                               )}
                             </div>
                           </div>
                         </Link>
                       );
                     })}
                   </div>
                 ) : (
                   <div className="rounded-2xl border border-border/60 border-dashed bg-card/20 p-12 text-center">
                     <MessageSquare className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
                     <h3 className="text-lg font-semibold">Henüz yorum yok</h3>
                     <p className="mt-2 text-sm text-muted-foreground">Kullanıcının attığı son yorumlar burada görünecek.</p>
                   </div>
                 )}
                </div>
             </TabsContent>
            )}
            {canViewReviews && (
            <TabsContent
              value="reviews"
              className={cn(
                'mt-0 min-h-[360px] overflow-x-clip',
                tabDirection === 'left' ? 'animate-tab-slide-left' : 'animate-tab-slide-right',
              )}
            >
                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-6 md:p-7">
                 <div className="mb-4 flex items-center gap-2 sm:mb-5">
                   <Star className="w-5 h-5 text-yellow-400" />
                   <h3 className="text-lg sm:text-xl font-bold">Son İncelemeler</h3>
                 </div>

                 {profileReviews.length > 0 ? (
                   <div className="space-y-3.5">
                     {profileReviews.map((review) => {
                       const averageScore = getReviewAverageScore(review);
                       const statusLabel = getMangaStatusLabel(review.mangaStatus);

                       return (
                         <Link
                           key={review.id}
                           to={review.targetHref}
                           className="group block rounded-xl border border-border/60 bg-background/45 p-3.5 transition-colors hover:border-primary/40 hover:bg-background/70 sm:p-4"
                         >
                           <div className="flex items-start gap-3.5 sm:gap-4">
                             <div className="h-24 w-16 sm:h-28 sm:w-20 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-secondary/40">
                               {review.mangaCover ? (
                                 <OptimizedImage
                                   src={review.mangaCover}
                                   alt={review.mangaTitle}
                                   allowProxy
                                   transform={{ width: 160, quality: 85, format: 'webp', fit: 'cover' }}
                                   containerClassName="h-full w-full"
                                   placeholderClassName="rounded-xl p-1 text-[8px] leading-tight"
                                   className="h-full w-full object-cover"
                                 />
                               ) : (
                                 <div className="flex h-full w-full items-center justify-center bg-secondary/40 text-center text-xs text-muted-foreground">
                                   Kapak yok
                                 </div>
                               )}
                             </div>

                             <div className="min-w-0 flex-1">
                               <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                 <div className="min-w-0">
                                   <div className="flex flex-wrap items-center gap-2">
                                     <h4 className="line-clamp-1 text-base sm:text-lg font-bold transition-colors group-hover:text-primary">
                                       {review.mangaTitle}
                                     </h4>
                                     {isEditedReview(review) && (
                                       <Badge variant="outline" className="rounded-md border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary">
                                         Düzenlendi
                                       </Badge>
                                     )}
                                   </div>
                                   <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                     <span>{formatDistanceToNow(new Date(review.createdAt), { addSuffix: true, locale: tr })}</span>
                                     {review.mangaType && (
                                       <>
                                         <span className="text-muted-foreground/50">·</span>
                                         <span className="font-medium text-foreground/80">{getCompactMangaTypeLabel(review.mangaType)}</span>
                                       </>
                                     )}
                                     {statusLabel && (
                                       <>
                                         <span className="text-muted-foreground/50">·</span>
                                         <span>{statusLabel}</span>
                                       </>
                                     )}
                                   </div>
                                 </div>

                                 <div className="flex shrink-0 flex-wrap items-center gap-2">
                                   <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs font-bold text-yellow-300 tabular-nums">
                                     <Star className="h-3.5 w-3.5 fill-current" />
                                     {averageScore.toFixed(1)}/10
                                   </span>
                                   <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground tabular-nums">
                                     <ThumbsUp className="h-3.5 w-3.5 text-emerald-400" />
                                     {review.likes || 0}
                                   </span>
                                   {(review.dislikes || 0) > 0 && (
                                     <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground tabular-nums">
                                       <ThumbsDown className="h-3.5 w-3.5 text-rose-400" />
                                       {review.dislikes}
                                     </span>
                                   )}
                                   <span className="hidden sm:inline-flex items-center gap-0.5 pl-1 text-xs font-medium text-primary">
                                     Seriye Git
                                     <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                   </span>
                                 </div>
                               </div>

                               <div className="mt-2.5 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                                 {renderRichContent(review.content)}
                               </div>

                               <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                 <span className="rounded-md border border-border/60 bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-foreground/85">
                                   Hikaye {review.ratingStory}/10
                                 </span>
                                 <span className="rounded-md border border-border/60 bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-foreground/85">
                                   Karakter {review.ratingCharacters}/10
                                 </span>
                                 <span className="rounded-md border border-border/60 bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-foreground/85">
                                   Çizim {review.ratingArt}/10
                                 </span>
                                 <span className="rounded-md border border-border/60 bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-foreground/85">
                                   İlerleyiş {review.ratingProgression}/10
                                 </span>
                                 <span className="rounded-md border border-border/60 bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-foreground/85">
                                   Sürükleyicilik {review.ratingEngagement}/10
                                 </span>
                               </div>
                             </div>
                           </div>
                         </Link>
                       );
                     })}
                   </div>
                 ) : (
                   <div className="rounded-2xl border border-border/60 border-dashed bg-card/20 p-12 text-center">
                     <Star className="w-10 h-10 mx-auto text-muted-foreground/60 mb-4" />
                     <h3 className="text-lg font-semibold">Henüz inceleme yok</h3>
                     <p className="text-muted-foreground mt-2 text-sm">Bu kullanıcının seri incelemeleri burada görünecek.</p>
                   </div>
                 )}
                </div>
             </TabsContent>
            )}
            {canViewFollowedManga && (
            <TabsContent
              value="following-manga"
              className={cn(
                'mt-0 min-h-[360px] overflow-x-clip',
                tabDirection === 'left' ? 'animate-tab-slide-left' : 'animate-tab-slide-right',
              )}
            >
                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-6 md:p-7">
                 <div className="mb-5 flex items-center gap-2">
                   <BookOpen className="w-5 h-5 text-primary" />
                   <h3 className="text-lg sm:text-xl font-bold">Takip Edilen İçerikler</h3>
                 </div>

                 {profileData.followedManga?.length > 0 ? (
                   <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                     {profileData.followedManga.map((manga: any) => (
                       <Link
                         key={manga.id}
                         to={manga.href}
                         className="group"
                       >
                         <div className="overflow-hidden rounded-xl border border-border/60 bg-background/45 transition-colors hover:border-primary/40 hover:bg-background/70">
                           <div className="relative aspect-[3/4] overflow-hidden bg-secondary/30">
                              <OptimizedImage
                                src={manga.cover}
                                alt={manga.title}
                                allowProxy
                                transform={{ width: 280, quality: 84, format: 'webp', fit: 'cover' }}
                                containerClassName="h-full w-full"
                                placeholderClassName="rounded-none"
                                className="h-full w-full object-cover"
                              />
                             <Badge className="absolute left-2 top-2 rounded-md border-none bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-black/75">
                              {getCompactMangaTypeLabel(manga.type)}
                             </Badge>
                           </div>

                           <div className="space-y-1.5 p-2.5 sm:p-3">
                             <h4 className="line-clamp-2 text-xs sm:text-sm font-semibold leading-snug group-hover:text-primary transition-colors">
                               {manga.title}
                             </h4>
                             <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                               <span>
                                 {formatDistanceToNow(new Date(manga.followedAt), { addSuffix: true, locale: tr })}
                               </span>
                               {manga.status && (
                                 <>
                                   <span className="text-muted-foreground/50">·</span>
                                   <span>{formatMangaStatusLabel(manga.status)}</span>
                                 </>
                               )}
                             </div>
                           </div>
                         </div>
                       </Link>
                     ))}
                   </div>
                 ) : (
                   <div className="rounded-2xl border border-border/60 border-dashed bg-card/20 p-12 text-center">
                     <BookOpen className="w-10 h-10 mx-auto text-muted-foreground/60 mb-4" />
                     <h3 className="text-lg font-semibold">Henüz takip edilen seri yok</h3>
                     <p className="text-muted-foreground mt-2 text-sm">Favorilere eklenenler değil, sadece takip edilen seriler burada görünecek.</p>
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

        <Dialog open={isQuickEditOpen} onOpenChange={setIsQuickEditOpen}>
          <DialogContent className="max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[520px] overflow-y-auto rounded-2xl border border-border/70 p-4 sm:p-6">
            <DialogHeader className="space-y-1.5 pr-6 text-left">
              <DialogTitle className="text-lg font-bold sm:text-xl">Profili Düzenle</DialogTitle>
              <DialogDescription>
                Banner görseli URL&apos;si ve biyografinizi buradan hızlıca güncelleyebilirsiniz.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              <div className="space-y-2">
                <Label htmlFor="quick-profile-banner-url">Banner Görsel URL</Label>
                <Input
                  id="quick-profile-banner-url"
                  placeholder="https://example.com/banner.jpg"
                  value={quickBannerUrl}
                  onChange={(event) => {
                    setQuickBannerUrl(event.target.value);
                    setQuickBannerPreviewFailed(false);
                  }}
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground">
                  Boş bırakırsanız son okuduğunuz seriden otomatik arka plan kullanılır.
                </p>
                {quickBannerUrl.trim() && isValidOptionalBannerUrl(quickBannerUrl) && (
                  <div className="relative mt-2 aspect-[4/1] max-h-32 w-full overflow-hidden rounded-xl border border-border/60 bg-secondary/30">
                    {!quickBannerPreviewFailed ? (
                      <>
                        <img
                          src={quickBannerUrl.trim()}
                          alt="Banner önizleme"
                          className="h-full w-full object-cover object-center"
                          onError={() => setQuickBannerPreviewFailed(true)}
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/85 via-transparent to-transparent" />
                      </>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center gap-2 text-xs text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                        Görsel önizlemesi yüklenemedi.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="quick-profile-bio">Biyografi</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{quickBio.length}/280</span>
                </div>
                <Textarea
                  id="quick-profile-bio"
                  placeholder="Kendiniz hakkında kısa bir not..."
                  value={quickBio}
                  onChange={(event) => setQuickBio(event.target.value.slice(0, 280))}
                  maxLength={280}
                  className="min-h-[92px] resize-none"
                />
              </div>
            </div>

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button asChild variant="ghost" size="sm" className="w-full sm:w-auto">
                <Link to="/settings?tab=profile" onClick={() => setIsQuickEditOpen(false)}>
                  Tüm Profil Ayarları
                </Link>
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setIsQuickEditOpen(false)} disabled={isSavingQuickEdit}>
                  İptal
                </Button>
                <Button type="button" onClick={() => void handleSaveQuickProfile()} disabled={isSavingQuickEdit}>
                  {isSavingQuickEdit ? 'Kaydediliyor...' : 'Kaydet'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </main>
    </div>
  );
};

export default Profile;
