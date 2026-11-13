import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  EyeOff,
  Hash,
  Heart,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquare,
  Pin,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  dedupeById,
  FORUM_CATEGORIES,
  FORUM_CATEGORY_MAP,
  ForumCategoryId,
  ForumSortOption,
  ForumTopic,
  getForumCategoryCounts,
  getForumTopicsFeed,
  toggleForumTopicLike,
} from '@/lib/forum';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { stripForumMediaForPreview } from '@/lib/forumMedia';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import StaffBadge from '@/components/user/StaffBadge';
import ForumTopicComposerModal from '@/components/community/ForumTopicComposerModal';

const TOPICS_PAGE_SIZE = 20;
const INITIAL_PINNED_VISIBLE = 3;

const SORT_OPTIONS: Array<{ value: ForumSortOption; label: string }> = [
  { value: 'latest', label: 'Son Aktivite' },
  { value: 'newest', label: 'En Yeni' },
  { value: 'most_liked', label: 'En Çok Beğenilen' },
  { value: 'most_replied', label: 'En Çok Yanıtlanan' },
];

const isValidCategoryId = (value: string | null): value is ForumCategoryId =>
  Boolean(value && Object.prototype.hasOwnProperty.call(FORUM_CATEGORY_MAP, value));

const formatRelativeTime = (isoDate?: string | null): string => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDistanceToNow(parsed, { addSuffix: true, locale: tr });
};

const getInitials = (name?: string | null): string => {
  const cleaned = (name || 'U').trim();
  return cleaned.slice(0, 2).toUpperCase();
};

