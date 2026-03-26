import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import {
  Heart,
  Star,
  Eye,
  BookOpen,
  Calendar,
  Play,
  ChevronDown,
  ChevronUp,
  Library,
  Bell,
  BellOff,
  List,
  Search,
  ShieldAlert,
  Flag,
  Clock3,
  Download,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { cn } from "@/lib/utils";
import Header from '@/components/layout/Header';
import CommentSection from '@/components/comments/CommentSection';
import ReadingListModal from '@/components/manga/ReadingListModal';
import StaffBadge from '@/components/user/StaffBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getMangaById,
  getAverageRating,
  rateManga,
  getUserRating,
  incrementMangaViews,
  getReviewsForManga,
  addReview,
  getUserReview,
  toggleReviewLike,
  getSimilarMangas,
  getMangaCharacters,
  createMangaReport,
} from '@/lib/database';
import { formatChapterDisplayTitle } from '@/lib/chapterTitle';
import { Chapter, Character, LibraryCategory, Manga, Review, Favorite } from '@/lib/types';
import { Trophy, Group } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  addFavorite,
  removeFavorite,
  isFavorite,
  getChapterReadProgressMap,
  getLatestProgress,
  updateFavoriteCategory,
  followManga,
  unfollowManga,
  isFollowingManga,
  getFavorites,
} from '../lib/storage';
import {
  MessageSquare,
  ThumbsUp,
  Plus,
  Send,
  ArrowRight,
  Edit3
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getStaffTextClassName } from '@/lib/staffRoles';
import { toast } from 'sonner';
import MangaDetailSkeleton from '@/components/skeletons/MangaDetailSkeleton';
import TagSection from '@/components/tags/TagSection';
import { formatReadingDuration, getBlockedUserIds, getMangaReadingTimeTotal } from '@/lib/profile';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { offlineDownloadManager } from '@/lib/offline/downloadManager';
import { getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import { OfflineMangaGroup } from '@/lib/offline/types';
import { flushPendingReaderSync } from '@/lib/offline/offlineReaderSync';
import { getTargetCommentIdFromLocation } from '@/lib/commentNavigation';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';

const categoryLabels: Record<LibraryCategory, string> = {
  reading: 'Okuyorum',
  plan_to_read: 'Okuyacağım',
  completed: 'Tamamladım',
  on_hold: 'Beklemede',
  dropped: 'Bıraktım',
};

const DEFAULT_USER_REVIEW: Partial<Review> = {
  content: '',
  rating_story: 10,
  rating_characters: 10,
  rating_art: 10,
  rating_progression: 10,
  rating_engagement: 10,
};

const PREVIEW_CHAPTER_BATCH_SIZE = 3;

const PreviewChapter = ({ 
  chapter, 
  index, 
  mangaId, 
  isImageMounted, 
  onInView,
  onNearBottom 
}: { 
  chapter: any; 
  index: number; 
  mangaId: string; 
  isImageMounted: boolean;
  onInView: (index: number) => void;
  onNearBottom: (index: number) => void;
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          onInView(index);
        }
      });
    }, { rootMargin: '-40% 0px -40% 0px' });
    
    observer.observe(containerRef.current);
    
    const bottomObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          onNearBottom(index);
        }
      });
    }, { rootMargin: '0px 0px 800px 0px' });
    
    bottomObserver.observe(containerRef.current);

    return () => {
      observer.disconnect();
      bottomObserver.disconnect();
    };
  }, [index, onInView, onNearBottom]);

  return (
    <div ref={containerRef} className="space-y-3 rounded-xl border border-border bg-card/50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold sm:text-xl">{formatChapterDisplayTitle(chapter.number, chapter.title)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {chapter.pages.length} sayfa
          </p>
        </div>
        <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto">
          <Link to={`/manga/${mangaId}/chapter/${chapter.id}`}>
            <Play className="h-4 w-4 mr-2" />
            Oku
          </Link>
        </Button>
      </div>
      
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5">
        {chapter.pages.map((page: string, pageIndex: number) => (
          <Link key={pageIndex} to={`/manga/${mangaId}/chapter/${chapter.id}?page=${pageIndex + 1}`}>
            <div className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-secondary shadow-sm transition-transform hover:-translate-y-0.5">
              {isImageMounted ? (
                <img 
                  src={page} 
                  alt={`Bölüm ${chapter.number} Sayfa ${pageIndex + 1}`}
                  loading="lazy"
                  className="h-full w-full rounded-[inherit] object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-[inherit] bg-secondary/30 text-muted-foreground">
                  <div className="animate-pulse w-8 h-8 rounded-full bg-border/50"></div>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                  <Eye className="h-4 w-4"/> Sayfaya Git
                </span>
              </div>
              <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md font-mono text-white text-xs px-2 py-1 rounded shadow">
                {pageIndex + 1}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

const MangaDetail: React.FC = () => {
  const { mangaId } = useParams<{ mangaId: string }>();
  const location = useLocation();
  const [manga, setManga] = useState<Manga | undefined>();
  const { user, isLoading: authLoading } = useAuth();
  const { snapshot: offlineSnapshot, isOnline } = useOfflineLibrary();
  const [favorite, setFavorite] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [category, setCategory] = useState<LibraryCategory | undefined>();
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [userRating, setUserRating] = useState<number | undefined>();
  const [averageRating, setAverageRating] = useState({ average: 0, count: 0 });
  const [hoverRating, setHoverRating] = useState(0);
  const [latestProgress, setLatestProgress] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [chapterSearch, setChapterSearch] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [minLoadedPreviewIndex, setMinLoadedPreviewIndex] = useState(0);
  const [maxLoadedIndex, setMaxLoadedIndex] = useState(0);
  const [currentViewedIndex, setCurrentViewedIndex] = useState(0);
  const [previewStartIndex, setPreviewStartIndex] = useState(0);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [revealedBlockedReviews, setRevealedBlockedReviews] = useState<Record<string, boolean>>({});
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Yanlış seri bilgisi');
  const [reportDetails, setReportDetails] = useState('');
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [seriesReadingSeconds, setSeriesReadingSeconds] = useState(0);
  const [isSeriesReadingTimeLoading, setIsSeriesReadingTimeLoading] = useState(false);
  const [isOfflineView, setIsOfflineView] = useState(false);
  const [isSeriesDownloadDialogOpen, setIsSeriesDownloadDialogOpen] = useState(false);
  const [isQueueingSeriesDownload, setIsQueueingSeriesDownload] = useState(false);
  const [chapterReadMap, setChapterReadMap] = useState<Record<string, { isRead?: boolean; readProgressPercent?: number }>>({});

  const offlineSeriesEntry = useMemo<OfflineMangaGroup | undefined>(() => (
    offlineSnapshot.series.find((entry) => entry.manga.mangaId === (manga?.id || mangaId))
  ), [offlineSnapshot.series, manga?.id, mangaId]);

  const offlineChapterMap = useMemo(() => (
    (offlineSeriesEntry?.chapters || []).reduce<Record<string, OfflineMangaGroup['chapters'][number]>>((map, chapter) => {
      map[chapter.chapterId] = chapter;
      return map;
    }, {})
  ), [offlineSeriesEntry]);

  const mergedChapterReadMap = useMemo(() => {
    const merged = { ...chapterReadMap };

    Object.entries(offlineChapterMap).forEach(([chapterId, chapter]) => {
      if (!chapter.isRead && !chapter.readProgressPercent) {
        return;
      }

      merged[chapterId] = {
        ...merged[chapterId],
        isRead: Boolean(merged[chapterId]?.isRead || chapter.isRead),
        readProgressPercent: Math.max(
          Number(merged[chapterId]?.readProgressPercent || 0),
          Number(chapter.readProgressPercent || 0),
        ),
      };
    });

    return merged;
  }, [chapterReadMap, offlineChapterMap]);

  const primaryOfflineJob = useMemo(() => {
    if (!offlineSeriesEntry) {
      return undefined;
    }

    return offlineSeriesEntry.jobs.find((job) => ['running', 'queued', 'paused'].includes(job.status))
      || offlineSeriesEntry.jobs[0];
  }, [offlineSeriesEntry]);

  const handlePreviewInView = React.useCallback((idx: number) => {
    setCurrentViewedIndex(idx);
  }, []);

  const handlePreviewNearBottom = React.useCallback((idx: number) => {
    setMaxLoadedIndex(prev => Math.max(prev, idx + 1));
  }, []);

  useEffect(() => {
    if (!manga?.chapters?.length) {
      setPreviewStartIndex(0);
      setMinLoadedPreviewIndex(0);
      setCurrentViewedIndex(0);
      setMaxLoadedIndex(0);
      return;
    }

    const sortedChaptersAsc = [...manga.chapters].sort((a, b) => a.number - b.number);
    const targetChapterId = latestProgress?.chapterId;
    const targetIndex = targetChapterId
      ? Math.max(0, sortedChaptersAsc.findIndex((chapter) => chapter.id === targetChapterId))
      : 0;

    setPreviewStartIndex(targetIndex);
    setMinLoadedPreviewIndex(targetIndex);
    setCurrentViewedIndex(targetIndex);
    setMaxLoadedIndex(Math.min(sortedChaptersAsc.length - 1, targetIndex + 1));
  }, [latestProgress?.chapterId, manga?.chapters]);

  const handleLoadPreviousPreviewChapters = React.useCallback(() => {
    setMinLoadedPreviewIndex((previous) => Math.max(0, previous - PREVIEW_CHAPTER_BATCH_SIZE));
  }, []);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgBreakdown, setAvgBreakdown] = useState<any>({
    story: 0,
    characters: 0,
    art: 0,
    progression: 0,
    engagement: 0
  });
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [userReview, setUserReview] = useState<Partial<Review>>(DEFAULT_USER_REVIEW);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [similarMangas, setSimilarMangas] = useState<Manga[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [mangaCharacters, setMangaCharacters] = useState<any[]>([]);


  const [isReviewsLoading, setIsReviewsLoading] = useState(true);
  const [isCharsLoading, setIsCharsLoading] = useState(true);
  const mangaReportReasons = [
    'Yanlış seri bilgisi',
    'Kırık veya eksik bölüm',
    'Kapak veya görsel sorunu',
    'Yinelenen seri kaydı',
    'Çeviri veya içerik hatası',
    'Diğer',
  ];
  const descriptionPreviewLimit = 185;
  const descriptionPreview = React.useMemo(() => {
    const rawDescription = manga?.description?.trim() || '';

    if (rawDescription.length <= descriptionPreviewLimit) {
      return rawDescription;
    }

    const sliced = rawDescription.slice(0, descriptionPreviewLimit);
    const lastSpaceIndex = sliced.lastIndexOf(' ');

    return `${(lastSpaceIndex > 120 ? sliced.slice(0, lastSpaceIndex) : sliced).trimEnd()}...`;
  }, [manga?.description]);
  const shouldShowDescriptionToggle = Boolean(manga?.description && descriptionPreview !== manga.description.trim());

  useEffect(() => {
    const targetCommentId = getTargetCommentIdFromLocation(location.search, location.hash);

    if (targetCommentId && activeTab !== 'overview') {
      setActiveTab('overview');
    }
  }, [activeTab, location.hash, location.search]);

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [manga?.id]);

  const resetUserScopedState = React.useCallback(() => {
    setFavorite(false);
    setIsFollowing(false);
    setCategory(undefined);
    setUserRating(undefined);
    setLatestProgress(null);
    setBlockedUserIds([]);
    setChapterReadMap({});
    setSeriesReadingSeconds(0);
    setUserReview(DEFAULT_USER_REVIEW);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadMangaData = async () => {
      if (!mangaId) return;

      try {
        setIsLoading(true);
        setIsReviewsLoading(true);
        setIsCharsLoading(true);
        setIsSeriesReadingTimeLoading(false);
        setLoadingSimilar(false);
        setSimilarMangas([]);
        setMangaCharacters([]);
        setReviews([]);
        resetUserScopedState();

        // Wave 1: Fetch the most important thing (Manga Metadata)
        const mData = isOnline ? await getMangaById(mangaId) : undefined;
        if (isCancelled) return;
        
        if (mData) {
          setIsOfflineView(false);
          setManga(mData);
          setAverageRating({ average: mData.averageRating, count: mData.reviewCount });
          if (mData.ratingBreakdown) {
            setAvgBreakdown(mData.ratingBreakdown);
          }
          
          // Show page structure immediately after metadata
          setIsLoading(false);

          // Wave 2: Fetch secondary content without re-triggering the page skeleton.
          void Promise.all([
            getMangaCharacters(mangaId),
            getReviewsForManga(mangaId),
          ]).then(([mChars, mReviews]) => {
            if (isCancelled) return;

            setMangaCharacters(mChars);
            setReviews(mReviews);
            setIsCharsLoading(false);
            setIsReviewsLoading(false);
          }).catch((error) => {
            if (isCancelled) return;

            console.error('Manga detail secondary load error:', error);
            setIsCharsLoading(false);
            setIsReviewsLoading(false);
          });

          // Parallel & Non-blocking
          void incrementMangaViews(mangaId);

          if (mData.genres && mData.genres.length > 0) {
            setLoadingSimilar(true);
            void getSimilarMangas(mangaId, mData.genres, 6).then(similar => {
              if (isCancelled) return;

              setSimilarMangas(similar);
            }).catch((error) => {
              if (isCancelled) return;

              console.error('Error loading similar mangas:', error);
              setSimilarMangas([]);
            }).finally(() => {
              if (!isCancelled) {
                setLoadingSimilar(false);
              }
            });
          }
        } else {
          const offlineManga = await getOfflineMangaDetail(mangaId);
          if (isCancelled) return;

          if (offlineManga) {
            setManga(offlineManga);
            setAverageRating({ average: 0, count: 0 });
            setReviews([]);
            setMangaCharacters([]);
            setSimilarMangas([]);
            setBlockedUserIds([]);
            setChapterReadMap({});
            setSeriesReadingSeconds(0);
            setIsOfflineView(true);
            setIsLoading(false);
            setIsReviewsLoading(false);
            setIsCharsLoading(false);
            setIsSeriesReadingTimeLoading(false);
            return;
          }

          setIsOfflineView(false);
          setManga(undefined);
          setIsLoading(false);
          setIsReviewsLoading(false);
          setIsCharsLoading(false);
        }
      } catch (err) {
        console.error('Error loading manga detail:', err);
        const offlineManga = mangaId ? await getOfflineMangaDetail(mangaId) : undefined;
        if (isCancelled) return;

        if (offlineManga) {
          setManga(offlineManga);
          setAverageRating({ average: 0, count: 0 });
          setReviews([]);
          setMangaCharacters([]);
          setSimilarMangas([]);
          setBlockedUserIds([]);
          setChapterReadMap({});
          setSeriesReadingSeconds(0);
          setIsOfflineView(true);
          setIsReviewsLoading(false);
          setIsCharsLoading(false);
          setIsSeriesReadingTimeLoading(false);
        }

        if (!offlineManga) {
          setManga(undefined);
          setIsReviewsLoading(false);
          setIsCharsLoading(false);
        }

        setIsLoading(false);
      }
    };

    void loadMangaData();

    return () => {
      isCancelled = true;
    };
  }, [isOnline, mangaId, resetUserScopedState]);

  useEffect(() => {
    if (!mangaId || isOfflineView || authLoading) {
      return;
    }

    let isCancelled = false;

    const loadUserScopedData = async () => {
      if (!user) {
        resetUserScopedState();
        setIsSeriesReadingTimeLoading(false);
        return;
      }

      try {
        setIsSeriesReadingTimeLoading(true);

        const [
          ,
          favorited,
          following,
          rating,
          progress,
          uReview,
          userFavorites,
          blockedUsersResult,
          chapterReadProgress,
          mangaReadingTime,
        ] = await Promise.all([
          isOnline ? flushPendingReaderSync() : Promise.resolve(),
          isFavorite(user.id, mangaId),
          isFollowingManga(user.id, mangaId),
          getUserRating(mangaId, user.id),
          getLatestProgress(user.id, mangaId),
          getUserReview(mangaId, user.id),
          getFavorites(user.id),
          getBlockedUserIds(user.id),
          getChapterReadProgressMap(user.id, mangaId),
          getMangaReadingTimeTotal(user.id, mangaId),
        ]);

        if (isCancelled) return;

        setFavorite(Boolean(favorited));
        setIsFollowing(Boolean(following));
        setUserRating(rating as number | undefined);
        setLatestProgress(progress);
        setUserReview((uReview as Review | null) ?? DEFAULT_USER_REVIEW);
        setBlockedUserIds((blockedUsersResult as { ids?: string[] })?.ids || []);
        setChapterReadMap((chapterReadProgress as Record<string, { isRead?: boolean; readProgressPercent?: number }>) || {});
        setSeriesReadingSeconds(Number(mangaReadingTime) || 0);

        const favs = userFavorites as Favorite[];
        const thisFav = favs.find((entry) => entry.mangaId === mangaId);
        setCategory(thisFav?.category);
      } catch (error) {
        if (isCancelled) return;

        console.error('Manga detail user load error:', error);
        resetUserScopedState();
      } finally {
        if (!isCancelled) {
          setIsSeriesReadingTimeLoading(false);
        }
      }
    };

    void loadUserScopedData();

    return () => {
      isCancelled = true;
    };
  }, [authLoading, isOfflineView, isOnline, mangaId, resetUserScopedState, user?.id]);

  if (isLoading) {
    return (
      <>
        <Header />
        <MangaDetailSkeleton />
      </>
    );
  }

  if (!manga) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container flex min-h-[60vh] items-center justify-center pt-20">
          <div className="text-center">
            {!isOnline ? (
              <>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-300">
                  <WifiOff className="h-7 w-7" />
                </div>
                <h1 className="mt-5 text-2xl font-bold">Bu seri çevrimdışı hazır değil</h1>
                <p className="mt-2 text-muted-foreground">
                  İnternet olmadan yalnızca daha önce indirdiğin seriler açılabilir.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <Button asChild variant="glow">
                    <Link to="/downloads">
                      <Download className="mr-2 h-4 w-4" />
                      İndirilenlere Git
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/">Ana Sayfaya Dön</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold">Manga Bulunamadı</h1>
                <p className="mt-2 text-muted-foreground">Aradığınız manga mevcut değil.</p>
                <Button asChild className="mt-4">
                  <Link to="/">Ana Sayfaya Dön</Link>
                </Button>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  const toggleFavorite = async () => {
    if (!isOnline) {
      toast.error('Favori islemi icin internet baglantisi gerekli');
      return;
    }

    if (!user) {
      toast.error('Favorilere eklemek için giriş yapmalısınız');
      return;
    }

    try {
      if (favorite) {
        await removeFavorite(user.id, manga.id);
        setFavorite(false);
        setCategory(undefined);
        toast.success('Favorilerden kaldırıldı');
      } else {
        await addFavorite(user.id, manga.id, 'reading');
        setFavorite(true);
        setCategory('reading');
        toast.success('Favorilere eklendi');
      }
    } catch (err) {
      toast.error('İşlem başarısız oldu');
    }
  };

  const handleCategoryChange = async (newCategory: LibraryCategory) => {
    if (!isOnline) {
      toast.error('Kategori guncellemek icin internet baglantisi gerekli');
      return;
    }

    if (!user) {
      toast.error('Giriş yapmalısınız');
      return;
    }

    try {
      if (favorite) {
        await updateFavoriteCategory(user.id, manga.id, newCategory);
      } else {
        await addFavorite(user.id, manga.id, newCategory);
      }

      const refreshedFavorites = await getFavorites(user.id);
      const refreshedEntry = refreshedFavorites.find((entry) => entry.mangaId === manga.id);

      setFavorite(true);
      setCategory((refreshedEntry?.category as LibraryCategory | undefined) || newCategory);
      toast.success(`Kategori: ${categoryLabels[(refreshedEntry?.category as LibraryCategory | undefined) || newCategory]}`);
    } catch (err) {
      console.error('Category update failed on manga detail:', err);
      toast.error('Kategori güncellenemedi');
    }
  };

  const toggleFollow = async () => {
    if (!isOnline) {
      toast.error('Takip islemi icin internet baglantisi gerekli');
      return;
    }

    if (!user) {
      toast.error('Takip etmek için giriş yapmalısınız');
      return;
    }

    try {
      if (isFollowing) {
        await unfollowManga(user.id, manga!.id);
        setIsFollowing(false);
        toast.success('Takibi bıraktınız');
      } else {
        await followManga(user.id, manga!.id);
        setIsFollowing(true);
        toast.success('Manga takip ediliyor! Yeni bölümlerden haberdar olacaksınız.');
      }
    } catch (err) {
      toast.error('İşlem başarısız oldu');
    }
  };

  const handleAddToList = () => {
    if (!isOnline) {
      toast.error('Liste islemleri icin internet baglantisi gerekli');
      return;
    }

    if (!user) {
      toast.error('Listeye eklemek için giriş yapmalısınız');
      return;
    }
    setIsListModalOpen(true);
  };

  const handleQueueSeriesDownload = async () => {
    if (!manga) {
      return;
    }

    if (!isOnline) {
      toast.error('Seri indirmek icin internete baglanmalisin');
      return;
    }

    try {
      setIsQueueingSeriesDownload(true);
      setIsSeriesDownloadDialogOpen(false);
      const job = await offlineDownloadManager.queueSeriesDownload(
        manga,
        [...manga.chapters].sort((a, b) => a.number - b.number),
      );

      if (!job) {
        toast.info('Bu serinin tüm bölümleri zaten çevrimdışı hazır');
        return;
      }
    } catch (error) {
      console.error('Series download queue error:', error);
      toast.error('Seri indirilemedi');
    } finally {
      setIsQueueingSeriesDownload(false);
    }
  };

  const handleQueueChapterDownload = async (chapter: Chapter) => {
    if (!manga) {
      return;
    }

    if (!isOnline) {
      toast.error('Bölüm indirmek icin internete baglanmalisin');
      return;
    }

    try {
      const job = await offlineDownloadManager.queueChapterDownload(manga, chapter);

      if (!job) {
        toast.info(`Bölüm ${chapter.number} zaten çevrimdışı hazır`);
        return;
      }
    } catch (error) {
      console.error('Chapter download queue error:', error);
      toast.error('Bölüm kuyruğa eklenemedi');
    }
  };

  const handleDeleteOfflineChapter = async (chapterId: string) => {
    await offlineDownloadManager.deleteChapterDownload(chapterId);
    toast.success('Bölüm indirilenlerden kaldırıldı');
  };

  const openReportDialog = () => {
    if (!isOnline) {
      toast.error('Bildirim göndermek için internet bağlantısı gerekli');
      return;
    }

    if (!user) {
      toast.error('Bildirim göndermek için giriş yapmalısınız');
      return;
    }

    setReportReason('Yanlış seri bilgisi');
    setReportDetails('');
    setIsReportDialogOpen(true);
  };

  const handleSubmitReport = async () => {
    if (!isOnline) {
      toast.error('Bildirim göndermek için internet bağlantısı gerekli');
      return;
    }

    if (!user) {
      toast.error('Bildirim göndermek için giriş yapmalısınız');
      return;
    }

    if (!reportReason.trim()) {
      toast.error('Bir neden seçmelisiniz');
      return;
    }

    try {
      setIsSubmittingReport(true);
      await createMangaReport({
        mangaId: manga.id,
        reporterId: user.id,
        reason: reportReason,
        details: reportDetails,
      });
      toast.success('Seri bildirimi admin ekibine iletildi');
      setIsReportDialogOpen(false);
      setReportDetails('');
    } catch (error) {
      console.error('Manga report submit error:', error);
      toast.error('Bildirim gönderilemedi');
    } finally {
      setIsSubmittingReport(false);
    }
  };


  const handleRating = async (rating: number) => {
    if (!isOnline) {
      toast.error('Puan vermek icin internet baglantisi gerekli');
      return;
    }

    if (!user) {
      toast.error('Puan vermek için giriş yapmalısınız');
      return;
    }

    try {
      await rateManga(manga.id, user.id, rating);
      setUserRating(rating);
      const newAvg = await getAverageRating(manga.id);
      setAverageRating(newAvg);

      // Update breakdown as well
      setAvgBreakdown({
        story: (newAvg as any).story || 0,
        characters: (newAvg as any).characters || 0,
        art: (newAvg as any).art || 0,
        progression: (newAvg as any).progression || 0,
        engagement: (newAvg as any).engagement || 0
      });

      toast.success(`${rating}/10 puan verildi!`);
    } catch (err) {
      toast.error('Puan kaydedilemedi');
    }
  };

  const handleReviewSubmit = async () => {
    if (!isOnline) {
      toast.error('Inceleme gondermek icin internet baglantisi gerekli');
      return;
    }

    if (!user) return;
    if (!userReview.content?.trim()) {
      toast.error('Lütfen bir inceleme metni yazın');
      return;
    }

    try {
      setIsSubmittingReview(true);
      await addReview({
        mangaId: manga.id,
        userId: user.id,
        username: user.username,
        userAvatar: user.avatar,
        content: userReview.content,
        rating_story: userReview.rating_story || 10,
        rating_characters: userReview.rating_characters || 10,
        rating_art: userReview.rating_art || 10,
        rating_progression: userReview.rating_progression || 10,
        rating_engagement: userReview.rating_engagement || 10,
      });

      const [newAvg, newReviews] = await Promise.all([
        getAverageRating(manga.id),
        getReviewsForManga(manga.id)
      ]);

      setAverageRating(newAvg);
      setReviews(newReviews);
      setAvgBreakdown({
        story: (newAvg as any).story || 0,
        characters: (newAvg as any).characters || 0,
        art: (newAvg as any).art || 0,
        progression: (newAvg as any).progression || 0,
        engagement: (newAvg as any).engagement || 0
      });

      setIsReviewModalOpen(false);
      toast.success('İncelemeniz başarıyla yayınlandı!');
    } catch (err) {
      toast.error('İnceleme gönderilemedi');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const toggleLikeReview = async (reviewId: string) => {
    if (!isOnline) {
      toast.error('Begeni islemi icin internet baglantisi gerekli');
      return;
    }

    if (!user) {
      toast.error('Beğenmek için giriş yapmalısınız');
      return;
    }

    try {
      await toggleReviewLike(reviewId, user.id);
      const newReviews = await getReviewsForManga(manga.id);
      setReviews(newReviews);
    } catch (err) {
      console.error('Like error:', err);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
    return views.toString();
  };

  const filteredChapters = manga.chapters.slice().reverse().filter(ch =>
    ch.number.toString().includes(chapterSearch) ||
    ch.title.toLocaleLowerCase('tr-TR').includes(chapterSearch.toLocaleLowerCase('tr-TR'))
  );

  const displayedChapters = showAllChapters
    ? filteredChapters
    : filteredChapters.slice(0, 8);

  const continueChapter = latestProgress
    ? manga.chapters.find(ch => ch.id === latestProgress.chapterId)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-16">
        {/* Hero Section */}
        <div className="relative overflow-hidden">
          {/* Background */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] overflow-hidden md:h-[34rem]">
            <img
              src={manga.banner || manga.cover}
              alt=""
              className="h-full w-full scale-110 object-cover blur-3xl [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.98)_0%,rgba(0,0,0,0.88)_48%,rgba(0,0,0,0.55)_72%,transparent_100%)]"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/72 to-background" />
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent via-background/60 to-background blur-xl" />
          </div>

          {/* Content */}
          <div className="container relative z-10 py-6 sm:py-8">
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
              {/* Cover */}
              <div className="mx-auto w-full max-w-[220px] shrink-0 animate-fade-up opacity-0 md:mx-0 md:w-64 md:max-w-none" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
                <img
                  src={manga.cover}
                  alt={manga.title}
                  className="mx-auto h-auto w-full rounded-xl object-cover shadow-2xl shadow-primary/10 md:h-96"
                />
              </div>

              {/* Info */}
              <div className="min-w-0 flex flex-1 flex-col gap-4 animate-fade-up opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="default"
                    className={`border-none font-bold ${manga.type === 'manhwa' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20' :
                      manga.type === 'manhua' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' :
                        manga.type === 'webtoon' ? 'bg-sky-600 text-white shadow-lg shadow-sky-500/20' :
                          'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                      }`}
                  >
                    {manga.type.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">
                    {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam Ediyor' : 'Ara Verildi'}
                  </Badge>
                </div>

                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{manga.title}</h1>

                {manga.alternativeTitles && manga.alternativeTitles.length > 0 && (
                  <p className="text-sm text-muted-foreground italic">
                    {manga.alternativeTitles.join(', ')}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <div className="flex items-center">
                    {manga.authorDetails ? (
                      <Link to={`/author/${manga.authorDetails.id}`} className="hover:text-primary transition-colors underline-offset-4 hover:underline">
                        {manga.author}
                      </Link>
                    ) : (
                      <span>{manga.author}</span>
                    )}
                    
                    {manga.artist && (
                      <span className="mx-2">•</span>
                    )}
                    
                    {manga.artist && manga.artistDetails ? (
                      <Link to={`/artist/${manga.artistDetails.id}`} className="hover:text-primary transition-colors underline-offset-4 hover:underline">
                        {manga.artist}
                      </Link>
                    ) : manga.artist ? (
                      <span>{manga.artist}</span>
                    ) : null}
                  </div>

                  {manga.releaseYear && (
                    <span className="flex items-center gap-1 text-xs border-l border-border pl-2">
                      <Calendar className="h-3 w-3" />
                      {manga.releaseYear}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {averageRating.count > 0 && (
                    <div className="flex items-center gap-1 text-primary">
                      <Star className="h-4 w-4 fill-primary" />
                      <span className="font-semibold">{averageRating.average}/10</span>
                      <span className="text-muted-foreground">({averageRating.count})</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Eye className="h-4 w-4" />
                    <span>{formatViews(manga.views || 0)} görüntülenme</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <BookOpen className="h-4 w-4" />
                    <span>{manga.chapters.length} bölüm</span>
                  </div>
                  {user && (
                    <div className="flex items-center gap-1 text-red-400">
                      <Clock3 className="h-4 w-4" />
                      <span>
                        Bu seride {isSeriesReadingTimeLoading ? 'yükleniyor...' : formatReadingDuration(seriesReadingSeconds)}
                      </span>
                    </div>
                  )}
                  {offlineSeriesEntry && offlineSeriesEntry.downloadedChapters > 0 && (
                    <div className="flex items-center gap-1 text-blue-400">
                      <Download className="h-4 w-4" />
                      <span>{offlineSeriesEntry.downloadedChapters} bölüm çevrimdışı hazır</span>
                    </div>
                  )}
                </div>

                <div>
                  <p className="hidden text-foreground/80 leading-relaxed md:block">
                    {manga.description}
                  </p>
                  <p className="text-foreground/80 leading-relaxed md:hidden">
                    {shouldShowDescriptionToggle && !isDescriptionExpanded ? descriptionPreview : manga.description}
                  </p>
                  {shouldShowDescriptionToggle && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsDescriptionExpanded((previous) => !previous)}
                      className="mt-2 h-8 px-0 text-sm font-medium text-primary hover:bg-transparent hover:text-primary md:hidden"
                    >
                      {isDescriptionExpanded ? 'Daha Az Göster' : 'Tamamını Gör'}
                      {isDescriptionExpanded ? (
                        <ChevronUp className="ml-2 h-4 w-4" />
                      ) : (
                        <ChevronDown className="ml-2 h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>

                {isOfflineView && (
                  <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
                    <div className="flex items-center gap-2 font-semibold">
                      <WifiOff className="h-4 w-4" />
                      Çevrimdışı görünüm
                    </div>
                    <p className="mt-1 text-blue-100/80">
                      Bu seri yerel cache&apos;ten açıldı. Yalnızca indirilen bölümler garanti edilir; yorum, bildirim ve topluluk verileri çevrimdışında güncellenmez.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {manga.genres.map((genre) => (
                    <Link key={genre} to={`/browse?genre=${encodeURIComponent(genre)}`}>
                      <Badge
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/80 transition-colors"
                      >
                        {genre}
                      </Badge>
                    </Link>
                  ))}
                </div>

                <div className="pt-4">
                  {continueChapter ? (
                    <Button asChild variant="glow" size="lg" className="w-full">
                      <Link to={`/manga/${manga.id}/chapter/${continueChapter.id}?page=${latestProgress?.page || 1}`}>
                        <Play className="h-4 w-4" />
                        Devam Et (Bölüm {continueChapter.number}, Sayfa {latestProgress?.page || 1})
                      </Link>
                    </Button>
                  ) : manga.chapters.length > 0 ? (
                    <Button asChild variant="glow" size="lg" className="w-full">
                      <Link to={`/manga/${manga.id}/chapter/${[...manga.chapters].sort((a, b) => a.number - b.number)[0]?.id}`}>
                        <Play className="h-4 w-4" />
                        Okumaya Başla
                      </Link>
                    </Button>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
                    <Button
                      variant={favorite ? 'default' : 'outline'}
                      size="lg"
                      onClick={toggleFavorite}
                      className={cn('h-11 w-full text-sm sm:h-12 sm:w-auto sm:text-base', favorite && 'bg-destructive hover:bg-destructive/90')}
                    >
                      <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
                      {favorite ? 'Favorilerde' : 'Favorilere Ekle'}
                    </Button>

                    <Button
                      variant={isFollowing ? 'default' : 'outline'}
                      size="lg"
                      onClick={toggleFollow}
                      className={cn('h-11 w-full text-sm sm:h-12 sm:w-auto sm:text-base', isFollowing && 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30')}
                    >
                      {isFollowing ? (
                        <BellOff className="h-4 w-4" />
                      ) : (
                        <Bell className="h-4 w-4" />
                      )}
                      {isFollowing ? 'Takibi Bırak' : 'Takip Et'}
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      onClick={handleAddToList}
                      className="group h-11 w-full border-primary/30 text-sm transition-all hover:border-primary/60 hover:bg-primary/5 sm:h-12 sm:w-auto sm:text-base"
                    >
                      <List className="h-4 w-4 text-primary transition-transform group-hover:scale-110" />
                      Listeye Ekle
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      disabled={primaryOfflineJob?.status === 'running'}
                      onClick={() => setIsSeriesDownloadDialogOpen(true)}
                      className="group h-11 w-full border-blue-500/30 text-sm hover:border-blue-400/60 hover:bg-blue-500/10 sm:h-12 sm:w-auto sm:text-base"
                    >
                      <Download className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
                      {primaryOfflineJob?.status === 'running'
                        ? 'Seri İndiriliyor'
                        : primaryOfflineJob && ['paused', 'failed', 'partial', 'queued'].includes(primaryOfflineJob.status)
                          ? 'İndirmeye Devam Et'
                          : 'Seriyi İndir'}
                    </Button>

                    {favorite && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="lg" className="col-span-2 h-11 w-full justify-between text-sm sm:h-12 sm:w-auto sm:text-base">
                            <Library className="h-4 w-4" />
                            {category ? categoryLabels[category] : 'Kategori'}
                            <ChevronDown className="ml-1 h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {(Object.entries(categoryLabels) as [LibraryCategory, string][]).map(([key, label]) => (
                            <DropdownMenuItem
                              key={key}
                              onClick={() => handleCategoryChange(key)}
                              className={category === key ? 'bg-secondary' : ''}
                            >
                              {label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    <Button
                      variant="outline"
                      size="lg"
                      onClick={openReportDialog}
                      className="group h-11 w-full border-amber-500/30 px-0 text-amber-100 hover:border-amber-400/60 hover:bg-amber-500/10 sm:h-12 sm:w-12"
                      aria-label="Seriyi bildir"
                      title="Seriyi bildir"
                    >
                      <Flag className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs System */}
        <div className="container py-8">
          <Tabs value={activeTab} className="w-full" onValueChange={setActiveTab}>
            <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:mb-8 sm:px-0">
              <TabsList className="h-auto min-w-full w-max justify-start gap-3 rounded-none border-b bg-transparent p-0 sm:gap-8">
                <TabsTrigger
                  value="overview"
                  className="whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  GENEL BAKIŞ
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  ÖNİZLEME
                </TabsTrigger>
                <TabsTrigger
                  value="reviews"
                  className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  İNCELEMELER
                  {reviews.length > 0 && (
                    <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[10px] text-primary hover:bg-primary/20">
                      {reviews.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="characters"
                  className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  KARAKTERLER
                  {mangaCharacters.length > 0 && (
                    <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[10px] text-primary hover:bg-primary/20">
                      {mangaCharacters.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="discover"
                  className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  KEŞFET
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3 lg:gap-8">
                {/* Chapters List */}
                <div className="space-y-4 sm:space-y-6 lg:col-span-2 lg:space-y-8">
                  <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
                    <div className="flex flex-col justify-between gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
                      <div>
                        <h2 className="text-xl font-bold">Bölümler</h2>
                        <p className="text-sm text-muted-foreground">{manga.chapters.length} bölüm mevcut</p>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Bölüm ara (örn: 97)"
                          className="pl-9"
                          value={chapterSearch}
                          onChange={(e) => setChapterSearch(e.target.value)}
                        />
                      </div>
                    </div>

                    {manga.chapters.length > 0 ? (
                      <>
                        <div className="divide-y divide-border">
                          {displayedChapters.map((chapter) => (
                            <div
                              key={chapter.id}
                              className="flex items-start justify-between gap-3 p-3 transition-colors hover:bg-secondary/50 sm:p-4 md:items-center"
                            >
                              <div className="min-w-0 flex-1">
                                <Link
                                  to={`/manga/${manga.id}/chapter/${chapter.id}`}
                                  className={cn(
                                    "line-clamp-2 text-sm font-medium leading-snug transition-colors sm:text-base",
                                    mergedChapterReadMap[chapter.id]?.isRead
                                      ? "text-emerald-400 hover:text-emerald-300"
                                      : "hover:text-primary",
                                  )}
                                >
                                  {formatChapterDisplayTitle(chapter.number, chapter.title)}
                                </Link>
                                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {formatDate(chapter.releaseDate)}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Eye className="h-3 w-3" />
                                    {formatViews(chapter.views || 0)}
                                  </span>
                                  {mergedChapterReadMap[chapter.id]?.isRead && (
                                    <Badge variant="secondary" className="text-[10px] border-emerald-500/20 bg-emerald-500/15 text-emerald-300">
                                      Okundu
                                    </Badge>
                                  )}
                                  {offlineChapterMap[chapter.id] && (
                                    <Badge variant="outline" className="text-[10px] capitalize">
                                      {offlineChapterMap[chapter.id].downloadStatus}
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              <div className="flex shrink-0 flex-col items-end gap-2 self-start md:self-center">
                                {offlineChapterMap[chapter.id]?.downloadStatus === 'completed' ? (
                                  <div className="flex items-center justify-end gap-2">
                                    <Badge variant="outline" className="h-7 text-[11px]">
                                      {chapter.pages.length} sayfa
                                    </Badge>
                                    <Button asChild size="sm" className="h-8 px-3 text-xs sm:h-9 sm:text-sm">
                                      <Link to={`/manga/${manga.id}/chapter/${chapter.id}`}>
                                        Çevrimdışı Oku
                                      </Link>
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-3 text-xs sm:h-9 sm:text-sm"
                                      onClick={() => void handleDeleteOfflineChapter(chapter.id)}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Sil
                                    </Button>
                                  </div>
                                ) : offlineChapterMap[chapter.id] && ['running', 'queued'].includes(offlineChapterMap[chapter.id].downloadStatus) ? (
                                  <div className="flex items-center justify-end gap-2">
                                    <Badge variant="outline" className="h-7 text-[11px]">
                                      {chapter.pages.length} sayfa
                                    </Badge>
                                    <Button variant="outline" size="sm" className="h-8 px-3 text-xs sm:h-9 sm:text-sm" disabled>
                                      <Download className="mr-2 h-4 w-4" />
                                      İndiriliyor
                                    </Button>
                                  </div>
                                ) : offlineChapterMap[chapter.id]?.downloadStatus === 'paused' ? (
                                  <div className="flex items-center justify-end gap-2">
                                    <Badge variant="outline" className="h-7 text-[11px]">
                                      {chapter.pages.length} sayfa
                                    </Badge>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-3 text-xs sm:h-9 sm:text-sm"
                                      onClick={() => void handleQueueChapterDownload(chapter)}
                                    >
                                      <Download className="mr-2 h-4 w-4" />
                                      Devam Et
                                    </Button>
                                  </div>
                                ) : offlineChapterMap[chapter.id] && ['failed', 'partial'].includes(offlineChapterMap[chapter.id].downloadStatus) ? (
                                  <div className="flex items-center justify-end gap-2">
                                    <Badge variant="outline" className="h-7 text-[11px]">
                                      {chapter.pages.length} sayfa
                                    </Badge>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-3 text-xs sm:h-9 sm:text-sm"
                                      onClick={() => void handleQueueChapterDownload(chapter)}
                                    >
                                      <Download className="mr-2 h-4 w-4" />
                                      Yeniden Dene
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-3 text-xs sm:h-9 sm:text-sm"
                                      onClick={() => void handleDeleteOfflineChapter(chapter.id)}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Sil
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-2">
                                    <Badge variant="outline" className="h-7 text-[11px]">
                                      {chapter.pages.length} sayfa
                                    </Badge>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-3 text-xs sm:h-9 sm:text-sm"
                                      onClick={() => void handleQueueChapterDownload(chapter)}
                                    >
                                      <Download className="mr-2 h-4 w-4" />
                                      İndir
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {filteredChapters.length > 8 && (
                          <div className="border-t border-border p-3 sm:p-4">
                            <Button
                              variant="ghost"
                              className="w-full"
                              onClick={() => setShowAllChapters(!showAllChapters)}
                            >
                              {showAllChapters ? (
                                <>
                                  <ChevronUp className="mr-2 h-4 w-4" />
                                  Daha Az Göster
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="mr-2 h-4 w-4" />
                                  Tüm Bölümleri Göster ({filteredChapters.length - 8} daha)
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-8 text-center text-muted-foreground">
                        Henüz bölüm eklenmemiş
                      </div>
                    )}
                  </div>

                </div>

                {/* Sidebar Info */}
                <div className="space-y-4 sm:space-y-6">
                  <div 
                    className="group cursor-pointer rounded-xl border border-border bg-card/50 p-3 transition-colors hover:bg-card/70 sm:p-6"
                    onClick={() => setActiveTab('reviews')}
                  >
                    <h2 className="mb-3 text-lg font-semibold text-center transition-colors group-hover:text-primary sm:mb-4">
                      {userRating ? 'Puanınız' : 'Puan Ver'}
                      <ArrowRight className="inline-block ml-2 h-4 w-4 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                    </h2>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap justify-center gap-1">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                          <div
                            key={star}
                            className="p-1"
                          >
                            <Star
                              className={`h-5 w-5 transition-colors ${star <= (userRating || 0)
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-muted-foreground'
                                }`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="text-sm text-center text-muted-foreground group-hover:text-foreground transition-colors">
                        {userRating ? (
                          <span>Puanınız: <strong className="text-foreground">{userRating}/10</strong></span>
                        ) : (
                          <span>Puanlamak için tıklayın</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card/50 p-3 sm:p-6">
                    <TagSection
                      entityType="manga"
                      entityId={manga.id}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border bg-card/50 p-3 shadow-sm sm:mt-8 sm:p-6 lg:p-10">
                <CommentSection mangaId={manga.id} />
              </div>
            </TabsContent>

            <TabsContent value="preview" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8">
                {(() => {
                  const sortedChaptersAsc = [...manga.chapters].sort((a, b) => a.number - b.number);
                  const safeStartIndex = Math.max(0, Math.min(previewStartIndex, sortedChaptersAsc.length - 1));
                  const safeMinLoadedIndex = Math.max(0, Math.min(minLoadedPreviewIndex, safeStartIndex));
                  const safeLoadedUntilIndex = Math.max(safeStartIndex, Math.min(maxLoadedIndex, sortedChaptersAsc.length - 1));
                  const displayedPreviewChapters = sortedChaptersAsc.slice(safeMinLoadedIndex, safeLoadedUntilIndex + 1);
                  
                  if (sortedChaptersAsc.length === 0) {
                    return <div className="text-center rounded-xl border border-border bg-card/50 text-muted-foreground p-8">Henüz bölüm eklenmemiş</div>;
                  }

                  return (
                    <>
                      {safeMinLoadedIndex > 0 && (
                        <div className="flex justify-center">
                          <Button
                            variant="outline"
                            className="rounded-full"
                            onClick={handleLoadPreviousPreviewChapters}
                          >
                            <ChevronUp className="mr-2 h-4 w-4" />
                            Önceki Bölümleri Yükle
                          </Button>
                        </div>
                      )}

                      {displayedPreviewChapters.map((chapter, localIndex) => {
                        const index = safeMinLoadedIndex + localIndex;
                        // Only mount images for current, previous, and next chapters (max 3 loaded in memory)
                        const isImageMounted = Math.abs(index - currentViewedIndex) <= 1;
                        
                        return (
                          <PreviewChapter 
                            key={chapter.id}
                            chapter={chapter}
                            index={index}
                            mangaId={manga.id}
                            isImageMounted={isImageMounted}
                            onInView={handlePreviewInView}
                            onNearBottom={handlePreviewNearBottom}
                          />
                        );
                      })}
                      
                      {safeLoadedUntilIndex < sortedChaptersAsc.length - 1 && (
                        <div className="flex justify-center p-8 bg-card/20 rounded-xl" style={{ minHeight: '100px' }}>
                          <span className="text-muted-foreground flex items-center gap-2">
                             <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                             Sonraki bölüm yükleniyor...
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </TabsContent>

            <TabsContent value="characters" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-6">
                {isCharsLoading ? (
                  // Characters Skeleton
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-3">
                      <div className="aspect-[3/4] rounded-xl bg-secondary/30 animate-pulse border border-border" />
                      <div className="h-4 w-2/3 bg-secondary/50 rounded mx-auto animate-pulse" />
                    </div>
                  ))
                ) : mangaCharacters.length > 0 ? (
                  mangaCharacters.map((char) => (
                    <Link key={char.id} to={`/character/${char.id}`} className="group space-y-3">
                      <div className="relative aspect-[3/4] rounded-xl overflow-hidden shadow-lg border border-border bg-secondary/30">
                        {char.imageUrl ? (
                          <img
                            src={char.imageUrl}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            alt={char.name}
                          />
                        ) : (
                          <EntityPlaceholderArt
                            name={char.name}
                            className="rounded-[inherit]"
                            initialClassName="text-5xl sm:text-6xl"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                          <div className="text-white text-xs font-bold flex items-center gap-1">
                            <Heart className="h-3 w-3 fill-current" /> {char.likesCount}
                          </div>
                        </div>
                      </div>
                      <h3 className="text-center font-bold text-sm truncate group-hover:text-primary transition-colors">{char.name}</h3>
                    </Link>
                  ))
                ) : (
                  <div className="col-span-full py-20 text-center text-muted-foreground italic bg-secondary/10 rounded-2xl border border-dashed border-border">
                    Bu seri için henüz karakter eklenmemiş.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="reviews" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isReviewsLoading ? (
                <div className="rounded-xl border border-border bg-card/50 p-4 shadow-xl sm:p-8">
                   <div className="flex flex-col items-center justify-center py-20 gap-4">
                      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                      <p className="text-muted-foreground animate-pulse">İncelemeler yükleniyor...</p>
                   </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card/50 p-4 shadow-xl sm:p-8">
                  {/* Reviews Summary */}
                  <div className="mb-10 grid grid-cols-1 items-center gap-8 md:grid-cols-2 lg:grid-cols-3 lg:gap-12">
                    <div className="text-center md:border-r border-border py-4">
                      <div className="text-7xl font-black mb-2 tracking-tighter text-foreground">{averageRating.average || '0'}</div>
                      <div className="flex justify-center gap-0.5 mb-2">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                          <Star key={star} className={`h-4 w-4 ${star <= Math.round(averageRating.average) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                        ))}
                      </div>
                      <div className="text-muted-foreground font-medium">{reviews.length} inceleme</div>
                    </div>

                    <div className="lg:col-span-2 space-y-3">
                      {[
                        { label: 'Hikaye', value: avgBreakdown.story },
                        { label: 'Karakterler', value: avgBreakdown.characters },
                        { label: 'Çizim', value: avgBreakdown.art },
                        { label: 'İlerleyiş', value: avgBreakdown.progression },
                        { label: 'Sürükleyicilik', value: avgBreakdown.engagement }
                      ].map((item) => (
                        <div key={item.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                            <span>{item.label}</span>
                            <span className="text-foreground">{item.value}/10</span>
                          </div>
                          <Progress value={item.value * 10} className="h-1.5" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mb-10 flex justify-start border-t border-border/50 pt-6 sm:justify-end">
                    <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
                      <DialogTrigger asChild>
                        <Button variant="glow" size="lg" className="w-full rounded-full px-8 shadow-lg shadow-primary/20 sm:w-auto">
                          {userReview?.id ? (
                            <>
                              <Edit3 className="mr-2 h-4 w-4" />
                              İncelemeyi Düzenle
                            </>
                          ) : (
                            <>
                              <Plus className="mr-2 h-4 w-4" />
                              İnceleme Yaz
                            </>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-primary/20 bg-card/95 p-4 backdrop-blur-xl sm:max-w-[600px] sm:p-6">
                        <DialogHeader className="pr-6 text-left sm:pr-8">
                          <DialogTitle className="text-xl font-bold sm:text-2xl">
                            {userReview.id ? 'İncelemeyi Düzenle' : 'İnceleme Yaz'}
                          </DialogTitle>
                          <DialogDescription>
                            {userReview.id ? 'Mevcut incelemenizi güncelleyin.' : 'Manga hakkındaki görüşlerinizi ayrıntılı olarak paylaşın.'}
                          </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-2 sm:space-y-6 sm:py-4">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
                            {[
                              { label: 'Hikaye', key: 'rating_story' },
                              { label: 'Karakterler', key: 'rating_characters' },
                              { label: 'Çizim', key: 'rating_art' },
                              { label: 'İlerleyiş', key: 'rating_progression' },
                              { label: 'Sürükleyicilik', key: 'rating_engagement' },
                            ].map((item) => (
                              <div key={item.label} className="space-y-2">
                                <div className="flex items-center justify-between gap-3 text-sm font-medium">
                                  <span>{item.label}</span>
                                  <span className="text-primary">{userReview[item.key as keyof Partial<Review>]}/10</span>
                                </div>
                                <div className="grid grid-cols-10 gap-1">
                                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                                    <button
                                      key={star}
                                      onClick={() => setUserReview(prev => ({ ...prev, [item.key]: star }))}
                                      className="flex h-7 w-full items-center justify-center rounded-md p-0.5 transition-colors hover:bg-secondary/60 sm:h-auto sm:w-auto"
                                    >
                                      <Star
                                        className={`h-4 w-4 ${star <= (userReview[item.key as keyof Partial<Review>] as number) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium">İncelemeniz</label>
                            <Textarea
                              placeholder="Manga hakkındaki düşünceleriniz..."
                              className="min-h-[120px] resize-none bg-secondary/30"
                              value={userReview.content}
                              onChange={(e) => setUserReview(prev => ({ ...prev, content: e.target.value }))}
                            />
                          </div>
                        </div>

                        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                          <Button className="w-full sm:w-auto" variant="ghost" onClick={() => setIsReviewModalOpen(false)}>İptal</Button>
                          <Button className="w-full sm:w-auto" variant="glow" onClick={handleReviewSubmit} disabled={isSubmittingReview}>
                            {isSubmittingReview ? 'Kaydediliyor...' : (userReview.id ? 'Güncelle' : 'Yayınla')}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  {/* Reviews List */}
                  <div className="space-y-6">
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      Kullanıcı İncelemeleri
                    </h3>

                    {reviews.length > 0 ? (
                      <div className="grid grid-cols-1 gap-6">
                        {reviews.map((review) => {
                          const isBlocked = blockedUserIds.includes(review.userId);
                          const isRevealed = revealedBlockedReviews[review.id];

                          return (
                            <div key={review.id} className="relative rounded-xl border border-border bg-card/30 p-4 transition-all hover:bg-card/50 sm:p-6">
                              <div className={cn("transition-all duration-300", isBlocked && !isRevealed && "blur-md select-none pointer-events-none grayscale opacity-40 overflow-hidden max-h-40")}>
                                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="flex min-w-0 gap-3 sm:gap-4">
                                    <Link to={`/profile/${review.userId}`} className="shrink-0 transition-transform hover:scale-105">
                                      <Avatar className="h-10 w-10 border-2 border-primary/20 sm:h-12 sm:w-12">
                                        <AvatarImage src={review.userAvatar} />
                                        <AvatarFallback>{review.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                                      </Avatar>
                                    </Link>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Link
                                          to={`/profile/${review.userId}`}
                                          className={cn(
                                            'min-w-0 truncate font-bold transition-colors hover:underline',
                                            review.userRole
                                              ? getStaffTextClassName(review.userRole)
                                              : 'text-foreground hover:text-primary'
                                          )}
                                        >
                                          {review.username}
                                        </Link>
                                        <StaffBadge role={review.userRole} compact />
                                      </div>
                                      <p className="text-xs text-muted-foreground">{formatDate(review.createdAt)}</p>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-10 gap-0.5 self-start text-yellow-400 sm:flex">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
                                      const avg = (review.rating_story + review.rating_characters + review.rating_art + review.rating_progression + review.rating_engagement) / 5;
                                      return <Star key={star} className={`h-3 w-3 ${star <= Math.round(avg) ? 'fill-current' : 'text-muted-foreground'}`} />;
                                    })}
                                  </div>
                                </div>

                                <p className="text-foreground/90 leading-relaxed mb-6 whitespace-pre-wrap">{review.content}</p>

                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-6 bg-secondary/20 p-3 rounded-lg">
                                  <span>Hikaye: <strong className="text-foreground">{review.rating_story}/10</strong></span>
                                  <span>Karakterler: <strong className="text-foreground">{review.rating_characters}/10</strong></span>
                                  <span>Çizim: <strong className="text-foreground">{review.rating_art}/10</strong></span>
                                  <span>İlerleyiş: <strong className="text-foreground">{review.rating_progression}/10</strong></span>
                                  <span>Sürükleyicilik: <strong className="text-foreground">{review.rating_engagement}/10</strong></span>
                                </div>

                                <div className="flex items-center justify-between border-t border-border pt-4">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`gap-2 ${review.likedBy.includes(user?.id || '') ? 'text-primary bg-primary/10' : ''}`}
                                    onClick={() => toggleLikeReview(review.id)}
                                  >
                                    <ThumbsUp className={`h-4 w-4 ${review.likedBy.includes(user?.id || '') ? 'fill-current' : ''}`} />
                                    <span>{review.likes}</span>
                                  </Button>
                                </div>
                              </div>

                              {isBlocked && !isRevealed && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-background/10 backdrop-blur-[2px]">
                                  <div className="bg-background/80 p-4 rounded-xl border border-border shadow-2xl max-w-xs">
                                    <ShieldAlert className="w-8 h-8 mx-auto text-red-500 mb-2" />
                                    <p className="text-sm font-bold mb-1">Engellenmiş İçerik</p>
                                    <p className="text-xs text-muted-foreground mb-4">Bu kullanıcıyı engellediğiniz için incelemesi gizlendi.</p>
                                    <Button 
                                      size="sm" 
                                      variant="outline" 
                                      className="w-full h-8 text-xs font-bold"
                                      onClick={() => setRevealedBlockedReviews(prev => ({ ...prev, [review.id]: true }))}
                                    >
                                      İncelemeyi Göster
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-20 bg-secondary/10 rounded-xl border border-dashed border-border">
                        <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                        <p className="text-muted-foreground">Henüz inceleme yapılmamış. İlk inceleyen siz olun!</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="discover" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="rounded-xl border border-border bg-card/50 p-4 sm:p-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-2xl font-bold">Benzer Seriler</h3>
                    <p className="text-muted-foreground text-sm mt-1">
                      {manga?.genres?.slice(0, 3).join(', ')} türlerinde diğer popüler seriler
                    </p>
                  </div>
                  <Button variant="outline" asChild className="w-full sm:w-auto">
                    <Link to="/browse">Tüm Serilere Göz At</Link>
                  </Button>
                </div>

                {loadingSimilar ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="animate-pulse">
                        <div className="aspect-[2/3] bg-muted rounded-lg" />
                        <div className="h-4 bg-muted rounded mt-2 w-3/4" />
                      </div>
                    ))}
                  </div>
                ) : similarMangas.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {similarMangas.map((m) => (
                      <Link
                        key={m.id}
                        to={`/manga/${m.id}`}
                        className="group relative overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
                      >
                        <div className="aspect-[2/3] overflow-hidden">
                          <img
                            src={m.cover}
                            alt={m.title}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform">
                          <h4 className="text-sm font-semibold text-white line-clamp-2">{m.title}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-[10px] px-1.5 h-5">
                              {m.type.toUpperCase()}
                            </Badge>
                            {(m as any).averageRating > 0 && (
                              <span className="text-xs text-yellow-400 flex items-center gap-0.5">
                                <Star className="h-3 w-3 fill-current" />
                                {(m as any).averageRating}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Always visible title overlay */}
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 to-transparent group-hover:opacity-0 transition-opacity">
                          <h4 className="text-xs font-medium text-white line-clamp-2">{m.title}</h4>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16 bg-secondary/10 rounded-xl border border-dashed border-border">
                    <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                    <p className="text-muted-foreground">Benzer seri bulunamadı.</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Daha fazla içerik eklendiğinde öneriler burada görünecek.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Dialog open={isSeriesDownloadDialogOpen} onOpenChange={setIsSeriesDownloadDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-border/70 p-4 sm:max-w-[540px] sm:p-6">
          <DialogHeader className="space-y-2 pr-6 text-left sm:pr-8">
            <DialogTitle className="text-xl font-bold sm:text-2xl">Seriyi İndir</DialogTitle>
            <DialogDescription>
              Mevcut tüm bölümler cihazına indirilecek ve internet olmadan açılabilecek.
            </DialogDescription>
          </DialogHeader>

          {manga && (
            <div className="space-y-4 py-1 sm:space-y-5 sm:py-2">
              <div className="rounded-xl border border-border/60 bg-card/60 p-3 sm:p-4">
                <p className="text-base font-semibold">{manga.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {manga.chapters.length} bölüm • {manga.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0)} sayfa
                </p>
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-100 sm:p-4">
                <p className="font-semibold">Boyut tahmini</p>
                <p className="mt-1 text-blue-100/80">
                  Bazı kaynaklar toplam dosya boyutunu önceden vermiyor. Bu durumda gerçek boyut indirme sırasında netleşecek.
                </p>
              </div>

              {offlineSeriesEntry && (
                <div className="rounded-xl border border-border/60 bg-card/60 p-3 text-sm text-muted-foreground sm:p-4">
                  {offlineSeriesEntry.downloadedChapters} bölüm zaten çevrimdışı hazır. Eksik veya başarısız olanlar yeniden kuyruğa alınacak.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button className="w-full sm:w-auto" variant="ghost" onClick={() => setIsSeriesDownloadDialogOpen(false)}>
              İptal
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => void handleQueueSeriesDownload()} disabled={isQueueingSeriesDownload}>
              {isQueueingSeriesDownload ? 'Kuyruğa Alınıyor...' : 'İndir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-border/70 p-4 sm:max-w-[560px] sm:p-6">
          <DialogHeader className="space-y-2 pr-6 text-left sm:pr-8">
            <DialogTitle className="text-xl font-bold sm:text-2xl">Seriyi Bildir</DialogTitle>
            <DialogDescription>
              Hata, eksik bölüm veya yanlış bilgi gibi problemleri buradan admin ekibine iletebilirsiniz.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1 sm:space-y-5 sm:py-2">
            <div className="rounded-xl border border-border/60 bg-card/60 p-3 sm:p-4">
              <p className="text-sm font-medium">{manga.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Aynı seri için tekrar bildirim gönderirseniz son notunuzla güncellenir.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Neden</label>
              <div className="grid grid-cols-2 gap-2">
                {mangaReportReasons.map((reason) => (
                  <Button
                    key={reason}
                    type="button"
                    variant={reportReason === reason ? 'default' : 'outline'}
                    size="sm"
                    className="h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left leading-snug"
                    onClick={() => setReportReason(reason)}
                  >
                    {reason}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Detay</label>
              <Textarea
                value={reportDetails}
                onChange={(event) => setReportDetails(event.target.value)}
                placeholder="Sorunu biraz daha açıklayın. Örnek: 57. bölüm sayfaları kırık."
                className="min-h-[128px] sm:min-h-[140px]"
                maxLength={600}
              />
              <p className="text-xs text-muted-foreground">{reportDetails.length}/600</p>
            </div>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setIsReportDialogOpen(false)}>
              İptal
            </Button>
            <Button className="w-full sm:w-auto" onClick={handleSubmitReport} disabled={isSubmittingReport}>
              {isSubmittingReport ? 'Gönderiliyor...' : 'Bildirimi Gönder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {user && manga && (
        <ReadingListModal
          isOpen={isListModalOpen}
          onClose={() => setIsListModalOpen(false)}
          mangaId={manga.id}
          userId={user.id}
        />
      )}
    </div>
  );
};


export default MangaDetail;
