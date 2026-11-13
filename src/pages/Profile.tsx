import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Eye,
  Film,
  Globe,
  Image as ImageIcon,
  Layers,
  List,
  Loader2,
  Lock,
  MessageSquare,
  MessageSquareText,
  Reply,
  Shield,
  Star,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import ReadingListCover from '@/components/manga/ReadingListCover';
import ProfileForumTab from '@/components/profile/ProfileForumTab';
import ProfileLibraryTab from '@/components/profile/ProfileLibraryTab';
import ProfileSidebar, {
  type ProfileNavItem,
  type ProfileTabKey,
} from '@/components/profile/ProfileSidebar';
import ProfileStatsTab from '@/components/profile/ProfileStatsTab';
import ProfileWallTab, {
  type ProfileReadingHistoryEntry,
} from '@/components/profile/ProfileWallTab';
import UserListModal from '@/components/profile/UserListModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { createProfileReport } from '@/lib/database';
import { getMangaTypeLabel } from '@/lib/mangaType';
import {
  blockUser,
  followUser,
  getProfileExtendedData,
  getUserProfile,
  syncAchievements,
  unblockUser,
  unfollowUser,
  updateProfileCustomization,
  type ProfileExtendedData,
  type ProfileRecentReview,
  type ProfileWallPost,
} from '@/lib/profile';
import { renderRichContent } from '@/lib/richTextRender';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

const EMPTY_EXTENDED_DATA: ProfileExtendedData = {
  bio: '',
  bannerUrl: '',
  followerPreviews: [],
  achievements: [],
  wallPosts: [],
  wallPostCount: 0,
  libraryItems: [],
  completedSeriesCount: 0,
  readingDaysCount: 0,
  monthlyReading: [],
  topGenres: [],
  typeCounts: [],
  ratingDistribution: [],
  ratingAverage: 0,
  topReadSeries: [],
  forumActivity: [],
  forumCount: 0,
  communityStats: {
    commentCount: 0,
    reviewCount: 0,
    topicCount: 0,
    forumReplyCount: 0,
    wallPostCount: 0,
    likesReceived: 0,
  },
};

const PROFILE_REPORT_REASONS = [
  'Sahte veya yanıltıcı profil',
  'Hakaret veya taciz',
  'Spam veya reklam',
  'Uygunsuz kullanıcı adı / görsel',
  'Diğer',
];

const normalizeProfileTab = (rawTab: string | null): ProfileTabKey => {
  switch (rawTab) {
    case 'library':
    case 'following-manga':
      return 'library';
    case 'lists':
    case 'tierlists':
      return 'lists';
    case 'comments':
      return 'comments';
    case 'reviews':
      return 'reviews';
    case 'forum':
      return 'forum';
    case 'stats':
    case 'achievements':
      return 'stats';
    case 'wall':
    default:
      return 'wall';
  }
};

const computeReviewScore = (review: ProfileRecentReview): number =>
  Math.round(
    ((review.ratingStory +
      review.ratingCharacters +
      review.ratingArt +
      review.ratingProgression +
      review.ratingEngagement) /
      5) *
      10,
  ) / 10;

const formatMangaStatusLabel = (status?: string | null): string => {
  if (!status) return '';
  if (status === 'Devam Ediyor' || status === 'ongoing') return 'Devam Ediyor';
  if (status === 'Tamamlandı' || status === 'completed') return 'Tamamlandı';
  if (status === 'Ara Verildi' || status === 'hiatus') return 'Ara Verildi';
  return status;
};

const ProfilePageSkeleton: React.FC = () => (
  <div className="min-h-screen bg-background">
    <Header />
    <main className="container max-w-6xl pb-12 pt-20">
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border/80 bg-card/70">
            <Skeleton className="h-24 w-full" />
            <div className="px-4 pb-4">
              <div className="-mt-9 flex items-end justify-between">
                <Skeleton className="h-[72px] w-[72px] rounded-full" />
                <Skeleton className="h-8 w-24 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-6 w-36" />
              <Skeleton className="mt-2 h-4 w-48" />
              <Skeleton className="mt-4 h-12 w-full rounded-lg" />
              <Skeleton className="mt-2.5 h-14 w-full rounded-lg" />
            </div>
          </div>
          <Skeleton className="hidden h-64 w-full rounded-xl lg:block" />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </main>
  </div>
);