const ForumTab: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialCategoryParam = searchParams.get('category');
  const initialCategory: ForumCategoryId | null = isValidCategoryId(initialCategoryParam)
    ? initialCategoryParam
    : null;
  const initialQuery = searchParams.get('q') || '';

  const [selectedCategory, setSelectedCategory] = useState<ForumCategoryId | null>(initialCategory);
  const [searchInput, setSearchInput] = useState<string>(initialQuery);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialQuery.trim());
  const [sort, setSort] = useState<ForumSortOption>('latest');

  const [totalCount, setTotalCount] = useState<number>(0);
  const [categoryCounts, setCategoryCounts] = useState<Record<ForumCategoryId, number>>(() => ({
    'genel-sohbet': 0,
    tanisma: 0,
    'seri-sohbetleri': 0,
    'bolum-tartismalari': 0,
    'oneri-tavsiye': 0,
    'site-geri-bildirim': 0,
  }));

  const [pinnedTopics, setPinnedTopics] = useState<ForumTopic[]>([]);
  const [showAllPinned, setShowAllPinned] = useState(false);

  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [likingTopicIds, setLikingTopicIds] = useState<Record<string, boolean>>({});
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  const feedRequestIdRef = useRef(0);

  // 300ms search debounce
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Sync URL query params (`category`, `q`) while keeping `tab` intact
  useEffect(() => {
    const currentCategory = searchParams.get('category');
    const currentQ = searchParams.get('q') || '';
    const nextCategory = selectedCategory || null;
    const nextQ = debouncedSearch || '';

    if ((currentCategory || null) === nextCategory && currentQ === nextQ) {
      return;
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextCategory) {
          next.set('category', nextCategory);
        } else {
          next.delete('category');
        }
        if (nextQ) {
          next.set('q', nextQ);
        } else {
          next.delete('q');
        }
        return next;
      },
      { replace: true },
    );
  }, [selectedCategory, debouncedSearch, searchParams, setSearchParams]);

  const loadCounts = useCallback(async () => {
    try {
      const summary = await getForumCategoryCounts();
      setTotalCount(summary.totalCount);
      setCategoryCounts(summary.counts);
    } catch (error) {
      console.error('Forum kategori sayıları alınamadı:', error);
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const showPinnedSection = sort === 'latest' && !debouncedSearch;

  const loadFeed = useCallback(async () => {
    const requestId = ++feedRequestIdRef.current;
    setIsLoading(true);

    try {
      if (showPinnedSection) {
        const [pinnedResult, mainResult] = await Promise.all([
          getForumTopicsFeed({
            category: selectedCategory,
            sort: 'latest',
            pinnedMode: 'pinned',
            limit: 30,
            offset: 0,
          }),
          getForumTopicsFeed({
            category: selectedCategory,
            sort: 'latest',
            pinnedMode: 'unpinned',
            limit: TOPICS_PAGE_SIZE,
            offset: 0,
          }),
        ]);

        if (requestId !== feedRequestIdRef.current) return;
        setPinnedTopics(dedupeById(pinnedResult.topics));
        setTopics(dedupeById(mainResult.topics));
        setHasMore(mainResult.hasMore);
      } else {
        const mainResult = await getForumTopicsFeed({
          category: selectedCategory,
          search: debouncedSearch || undefined,
          sort,
          pinnedMode: 'all',
          limit: TOPICS_PAGE_SIZE,
          offset: 0,
        });

        if (requestId !== feedRequestIdRef.current) return;
        setPinnedTopics([]);
        setTopics(dedupeById(mainResult.topics));
        setHasMore(mainResult.hasMore);
      }
    } catch (error) {
      if (requestId !== feedRequestIdRef.current) return;
      console.error('Forum akışı yüklenemedi:', error);
      toast.error('Forum konuları yüklenirken bir hata oluştu.');
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [selectedCategory, debouncedSearch, sort, showPinnedSection]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    const requestId = feedRequestIdRef.current;
    setIsLoadingMore(true);

    try {
      const nextResult = await getForumTopicsFeed({
        category: selectedCategory,
        search: debouncedSearch || undefined,
        sort,
        pinnedMode: showPinnedSection ? 'unpinned' : 'all',
        limit: TOPICS_PAGE_SIZE,
        offset: topics.length,
      });

      if (requestId !== feedRequestIdRef.current) return;
      setTopics((prev) => dedupeById([...prev, ...nextResult.topics]));
      setHasMore(nextResult.hasMore);
    } catch (error) {
      console.error('Daha fazla konu yüklenemedi:', error);
      toast.error('Konuların devamı yüklenemedi.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleOpenComposer = () => {
    if (!user) {
      toast.info('Yeni konu açmak için giriş yapmalısınız.');
      navigate('/auth');
      return;
    }
    setIsComposerOpen(true);
  };

  const handleTopicSaved = (savedTopic: ForumTopic) => {
    setTopics((prev) => dedupeById([savedTopic, ...prev]));
    loadCounts();
    navigate(`/community/topic/${savedTopic.id}`);
  };

  const handleToggleLike = async (topic: ForumTopic) => {
    if (!user) {
      toast.error('Beğenmek için giriş yapmalısınız.');
      return;
    }
    if (likingTopicIds[topic.id]) return;

    const currentlyLiked = topic.viewerHasLiked;
    const delta = currentlyLiked ? -1 : 1;

    setLikingTopicIds((prev) => ({ ...prev, [topic.id]: true }));
    setTopics((prev) =>
      prev.map((item) =>
        item.id === topic.id
          ? {
              ...item,
              viewerHasLiked: !currentlyLiked,
              likeCount: Math.max(0, item.likeCount + delta),
            }
          : item,
      ),
    );
    setPinnedTopics((prev) =>
      prev.map((item) =>
        item.id === topic.id
          ? {
              ...item,
              viewerHasLiked: !currentlyLiked,
              likeCount: Math.max(0, item.likeCount + delta),
            }
          : item,
      ),
    );

    try {
      await toggleForumTopicLike({
        topicId: topic.id,
        userId: user.id,
        currentlyLiked,
        topicAuthorId: topic.userId,
        topicTitle: topic.title,
        actorUsername: user.username,
      });
    } catch (error) {
      console.error('Konu beğeni hatası:', error);
      setTopics((prev) =>
        prev.map((item) =>
          item.id === topic.id
            ? {
                ...item,
                viewerHasLiked: currentlyLiked,
                likeCount: Math.max(0, item.likeCount - delta),
              }
            : item,
        ),
      );
      setPinnedTopics((prev) =>
        prev.map((item) =>
          item.id === topic.id
            ? {
                ...item,
                viewerHasLiked: currentlyLiked,
                likeCount: Math.max(0, item.likeCount - delta),
              }
            : item,
        ),
      );
      toast.error('Beğeni işlemi tamamlanamadı.');
    } finally {
      setLikingTopicIds((prev) => {
        const next = { ...prev };
        delete next[topic.id];
        return next;
      });
    }
  };

  const visiblePinnedTopics = useMemo(() => {
    if (showAllPinned) return pinnedTopics;
    return pinnedTopics.slice(0, INITIAL_PINNED_VISIBLE);
  }, [pinnedTopics, showAllPinned]);

  const hiddenPinnedCount = Math.max(0, pinnedTopics.length - INITIAL_PINNED_VISIBLE);

  const handleSelectCategory = (categoryId: ForumCategoryId | null) => {
    setSelectedCategory(categoryId);
    setShowAllPinned(false);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 min-w-0">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 shrink-0 gap-4">
        <Button
          type="button"
          onClick={handleOpenComposer}
          className="w-full h-10 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold gap-2 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Yeni konu
        </Button>

        <nav
          aria-label="Forum kategorileri"
          className="rounded-xl border border-border/60 bg-card/50 p-2 space-y-0.5"
        >
          <button
            type="button"
            onClick={() => handleSelectCategory(null)}
            className={cn(
              'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left',
              selectedCategory === null
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            <span className="truncate">Tüm başlıklar</span>
            <span className="text-xs tabular-nums opacity-80 shrink-0">{totalCount}</span>
          </button>

          {FORUM_CATEGORIES.map((category) => {
            const active = selectedCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => handleSelectCategory(category.id)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                  active
                    ? 'bg-primary/15 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Hash className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{category.label}</span>
                </span>
                <span className="text-xs tabular-nums opacity-80 shrink-0">
                  {categoryCounts[category.id] ?? 0}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Header & Sort */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Forum</h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              onClick={handleOpenComposer}
              className="lg:hidden h-9 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold gap-1.5 px-3"
            >
              <Plus className="h-4 w-4" />
              Yeni konu
            </Button>

            <Select value={sort} onValueChange={(value) => setSort(value as ForumSortOption)}>
              <SelectTrigger className="w-[165px] h-9 bg-card/60" aria-label="Konuları sırala">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Mobile Category Bar */}
        <div className="flex flex-wrap gap-1.5 lg:hidden">
          <button
            type="button"
            onClick={() => handleSelectCategory(null)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              selectedCategory === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card/60 text-muted-foreground border-border/60 hover:text-foreground',
            )}
          >
            <span>Tümü</span>
            <span className="opacity-75 tabular-nums">{totalCount}</span>
          </button>
          {FORUM_CATEGORIES.map((category) => {
            const active = selectedCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => handleSelectCategory(category.id)}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card/60 text-muted-foreground border-border/60 hover:text-foreground',
                )}
              >
                <Hash className="h-3 w-3 opacity-75" />
                <span>{category.label}</span>
                <span className="opacity-75 tabular-nums">{categoryCounts[category.id] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Konu ve yorum ara..."
            aria-label="Konu ve yorum ara"
            className="pl-9 pr-9 h-10 bg-card/60"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label="Aramayı temizle"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Collapsible Pinned Topics Card */}
        {!isLoading && showPinnedSection && pinnedTopics.length > 0 && (
          <section
            aria-label="Sabit konular"
            className="rounded-xl border border-border/70 bg-card/60 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-muted/25">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Pin className="h-3.5 w-3.5 text-primary" />
                <span>Sabit konular</span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {pinnedTopics.length}
              </span>
            </div>

            <div className="divide-y divide-border/50">
              {visiblePinnedTopics.map((topic) => (
                <Link
                  key={topic.id}
                  to={`/community/topic/${topic.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/35 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {topic.isLocked && (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                      {topic.title}
                    </span>
                    {topic.mangaTitle && (
                      <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0 max-w-[180px] truncate">
                        <BookOpen className="h-3 w-3 shrink-0" />
                        <span className="truncate">{topic.mangaTitle}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {topic.replyCount}
                    </span>
                    <ChevronRight className="h-4 w-4 opacity-60 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </Link>
              ))}
            </div>

            {hiddenPinnedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllPinned((prev) => !prev)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-primary hover:bg-muted/35 border-t border-border/50 transition-colors"
              >
                {showAllPinned ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    <span>Daha az göster</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    <span>+{hiddenPinnedCount} sabit konu daha</span>
                  </>
                )}
              </button>
            )}
          </section>
        )}

        {/* Topics Stream */}
        {isLoading ? (
          <div className="rounded-xl border border-border/60 bg-card/40 divide-y divide-border/50">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-3.5 w-32" />
                </div>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <div className="flex items-center gap-4 pt-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/40 p-10 text-center space-y-3">
            <MessageSquare className="h-9 w-9 mx-auto text-muted-foreground/60" />
            <div className="space-y-1">
              <p className="text-base font-semibold">Konu bulunamadı</p>
              <p className="text-sm text-muted-foreground">
                {debouncedSearch
                  ? 'Aramanıza uygun forum konusu bulunamadı.'
                  : 'Bu kategoride henüz açılmış bir konu yok.'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              {(selectedCategory !== null || debouncedSearch) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCategory(null);
                    setSearchInput('');
                  }}
                >
                  Filtreleri Temizle
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleOpenComposer}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold gap-1.5"
              >
                <Plus className="h-4 w-4" />
                İlk Konuyu Aç
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-card/40 divide-y divide-border/50">
            {topics.map((topic) => {
              const categoryMeta = FORUM_CATEGORY_MAP[topic.category];
              const createdLabel = formatRelativeTime(topic.createdAt);
              const lastActivityLabel = formatRelativeTime(topic.lastPostAt || topic.createdAt);

              return (
                <article
                  key={topic.id}
                  className="p-4 sm:px-5 hover:bg-muted/20 transition-colors min-w-0"
                >
                  {/* Author + Time + Status */}
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Link
                        to={`/profile/${topic.userId}`}
                        className="flex items-center gap-2 min-w-0 hover:opacity-90"
                      >
                        <Avatar className="h-6 w-6 shrink-0 border border-border/60">
                          <AvatarImage src={topic.authorAvatar || undefined} alt={topic.authorUsername} />
                          <AvatarFallback className="text-[10px]">
                            {getInitials(topic.authorUsername)}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className={cn(
                            'font-medium truncate max-w-[160px] sm:max-w-[220px]',
                            getStaffTextClassName(topic.authorRole),
                          )}
                        >
                          {topic.authorUsername}
                        </span>
                      </Link>
                      <StaffBadge role={topic.authorRole} compact />
                      {createdLabel && <span className="shrink-0">· {createdLabel}</span>}
                    </div>

                    {(topic.isPinned || topic.isLocked) && (
                      <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
                        {topic.isPinned && (
                          <span title="Sabit konu">
                            <Pin className="h-3.5 w-3.5 text-primary" />
                          </span>
                        )}
                        {topic.isLocked && (
                          <span title="Kilitli konu">
                            <Lock className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Title + Optional Manga/Chapter Link */}
                  <div className="mt-2 space-y-1.5 min-w-0">
                    <Link
                      to={`/community/topic/${topic.id}`}
                      className="block text-base sm:text-[17px] font-semibold text-foreground hover:text-primary transition-colors break-words leading-snug"
                    >
                      {topic.title}
                    </Link>

                    {topic.mangaTitle && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                        <span className="truncate font-medium text-foreground/85">
                          {topic.mangaTitle}
                        </span>
                        {typeof topic.chapterNumber === 'number' && (
                          <span className="shrink-0 text-muted-foreground">
                            · Bölüm {topic.chapterNumber}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Preview (never leak spoiler raw text) */}
                    {topic.isSpoiler ? (
                      <Link
                        to={`/community/topic/${topic.id}`}
                        className="inline-flex items-center gap-1.5 text-sm text-amber-500/90 hover:text-amber-400 transition-colors"
                      >
                        <EyeOff className="h-3.5 w-3.5 shrink-0" />
                        <span>Spoiler içerikli konu — görüntülemek için aç</span>
                      </Link>
                    ) : (
                      (() => {
                        const preview = stripForumMediaForPreview(topic.content);
                        return (
                          <div className="space-y-1">
                            {preview.text && (
                              <p className="text-sm text-muted-foreground line-clamp-2 break-words">
                                {preview.text}
                              </p>
                            )}
                            {preview.mediaCount > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/85">
                                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                                <span>{preview.mediaCount} görsel</span>
                              </span>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>

                  {/* Footer Bar */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleSelectCategory(topic.category)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 hover:bg-muted text-foreground/85 hover:text-primary transition-colors font-medium"
                      >
                        <Hash className="h-3 w-3 opacity-75" />
                        <span>{categoryMeta?.label || topic.category}</span>
                      </button>

                      <Link
                        to={`/community/topic/${topic.id}`}
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors tabular-nums"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>{topic.replyCount} yanıt</span>
                      </Link>

                      <button
                        type="button"
                        onClick={() => handleToggleLike(topic)}
                        disabled={Boolean(likingTopicIds[topic.id])}
                        className={cn(
                          'inline-flex items-center gap-1 transition-colors tabular-nums',
                          topic.viewerHasLiked
                            ? 'text-rose-500 font-medium'
                            : 'hover:text-rose-500',
                        )}
                      >
                        <Heart
                          className={cn(
                            'h-3.5 w-3.5',
                            topic.viewerHasLiked && 'fill-current',
                          )}
                        />
                        <span>{topic.likeCount}</span>
                      </button>
                    </div>

                    {lastActivityLabel && (
                      <span className="text-xs text-muted-foreground/85 shrink-0">
                        Son yanıt {lastActivityLabel}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {hasMore && !isLoading && (
          <div className="flex justify-center pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="gap-2"
            >
              {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>Daha fazla konu yükle</span>
            </Button>
          </div>
        )}
      </div>

      <ForumTopicComposerModal
        open={isComposerOpen}
        onOpenChange={setIsComposerOpen}
        defaultCategory={selectedCategory || 'genel-sohbet'}
        onSaved={handleTopicSaved}
      />
    </div>
  );
};

export default ForumTab;
