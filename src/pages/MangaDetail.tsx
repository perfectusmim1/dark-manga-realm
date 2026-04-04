import React, { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  Link2,
  RefreshCcw,
} from 'lucide-react';
import { cn } from "@/lib/utils";
import Header from '@/components/layout/Header';
import CommentSection from '@/components/comments/CommentSection';
import ReadingListModal from '@/components/manga/ReadingListModal';
import StaffBadge from '@/components/user/StaffBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getChapterPagesByIds,
  getMangaById,
  getMangaChapters,
  getAverageRating,
  rateManga,
  getUserRating,
  incrementMangaViews,
  getReviewsForManga,
  addReview,
  deleteReview,
  getUserReview,
  toggleReviewLike,
  toggleReviewDislike,
  getSimilarMangas,
  getMangaCharacters,
  createMangaReport,
} from '@/lib/database';
import { formatChapterDisplayTitle } from '@/lib/chapterTitle';
import { Bookmark, Chapter, Character, ExternalRatingsCache, ExternalSyncProvider, LibraryCategory, Manga, Review, Favorite } from '@/lib/types';
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
  getBookmarks,
} from '../lib/storage';
import {
  MessageSquare,
  ThumbsDown,
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
import OfflineNotice from '@/components/offline/OfflineNotice';
import { formatReadingDuration, getBlockedUserIds, getMangaReadingTimeTotal } from '@/lib/profile';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { isDownloadAuthRequiredError, offlineDownloadManager } from '@/lib/offline/downloadManager';
import { cacheOfflineManga, cacheOfflineMangaCharacters, getOfflineMangaCharacters, getOfflineMangaDetail } from '@/lib/offline/offlineStorage';
import { OfflineMangaGroup } from '@/lib/offline/types';
import { areBookmarksInitialized, getCachedBookmarksState } from '@/lib/offline/userSync';
import { flushPendingReaderSync, initializeOfflineReaderSync } from '@/lib/offline/offlineReaderSync';
import { getTargetCommentIdFromLocation } from '@/lib/commentNavigation';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';
import OptimizedImage from '@/components/media/OptimizedImage';
import DeferredMount from '@/components/performance/DeferredMount';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import {
  getCharacterListingRoleLabel,
  getCharacterListingRoleSectionTitle,
  type CharacterListingRole,
} from '@/lib/characterRoles';
import { getMangaRelationTypeLabel } from '@/lib/mangaRelations';
import {
  getExternalSyncStatuses,
  getMangaExternalRatings,
  isExternalProviderSupported,
  normalizeExternalSyncPreferences,
  refreshMangaExternalRatings,
  syncMangaToExternalProviders,
} from '@/lib/externalSync';
import { applyOptimisticReaction, hasReaction, type ReactionType } from '@/lib/reactions';

const categoryLabels: Record<LibraryCategory, string> = {
  reading: 'Okuyorum',
  plan_to_read: 'Okuyacağım',
  completed: 'Tamamladım',
  on_hold: 'Beklemede',
  dropped: 'Bıraktım',
};

const externalProviderLabels: Record<ExternalSyncProvider, string> = {
  myanimelist: 'MyAnimeList',
  anilist: 'AniList',
};

const formatExternalScore = (score?: number | null) => (
  typeof score === 'number'
    ? `${score.toFixed(score >= 10 ? 0 : 2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')} / 10`
    : 'Henüz yok'
);

const DEFAULT_USER_REVIEW: Partial<Review> = {
  content: '',
  rating_story: 10,
  rating_characters: 10,
  rating_art: 10,
  rating_progression: 10,
  rating_engagement: 10,
};

const createDefaultUserReview = (): Partial<Review> => ({
  ...DEFAULT_USER_REVIEW,
});

const getReviewAverageScore = (review?: Partial<Review> | null) => {
  if (!review) {
    return undefined;
  }

  const scores = [
    review.rating_story,
    review.rating_characters,
    review.rating_art,
    review.rating_progression,
    review.rating_engagement,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (scores.length === 0) {
    return undefined;
  }

  return Math.round((scores.reduce((total, value) => total + value, 0) / scores.length) * 10) / 10;
};

const REVIEW_EDIT_INDICATOR_THRESHOLD_MS = 1000;
const REVIEW_CONTENT_MAX_LENGTH = 5000;
const REVIEW_COLLAPSE_THRESHOLD = 700;

const shouldShowEditedReviewLabel = (review: Review) => {
  const createdAt = new Date(review.createdAt).getTime();
  const updatedAt = new Date(review.updatedAt).getTime();

  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
    return false;
  }

  return updatedAt - createdAt > REVIEW_EDIT_INDICATOR_THRESHOLD_MS;
};

const shouldCollapseReviewContent = (content?: string | null) =>
  (content?.trim().length || 0) > REVIEW_COLLAPSE_THRESHOLD;

const PREVIEW_CHAPTER_BATCH_SIZE = 3;
const MOBILE_OVERVIEW_PREVIEW_CHAPTER_COUNT = 3;
const DESKTOP_OVERVIEW_PREVIEW_CHAPTER_COUNT = 8;
const OVERVIEW_CHAPTER_BATCH_SIZE = 28;
const MangaDetailGalleryPanel = lazy(() => import('@/components/manga/MangaDetailGalleryPanel'));
const MangaDetailDiscoverPanel = lazy(() => import('@/components/manga/MangaDetailDiscoverPanel'));

const PreviewPageThumbnail = React.memo(({
  page,
  pageIndex,
  chapterNumber,
  chapterId,
  mangaId,
  isChapterMounted,
}: {
  page: string;
  pageIndex: number;
  chapterNumber: number;
  chapterId: string;
  mangaId: string;
  isChapterMounted: boolean;
}) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (!isChapterMounted || !cardRef.current) {
      setIsNearViewport(false);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsNearViewport(Boolean(entry?.isIntersecting));
      },
      { rootMargin: '320px 0px 320px 0px', threshold: 0.01 }
    );

    observer.observe(cardRef.current);

    return () => observer.disconnect();
  }, [isChapterMounted]);

  const shouldMountImage = isChapterMounted && isNearViewport;

  return (
    <Link
      to={`/manga/${mangaId}/chapter/${chapterId}?page=${pageIndex + 1}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div
        ref={cardRef}
        className="relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-secondary shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5 isolate"
        style={{ contentVisibility: 'auto', containIntrinsicSize: '144px 192px' }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
          {shouldMountImage ? (
            <img
              src={page}
              alt={`Bölüm ${chapterNumber} Sayfa ${pageIndex + 1}`}
              loading="lazy"
              decoding="async"
              width={240}
              height={320}
              sizes="(min-width: 1280px) 180px, (min-width: 1024px) 16vw, (min-width: 640px) 22vw, 31vw"
              draggable={false}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover [transform:translateZ(0)] [backface-visibility:hidden] transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-secondary/30 text-muted-foreground">
              <div className="h-8 w-8 animate-pulse rounded-full bg-border/50" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        </div>

        <div className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex items-center gap-1.5 text-sm font-medium text-white">
            <Eye className="h-4 w-4" />
            Sayfaya Git
          </span>
        </div>

        <div className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-1 font-mono text-xs text-white shadow">
          {pageIndex + 1}
        </div>
      </div>
    </Link>
  );
});

const PreviewChapter = React.memo(({ 
  chapter, 
  pages,
  index, 
  mangaId, 
  isImageMounted, 
  onInView,
  onNearBottom,
}: { 
  chapter: any; 
  pages: string[];
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
          {pages.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {pages.length} sayfa
            </p>
          )}
        </div>
        <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto">
          <Link to={`/manga/${mangaId}/chapter/${chapter.id}`}>
            <Play className="h-4 w-4 mr-2" />
            Oku
          </Link>
        </Button>
      </div>
      
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {pages.length > 0 ? (
          pages.map((page: string, pageIndex: number) => (
            <PreviewPageThumbnail
              key={pageIndex}
              page={page}
              pageIndex={pageIndex}
              chapterNumber={chapter.number}
              chapterId={chapter.id}
              mangaId={mangaId}
              isChapterMounted={isImageMounted}
            />
          ))
        ) : (
          <div className="col-span-full rounded-xl border border-dashed border-border/70 bg-secondary/20 p-6 text-sm text-muted-foreground">
            Önizleme sayfaları yükleniyor...
          </div>
        )}
      </div>
    </div>
  );
});

const BookmarkPagePreview = React.memo(({
  src,
  alt,
  pageNumber,
}: {
  src?: string | null;
  alt: string;
  pageNumber: number;
}) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (!cardRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsNearViewport(Boolean(entry?.isIntersecting));
      },
      { rootMargin: '260px 0px', threshold: 0.01 },
    );

    observer.observe(cardRef.current);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary shadow-sm sm:h-32 sm:w-24"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '80px 112px' }}
    >
      {isNearViewport && src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={160}
          height={224}
          sizes="96px"
          draggable={false}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-secondary/40">
          <div className="h-7 w-7 animate-pulse rounded-full bg-border/60" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
      <div className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold text-white shadow">
        Sayfa {pageNumber}
      </div>
    </div>
  );
});

const MangaDetail: React.FC = () => {
  const { mangaId } = useParams<{ mangaId: string }>();
  const location = useLocation();
  const { disableHeavyEffects, isMobile } = useDeviceProfile();
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
  const [externalRatings, setExternalRatings] = useState<ExternalRatingsCache>({});
  const [externalProviderStatuses, setExternalProviderStatuses] = useState<Record<ExternalSyncProvider, { connected: boolean; lastError?: string | null }>>({
    myanimelist: { connected: false, lastError: null },
    anilist: { connected: false, lastError: null },
  });
  const [isRefreshingExternalRatings, setIsRefreshingExternalRatings] = useState(false);
  const [syncingExternalProvider, setSyncingExternalProvider] = useState<ExternalSyncProvider | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [chapterSearch, setChapterSearch] = useState('');
  const deferredChapterSearch = useDeferredValue(chapterSearch);
  const [activeTab, setActiveTab] = useState('overview');
  const [minLoadedPreviewIndex, setMinLoadedPreviewIndex] = useState(0);
  const [maxLoadedIndex, setMaxLoadedIndex] = useState(0);
  const [currentViewedIndex, setCurrentViewedIndex] = useState(0);
  const [previewStartIndex, setPreviewStartIndex] = useState(0);
  const [previewChapterPagesById, setPreviewChapterPagesById] = useState<Record<string, string[]>>({});
  const [overviewVisibleCount, setOverviewVisibleCount] = useState(OVERVIEW_CHAPTER_BATCH_SIZE);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [revealedBlockedReviews, setRevealedBlockedReviews] = useState<Record<string, boolean>>({});
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Yanlış seri bilgisi');
  const [reportDetails, setReportDetails] = useState('');
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isAlternativeTitlesExpanded, setIsAlternativeTitlesExpanded] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [seriesReadingSeconds, setSeriesReadingSeconds] = useState(0);
  const [isSeriesReadingTimeLoading, setIsSeriesReadingTimeLoading] = useState(false);
  const [isOfflineView, setIsOfflineView] = useState(false);
  const [isSeriesDownloadDialogOpen, setIsSeriesDownloadDialogOpen] = useState(false);
  const [isQueueingSeriesDownload, setIsQueueingSeriesDownload] = useState(false);
  const [chapterReadMap, setChapterReadMap] = useState<Record<string, { isRead?: boolean; readProgressPercent?: number }>>({});
  const [seriesBookmarks, setSeriesBookmarks] = useState<Bookmark[]>([]);
  const [isSeriesBookmarksLoading, setIsSeriesBookmarksLoading] = useState(false);
  const [hasLoadedBookmarks, setHasLoadedBookmarks] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [expandedReviewIds, setExpandedReviewIds] = useState<Record<string, boolean>>({});
  const [avgBreakdown, setAvgBreakdown] = useState<any>({
    story: 0,
    characters: 0,
    art: 0,
    progression: 0,
    engagement: 0
  });
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [userReview, setUserReview] = useState<Partial<Review>>(createDefaultUserReview);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [deletingReviewId, setDeletingReviewId] = useState<string | null>(null);
  const [reviewPendingDelete, setReviewPendingDelete] = useState<Review | null>(null);
  const [pendingReviewReactions, setPendingReviewReactions] = useState<Record<string, boolean>>({});
  const [similarMangas, setSimilarMangas] = useState<Manga[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [mangaCharacters, setMangaCharacters] = useState<any[]>([]);
  const [hasLoadedReviews, setHasLoadedReviews] = useState(false);
  const [hasLoadedCharacters, setHasLoadedCharacters] = useState(false);
  const [hasLoadedSimilar, setHasLoadedSimilar] = useState(false);
  const [isReviewsLoading, setIsReviewsLoading] = useState(true);
  const [isCharsLoading, setIsCharsLoading] = useState(true);
  const overviewLoadMoreRef = React.useRef<HTMLDivElement | null>(null);
  const backgroundFetchVersionRef = React.useRef(0);
  const charactersLoadPromiseRef = React.useRef<Promise<Character[]> | null>(null);
  const similarLoadPromiseRef = React.useRef<Promise<Manga[]> | null>(null);

  useEffect(() => {
    void offlineDownloadManager.initialize();
    initializeOfflineReaderSync();
  }, []);

  const offlineSeriesEntry = useMemo<OfflineMangaGroup | undefined>(() => (
    offlineSnapshot.series.find((entry) => entry.manga.mangaId === (manga?.id || mangaId))
  ), [offlineSnapshot.series, manga?.id, mangaId]);
  const userExternalSyncPreferences = useMemo(
    () => normalizeExternalSyncPreferences(user?.preferences),
    [user?.preferences],
  );

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
  const getKnownChapterPageCount = React.useCallback((chapter?: Chapter | null) => {
    if (!chapter) {
      return undefined;
    }

    const cachedPreviewCount = previewChapterPagesById[chapter.id]?.length;
    if (cachedPreviewCount && cachedPreviewCount > 0) {
      return cachedPreviewCount;
    }

    const offlinePageCount = offlineChapterMap[chapter.id]?.pageCount;
    if (typeof offlinePageCount === 'number' && offlinePageCount > 0) {
      return offlinePageCount;
    }

    if (typeof chapter.pageCount === 'number' && chapter.pageCount > 0) {
      return chapter.pageCount;
    }

    if (Array.isArray(chapter.pages) && chapter.pages.length > 0) {
      return chapter.pages.length;
    }

    return undefined;
  }, [offlineChapterMap, previewChapterPagesById]);

  const primaryOfflineJob = useMemo(() => {
    if (!offlineSeriesEntry) {
      return undefined;
    }

    return offlineSeriesEntry.jobs.find((job) => ['running', 'queued', 'paused'].includes(job.status))
      || offlineSeriesEntry.jobs[0];
  }, [offlineSeriesEntry]);

  const isOverviewTabActive = activeTab === 'overview';
  const isPreviewTabActive = activeTab === 'preview';
  const isBookmarksTabActive = activeTab === 'bookmarks';
  const isReviewsTabActive = activeTab === 'reviews';
  const isGalleryTabActive = activeTab === 'gallery';
  const isCharactersTabActive = activeTab === 'characters';
  const isDiscoverTabActive = activeTab === 'discover';
  const reviewCount = useMemo(() => (
    Math.max(manga?.reviewCount || 0, averageRating.count || 0)
  ), [averageRating.count, manga?.reviewCount]);
  const characterCount = useMemo(() => (
    Math.max(manga?.characterCount || 0, mangaCharacters.length)
  ), [manga?.characterCount, mangaCharacters.length]);
  const seriesGalleryImages = useMemo(() => {
    const rawGallery = manga?.details?.extra?.seriesGallery;
    if (!Array.isArray(rawGallery)) {
      return [];
    }

    return rawGallery
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean)
      .map((url, index) => ({
        url,
        thumbUrl: url,
        source: 'import',
        sourceUrl: url,
        label: `Seri Galerisi ${index + 1}`,
      }));
  }, [manga?.details?.extra?.seriesGallery]);
  const malLink = useMemo(() => (
    manga?.sourceLinks?.find((link) => link.source === 'myanimelist')
  ), [manga?.sourceLinks]);
  const aniListLink = useMemo(() => (
    manga?.sourceLinks?.find((link) => link.source === 'anilist')
  ), [manga?.sourceLinks]);
  const hasSupportedExternalProviders = useMemo(() => (
    isExternalProviderSupported(manga?.sourceLinks, 'myanimelist')
    || isExternalProviderSupported(manga?.sourceLinks, 'anilist')
  ), [manga?.sourceLinks]);
  const groupedMangaCharacters = useMemo(() => {
    const groups = new Map<CharacterListingRole, Character[]>();
    groups.set('main', []);
    groups.set('supporting', []);
    groups.set('minor', []);

    mangaCharacters.forEach((character) => {
      const role = character.listingRole || 'minor';
      groups.get(role)?.push(character);
    });

    return (['main', 'supporting', 'minor'] as CharacterListingRole[])
      .map((role) => ({
        role,
        title: getCharacterListingRoleSectionTitle(role),
        items: [...(groups.get(role) || [])].sort((left, right) => left.name.localeCompare(right.name, 'tr')),
      }))
      .filter((group) => group.items.length > 0);
  }, [mangaCharacters]);

  const handlePreviewInView = React.useCallback((idx: number) => {
    setCurrentViewedIndex(idx);
  }, []);

  const handlePreviewNearBottom = React.useCallback((idx: number) => {
    setMaxLoadedIndex(prev => Math.max(prev, idx + 1));
  }, []);

  useEffect(() => {
    backgroundFetchVersionRef.current += 1;
    charactersLoadPromiseRef.current = null;
    similarLoadPromiseRef.current = null;

    return () => {
      backgroundFetchVersionRef.current += 1;
      charactersLoadPromiseRef.current = null;
      similarLoadPromiseRef.current = null;
    };
  }, [mangaId]);

  const loadCharacters = React.useCallback((options?: { visible?: boolean }) => {
    if (!mangaId || !isOnline || isOfflineView || isLoading || hasLoadedCharacters) {
      return Promise.resolve(mangaCharacters);
    }

    if (options?.visible) {
      setIsCharsLoading(true);
    }

    if (charactersLoadPromiseRef.current) {
      return charactersLoadPromiseRef.current;
    }

    const requestVersion = backgroundFetchVersionRef.current;
    const request = getMangaCharacters(mangaId)
      .then((characters) => {
        if (requestVersion !== backgroundFetchVersionRef.current) {
          return [];
        }

        setMangaCharacters(characters);
        setHasLoadedCharacters(true);
        void cacheOfflineMangaCharacters(mangaId, characters);

        return characters;
      })
      .catch((error) => {
        if (requestVersion !== backgroundFetchVersionRef.current) {
          return [];
        }

        console.error('Manga characters load error:', error);
        setMangaCharacters([]);
        return [];
      })
      .finally(() => {
        if (requestVersion === backgroundFetchVersionRef.current) {
          setIsCharsLoading(false);
        }

        if (charactersLoadPromiseRef.current === request) {
          charactersLoadPromiseRef.current = null;
        }
      });

    charactersLoadPromiseRef.current = request;
    return request;
  }, [hasLoadedCharacters, isLoading, isOfflineView, isOnline, mangaCharacters, mangaId]);

  const loadSimilarMangas = React.useCallback((options?: { visible?: boolean }) => {
    if (!mangaId || !manga || !isOnline || isOfflineView || isLoading || hasLoadedSimilar) {
      return Promise.resolve(similarMangas);
    }

    if (!manga.genres || manga.genres.length === 0) {
      setHasLoadedSimilar(true);
      setLoadingSimilar(false);
      return Promise.resolve([]);
    }

    if (options?.visible) {
      setLoadingSimilar(true);
    }

    if (similarLoadPromiseRef.current) {
      return similarLoadPromiseRef.current;
    }

    const requestVersion = backgroundFetchVersionRef.current;
    const request = getSimilarMangas(mangaId, manga.genres, 6)
      .then((similar) => {
        if (requestVersion !== backgroundFetchVersionRef.current) {
          return [];
        }

        setSimilarMangas(similar);
        setHasLoadedSimilar(true);
        return similar;
      })
      .catch((error) => {
        if (requestVersion !== backgroundFetchVersionRef.current) {
          return [];
        }

        console.error('Error loading similar mangas:', error);
        setSimilarMangas([]);
        return [];
      })
      .finally(() => {
        if (requestVersion === backgroundFetchVersionRef.current) {
          setLoadingSimilar(false);
        }

        if (similarLoadPromiseRef.current === request) {
          similarLoadPromiseRef.current = null;
        }
      });

    similarLoadPromiseRef.current = request;
    return request;
  }, [hasLoadedSimilar, isLoading, isOfflineView, isOnline, manga, mangaId, similarMangas]);

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

  useEffect(() => {
    setPreviewChapterPagesById({});
  }, [manga?.id]);

  const handleLoadPreviousPreviewChapters = React.useCallback(() => {
    setMinLoadedPreviewIndex((previous) => Math.max(0, previous - PREVIEW_CHAPTER_BATCH_SIZE));
  }, []);

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
  const alternativeTitlesText = React.useMemo(() => (
    manga?.alternativeTitles?.filter(Boolean).join(', ').trim() || ''
  ), [manga?.alternativeTitles]);
  const alternativeTitlesContainerRef = useRef<HTMLDivElement | null>(null);
  const alternativeTitlesMeasureRef = useRef<HTMLSpanElement | null>(null);
  const [hasAlternativeTitlesOverflow, setHasAlternativeTitlesOverflow] = useState(false);
  const shouldShowAlternativeTitlesToggle = Boolean(alternativeTitlesText && hasAlternativeTitlesOverflow);
  const activeMangaId = manga?.id || mangaId || '';
  const seriesBookmarkEntries = useMemo(() => {
    if (!hasLoadedBookmarks) {
      return [];
    }

    const chapterMap = new Map((manga?.chapters || []).map((chapter) => [chapter.id, chapter]));

    return seriesBookmarks.map((bookmark) => {
      const chapter = chapterMap.get(bookmark.chapterId);
      const previewPages = chapter ? previewChapterPagesById[chapter.id] : undefined;
      const previewImage = isOnline
        ? (Array.isArray(previewPages) && bookmark.page > 0 && bookmark.page <= previewPages.length
            ? previewPages[bookmark.page - 1]
            : manga?.cover || null)
        : (manga?.cover || (Array.isArray(chapter?.pages) ? chapter.pages[0] : null));

      return {
        bookmark,
        chapter,
        previewImage,
        chapterLabel: chapter
          ? formatChapterDisplayTitle(chapter.number, chapter.title)
          : `Bölüm ${bookmark.chapterNumber}`,
        createdAtLabel: bookmark.createdAt
          ? new Date(bookmark.createdAt).toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Az önce',
      };
    });
  }, [hasLoadedBookmarks, isOnline, manga?.chapters, manga?.cover, previewChapterPagesById, seriesBookmarks]);

  const handleActiveTabChange = React.useCallback((nextTab: string) => {
    setActiveTab(nextTab);

    if (nextTab === 'reviews' && !hasLoadedReviews) {
      setIsReviewsLoading(true);
    }

    if (nextTab === 'characters' && !hasLoadedCharacters) {
      setIsCharsLoading(true);
    }

    if (nextTab === 'discover' && !hasLoadedSimilar) {
      setLoadingSimilar(true);
    }

    if (nextTab === 'bookmarks' && !hasLoadedBookmarks) {
      setIsSeriesBookmarksLoading(true);
    }
  }, [hasLoadedBookmarks, hasLoadedCharacters, hasLoadedReviews, hasLoadedSimilar]);

  useEffect(() => {
    const targetCommentId = getTargetCommentIdFromLocation(location.search, location.hash);

    if (targetCommentId && activeTab !== 'overview') {
      setActiveTab('overview');
    }
  }, [activeTab, location.hash, location.search]);

  useEffect(() => {
    setIsDescriptionExpanded(false);
    setIsAlternativeTitlesExpanded(false);
  }, [manga?.id]);

  useEffect(() => {
    setExternalRatings(getMangaExternalRatings(manga));
  }, [manga?.details]);

  useEffect(() => {
    let isCancelled = false;

    if (!manga?.id || !isOnline || !hasSupportedExternalProviders) {
      return () => {
        isCancelled = true;
      };
    }

    setIsRefreshingExternalRatings(true);

    void refreshMangaExternalRatings(manga.id)
      .then((payload) => {
        if (isCancelled || !payload?.details) {
          return;
        }

        setExternalRatings(getMangaExternalRatings({ details: payload.details }));
        setManga((current) => current ? { ...current, details: payload.details } : current);
      })
      .catch((error) => {
        console.error('External ratings refresh error:', error);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsRefreshingExternalRatings(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [hasSupportedExternalProviders, isOnline, manga?.id]);

  useEffect(() => {
    let isCancelled = false;

    if (!user?.id || !isOnline) {
      setExternalProviderStatuses({
        myanimelist: { connected: false, lastError: null },
        anilist: { connected: false, lastError: null },
      });
      return () => {
        isCancelled = true;
      };
    }

    void getExternalSyncStatuses()
      .then((response) => {
        if (isCancelled) {
          return;
        }

        const nextStatuses: Record<ExternalSyncProvider, { connected: boolean; lastError?: string | null }> = {
          myanimelist: { connected: false, lastError: null },
          anilist: { connected: false, lastError: null },
        };

        for (const item of response?.providers || []) {
          if (item.provider === 'myanimelist' || item.provider === 'anilist') {
            nextStatuses[item.provider] = {
              connected: Boolean(item.account?.connected),
              lastError: item.account?.lastError || null,
            };
          }
        }

        setExternalProviderStatuses(nextStatuses);
      })
      .catch((error) => {
        console.error('External sync status load error:', error);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOnline, user?.id]);

  useEffect(() => {
    if (!alternativeTitlesText) {
      setHasAlternativeTitlesOverflow(false);
      return;
    }

    const container = alternativeTitlesContainerRef.current;
    const measure = alternativeTitlesMeasureRef.current;

    if (!container || !measure) {
      return;
    }

    const updateOverflowState = () => {
      const nextHasOverflow = measure.scrollWidth - container.clientWidth > 1;
      setHasAlternativeTitlesOverflow((current) => (
        current === nextHasOverflow ? current : nextHasOverflow
      ));
    };

    updateOverflowState();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOverflowState);
      return () => window.removeEventListener('resize', updateOverflowState);
    }

    const observer = new ResizeObserver(() => {
      updateOverflowState();
    });

    observer.observe(container);
    observer.observe(measure);

    return () => observer.disconnect();
  }, [alternativeTitlesText]);

  useEffect(() => {
    let isCancelled = false;
    let bookmarkTimeoutId: ReturnType<typeof window.setTimeout> | null = null;

    const getCurrentSeriesBookmarks = (bookmarks: Bookmark[]) => bookmarks
      .filter((bookmark) => bookmark.mangaId === activeMangaId)
      .sort((left, right) => {
        const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
        const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
        return rightTime - leftTime;
      });

    if (!user?.id || !activeMangaId) {
      setSeriesBookmarks([]);
      setIsSeriesBookmarksLoading(false);
      setHasLoadedBookmarks(false);
      return;
    }

    if (!isBookmarksTabActive || hasLoadedBookmarks) {
      return;
    }

    const cachedBookmarks = getCurrentSeriesBookmarks(getCachedBookmarksState(user.id));

    if (areBookmarksInitialized(user.id)) {
      setSeriesBookmarks(cachedBookmarks);
      setHasLoadedBookmarks(true);
      setIsSeriesBookmarksLoading(false);
      return;
    }

    setIsSeriesBookmarksLoading(true);

    const fallbackBookmarks = new Promise<Bookmark[]>((resolve) => {
      bookmarkTimeoutId = window.setTimeout(() => {
        console.warn('Series bookmarks load timed out; using local cache fallback.');
        resolve(getCachedBookmarksState(user.id));
      }, 4500);
    });

    void Promise.race([getBookmarks(user.id), fallbackBookmarks])
      .then((bookmarks) => {
        if (isCancelled) {
          return;
        }

        setSeriesBookmarks(getCurrentSeriesBookmarks(bookmarks));
        setHasLoadedBookmarks(true);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        console.error('Series bookmarks load error:', error);
        setSeriesBookmarks(cachedBookmarks);
        setHasLoadedBookmarks(true);
      })
      .finally(() => {
        if (bookmarkTimeoutId !== null) {
          window.clearTimeout(bookmarkTimeoutId);
        }

        if (!isCancelled) {
          setIsSeriesBookmarksLoading(false);
        }
      });

    return () => {
      isCancelled = true;

      if (bookmarkTimeoutId !== null) {
        window.clearTimeout(bookmarkTimeoutId);
      }
    };
  }, [activeMangaId, hasLoadedBookmarks, isBookmarksTabActive, user?.id]);

  const resetUserScopedState = React.useCallback(() => {
    setFavorite(false);
    setIsFollowing(false);
    setCategory(undefined);
    setUserRating(undefined);
    setLatestProgress(null);
    setBlockedUserIds([]);
    setChapterReadMap({});
    setSeriesReadingSeconds(0);
    setSeriesBookmarks([]);
    setIsSeriesBookmarksLoading(false);
    setHasLoadedBookmarks(false);
    setUserReview(createDefaultUserReview());
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
        setHasLoadedReviews(false);
        setHasLoadedCharacters(false);
        setHasLoadedSimilar(false);
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
          void cacheOfflineManga(mData);
          if (mData.ratingBreakdown) {
            setAvgBreakdown(mData.ratingBreakdown);
          }
          
          // Show page structure immediately after metadata
          setIsLoading(false);
          setIsCharsLoading(false);
          setIsReviewsLoading(false);

          // Parallel & Non-blocking
          void incrementMangaViews(mangaId);
        } else {
          const offlineManga = await getOfflineMangaDetail(mangaId);
          if (isCancelled) return;

          if (offlineManga) {
            const offlineCharacters = await getOfflineMangaCharacters(mangaId);
            setManga(offlineManga);
            setAverageRating({ average: 0, count: 0 });
            setReviews([]);
            setMangaCharacters(offlineCharacters);
            setSimilarMangas([]);
            setHasLoadedReviews(true);
            setHasLoadedCharacters(true);
            setHasLoadedSimilar(true);
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
          setHasLoadedReviews(true);
          setHasLoadedCharacters(true);
          setHasLoadedSimilar(true);
          setIsLoading(false);
          setIsReviewsLoading(false);
          setIsCharsLoading(false);
        }
      } catch (err) {
        console.error('Error loading manga detail:', err);
        const offlineManga = mangaId ? await getOfflineMangaDetail(mangaId) : undefined;
        if (isCancelled) return;

        if (offlineManga) {
          const offlineCharacters = await getOfflineMangaCharacters(mangaId);
          setManga(offlineManga);
          setAverageRating({ average: 0, count: 0 });
          setReviews([]);
          setMangaCharacters(offlineCharacters);
          setSimilarMangas([]);
          setHasLoadedReviews(true);
          setHasLoadedCharacters(true);
          setHasLoadedSimilar(true);
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
    if (
      !mangaId
      || !isOnline
      || isOfflineView
      || isLoading
      || activeTab !== 'characters'
      || hasLoadedCharacters
    ) {
      return;
    }

    void loadCharacters({ visible: true });
  }, [activeTab, hasLoadedCharacters, isLoading, isOfflineView, isOnline, loadCharacters, mangaId]);

  useEffect(() => {
    if (
      !mangaId
      || !isOnline
      || isOfflineView
      || isLoading
      || activeTab !== 'reviews'
      || hasLoadedReviews
    ) {
      return;
    }

    let isCancelled = false;
    setIsReviewsLoading(true);

    void getReviewsForManga(mangaId)
      .then((nextReviews) => {
        if (isCancelled) {
          return;
        }

        setReviews(nextReviews);
        setHasLoadedReviews(true);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        console.error('Manga reviews load error:', error);
        setReviews([]);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsReviewsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, hasLoadedReviews, isLoading, isOfflineView, isOnline, mangaId]);

  useEffect(() => {
    if (
      !mangaId
      || !manga
      || !isOnline
      || isOfflineView
      || isLoading
      || activeTab !== 'discover'
      || hasLoadedSimilar
    ) {
      return;
    }

    void loadSimilarMangas({ visible: true });
  }, [activeTab, hasLoadedSimilar, isLoading, isOfflineView, isOnline, loadSimilarMangas, manga, mangaId]);

  useEffect(() => {
    if (!mangaId || authLoading) {
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
          isOnline ? getUserRating(mangaId, user.id) : Promise.resolve(undefined),
          getLatestProgress(user.id, mangaId),
          isOnline ? getUserReview(mangaId, user.id) : Promise.resolve(null),
          getFavorites(user.id),
          isOnline ? getBlockedUserIds(user.id) : Promise.resolve({ ids: [] }),
          getChapterReadProgressMap(user.id, mangaId),
          isOnline ? getMangaReadingTimeTotal(user.id, mangaId) : Promise.resolve(0),
        ]);

        if (isCancelled) return;

        setFavorite(Boolean(favorited));
        setIsFollowing(Boolean(following));
        setUserRating(rating as number | undefined);
        setLatestProgress(progress);
        setUserReview((uReview as Review | null) ? { ...(uReview as Review) } : createDefaultUserReview());
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
  }, [authLoading, isOnline, mangaId, resetUserScopedState, user?.id]);

  const triggerExternalSync = async (
    trigger: 'manual' | 'reading' | 'category' | 'favorite' | 'rating' | 'review',
    providers?: ExternalSyncProvider[],
  ) => {
    if (!user?.id || !manga?.id || !isOnline) {
      return;
    }

    const response = await syncMangaToExternalProviders({
      mangaId: manga.id,
      trigger,
      providers,
    });

    const statusResponse = await getExternalSyncStatuses().catch(() => null);
    if (statusResponse?.providers) {
      const nextStatuses: Record<ExternalSyncProvider, { connected: boolean; lastError?: string | null }> = {
        myanimelist: { connected: false, lastError: null },
        anilist: { connected: false, lastError: null },
      };

      for (const item of statusResponse.providers) {
        if (item.provider === 'myanimelist' || item.provider === 'anilist') {
          nextStatuses[item.provider] = {
            connected: Boolean(item.account?.connected),
            lastError: item.account?.lastError || null,
          };
        }
      }

      setExternalProviderStatuses(nextStatuses);
    }

    return response;
  };

  const handleManualExternalSync = async (provider: ExternalSyncProvider) => {
    if (!user) {
      toast.error('Harici senkron için giriş yapmalısınız');
      return;
    }

    if (!manga) {
      return;
    }

    try {
      setSyncingExternalProvider(provider);
      const response = await triggerExternalSync('manual', [provider]);
      const providerResult = response?.results?.find((item) => item.provider === provider);

      if (!providerResult) {
        toast.success(`${externalProviderLabels[provider]} senkronu tamamlandı`);
        return;
      }

      if (!providerResult.success) {
        toast.error(providerResult.message || `${externalProviderLabels[provider]} senkronu başarısız oldu`);
        return;
      }

      if (providerResult.skipped) {
        toast.info(providerResult.message || `${externalProviderLabels[provider]} için yeni değişiklik yok`);
        return;
      }

      if (providerResult.warning) {
        toast.warning(providerResult.warning);
        return;
      }

      toast.success(`${externalProviderLabels[provider]} senkronu tamamlandı`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Harici senkron başarısız oldu');
    } finally {
      setSyncingExternalProvider(null);
    }
  };

  const toggleFavorite = async () => {
    if (!user) {
      toast.error('Favorilere eklemek için giriş yapmalısınız');
      return;
    }

    try {
      if (favorite) {
        await removeFavorite(user.id, manga.id);
        setFavorite(false);
        setCategory(undefined);
        if (isOnline) {
          void triggerExternalSync('favorite').catch((error) => {
            console.warn('External sync after favorite removal failed:', error);
          });
        }
        toast.success(isOnline ? 'Favorilerden kaldırıldı' : 'Tekrar çevrimiçi olduğunda favoriler eşitlenecek');
      } else {
        await addFavorite(user.id, manga.id, 'reading', {
          mangaTitle: manga.title,
          mangaCover: manga.cover,
        });
        setFavorite(true);
        setCategory('reading');
        if (isOnline) {
          void triggerExternalSync('favorite').catch((error) => {
            console.warn('External sync after favorite change failed:', error);
          });
        }
        toast.success(isOnline ? 'Favorilere eklendi' : 'Tekrar çevrimiçi olduğunda favoriler eşitlenecek');
      }
    } catch (err) {
      toast.error('İşlem başarısız oldu');
    }
  };

  const handleCategoryChange = async (newCategory: LibraryCategory) => {
    if (!user) {
      toast.error('Giriş yapmalısınız');
      return;
    }

    try {
      if (favorite) {
        await updateFavoriteCategory(user.id, manga.id, newCategory);
      } else {
        await addFavorite(user.id, manga.id, newCategory, {
          mangaTitle: manga.title,
          mangaCover: manga.cover,
        });
      }

      const refreshedFavorites = await getFavorites(user.id);
      const refreshedEntry = refreshedFavorites.find((entry) => entry.mangaId === manga.id);

      setFavorite(true);
      setCategory((refreshedEntry?.category as LibraryCategory | undefined) || newCategory);
      if (isOnline) {
        void triggerExternalSync('category').catch((error) => {
          console.warn('External sync after category change failed:', error);
        });
      }
      toast.success(
        isOnline
          ? `Kategori: ${categoryLabels[(refreshedEntry?.category as LibraryCategory | undefined) || newCategory]}`
          : 'Kütüphane değişikliği tekrar çevrimiçi olduğunda eşitlenecek'
      );
    } catch (err) {
      console.error('Category update failed on manga detail:', err);
      toast.error('Kategori güncellenemedi');
    }
  };

  const toggleFollow = async () => {
    if (!user) {
      toast.error('Takip etmek için giriş yapmalısınız');
      return;
    }

    try {
      if (isFollowing) {
        await unfollowManga(user.id, manga!.id);
        setIsFollowing(false);
        toast.success(isOnline ? 'Takibi bıraktınız' : 'Tekrar çevrimiçi olduğunda takip durumu eşitlenecek');
      } else {
        await followManga(user.id, manga!.id);
        setIsFollowing(true);
        toast.success(
          isOnline
            ? 'Manga takip ediliyor! Yeni bölümlerden haberdar olacaksınız.'
            : 'Tekrar çevrimiçi olduğunda takip durumu eşitlenecek'
        );
      }
    } catch (err) {
      toast.error('İşlem başarısız oldu');
    }
  };

  const handleAddToList = () => {
    if (!user) {
      toast.error('Listeye eklemek için giriş yapmalısınız');
      return;
    }

    if (!isOnline && !offlineSeriesEntry) {
      toast.error('Çevrimdışıyken sadece indirilen seriler okuma listelerine eklenebilir');
      return;
    }

    setIsListModalOpen(true);
  };

  const handleQueueSeriesDownload = async () => {
    if (!manga) {
      return;
    }

    if (!user) {
      toast.error('İndirme yapmak için giriş yapmalısınız');
      return;
    }

    if (!isOnline) {
      toast.error('Seri indirmek icin internete baglanmalisin');
      return;
    }

    try {
      setIsQueueingSeriesDownload(true);
      setIsSeriesDownloadDialogOpen(false);
      const downloadableChapters = await getMangaChapters(manga.id, { includePages: true });
      const job = await offlineDownloadManager.queueSeriesDownload(
        {
          ...manga,
          chapters: downloadableChapters,
        },
        [...downloadableChapters].sort((a, b) => a.number - b.number),
      );

      if (!job) {
        toast.info('Bu serinin tüm bölümleri zaten çevrimdışı hazır');
        return;
      }
    } catch (error) {
      console.error('Series download queue error:', error);
      toast.error(isDownloadAuthRequiredError(error) ? error.message : 'Seri indirilemedi');
    } finally {
      setIsQueueingSeriesDownload(false);
    }
  };

  const handleQueueChapterDownload = async (chapter: Chapter) => {
    if (!manga) {
      return;
    }

    if (!user) {
      toast.error('İndirme yapmak için giriş yapmalısınız');
      return;
    }

    if (!isOnline) {
      toast.error('Bölüm indirmek icin internete baglanmalisin');
      return;
    }

    try {
      const chapterPages = chapter.pages.length > 0
        ? chapter.pages
        : (await getChapterPagesByIds([chapter.id]))[chapter.id] || [];

      if (chapterPages.length === 0) {
        toast.error('Bölüm sayfaları alınamadı');
        return;
      }

      const job = await offlineDownloadManager.queueChapterDownload(manga, {
        ...chapter,
        pages: chapterPages,
        pageCount: chapterPages.length,
      });

      if (!job) {
        toast.info(`Bölüm ${chapter.number} zaten çevrimdışı hazır`);
        return;
      }
    } catch (error) {
      console.error('Chapter download queue error:', error);
      toast.error(isDownloadAuthRequiredError(error) ? error.message : 'Bölüm kuyruğa eklenemedi');
    }
  };

  const openSeriesDownloadDialog = () => {
    if (!user) {
      toast.error('İndirme yapmak için giriş yapmalısınız');
      return;
    }

    setIsSeriesDownloadDialogOpen(true);
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

      await triggerExternalSync('rating').catch((error) => {
        console.warn('External sync after rating failed:', error);
      });
      toast.success(`${rating}/10 puan verildi!`);
    } catch (err) {
      toast.error('Puan kaydedilemedi');
    }
  };

  const canDeleteReview = (review: Review) => {
    if (!user) {
      return false;
    }

    if (review.userId === user.id) {
      return true;
    }

    return user.role === 'admin';
  };

  const handleReviewSubmit = async () => {
    if (!isOnline) {
      toast.error('Inceleme gondermek icin internet baglantisi gerekli');
      return;
    }

    if (!user) return;
    const normalizedReviewContent = userReview.content?.trim() || '';

    if (!normalizedReviewContent) {
      toast.error('Lütfen bir inceleme metni yazın');
      return;
    }

    if (normalizedReviewContent.length > REVIEW_CONTENT_MAX_LENGTH) {
      toast.error(`İnceleme en fazla ${REVIEW_CONTENT_MAX_LENGTH.toLocaleString('tr-TR')} karakter olabilir`);
      return;
    }

    try {
      setIsSubmittingReview(true);
      await addReview({
        mangaId: manga.id,
        userId: user.id,
        username: user.username,
        userAvatar: user.avatar,
        content: normalizedReviewContent,
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
      const ownReview = newReviews.find((review) => review.userId === user.id);

      setAverageRating(newAvg);
      setReviews(newReviews);
      setHasLoadedReviews(true);
      setUserReview(ownReview ? { ...ownReview } : {
        ...userReview,
        userId: user.id,
        username: user.username,
        userAvatar: user.avatar,
        content: normalizedReviewContent,
      });
      setUserRating(getReviewAverageScore(ownReview || userReview));
      setAvgBreakdown({
        story: (newAvg as any).story || 0,
        characters: (newAvg as any).characters || 0,
        art: (newAvg as any).art || 0,
        progression: (newAvg as any).progression || 0,
        engagement: (newAvg as any).engagement || 0
      });

      await triggerExternalSync('review').catch((error) => {
        console.warn('External sync after review failed:', error);
      });
      setIsReviewModalOpen(false);
      toast.success('İncelemeniz başarıyla yayınlandı!');
    } catch (err) {
      toast.error('İnceleme gönderilemedi');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleDeleteReview = async (review: Review) => {
    if (!isOnline) {
      toast.error('İnceleme silmek için internet bağlantısı gerekli');
      return;
    }

    if (!user || !manga || !canDeleteReview(review)) {
      toast.error('Bu incelemeyi silme yetkiniz yok');
      return;
    }

    if (deletingReviewId) {
      return;
    }

    setReviewPendingDelete(review);
  };

  const confirmDeleteReview = async () => {
    if (!reviewPendingDelete || !user || !manga) {
      return;
    }

    const review = reviewPendingDelete;
    const isOwnReview = review.userId === user.id;

    try {
      setDeletingReviewId(review.id);
      await deleteReview(review.id);

      const [newAvg, newReviews] = await Promise.all([
        getAverageRating(manga.id),
        getReviewsForManga(manga.id),
      ]);

      setAverageRating(newAvg);
      setReviews(newReviews);
      setHasLoadedReviews(true);
      setAvgBreakdown({
        story: (newAvg as any).story || 0,
        characters: (newAvg as any).characters || 0,
        art: (newAvg as any).art || 0,
        progression: (newAvg as any).progression || 0,
        engagement: (newAvg as any).engagement || 0,
      });

      if (isOwnReview) {
        setUserReview(createDefaultUserReview());
        setUserRating(undefined);
        setIsReviewModalOpen(false);
      }

      toast.success(isOwnReview ? 'İncelemeniz silindi' : 'İnceleme silindi');
    } catch (error) {
      console.error('Review delete error:', error);
      toast.error('İnceleme silinemedi');
    } finally {
      setReviewPendingDelete(null);
      setDeletingReviewId(null);
    }
  };

  const handleReviewReaction = async (reviewId: string, reactionType: ReactionType) => {
    if (!isOnline) {
      toast.error('Tepki işlemi için internet bağlantısı gerekli');
      return;
    }

    if (!user) {
      toast.error('Tepki bırakmak için giriş yapmalısınız');
      return;
    }

    if (pendingReviewReactions[reviewId]) {
      return;
    }

    const previousReviews = reviews;
    if (!reviews.some((review) => review.id === reviewId)) {
      return;
    }

    const nextReviews = reviews.map((review) => (
      review.id === reviewId
        ? applyOptimisticReaction(review, user.id, reactionType)
        : review
    ));

    setPendingReviewReactions((previous) => ({ ...previous, [reviewId]: true }));
    setReviews(nextReviews);

    try {
      if (reactionType === 'like') {
        await toggleReviewLike(reviewId, user.id);
      } else {
        await toggleReviewDislike(reviewId, user.id);
      }
    } catch (err) {
      console.error('Review reaction error:', err);
      setReviews(previousReviews);
      toast.error('Tepki güncellenemedi');
    } finally {
      setPendingReviewReactions((previous) => {
        const next = { ...previous };
        delete next[reviewId];
        return next;
      });
    }
  };

  const toggleLikeReview = async (reviewId: string) => {
    await handleReviewReaction(reviewId, 'like');
  };

  const toggleDislikeReview = async (reviewId: string) => {
    await handleReviewReaction(reviewId, 'dislike');
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

  const filteredChapters = useMemo(() => {
    if (!manga) {
      return [];
    }

    const normalizedQuery = deferredChapterSearch.toLocaleLowerCase('tr-TR');

    return manga.chapters
      .slice()
      .reverse()
      .filter((chapter) => (
        chapter.number.toString().includes(deferredChapterSearch)
        || chapter.title.toLocaleLowerCase('tr-TR').includes(normalizedQuery)
      ));
  }, [deferredChapterSearch, manga?.chapters]);

  const overviewPreviewChapterCount = isMobile
    ? MOBILE_OVERVIEW_PREVIEW_CHAPTER_COUNT
    : DESKTOP_OVERVIEW_PREVIEW_CHAPTER_COUNT;

  const visibleChapters = useMemo(
    () => filteredChapters.slice(0, overviewPreviewChapterCount),
    [filteredChapters, overviewPreviewChapterCount],
  );
  const visibleOverviewChapters = useMemo(() => (
    showAllChapters
      ? filteredChapters.slice(0, overviewVisibleCount)
      : visibleChapters
  ), [filteredChapters, overviewVisibleCount, showAllChapters, visibleChapters]);
  const remainingOverviewChapterCount = Math.max(0, filteredChapters.length - visibleOverviewChapters.length);
  const sortedPreviewChapters = useMemo(() => (
    manga?.chapters ? [...manga.chapters].sort((a, b) => a.number - b.number) : []
  ), [manga?.chapters]);
  const previewWindow = useMemo(() => {
    if (sortedPreviewChapters.length === 0) {
      return {
        safeStartIndex: 0,
        safeMinLoadedIndex: 0,
        safeLoadedUntilIndex: 0,
        displayedPreviewChapters: [] as Chapter[],
      };
    }

    const safeStartIndex = Math.max(0, Math.min(previewStartIndex, sortedPreviewChapters.length - 1));
    const safeMinLoadedIndex = Math.max(0, Math.min(minLoadedPreviewIndex, safeStartIndex));
    const safeLoadedUntilIndex = Math.max(safeStartIndex, Math.min(maxLoadedIndex, sortedPreviewChapters.length - 1));

    return {
      safeStartIndex,
      safeMinLoadedIndex,
      safeLoadedUntilIndex,
      displayedPreviewChapters: sortedPreviewChapters.slice(safeMinLoadedIndex, safeLoadedUntilIndex + 1),
    };
  }, [maxLoadedIndex, minLoadedPreviewIndex, previewStartIndex, sortedPreviewChapters]);

  useEffect(() => {
    if (!isPreviewTabActive || !isOnline || previewWindow.displayedPreviewChapters.length === 0) {
      return;
    }

    const missingChapterIds = previewWindow.displayedPreviewChapters
      .map((chapter) => chapter.id)
      .filter((chapterId) => !previewChapterPagesById[chapterId]);

    if (missingChapterIds.length === 0) {
      return;
    }

    let isCancelled = false;

    void getChapterPagesByIds(missingChapterIds)
      .then((pagesById) => {
        if (isCancelled || Object.keys(pagesById).length === 0) {
          return;
        }

        setPreviewChapterPagesById((current) => ({
          ...current,
          ...pagesById,
        }));
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error('Preview chapter page fetch error:', error);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOnline, isPreviewTabActive, previewChapterPagesById, previewWindow.displayedPreviewChapters]);

  useEffect(() => {
    setOverviewVisibleCount(OVERVIEW_CHAPTER_BATCH_SIZE);
  }, [deferredChapterSearch, manga?.id]);

  useEffect(() => {
    if (!showAllChapters) {
      return;
    }

    const sentinel = overviewLoadMoreRef.current;
    if (!sentinel || overviewVisibleCount >= filteredChapters.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          return;
        }

        setOverviewVisibleCount((current) => Math.min(current + OVERVIEW_CHAPTER_BATCH_SIZE, filteredChapters.length));
      },
      { rootMargin: '420px 0px', threshold: 0.01 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredChapters.length, overviewVisibleCount, showAllChapters]);

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

  const renderChapterRow = (chapter: Chapter) => {
    const chapterPageCount = getKnownChapterPageCount(chapter);
    const pageCountBadge = chapterPageCount ? (
      <Badge variant="outline" className="h-8 shrink-0 text-[11px]">
        {chapterPageCount} sayfa
      </Badge>
    ) : null;

    return (
      <div
        className="flex flex-col gap-3 p-3 transition-colors hover:bg-secondary/50 sm:p-4 md:flex-row md:items-center md:justify-between"
      >
        <div className="min-w-0 flex-1">
          <Link
            to={`/manga/${manga.id}/chapter/${chapter.id}`}
            className={cn(
              "line-clamp-1 text-base font-semibold leading-tight transition-colors sm:line-clamp-2 sm:text-base",
              mergedChapterReadMap[chapter.id]?.isRead
                ? "text-emerald-400 hover:text-emerald-300"
                : "hover:text-primary",
            )}
          >
            {formatChapterDisplayTitle(chapter.number, chapter.title)}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted-foreground sm:text-xs">
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

        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end">
          {offlineChapterMap[chapter.id]?.downloadStatus === 'completed' ? (
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
              {pageCountBadge}
              <Button asChild size="sm" className="h-9 px-3 text-xs sm:text-sm">
                <Link to={`/manga/${manga.id}/chapter/${chapter.id}`}>
                  Oku
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 px-0 text-xs sm:w-auto sm:px-3 sm:text-sm"
                onClick={() => void handleDeleteOfflineChapter(chapter.id)}
              >
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="sr-only sm:not-sr-only">Sil</span>
              </Button>
            </div>
          ) : offlineChapterMap[chapter.id] && ['running', 'queued'].includes(offlineChapterMap[chapter.id].downloadStatus) ? (
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
              {pageCountBadge}
              <Button variant="outline" size="sm" className="h-9 px-3 text-xs sm:text-sm" disabled>
                <Download className="mr-2 h-4 w-4" />
                İndiriliyor
              </Button>
            </div>
          ) : offlineChapterMap[chapter.id]?.downloadStatus === 'paused' ? (
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
              {pageCountBadge}
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs sm:text-sm"
                onClick={() => void handleQueueChapterDownload(chapter)}
              >
                <Download className="mr-2 h-4 w-4" />
                Devam Et
              </Button>
            </div>
          ) : offlineChapterMap[chapter.id] && ['failed', 'partial'].includes(offlineChapterMap[chapter.id].downloadStatus) ? (
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
              {pageCountBadge}
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs sm:text-sm"
                onClick={() => void handleQueueChapterDownload(chapter)}
              >
                <Download className="mr-2 h-4 w-4" />
                Yeniden Dene
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 px-0 text-xs sm:w-auto sm:px-3 sm:text-sm"
                onClick={() => void handleDeleteOfflineChapter(chapter.id)}
              >
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="sr-only sm:not-sr-only">Sil</span>
              </Button>
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
              {pageCountBadge}
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs sm:text-sm"
                onClick={() => void handleQueueChapterDownload(chapter)}
              >
                <Download className="mr-2 h-4 w-4" />
                İndir
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const continueChapter = latestProgress
    ? manga.chapters.find(ch => ch.id === latestProgress.chapterId)
    : null;
  const heroArtwork = manga.banner || manga.cover;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-16">
        {/* Hero Section */}
        <div className="relative overflow-hidden">
          {/* Background */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] overflow-hidden md:h-[34rem]">
            <OptimizedImage
              src={heroArtwork}
              alt=""
              aria-hidden
              priority
              containerClassName="h-full w-full"
              className={cn(
                'h-full w-full object-cover [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.98)_0%,rgba(0,0,0,0.88)_48%,rgba(0,0,0,0.55)_72%,transparent_100%)]',
                disableHeavyEffects
                  ? 'scale-105 blur-lg opacity-80'
                  : 'scale-[1.08] blur-xl lg:blur-2xl opacity-90',
              )}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/72 to-background" />
            <div className={cn(
              'absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent via-background/60 to-background',
              disableHeavyEffects ? '' : 'blur-md',
            )} />
          </div>

          {/* Content */}
          <div className="container relative z-10 py-6 sm:py-8">
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
              {/* Cover */}
              <div className="mx-auto w-full max-w-[220px] shrink-0 animate-fade-up opacity-0 md:mx-0 md:w-64 md:max-w-none" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
                <OptimizedImage
                  src={manga.cover}
                  alt={manga.title}
                  priority
                  containerClassName="mx-auto"
                  className="mx-auto h-auto w-full rounded-xl object-cover shadow-2xl shadow-primary/10 md:h-96"
                />
              </div>

              {/* Info */}
              <div className="min-w-0 flex flex-1 flex-col gap-4 animate-fade-up opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="default"
                    className={`border-none font-bold ${manga.type === 'manhwa' ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/20' :
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

                {alternativeTitlesText && (
                  <div ref={alternativeTitlesContainerRef} className="relative space-y-1">
                    <span
                      ref={alternativeTitlesMeasureRef}
                      aria-hidden
                      className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-sm italic opacity-0"
                    >
                      {alternativeTitlesText}
                    </span>
                    <button
                      type="button"
                      onClick={() => shouldShowAlternativeTitlesToggle && setIsAlternativeTitlesExpanded((previous) => !previous)}
                      className={cn(
                        'w-full text-left text-sm text-muted-foreground italic',
                        shouldShowAlternativeTitlesToggle && 'cursor-pointer transition-colors hover:text-foreground/85',
                        !isAlternativeTitlesExpanded && 'truncate',
                      )}
                      aria-expanded={isAlternativeTitlesExpanded}
                      title={shouldShowAlternativeTitlesToggle ? 'Alternatif başlıkları göster/gizle' : undefined}
                    >
                      {alternativeTitlesText}
                    </button>
                    {shouldShowAlternativeTitlesToggle && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAlternativeTitlesExpanded((previous) => !previous)}
                        className="h-8 px-0 text-sm font-medium text-primary hover:bg-transparent hover:text-primary"
                      >
                        {isAlternativeTitlesExpanded ? 'Daha Az Göster' : 'Tümünü Gör'}
                        {isAlternativeTitlesExpanded ? (
                          <ChevronUp className="ml-2 h-4 w-4" />
                        ) : (
                          <ChevronDown className="ml-2 h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const authorItems = manga.authorsDetails?.length
                        ? manga.authorsDetails
                        : manga.authorDetails
                          ? [manga.authorDetails]
                          : [];
                      const artistItems = manga.artistsDetails?.length
                        ? manga.artistsDetails
                        : manga.artistDetails
                          ? [manga.artistDetails]
                          : [];

                      return (
                        <>
                          {authorItems.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {authorItems.map((author, index) => (
                                <React.Fragment key={author.id}>
                                  {index > 0 ? <span>,</span> : null}
                                  <Link to={`/author/${author.id}`} className="hover:text-primary transition-colors underline-offset-4 hover:underline">
                                    {author.name}
                                  </Link>
                                </React.Fragment>
                              ))}
                            </div>
                          ) : (
                            <span>{manga.author}</span>
                          )}

                          {artistItems.length > 0 || manga.artist ? (
                            <span className="mx-1">•</span>
                          ) : null}

                          {artistItems.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {artistItems.map((artist, index) => (
                                <React.Fragment key={artist.id}>
                                  {index > 0 ? <span>,</span> : null}
                                  <Link to={`/artist/${artist.id}`} className="hover:text-primary transition-colors underline-offset-4 hover:underline">
                                    {artist.name}
                                  </Link>
                                </React.Fragment>
                              ))}
                            </div>
                          ) : manga.artist ? (
                            <span>{manga.artist}</span>
                          ) : null}
                        </>
                      );
                    })()}
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
                  <p className="text-foreground/80 leading-relaxed">
                    {shouldShowDescriptionToggle && !isDescriptionExpanded ? descriptionPreview : manga.description}
                  </p>
                  {shouldShowDescriptionToggle && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsDescriptionExpanded((previous) => !previous)}
                      className="mt-2 h-8 px-0 text-sm font-medium text-primary hover:bg-transparent hover:text-primary"
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
                      onClick={openSeriesDownloadDialog}
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
          <Tabs value={activeTab} className="w-full" onValueChange={handleActiveTabChange}>
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
                  value="bookmarks"
                  className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  YER İMLERİ
                  {seriesBookmarks.length > 0 && (
                    <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[10px] text-primary hover:bg-primary/20">
                      {seriesBookmarks.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="reviews"
                  className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  İNCELEMELER
                  {reviewCount > 0 && (
                    <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[10px] text-primary hover:bg-primary/20">
                      {reviewCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="characters"
                  className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  KARAKTERLER
                  {characterCount > 0 && (
                    <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[10px] text-primary hover:bg-primary/20">
                      {characterCount}
                    </Badge>
                  )}
                </TabsTrigger>
                {seriesGalleryImages.length > 0 && (
                  <TabsTrigger
                    value="gallery"
                    className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                  >
                    GALERİ
                    <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[10px] text-primary hover:bg-primary/20">
                      {seriesGalleryImages.length}
                    </Badge>
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="discover"
                  className="flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 text-[13px] font-semibold transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent sm:text-lg"
                >
                  KEŞFET
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isOverviewTabActive ? (
                <>
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
                            <div className="divide-y divide-border overflow-hidden">
                              {visibleOverviewChapters.map((chapter) => (
                                <div key={chapter.id}>
                                  {renderChapterRow(chapter)}
                                </div>
                              ))}
                            </div>

                            {showAllChapters && visibleOverviewChapters.length < filteredChapters.length && (
                              <div ref={overviewLoadMoreRef} className="px-4 py-5 text-center text-sm text-muted-foreground">
                                Daha fazla bölüm yükleniyor...
                              </div>
                            )}

                            {filteredChapters.length > overviewPreviewChapterCount && (
                              <div className="border-t border-border p-3 sm:p-4">
                                <Button
                                  variant="ghost"
                                  className="w-full"
                                  onClick={() => setShowAllChapters(!showAllChapters)}
                                >
                                  <span
                                    className={cn(
                                      'mr-2 inline-flex transition-transform duration-200',
                                      showAllChapters && 'rotate-180',
                                    )}
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </span>
                                  {showAllChapters
                                    ? 'Daha Az Göster'
                                    : `Tüm Bölümleri Göster (${remainingOverviewChapterCount} daha)`}
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

                      {manga.relatedSeries && manga.relatedSeries.length > 0 && (
                        <div className="rounded-xl border border-border bg-card/50 p-4 sm:p-6">
                          <div className="mb-4">
                            <h2 className="text-xl font-bold">İlgili Seriler</h2>
                            <p className="text-sm text-muted-foreground">
                              Devam serileri, öncüller ve diğer bağlantılı içerikler.
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            {manga.relatedSeries.map((relation) => (
                              relation.relatedManga ? (
                                <Link
                                  key={relation.id}
                                  to={`/manga/${relation.relatedManga.id}`}
                                  className="group flex gap-3 rounded-2xl border border-border bg-background/40 p-3 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg [transform:translateZ(0)]"
                                >
                                  <div className="h-24 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary">
                                    {relation.relatedManga.cover ? (
                                      <OptimizedImage
                                        src={relation.relatedManga.cover}
                                        alt={relation.relatedManga.title}
                                        rootMargin="420px 0px"
                                        containerClassName="h-full w-full"
                                        placeholderClassName="rounded-none"
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <EntityPlaceholderArt
                                        name={relation.relatedManga.title}
                                        className="rounded-none"
                                        initialClassName="text-xl"
                                      />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <Badge variant="secondary" className="mb-2 rounded-full">
                                      {getMangaRelationTypeLabel(relation.relationType)}
                                    </Badge>
                                    <p className="line-clamp-2 font-semibold group-hover:text-primary">
                                      {relation.relatedManga.title}
                                    </p>
                                    <p className="mt-2 text-sm text-muted-foreground">
                                      {relation.relatedManga.type} {relation.relatedManga.releaseYear ? `• ${relation.relatedManga.releaseYear}` : ''}
                                    </p>
                                  </div>
                                </Link>
                              ) : null
                            ))}
                          </div>
                        </div>
                      )}

                    </div>

                    {/* Sidebar Info */}
                    <div className="space-y-4 sm:space-y-6">
                      <div 
                        className="group hidden cursor-pointer rounded-xl border border-border bg-card/50 p-3 transition-colors hover:bg-card/70 sm:block sm:p-6"
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
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold">Harici Takip</h3>
                            <p className="text-sm text-muted-foreground">Desteklenen servisler ve cache'li puan bilgileri.</p>
                          </div>
                          {isRefreshingExternalRatings ? (
                            <RefreshCcw className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : null}
                        </div>

                        <div className="space-y-3">
                          {([
                            {
                              provider: 'myanimelist' as const,
                              link: malLink,
                              rating: externalRatings.myanimelist,
                            },
                            {
                              provider: 'anilist' as const,
                              link: aniListLink,
                              rating: externalRatings.anilist,
                            },
                          ]).map(({ provider, link, rating }) => {
                            const isSupported = isExternalProviderSupported(manga.sourceLinks, provider);
                            const isConnected = externalProviderStatuses[provider]?.connected;
                            const hasSyncError = Boolean(externalProviderStatuses[provider]?.lastError);
                            const isProviderEnabled = userExternalSyncPreferences.providers[provider].enabled;

                            return (
                              <div key={provider} className="rounded-xl border border-border/60 bg-background/30 p-3">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium">{externalProviderLabels[provider]}</span>
                                      <Badge className={isSupported ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15' : 'bg-secondary text-muted-foreground hover:bg-secondary'}>
                                        {isSupported ? 'Destekleniyor' : 'Desteklenmiyor'}
                                      </Badge>
                                      {isConnected ? (
                                        <Badge variant="outline">Bağlı</Badge>
                                      ) : null}
                                      {user && !isProviderEnabled ? (
                                        <Badge variant="secondary">Senkron Kapalı</Badge>
                                      ) : null}
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                      Puan: <span className="font-medium text-foreground">{formatExternalScore(rating?.score)}</span>
                                    </p>
                                    {hasSyncError ? (
                                      <p className="text-xs text-amber-300">{externalProviderStatuses[provider]?.lastError}</p>
                                    ) : null}
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    {link?.url ? (
                                      <Button asChild size="sm" variant="outline">
                                        <a href={link.url} target="_blank" rel="noreferrer">
                                          <Link2 className="h-4 w-4" />
                                          Aç
                                        </a>
                                      </Button>
                                    ) : null}
                                    {user && isSupported && isConnected ? (
                                      <Button
                                        size="sm"
                                        variant="glow"
                                        onClick={() => void handleManualExternalSync(provider)}
                                        disabled={syncingExternalProvider === provider || !isProviderEnabled}
                                      >
                                        {syncingExternalProvider === provider ? (
                                          <RefreshCcw className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <RefreshCcw className="h-4 w-4" />
                                        )}
                                        Şimdi Senkronla
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-card/50 p-3 sm:p-6">
                        {isOnline ? (
                          <TagSection
                            entityType="manga"
                            entityId={manga.id}
                          />
                        ) : (
                          <OfflineNotice
                            compact
                            title="Çevrimdışısınız"
                            description="Akıllı etiketler için internete bağlanmanız gerekiyor."
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <DeferredMount className="mt-4 sm:mt-8" placeholderMinHeight={420} rootMargin="240px 0px">
                    <div className="rounded-xl border border-border bg-card/50 p-3 shadow-sm sm:p-6 lg:p-10">
                      {isOnline ? (
                        <CommentSection mangaId={manga.id} />
                      ) : (
                        <OfflineNotice
                          compact
                          title="Çevrimdışısınız"
                          description="Yorumlar ve inceleme yorumları için internete bağlanın."
                        />
                      )}
                    </div>
                  </DeferredMount>
                </>
              ) : null}
            </TabsContent>

            <TabsContent value="preview" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isPreviewTabActive ? (
              !isOnline ? (
                <OfflineNotice
                  description="Seri önizlemesi internet bağlantısı gerektirir."
                  actionHref={`/manga/${manga.id}`}
                  actionLabel="Genel Bakışa Dön"
                />
              ) : (
                <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8">
                  {sortedPreviewChapters.length === 0 ? (
                    <div className="text-center rounded-xl border border-border bg-card/50 text-muted-foreground p-8">Henüz bölüm eklenmemiş</div>
                  ) : (
                    <>
                      {previewWindow.safeMinLoadedIndex > 0 && (
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

                      {previewWindow.displayedPreviewChapters.map((chapter, localIndex) => {
                        const index = previewWindow.safeMinLoadedIndex + localIndex;
                        const isImageMounted = Math.abs(index - currentViewedIndex) <= 1;

                        return (
                          <PreviewChapter
                            key={chapter.id}
                            chapter={chapter}
                            pages={previewChapterPagesById[chapter.id] || []}
                            index={index}
                            mangaId={manga.id}
                            isImageMounted={isImageMounted}
                            onInView={handlePreviewInView}
                            onNearBottom={handlePreviewNearBottom}
                          />
                        );
                      })}

                      {previewWindow.safeLoadedUntilIndex < sortedPreviewChapters.length - 1 && (
                        <div className="flex justify-center p-8 bg-card/20 rounded-xl" style={{ minHeight: '100px' }}>
                          <span className="text-muted-foreground flex items-center gap-2">
                             <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                             Sonraki bölüm yükleniyor...
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
              ) : null}
            </TabsContent>

            <TabsContent value="gallery" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isGalleryTabActive ? (
                <Suspense
                  fallback={(
                    <div className="rounded-xl border border-border bg-card/50 p-6 sm:p-8">
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div key={`gallery-skeleton-${index}`} className="aspect-[3/4] animate-pulse rounded-xl bg-secondary/40" />
                        ))}
                      </div>
                    </div>
                  )}
                >
                  <MangaDetailGalleryPanel images={seriesGalleryImages} />
                </Suspense>
              ) : null}
            </TabsContent>

            <TabsContent value="bookmarks" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isBookmarksTabActive ? (
              <div className="mx-auto max-w-5xl space-y-6">
                {!user ? (
                  <div className="rounded-xl border border-border bg-card/50 p-8 text-center shadow-sm">
                    <h3 className="text-xl font-semibold">Bu serideki yer imlerini görmek için giriş yapın</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Kayıtlı sayfalarınız burada sadece bu seriye özel olarak listelenir.
                    </p>
                    <Button asChild className="mt-4" variant="glow">
                      <Link to="/auth">Giriş Yap</Link>
                    </Button>
                  </div>
                ) : isSeriesBookmarksLoading ? (
                  <div className="rounded-xl border border-border bg-card/50 p-8 shadow-sm">
                    <div className="flex flex-col items-center justify-center gap-4 py-12">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                      <p className="text-sm text-muted-foreground">Yer imleri hazırlanıyor...</p>
                    </div>
                  </div>
                ) : seriesBookmarkEntries.length > 0 ? (
                  <>
                    {!isOnline && (
                      <OfflineNotice
                        compact
                        className="text-left"
                        description="Çevrimdışıyken yalnızca bu seri için önceden kaydedilmiş yer imleri gösterilir."
                      />
                    )}

                    <div className="grid gap-4 lg:grid-cols-2">
                      {seriesBookmarkEntries.map(({ bookmark, chapter, chapterLabel, createdAtLabel, previewImage }, index) => (
                        <Link
                          key={`${bookmark.chapterId}-${bookmark.page}-${bookmark.createdAt || index}`}
                          to={`/manga/${manga.id}/chapter/${bookmark.chapterId}?page=${bookmark.page}`}
                          className="group flex gap-4 rounded-xl border border-border bg-card/50 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card/70 animate-fade-up opacity-0 [transform:translateZ(0)]"
                          style={{ animationDelay: `${0.08 + index * 0.04}s`, animationFillMode: 'forwards' }}
                        >
                          <BookmarkPagePreview
                            src={previewImage}
                            alt={`${chapterLabel} - Sayfa ${bookmark.page}`}
                            pageNumber={bookmark.page}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">Yer İmi</p>
                            </div>

                            <h3 className="mt-2 line-clamp-2 text-base font-semibold sm:text-lg">
                              {chapterLabel}
                            </h3>

                            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                              <span>
                                {chapter
                                  ? (getKnownChapterPageCount(chapter)
                                      ? `${getKnownChapterPageCount(chapter)} sayfa`
                                      : `Bölüm ${chapter.number}`)
                                  : `Bölüm ${bookmark.chapterNumber}`}
                              </span>
                            </div>

                            {bookmark.note && (
                              <div className="mt-3 rounded-lg border border-border/60 bg-secondary/40 p-3 text-sm italic text-muted-foreground">
                                "{bookmark.note}"
                              </div>
                            )}

                            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                              <span>{createdAtLabel}</span>
                              <span className="inline-flex items-center gap-1 text-primary transition-all group-hover:gap-1.5">
                                Yer imine git
                                <ArrowRight className="h-4 w-4" />
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
                    <h3 className="text-xl font-semibold">Bu seri için kayıtlı yer imi yok</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Okurken önemli bir sayfayı işaretlediğinizde burada sadece bu seriye ait kayıtları göreceksiniz.
                    </p>
                    <Button asChild className="mt-4" variant="outline">
                      <Link to={manga.chapters.length > 0 ? `/manga/${manga.id}/chapter/${[...manga.chapters].sort((a, b) => a.number - b.number)[0]?.id}` : `/manga/${manga.id}`}>
                        Okumaya Başla
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
              ) : null}
            </TabsContent>

            <TabsContent value="characters" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isCharactersTabActive ? (
                <div className="space-y-8">
                  {isCharsLoading ? (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-6">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="space-y-3">
                          <div className="aspect-[3/4] rounded-xl bg-secondary/30 animate-pulse border border-border" />
                          <div className="h-4 w-2/3 bg-secondary/50 rounded mx-auto animate-pulse" />
                        </div>
                      ))}
                    </div>
                  ) : mangaCharacters.length > 0 ? (
                    groupedMangaCharacters.map((group) => (
                      <section key={group.role} className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-xl font-bold sm:text-2xl">{group.title}</h2>
                            <p className="text-sm text-muted-foreground">{group.items.length} karakter</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-6">
                          {group.items.map((char) => (
                            <Link key={char.id} to={`/character/${char.id}`} className="group space-y-3">
                              <div className="relative aspect-[3/4] rounded-xl overflow-hidden shadow-lg border border-border bg-secondary/30">
                                {char.imageUrl ? (
                                  <OptimizedImage
                                    src={char.imageUrl}
                                    alt={char.name}
                                    rootMargin="420px 0px"
                                    containerClassName="h-full w-full"
                                    placeholderClassName="rounded-[inherit]"
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                  />
                                ) : (
                                  <EntityPlaceholderArt
                                    name={char.name}
                                    className="rounded-[inherit]"
                                    initialClassName="text-5xl sm:text-6xl"
                                  />
                                )}
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%] bg-gradient-to-t from-black/95 via-black/65 via-35% to-transparent" />
                                <div className="absolute inset-x-0 bottom-0 p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow-[0_1px_6px_rgba(0,0,0,0.55)]">
                                      {getCharacterListingRoleLabel(group.role)}
                                    </span>
                                    <div className="flex items-center gap-1 text-xs font-bold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">
                                      <Heart className="h-3 w-3 fill-current" /> {char.likesCount}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-1 text-center">
                                <h3 className="truncate font-bold text-sm group-hover:text-primary transition-colors">{char.name}</h3>
                                {char.details?.role ? (
                                  <p className="truncate text-xs text-muted-foreground">{char.details.role}</p>
                                ) : null}
                              </div>
                            </Link>
                          ))}
                        </div>
                      </section>
                    ))
                  ) : (
                    <div className="col-span-full py-20 text-center text-muted-foreground italic bg-secondary/10 rounded-2xl border border-dashed border-border">
                      {isOnline
                        ? 'Bu seri için henüz karakter eklenmemiş.'
                        : 'Çevrimdışıyken sadece daha önce önbelleğe alınan karakter kartları gösterilebilir.'}
                    </div>
                  )}
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="reviews" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isReviewsTabActive ? (
                !isOnline ? (
                  <OfflineNotice
                    description="İncelemeler için internete bağlanmanız gerekiyor."
                    actionHref={`/manga/${manga.id}`}
                    actionLabel="Genel Bakışa Dön"
                  />
                ) : isReviewsLoading ? (
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
                      <div className="text-muted-foreground font-medium">{reviewCount} inceleme</div>
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
                            <div className="flex items-center justify-between gap-3">
                              <label className="text-sm font-medium">İncelemeniz</label>
                              <span className={cn(
                                'text-xs',
                                (userReview.content?.length || 0) > REVIEW_CONTENT_MAX_LENGTH * 0.9
                                  ? 'text-primary'
                                  : 'text-muted-foreground',
                              )}>
                                {(userReview.content?.length || 0).toLocaleString('tr-TR')} / {REVIEW_CONTENT_MAX_LENGTH.toLocaleString('tr-TR')}
                              </span>
                            </div>
                            <Textarea
                              placeholder="Manga hakkındaki düşünceleriniz..."
                              className="min-h-[120px] resize-none bg-secondary/30"
                              value={userReview.content}
                              onChange={(e) => setUserReview(prev => ({ ...prev, content: e.target.value }))}
                              maxLength={REVIEW_CONTENT_MAX_LENGTH}
                            />
                          </div>
                        </div>

                        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                          {userReview.id ? (
                            <Button
                              className="w-full sm:w-auto sm:mr-auto"
                              variant="destructive"
                              onClick={() => handleDeleteReview({
                                ...(userReview as Review),
                                userId: (userReview.userId || user?.id || '') as string,
                                username: (userReview.username || user?.username || '') as string,
                              })}
                              disabled={isSubmittingReview || deletingReviewId === userReview.id}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {deletingReviewId === userReview.id ? 'Siliniyor...' : 'İncelemeyi Sil'}
                            </Button>
                          ) : null}
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
                          const isReviewExpanded = Boolean(expandedReviewIds[review.id]);
                          const isReviewExpandable = shouldCollapseReviewContent(review.content);

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
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span>{formatDate(review.createdAt)}</span>
                                        {shouldShowEditedReviewLabel(review) && (
                                          <Badge variant="outline" className="h-5 border-primary/30 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                            Düzenlendi
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-10 gap-0.5 self-start text-yellow-400 sm:flex">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
                                      const avg = (review.rating_story + review.rating_characters + review.rating_art + review.rating_progression + review.rating_engagement) / 5;
                                      return <Star key={star} className={`h-3 w-3 ${star <= Math.round(avg) ? 'fill-current' : 'text-muted-foreground'}`} />;
                                    })}
                                  </div>
                                </div>

                                <div className="mb-6">
                                  <div
                                    className={cn(
                                      'relative overflow-hidden transition-[max-height] duration-300 ease-out',
                                      isReviewExpandable && !isReviewExpanded ? 'max-h-48' : 'max-h-[120rem]',
                                    )}
                                  >
                                    <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">{review.content}</p>
                                    {isReviewExpandable && !isReviewExpanded && (
                                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card via-card/95 to-transparent" />
                                    )}
                                  </div>
                                  {isReviewExpandable && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="mt-3 h-8 rounded-full px-3 text-primary hover:bg-primary/10 hover:text-primary"
                                      onClick={() => setExpandedReviewIds((prev) => ({
                                        ...prev,
                                        [review.id]: !prev[review.id],
                                      }))}
                                    >
                                      {isReviewExpanded ? 'Daha Az Göster' : 'Tümünü Gör'}
                                      {isReviewExpanded ? (
                                        <ChevronUp className="ml-2 h-4 w-4" />
                                      ) : (
                                        <ChevronDown className="ml-2 h-4 w-4" />
                                      )}
                                    </Button>
                                  )}
                                </div>

                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-6 bg-secondary/20 p-3 rounded-lg">
                                  <span>Hikaye: <strong className="text-foreground">{review.rating_story}/10</strong></span>
                                  <span>Karakterler: <strong className="text-foreground">{review.rating_characters}/10</strong></span>
                                  <span>Çizim: <strong className="text-foreground">{review.rating_art}/10</strong></span>
                                  <span>İlerleyiş: <strong className="text-foreground">{review.rating_progression}/10</strong></span>
                                  <span>Sürükleyicilik: <strong className="text-foreground">{review.rating_engagement}/10</strong></span>
                                </div>

                                <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={Boolean(pendingReviewReactions[review.id])}
                                      className={cn(
                                        'gap-2 hover:bg-emerald-500/10 hover:text-emerald-500',
                                        hasReaction(review, user?.id, 'like') && 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15 hover:text-emerald-500'
                                      )}
                                      onClick={() => void toggleLikeReview(review.id)}
                                    >
                                      <ThumbsUp className={`h-4 w-4 ${hasReaction(review, user?.id, 'like') ? 'fill-current' : ''}`} />
                                      <span>{review.likes}</span>
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={Boolean(pendingReviewReactions[review.id])}
                                      className={cn(
                                        'gap-2 hover:bg-red-500/10 hover:text-red-500',
                                        hasReaction(review, user?.id, 'dislike') && 'bg-red-500/10 text-red-500 hover:bg-red-500/15 hover:text-red-500'
                                      )}
                                      onClick={() => void toggleDislikeReview(review.id)}
                                    >
                                      <ThumbsDown className={`h-4 w-4 ${hasReaction(review, user?.id, 'dislike') ? 'fill-current' : ''}`} />
                                      <span>{review.dislikes}</span>
                                    </Button>
                                  </div>
                                  {canDeleteReview(review) && review.userId !== user?.id && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      onClick={() => handleDeleteReview(review)}
                                      disabled={deletingReviewId === review.id}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      {deletingReviewId === review.id ? 'Siliniyor...' : 'Sil'}
                                    </Button>
                                  )}
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
                )
              ) : null}
            </TabsContent>

            <TabsContent value="discover" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {isDiscoverTabActive ? (
                !isOnline ? (
                  <OfflineNotice
                    description="Keşfet ve benzer seri önerileri internet bağlantısı gerektirir."
                    actionHref="/downloads"
                    actionLabel="İndirilenlere Git"
                  />
                ) : (
                  <Suspense
                    fallback={(
                      <div className="rounded-xl border border-border bg-card/50 p-6 sm:p-8">
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
                          {Array.from({ length: 6 }).map((_, index) => (
                            <div key={`discover-skeleton-${index}`} className="animate-pulse">
                              <div className="aspect-[2/3] rounded-lg bg-muted" />
                              <div className="mt-2 h-4 w-3/4 rounded bg-muted" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  >
                    <MangaDetailDiscoverPanel
                      genres={manga?.genres || []}
                      loading={loadingSimilar}
                      similarMangas={similarMangas}
                    />
                  </Suspense>
                )
              ) : null}
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
                  {manga.chapters.length} bölüm
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

      <ConfirmDialog
        open={Boolean(reviewPendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingReviewId) {
            setReviewPendingDelete(null);
          }
        }}
        title="İnceleme silinsin mi?"
        description={
          reviewPendingDelete
            ? reviewPendingDelete.userId === user?.id
              ? 'İncelemeniz kalıcı olarak silinecek. Bu işlem geri alınamaz.'
              : `${reviewPendingDelete.username} kullanıcısının incelemesi kalıcı olarak silinecek. Bu işlem geri alınamaz.`
            : ''
        }
        confirmLabel={deletingReviewId ? 'Siliniyor...' : 'Sil'}
        cancelLabel="Vazgeç"
        onConfirm={() => void confirmDeleteReview()}
        destructive
      />
    </div>
  );
};


export default MangaDetail;