const Profile: React.FC = () => {
  const { userId } = useParams<{ userId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: currentUser, updatePreferences } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const { toast } = useToast();

  const targetUserId = userId || currentUser?.id;

  const [profileData, setProfileData] = useState<any>(null);
  const [extendedData, setExtendedData] = useState<ProfileExtendedData>(EMPTY_EXTENDED_DATA);
  const [activityData, setActivityData] = useState<{ date: string; count: number }[]>([]);
  const [readingLists, setReadingLists] = useState<any[]>([]);
  const [tierLists, setTierLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false);
  const [isBlockLoading, setIsBlockLoading] = useState(false);

  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState(PROFILE_REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [isReportSubmitting, setIsReportSubmitting] = useState(false);

  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [editBio, setEditBio] = useState('');
  const [editBannerUrl, setEditBannerUrl] = useState('');
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);

  const [listModalType, setListModalType] = useState<'followers' | 'following' | null>(null);

  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewSort, setReviewSort] = useState<'newest' | 'highest' | 'liked'>('newest');

  const isOwnProfile = Boolean(currentUser && targetUserId && currentUser.id === targetUserId);
  const includeAdult = currentUser?.preferences?.content?.adult_mode === true;

  useDocumentTitle(profileData?.username ? `${profileData.username} · Profil` : 'Profil');

  useEffect(() => {
    if (!isOnline || !targetUserId) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadProfile = async () => {
      setLoading(true);
      setError(null);

      try {
        const [profile, extended] = await Promise.all([
          getUserProfile(targetUserId, currentUser?.id),
          getProfileExtendedData(targetUserId).catch((extError) => {
            console.error('Profile extended data fetch error:', extError);
            return null;
          }),
        ]);

        if (!active) return;

        const profileVisible = profile.sectionAccess?.profile ?? true;
        setProfileData(profile);
        setExtendedData(extended ?? EMPTY_EXTENDED_DATA);
        setActivityData(profile.activity || []);
        setReadingLists(profile.readingLists || []);
        setTierLists(profile.tierLists || []);

        if (isOwnProfile && profileVisible) {
          void syncAchievements(targetUserId, {
            totalSeries: profile.stats.totalSeries,
            totalChapters: profile.stats.totalChapters,
            totalComments: profile.stats.totalComments,
          })
            .then((synced) => {
              if (!active || !Array.isArray(synced)) return;
              const mapped = synced.map((entry: any) => ({
                achievementId: String(entry.achievement_id || entry.achievementId || ''),
                progress: Number(entry.progress ?? 0) || 0,
                unlockedAt: String(entry.unlocked_at || entry.unlockedAt || ''),
              }));
              setExtendedData((prev) => ({
                ...prev,
                achievements: mapped.length > 0 ? mapped : prev.achievements,
              }));
            })
            .catch((syncError) => {
              console.error('Achievement sync error:', syncError);
            });
        }
      } catch (err) {
        if (!active) return;
        console.error('Profile fetch error:', err);
        setError('Profil yüklenirken bir hata oluştu veya profil gizli tutuluyor.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      active = false;
    };
  }, [currentUser?.id, isOnline, isOwnProfile, targetUserId]);

  const canView = profileData?.sectionAccess?.profile ?? true;
  const canViewReadingHistory = profileData?.sectionAccess?.readingHistory ?? true;
  const canViewReadingDetails = canViewReadingHistory && Boolean(currentUser);
  const canViewReadingLists = profileData?.sectionAccess?.readingLists ?? true;
  const canViewTierLists = profileData?.sectionAccess?.tierLists ?? true;
  const canViewComments = profileData?.sectionAccess?.comments ?? true;
  const canViewReviews = profileData?.sectionAccess?.reviews ?? canViewComments;
  const canViewFollowedManga = profileData?.sectionAccess?.followedManga ?? true;
  const canViewLibrary = canViewFollowedManga;
  const canViewAnyLists = canViewReadingLists || canViewTierLists;

  const libraryItemsFallback = useMemo(() => {
    if (extendedData.libraryItems.length > 0) {
      return extendedData.libraryItems;
    }
    const followed = Array.isArray(profileData?.followedManga) ? profileData.followedManga : [];
    return followed.map((item: any) => ({
      id: String(item.id),
      title: String(item.title || 'Seri'),
      cover: item.cover || null,
      type: String(item.type || 'Manga'),
      status: String(item.status || ''),
      chapterCount: Number(item.chapterCount ?? 0) || 0,
      readChaptersCount: 0,
      lastReadChapter: null,
      followedAt: String(item.followedAt || ''),
    }));
  }, [extendedData.libraryItems, profileData?.followedManga]);

  const recentReadsList = useMemo<ProfileReadingHistoryEntry[]>(() => {
    if (!canViewReadingDetails || !Array.isArray(profileData?.recentReads)) {
      return [];
    }
    return profileData.recentReads;
  }, [canViewReadingDetails, profileData?.recentReads]);

  const recentCommentsList: any[] = useMemo(
    () => (canViewComments && Array.isArray(profileData?.recentComments) ? profileData.recentComments : []),
    [canViewComments, profileData?.recentComments],
  );

  const recentReviewsList: ProfileRecentReview[] = useMemo(
    () => (canViewReviews && Array.isArray(profileData?.recentReviews) ? profileData.recentReviews : []),
    [canViewReviews, profileData?.recentReviews],
  );

  const visibleReviews = useMemo(() => {
    const query = reviewSearch.trim().toLowerCase();
    const filtered = query
      ? recentReviewsList.filter(
          (rev) =>
            rev.mangaTitle.toLowerCase().includes(query) ||
            rev.content.toLowerCase().includes(query),
        )
      : recentReviewsList;

    return [...filtered].sort((a, b) => {
      if (reviewSort === 'highest') {
        const diff = computeReviewScore(b) - computeReviewScore(a);
        if (diff !== 0) return diff;
      } else if (reviewSort === 'liked') {
        const diff = (b.likes || 0) - (a.likes || 0);
        if (diff !== 0) return diff;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [recentReviewsList, reviewSearch, reviewSort]);

  const navItems = useMemo<ProfileNavItem[]>(() => {
    if (!canView) return [];

    const items: ProfileNavItem[] = [
      {
        id: 'wall',
        label: 'Duvar',
        count: extendedData.wallPostCount || extendedData.wallPosts.length,
        icon: Layers,
      },
    ];

    if (canViewLibrary) {
      items.push({
        id: 'library',
        label: 'Kitaplık',
        count: libraryItemsFallback.length,
        icon: BookOpen,
      });
    }

    if (canViewAnyLists) {
      const listsTotal =
        (canViewReadingLists ? readingLists.length : 0) +
        (canViewTierLists ? tierLists.length : 0);
      items.push({
        id: 'lists',
        label: 'Koleksiyonlar',
        count: listsTotal,
        icon: List,
      });
    }

    if (canViewComments) {
      items.push({
        id: 'comments',
        label: 'Yorumlar',
        count: profileData?.stats?.totalComments ?? recentCommentsList.length,
        icon: MessageSquare,
      });
    }

    if (canViewReviews) {
      items.push({
        id: 'reviews',
        label: 'İncelemeler',
        count: recentReviewsList.length,
        icon: Star,
      });
    }

    items.push({
      id: 'forum',
      label: 'Forum',
      count: extendedData.forumCount || extendedData.forumActivity.length,
      icon: MessageSquareText,
    });

    items.push({
      id: 'stats',
      label: 'İstatistik',
      icon: BarChart3,
    });

    return items;
  }, [
    canView,
    canViewAnyLists,
    canViewComments,
    canViewLibrary,
    canViewReadingLists,
    canViewReviews,
    canViewTierLists,
    extendedData.forumActivity.length,
    extendedData.forumCount,
    extendedData.wallPostCount,
    extendedData.wallPosts.length,
    libraryItemsFallback.length,
    profileData?.stats?.totalComments,
    readingLists.length,
    recentCommentsList.length,
    recentReviewsList.length,
    tierLists.length,
  ]);

  const requestedTab = normalizeProfileTab(searchParams.get('tab'));
  const activeTab: ProfileTabKey = navItems.some((item) => item.id === requestedTab)
    ? requestedTab
    : (navItems[0]?.id ?? 'wall');

  const handleTabChange = useCallback(
    (nextTab: ProfileTabKey) => {
      const nextParams = new URLSearchParams(searchParams);
      if (nextTab === 'wall') {
        nextParams.delete('tab');
      } else {
        nextParams.set('tab', nextTab);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleToggleFollow = async () => {
    if (!currentUser) {
      toast({
        title: 'Giriş Gerekli',
        description: 'Takip etmek için giriş yapmalısınız.',
        variant: 'destructive',
      });
      return;
    }
    if (!profileData || isFollowLoading) return;

    setIsFollowLoading(true);
    try {
      if (profileData.relationship.isFollowing) {
        await unfollowUser(currentUser.id, profileData.id);
        setProfileData((prev: any) => ({
          ...prev,
          stats: {
            ...prev.stats,
            followersCount: Math.max(0, prev.stats.followersCount - 1),
          },
          relationship: { ...prev.relationship, isFollowing: false },
        }));
        toast({
          title: 'Takipten Çıkarıldı',
          description: `${profileData.username} artık takip edilmiyor.`,
        });
      } else {
        await followUser(currentUser.id, profileData.id);
        setProfileData((prev: any) => ({
          ...prev,
          stats: {
            ...prev.stats,
            followersCount: prev.stats.followersCount + 1,
          },
          relationship: { ...prev.relationship, isFollowing: true },
        }));
        toast({
          title: 'Takip Edildi',
          description: `${profileData.username} takip edilmeye başlandı.`,
        });
      }
    } catch {
      toast({
        title: 'Hata',
        description: 'İşlem gerçekleştirilemedi.',
        variant: 'destructive',
      });
    } finally {
      setIsFollowLoading(false);
    }
  };

  const handleConfirmBlockToggle = async () => {
    if (!currentUser || !profileData || isBlockLoading) return;
    setIsBlockLoading(true);
    try {
      if (profileData.relationship.isBlocked) {
        await unblockUser(currentUser.id, profileData.id);
        setProfileData((prev: any) => ({
          ...prev,
          relationship: { ...prev.relationship, isBlocked: false },
        }));
        toast({
          title: 'Engel Kaldırıldı',
          description: `${profileData.username} engeli kaldırıldı.`,
        });
      } else {
        await blockUser(currentUser.id, profileData.id);
        setProfileData((prev: any) => ({
          ...prev,
          relationship: { ...prev.relationship, isBlocked: true, isFollowing: false },
        }));
        toast({
          title: 'Kullanıcı Engellendi',
          description: `${profileData.username} engellendi.`,
        });
      }
      setIsBlockConfirmOpen(false);
    } catch {
      toast({
        title: 'Hata',
        description: 'Engelleme işlemi başarısız oldu.',
        variant: 'destructive',
      });
    } finally {
      setIsBlockLoading(false);
    }
  };

  const handleSubmitProfileReport = async () => {
    if (!currentUser || !profileData) {
      toast({
        title: 'Giriş Gerekli',
        description: 'Bildirim göndermek için giriş yapmalısınız.',
        variant: 'destructive',
      });
      return;
    }

    if (!reportReason.trim()) {
      toast({
        title: 'Neden seçin',
        description: 'Lütfen bildirim nedeni seçin.',
        variant: 'destructive',
      });
      return;
    }

    setIsReportSubmitting(true);
    try {
      await createProfileReport({
        reporterId: currentUser.id,
        reportedUserId: profileData.id,
        reason: reportReason,
        details: reportDetails,
      });
      toast({
        title: 'Profil bildirildi',
        description: 'Bildiriminiz moderasyon ekibine iletildi.',
      });
      setIsReportDialogOpen(false);
      setReportDetails('');
    } catch (reportErr) {
      console.error('Profile report error:', reportErr);
      toast({
        title: 'Hata',
        description: 'Profil bildirimi gönderilemedi.',
        variant: 'destructive',
      });
    } finally {
      setIsReportSubmitting(false);
    }
  };

  const handleOpenEditCustomization = () => {
    setEditBio(extendedData.bio || currentUser?.preferences?.profile?.bio || '');
    setEditBannerUrl(extendedData.bannerUrl || currentUser?.preferences?.profile?.banner_url || '');
    setIsEditProfileOpen(true);
  };

  const handleSaveCustomization = async () => {
    if (!currentUser || isSavingCustomization) return;

    setIsSavingCustomization(true);
    try {
      const updatedPrefs = await updateProfileCustomization(currentUser.preferences, {
        bio: editBio,
        bannerUrl: editBannerUrl,
      });
      const nextBio = updatedPrefs?.profile?.bio ?? '';
      const nextBanner = updatedPrefs?.profile?.banner_url ?? '';

      setExtendedData((prev) => ({
        ...prev,
        bio: nextBio,
        bannerUrl: nextBanner,
      }));
      await updatePreferences(updatedPrefs as User['preferences']);
      setIsEditProfileOpen(false);
      toast({
        title: 'Profil güncellendi',
        description: 'Biyografi ve kapak ayarları kaydedildi.',
      });
    } catch (saveErr) {
      console.error('Profile customization save error:', saveErr);
      toast({
        title: 'Hata',
        description: 'Profil bilgileri kaydedilemedi.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingCustomization(false);
    }
  };

  const handleWallPostCreated = useCallback((post: ProfileWallPost) => {
    setExtendedData((prev) => ({
      ...prev,
      wallPosts: [post, ...prev.wallPosts],
      wallPostCount: prev.wallPostCount + 1,
      communityStats: {
        ...prev.communityStats,
        wallPostCount: prev.communityStats.wallPostCount + 1,
      },
    }));
  }, []);

  const handleWallPostDeleted = useCallback((postId: string) => {
    setExtendedData((prev) => ({
      ...prev,
      wallPosts: prev.wallPosts.filter((post) => post.id !== postId),
      wallPostCount: Math.max(0, prev.wallPostCount - 1),
      communityStats: {
        ...prev.communityStats,
        wallPostCount: Math.max(0, prev.communityStats.wallPostCount - 1),
      },
    }));
  }, []);

  if (!isOnline) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <OfflineRequiredScreen
          title="Profil Sayfası İnternet İstiyor"
          description="Kullanıcı profilleri, takipçi listeleri, duvar paylaşımları ve istatistikler yalnızca çevrimiçi modda açılır."
        />
      </div>
    );
  }

  if (!targetUserId) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-6xl pb-12 pt-24 text-center">
          <p className="text-sm text-muted-foreground">Profili görmek için giriş yapmalısınız.</p>
          <Button asChild className="mt-4" size="sm">
            <Link to="/auth">Giriş Yap</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (loading) {
    return <ProfilePageSkeleton />;
  }

  if (error || !profileData) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-6xl pb-12 pt-24 text-center">
          <Shield className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-bold">Profil Görüntülenemiyor</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {error || 'Bu profil bulunamadı veya gizli tutuluyor.'}
          </p>
          <Button asChild className="mt-5" size="sm" variant="outline">
            <Link to="/">Ana Sayfaya Dön</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-6xl pb-12 pt-20">
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ProfileSidebar
            profile={{
              id: profileData.id,
              username: profileData.username,
              avatar: profileData.avatar,
              role: profileData.role,
              created_at: profileData.created_at,
              bio: extendedData.bio,
              bannerUrl: extendedData.bannerUrl,
              stats: profileData.stats,
              relationship: profileData.relationship,
            }}
            completedSeriesCount={extendedData.completedSeriesCount}
            readingDaysCount={extendedData.readingDaysCount}
            followerPreviews={extendedData.followerPreviews}
            achievements={extendedData.achievements}
            isOwnProfile={isOwnProfile}
            canViewReadingStats={canView && canViewReadingHistory}
            followLoading={isFollowLoading}
            navItems={navItems}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onToggleFollow={() => void handleToggleFollow()}
            onOpenFollowModal={(type) => setListModalType(type)}
            onOpenEditCustomization={handleOpenEditCustomization}
            onOpenBlockConfirm={() => setIsBlockConfirmOpen(true)}
            onOpenReport={() => setIsReportDialogOpen(true)}
          />

          <div className="min-w-0 space-y-4">
            {!canView ? (
              <div className="rounded-xl border border-border/80 bg-card/65 p-10 text-center">
                <Lock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <h2 className="text-base font-bold">Bu Profil Gizli</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Kullanıcı profil ayrıntılarını gizlemeyi tercih etmiş.
                </p>
              </div>
            ) : (
              <>
                {/* Mobile Horizontal Scrollable Tab Strip */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide lg:hidden">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleTabChange(item.id)}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                          isActive
                            ? 'bg-foreground text-background'
                            : 'border border-border/75 bg-card/65 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span>{item.label}</span>
                        {typeof item.count === 'number' && (
                          <span className="tabular-nums opacity-75">{item.count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {activeTab === 'wall' && (
                  <ProfileWallTab
                    profileId={profileData.id}
                    profileUsername={profileData.username}
                    profileAvatar={profileData.avatar}
                    profileRole={profileData.role}
                    wallPosts={extendedData.wallPosts}
                    readingHistory={recentReadsList}
                    canViewHistory={canViewReadingDetails}
                    includeAdult={includeAdult}
                    currentUser={currentUser}
                    isBlockedUser={Boolean(profileData.relationship?.isBlocked)}
                    onPostCreated={handleWallPostCreated}
                    onPostDeleted={handleWallPostDeleted}
                  />
                )}

                {activeTab === 'library' && canViewLibrary && (
                  <ProfileLibraryTab
                    items={libraryItemsFallback}
                    canViewHistory={canViewReadingDetails}
                  />
                )}

                {activeTab === 'lists' && canViewAnyLists && (
                  <div className="space-y-6">
                    {canViewReadingLists && (
                      <section className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                            <BookMarked className="h-4 w-4 text-primary" />
                            Koleksiyonlar ({readingLists.length})
                          </h2>
                          {isOwnProfile && (
                            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                              <Link to="/reading-lists">Listelerimi Yönet</Link>
                            </Button>
                          )}
                        </div>

                        {readingLists.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-8 text-center text-sm text-muted-foreground">
                            Henüz herkese açık okuma listesi yok.
                          </div>
                        ) : (
                          <div className="grid gap-4 sm:grid-cols-2">
                            {readingLists.map((list: any) => (
                              <Link
                                key={list.id}
                                to={`/reading-lists/${list.id}`}
                                className="group flex flex-col justify-between rounded-xl border border-border/75 bg-card/65 p-3.5 transition-colors hover:border-primary/40 hover:bg-card"
                              >
                                <div>
                                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                    <span className="inline-flex items-center gap-1">
                                      {list.is_public ? (
                                        <Globe className="h-3 w-3 text-emerald-400" />
                                      ) : (
                                        <Lock className="h-3 w-3 text-rose-400" />
                                      )}
                                      {list.is_public ? 'Açık' : 'Özel'}
                                    </span>
                                    <span>{new Date(list.created_at).toLocaleDateString('tr-TR')}</span>
                                  </div>
                                  <h3 className="line-clamp-1 text-sm font-bold text-foreground transition-colors group-hover:text-primary sm:text-base">
                                    {list.name}
                                  </h3>
                                  {list.description && (
                                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                      {list.description}
                                    </p>
                                  )}
                                </div>

                                <div className="mt-3">
                                  <ReadingListCover
                                    variant="strip"
                                    imageUrl={list.image_url}
                                    previewCovers={Array.isArray(list.preview_covers) ? list.preview_covers : []}
                                    totalCount={typeof list.items_count === 'number' ? list.items_count : undefined}
                                    alt={list.name}
                                    showLabel={false}
                                  />
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </section>
                    )}

                    {canViewTierLists && (
                      <section className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                            <List className="h-4 w-4 text-primary" />
                            Tier Listeler ({tierLists.length})
                          </h2>
                          {isOwnProfile && (
                            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                              <Link to="/tier-lists/create">Yeni Tier List</Link>
                            </Button>
                          )}
                        </div>

                        {tierLists.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-8 text-center text-sm text-muted-foreground">
                            Henüz tier list oluşturulmamış.
                          </div>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {tierLists.map((list: any) => (
                              <div
                                key={list.id}
                                onClick={() => navigate(`/tier-lists/${list.id}`)}
                                className="group cursor-pointer rounded-xl border border-border/75 bg-card/65 p-4 transition-colors hover:border-primary/40 hover:bg-card"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <h3 className="line-clamp-1 text-sm font-bold text-foreground transition-colors group-hover:text-primary">
                                    {list.title}
                                  </h3>
                                  <Badge variant="secondary" className="h-5 shrink-0 px-2 text-[11px]">
                                    {list.type === 'character' ? 'Karakter' : 'Seri'}
                                  </Badge>
                                </div>
                                <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
                                  <span className="inline-flex items-center gap-1">
                                    {list.is_public ? (
                                      <Globe className="h-3 w-3 text-emerald-400" />
                                    ) : (
                                      <Lock className="h-3 w-3 text-rose-400" />
                                    )}
                                    {list.is_public ? 'Herkese Açık' : 'Gizli'}
                                  </span>
                                  <span>{new Date(list.created_at).toLocaleDateString('tr-TR')}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                )}

                {activeTab === 'comments' && canViewComments && (
                  <div className="space-y-3">
                    {recentCommentsList.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
                        Henüz yorum yapılmamış.
                      </div>
                    ) : (
                      recentCommentsList.map((comment) => (
                        <Link
                          key={`${comment.entityType}-${comment.id}`}
                          to={comment.targetHref}
                          className="block rounded-xl border border-border/75 bg-card/65 p-4 transition-colors hover:border-primary/40 hover:bg-card"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-foreground">{comment.targetName}</span>
                              <span>·</span>
                              <span>
                                {comment.entityType === 'manga'
                                  ? 'Seri'
                                  : comment.entityType === 'character'
                                    ? 'Karakter'
                                    : comment.entityType === 'author'
                                      ? 'Yazar'
                                      : 'Çizer'}
                              </span>
                              {comment.parentId && (
                                <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px]">
                                  <Reply className="h-2.5 w-2.5" />
                                  Yanıt
                                </span>
                              )}
                              {comment.isSpoiler && (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                                  <Eye className="h-2.5 w-2.5" />
                                  Spoiler
                                </span>
                              )}
                              {comment.hasMedia && <ImageIcon className="h-3 w-3 text-primary" />}
                              {comment.hasGif && <Film className="h-3 w-3 text-primary" />}
                            </div>
                            <span>
                              {formatDistanceToNow(new Date(comment.createdAt), {
                                addSuffix: true,
                                locale: tr,
                              })}
                            </span>
                          </div>

                          <div className="mt-2 line-clamp-3 text-sm text-foreground/90">
                            {renderRichContent(comment.preview || '')}
                          </div>

                          <div className="mt-2 flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                            <ThumbsUp className="h-3 w-3" />
                            <span>{comment.likes || 0}</span>
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'reviews' && canViewReviews && (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <Input
                        value={reviewSearch}
                        onChange={(e) => setReviewSearch(e.target.value)}
                        placeholder="İncelemelerde ara..."
                        className="h-9 bg-card/60 text-sm sm:max-w-xs"
                      />
                      <div className="flex items-center gap-1">
                        {(
                          [
                            { id: 'newest', label: 'En Yeni' },
                            { id: 'highest', label: 'En Yüksek Puan' },
                            { id: 'liked', label: 'En Beğenilen' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setReviewSort(opt.id)}
                            className={cn(
                              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                              reviewSort === opt.id
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {visibleReviews.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
                        Henüz inceleme bulunmuyor.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {visibleReviews.map((review) => {
                          const avgScore = computeReviewScore(review);
                          const statusLabel = formatMangaStatusLabel(review.mangaStatus);
                          return (
                            <Link
                              key={review.id}
                              to={review.targetHref}
                              className="block rounded-xl border border-border/75 bg-card/65 p-4 transition-colors hover:border-primary/40 hover:bg-card"
                            >
                              <div className="flex gap-3.5">
                                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                                  {review.mangaCover ? (
                                    <img
                                      src={review.mangaCover}
                                      alt={review.mangaTitle}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="line-clamp-1 text-sm font-bold text-foreground sm:text-base">
                                      {review.mangaTitle}
                                    </h3>
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold tabular-nums text-amber-400">
                                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                      {avgScore}/10
                                    </span>
                                  </div>

                                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    {review.mangaType && <span>{getMangaTypeLabel(review.mangaType)}</span>}
                                    {statusLabel && (
                                      <>
                                        <span>·</span>
                                        <span>{statusLabel}</span>
                                      </>
                                    )}
                                    <span>·</span>
                                    <span>
                                      {formatDistanceToNow(new Date(review.createdAt), {
                                        addSuffix: true,
                                        locale: tr,
                                      })}
                                    </span>
                                  </div>

                                  <div className="mt-2.5 text-sm text-foreground/90">
                                    {renderRichContent(review.content)}
                                  </div>

                                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                    <span>Hikaye {review.ratingStory}/10</span>
                                    <span>Karakter {review.ratingCharacters}/10</span>
                                    <span>Çizim {review.ratingArt}/10</span>
                                    <span>İlerleyiş {review.ratingProgression}/10</span>
                                    <span>Sürükleyicilik {review.ratingEngagement}/10</span>
                                  </div>

                                  <div className="mt-2.5 flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
                                    <span className="inline-flex items-center gap-1">
                                      <ThumbsUp className="h-3 w-3" />
                                      {review.likes}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                      <ThumbsDown className="h-3 w-3" />
                                      {review.dislikes || 0}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'forum' && (
                  <ProfileForumTab items={extendedData.forumActivity} />
                )}

                {activeTab === 'stats' && (
                  <ProfileStatsTab
                    extendedData={extendedData}
                    heatmapActivity={activityData}
                    totalChapters={profileData.stats.totalChapters}
                    totalSeries={profileData.stats.totalSeries}
                    totalReadingSeconds={profileData.stats.totalReadingSeconds}
                    canViewHistory={canViewReadingHistory}
                    canViewReviews={canViewReviews}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Followers / Following Modal */}
      {listModalType && (
        <UserListModal
          isOpen={listModalType !== null}
          onClose={() => setListModalType(null)}
          userId={profileData.id}
          type={listModalType}
        />
      )}

      {/* Owner Bio & Banner Customization Dialog */}
      <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profil Görünümünü Düzenle</DialogTitle>
            <DialogDescription>
              Kapak görseli bağlantısını ve profil açıklamanı güncelleyebilirsin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="profile-banner-input" className="text-xs font-medium text-foreground">
                Kapak Görseli URL
              </label>
              <Input
                id="profile-banner-input"
                type="url"
                value={editBannerUrl}
                onChange={(e) => setEditBannerUrl(e.target.value)}
                placeholder="https://..."
                maxLength={500}
              />
              {editBannerUrl.trim() && (
                <div className="mt-2 h-20 w-full overflow-hidden rounded-lg border border-border bg-muted">
                  <img
                    src={editBannerUrl.trim()}
                    alt="Kapak önizleme"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="profile-bio-input" className="font-medium text-foreground">
                  Hakkında (Biyografi)
                </label>
                <span className="tabular-nums text-muted-foreground">{editBio.length}/280</span>
              </div>
              <Textarea
                id="profile-bio-input"
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder="Kendinden veya sevdiğin serilerden bahset..."
                maxLength={280}
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditProfileOpen(false)}
              disabled={isSavingCustomization}
            >
              İptal
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveCustomization()}
              disabled={isSavingCustomization}
            >
              {isSavingCustomization && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block / Unblock Confirmation Dialog */}
      <Dialog open={isBlockConfirmOpen} onOpenChange={setIsBlockConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {profileData.relationship.isBlocked ? 'Engeli Kaldır' : 'Kullanıcıyı Engelle'}
            </DialogTitle>
            <DialogDescription>
              {profileData.relationship.isBlocked
                ? `${profileData.username} kullanıcısının engelini kaldırmak istediğine emin misin?`
                : `${profileData.username} kullanıcısını engellersen içerikleri ve duvar paylaşımları gizlenir.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBlockConfirmOpen(false)}
              disabled={isBlockLoading}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              variant={profileData.relationship.isBlocked ? 'default' : 'destructive'}
              onClick={() => void handleConfirmBlockToggle()}
              disabled={isBlockLoading}
            >
              {isBlockLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {profileData.relationship.isBlocked ? 'Engeli Kaldır' : 'Engelle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Profile Dialog */}
      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kullanıcıyı Bildir</DialogTitle>
            <DialogDescription>
              {profileData.username} hakkında moderasyon ekibine bildirim gönder.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {PROFILE_REPORT_REASONS.map((reason) => (
                <Button
                  key={reason}
                  type="button"
                  size="sm"
                  variant={reportReason === reason ? 'default' : 'outline'}
                  onClick={() => setReportReason(reason)}
                  className="h-8 rounded-full text-xs"
                >
                  {reason}
                </Button>
              ))}
            </div>

            <Textarea
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="İsteğe bağlı ek açıklama..."
              rows={3}
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsReportDialogOpen(false)}
              disabled={isReportSubmitting}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmitProfileReport()}
              disabled={isReportSubmitting}
            >
              {isReportSubmitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Bildir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Profile;
