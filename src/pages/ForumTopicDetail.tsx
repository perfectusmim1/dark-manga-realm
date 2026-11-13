import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  ArrowLeft,
  BookOpen,
  CornerUpLeft,
  Edit3,
  EyeOff,
  Flag,
  Hash,
  Heart,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  Pin,
  PinOff,
  Send,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import {
  createForumPost,
  dedupeById,
  deleteForumPost,
  deleteForumTopic,
  extractMentionUsernames,
  FORUM_CATEGORY_MAP,
  ForumPost,
  ForumTopic,
  getForumTopicDetail,
  getForumTopicPosts,
  resolveUserIdsByUsernames,
  toggleForumPostLike,
  toggleForumTopicLike,
  updateForumPost,
  updateForumTopic,
} from '@/lib/forum';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';
import Header from '@/components/layout/Header';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import OptimizedImage from '@/components/media/OptimizedImage';
import StaffBadge from '@/components/user/StaffBadge';
import ForumRichContent from '@/components/community/ForumRichContent';
import ForumTopicComposerModal from '@/components/community/ForumTopicComposerModal';
import ForumReportDialog from '@/components/community/ForumReportDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const POSTS_PAGE_SIZE = 30;
const MAX_REPLY_LENGTH = 10000;

const getInitials = (name?: string | null): string => {
  const cleaned = (name || 'U').trim();
  return cleaned.slice(0, 2).toUpperCase();
};

const formatRelativeTime = (isoDate?: string | null): string => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDistanceToNow(parsed, { addSuffix: true, locale: tr });
};

const formatFullDate = (isoDate?: string | null): string => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return format(parsed, 'd MMMM yyyy HH:mm', { locale: tr });
};

const resolveMentionsInBatches = async (
  texts: string[],
  knownMap: Record<string, string>,
): Promise<Record<string, string>> => {
  const combinedMap: Record<string, string> = { ...knownMap };
  const allUsernames = Array.from(
    new Set(
      texts
        .flatMap((text) => extractMentionUsernames(text))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );

  const missing: string[] = [];
  for (const name of allUsernames) {
    if (!combinedMap[name.toLowerCase()]) {
      missing.push(name);
    }
  }

  for (let i = 0; i < missing.length; i += 8) {
    const batch = missing.slice(i, i + 8);
    const resolved = await resolveUserIdsByUsernames(batch, combinedMap);
    Object.assign(combinedMap, resolved);
  }

  return combinedMap;
};

const ForumTopicDetail: React.FC = () => {
  const { topicId } = useParams<{ topicId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const { access } = useAdminAccess({
    requireOnlineValidation: true,
    enabled: Boolean(user && isOnline),
  });

  const targetPostId = searchParams.get('postId') || '';
  const isStaff = Boolean(
    access.canAccessAdminPanel || user?.role === 'admin' || user?.role === 'moderator',
  );

  const [topic, setTopic] = useState<ForumTopic | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [mentionUserIdByUsername, setMentionUserIdByUsername] = useState<Record<string, string>>({});

  // Topic interactions & moderation
  const [isLikingTopic, setIsLikingTopic] = useState(false);
  const [isModActionLoading, setIsModActionLoading] = useState(false);
  const [isEditTopicOpen, setIsEditTopicOpen] = useState(false);
  const [isDeleteTopicDialogOpen, setIsDeleteTopicDialogOpen] = useState(false);
  const [isDeletingTopic, setIsDeletingTopic] = useState(false);

  // Reply composer
  const [replyContent, setReplyContent] = useState('');
  const [replyIsSpoiler, setReplyIsSpoiler] = useState(false);
  const [replyToPost, setReplyToPost] = useState<ForumPost | null>(null);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Post interactions & inline edit
  const [likingPostIds, setLikingPostIds] = useState<Record<string, boolean>>({});
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState('');
  const [editingPostSpoiler, setEditingPostSpoiler] = useState(false);
  const [isSavingPostEdit, setIsSavingPostEdit] = useState(false);
  const [deletePostTarget, setDeletePostTarget] = useState<ForumPost | null>(null);
  const [isDeletingPost, setIsDeletingPost] = useState(false);

  // Report dialog
  const [reportTarget, setReportTarget] = useState<{
    targetType: 'topic' | 'post';
    postId?: string;
    reportedUserId: string;
    reportedUsername?: string;
  } | null>(null);

  // Post highlight for ?postId=
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const hasScrolledToTargetRef = useRef(false);

  useDocumentTitle(topic ? topic.title : 'Forum Konusu');

  const knownUsersMap = useMemo(() => {
    const map: Record<string, string> = { ...mentionUserIdByUsername };
    if (topic?.authorUsername && topic.userId) {
      map[topic.authorUsername.toLowerCase()] = topic.userId;
    }
    if (topic?.lastPostUsername && topic.lastPostUserId) {
      map[topic.lastPostUsername.toLowerCase()] = topic.lastPostUserId;
    }
    for (const post of posts) {
      if (post.authorUsername && post.userId) {
        map[post.authorUsername.toLowerCase()] = post.userId;
      }
    }
    return map;
  }, [mentionUserIdByUsername, topic, posts]);

  const enrichMentions = useCallback(
    async (topicItem: ForumTopic | null, postList: ForumPost[]) => {
      if (!topicItem) return;
      const seedMap: Record<string, string> = {};
      if (topicItem.authorUsername && topicItem.userId) {
        seedMap[topicItem.authorUsername.toLowerCase()] = topicItem.userId;
      }
      if (topicItem.lastPostUsername && topicItem.lastPostUserId) {
        seedMap[topicItem.lastPostUsername.toLowerCase()] = topicItem.lastPostUserId;
      }
      for (const post of postList) {
        if (post.authorUsername && post.userId) {
          seedMap[post.authorUsername.toLowerCase()] = post.userId;
        }
      }

      const texts = [
        topicItem.content,
        ...postList.map((post) => post.content),
        ...postList.map((post) => post.parentContent || ''),
      ].filter(Boolean);

      const resolved = await resolveMentionsInBatches(texts, seedMap);
      setMentionUserIdByUsername((prev) => ({ ...prev, ...resolved }));
    },
    [],
  );

  const loadTopicAndPosts = useCallback(async () => {
    if (!topicId || !isOnline) return;
    setIsLoading(true);
    setNotFound(false);
    hasScrolledToTargetRef.current = false;

    try {
      const [detail, initialPosts] = await Promise.all([
        getForumTopicDetail(topicId),
        getForumTopicPosts(topicId, POSTS_PAGE_SIZE, 0),
      ]);

      if (!detail) {
        setTopic(null);
        setPosts([]);
        setHasMorePosts(false);
        setNotFound(true);
        return;
      }

      const dedupedPosts = dedupeById(initialPosts.posts);
      setTopic(detail);
      setPosts(dedupedPosts);
      setHasMorePosts(initialPosts.hasMore);
      void enrichMentions(detail, dedupedPosts);
    } catch (error) {
      console.error('Forum konu detayı yüklenemedi:', error);
      toast.error('Konu yüklenirken bir hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  }, [topicId, isOnline, enrichMentions]);

  useEffect(() => {
    loadTopicAndPosts();
  }, [loadTopicAndPosts]);

  // Smooth scroll and temporary highlight when ?postId= matches a loaded post
  useEffect(() => {
    if (!targetPostId || isLoading || hasScrolledToTargetRef.current) return;
    const match = posts.some((post) => post.id === targetPostId);
    if (!match) return;

    hasScrolledToTargetRef.current = true;
    const scrollTimer = window.setTimeout(() => {
      const element = document.getElementById(`post-${targetPostId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedPostId(targetPostId);
      }
    }, 80);

    const clearTimer = window.setTimeout(() => {
      setHighlightedPostId((current) => (current === targetPostId ? null : current));
    }, 3200);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [targetPostId, posts, isLoading]);

  const handleLoadMorePosts = async () => {
    if (!topicId || isLoadingMorePosts || !hasMorePosts) return;
    setIsLoadingMorePosts(true);

    try {
      const res = await getForumTopicPosts(topicId, POSTS_PAGE_SIZE, posts.length);
      const nextPosts = dedupeById([...posts, ...res.posts]);
      setPosts(nextPosts);
      setHasMorePosts(res.hasMore);
      if (topic) {
        void enrichMentions(topic, nextPosts);
      }
    } catch (error) {
      console.error('Yanıtlar yüklenemedi:', error);
      toast.error('Daha fazla yanıt yüklenemedi.');
    } finally {
      setIsLoadingMorePosts(false);
    }
  };

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Forum konularını görüntülemek ve yanıt yazmak için internete bağlanın."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  const canManageTopic = Boolean(topic && user && (user.id === topic.userId || isStaff));
  const categoryMeta = topic ? FORUM_CATEGORY_MAP[topic.category] : undefined;

  const handleToggleTopicLike = async () => {
    if (!topic) return;
    if (!user) {
      toast.error('Beğenmek için giriş yapmalısınız.');
      return;
    }
    if (isLikingTopic) return;

    const currentlyLiked = topic.viewerHasLiked;
    const delta = currentlyLiked ? -1 : 1;
    setIsLikingTopic(true);
    setTopic((prev) =>
      prev
        ? {
            ...prev,
            viewerHasLiked: !currentlyLiked,
            likeCount: Math.max(0, prev.likeCount + delta),
          }
        : prev,
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
      setTopic((prev) =>
        prev
          ? {
              ...prev,
              viewerHasLiked: currentlyLiked,
              likeCount: Math.max(0, prev.likeCount - delta),
            }
          : prev,
      );
      toast.error('Beğeni işlemi tamamlanamadı.');
    } finally {
      setIsLikingTopic(false);
    }
  };

  const handleShareTopic = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Konu bağlantısı kopyalandı.');
    } catch {
      toast.error('Bağlantı kopyalanamadı.');
    }
  };

  const handleTogglePin = async () => {
    if (!topic || !isStaff || isModActionLoading) return;
    const nextPinned = !topic.isPinned;
    setIsModActionLoading(true);

    try {
      await updateForumTopic(topic.id, { isPinned: nextPinned });
      setTopic((prev) => (prev ? { ...prev, isPinned: nextPinned } : prev));
      toast.success(nextPinned ? 'Konu sabitlendi.' : 'Konu sabitlemesi kaldırıldı.');
    } catch (error) {
      console.error('Sabitleme hatası:', error);
      toast.error('Sabitleme durumu güncellenemedi.');
    } finally {
      setIsModActionLoading(false);
    }
  };

  const handleToggleLock = async () => {
    if (!topic || !isStaff || isModActionLoading) return;
    const nextLocked = !topic.isLocked;
    setIsModActionLoading(true);

    try {
      await updateForumTopic(topic.id, { isLocked: nextLocked });
      setTopic((prev) => (prev ? { ...prev, isLocked: nextLocked } : prev));
      toast.success(nextLocked ? 'Konu kilitlendi.' : 'Konunun kilidi açıldı.');
    } catch (error) {
      console.error('Kilitleme hatası:', error);
      toast.error('Kilit durumu güncellenemedi.');
    } finally {
      setIsModActionLoading(false);
    }
  };

  const handleDeleteTopicConfirm = async () => {
    if (!topic || isDeletingTopic) return;
    setIsDeletingTopic(true);

    try {
      await deleteForumTopic(topic.id);
      toast.success('Konu silindi.');
      navigate('/community?tab=forum', { replace: true });
    } catch (error) {
      console.error('Konu silme hatası:', error);
      toast.error('Konu silinemedi.');
      setIsDeletingTopic(false);
    }
  };

  const handleSubmitReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!topic) return;

    if (!user) {
      toast.error('Yanıt yazmak için giriş yapmalısınız.');
      return;
    }

    if (topic.isLocked) {
      toast.error('Bu konu kilitli olduğu için yanıt yazılamaz.');
      return;
    }

    const trimmed = replyContent.trim();
    if (!trimmed) {
      toast.error('Yanıt içeriği boş olamaz.');
      return;
    }
    if (trimmed.length > MAX_REPLY_LENGTH) {
      toast.error(`Yanıt en fazla ${MAX_REPLY_LENGTH.toLocaleString('tr-TR')} karakter olabilir.`);
      return;
    }

    setIsSubmittingReply(true);

    try {
      const created = await createForumPost({
        topicId: topic.id,
        topicTitle: topic.title,
        topicAuthorId: topic.userId,
        userId: user.id,
        actorUsername: user.username || 'Kullanıcı',
        parentPostId: replyToPost?.id || null,
        parentAuthorId: replyToPost?.userId || null,
        content: trimmed,
        isSpoiler: replyIsSpoiler,
        knownUserMap: knownUsersMap,
      });

      setReplyContent('');
      setReplyIsSpoiler(false);
      setReplyToPost(null);
      setTopic((prev) => (prev ? { ...prev, replyCount: prev.replyCount + 1 } : prev));

      if (!hasMorePosts) {
        const res = await getForumTopicPosts(topic.id, POSTS_PAGE_SIZE, posts.length);
        const merged = dedupeById([...posts, ...res.posts]);
        setPosts(merged);
        setHasMorePosts(res.hasMore);
        void enrichMentions(topic, merged);

        window.setTimeout(() => {
          document
            .getElementById(`post-${created.id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedPostId(created.id);
          window.setTimeout(() => {
            setHighlightedPostId((curr) => (curr === created.id ? null : curr));
          }, 2800);
        }, 100);
      }

      toast.success('Yanıtınız gönderildi.');
    } catch (error) {
      console.error('Yanıt gönderme hatası:', error);
      toast.error('Yanıt gönderilemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleQuotePost = (post: ForumPost) => {
    if (topic?.isLocked) return;
    setReplyToPost(post);
    replyTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      replyTextareaRef.current?.focus();
    }, 200);
  };

  const handleTogglePostLike = async (post: ForumPost) => {
    if (!topic) return;
    if (!user) {
      toast.error('Beğenmek için giriş yapmalısınız.');
      return;
    }
    if (likingPostIds[post.id]) return;

    const currentlyLiked = post.viewerHasLiked;
    const delta = currentlyLiked ? -1 : 1;

    setLikingPostIds((prev) => ({ ...prev, [post.id]: true }));
    setPosts((prev) =>
      prev.map((item) =>
        item.id === post.id
          ? {
              ...item,
              viewerHasLiked: !currentlyLiked,
              likeCount: Math.max(0, item.likeCount + delta),
            }
          : item,
      ),
    );

    try {
      await toggleForumPostLike({
        postId: post.id,
        topicId: topic.id,
        userId: user.id,
        currentlyLiked,
        postAuthorId: post.userId,
        topicTitle: topic.title,
        actorUsername: user.username,
      });
    } catch (error) {
      console.error('Yanıt beğeni hatası:', error);
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id
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
      setLikingPostIds((prev) => {
        const next = { ...prev };
        delete next[post.id];
        return next;
      });
    }
  };

  const handleStartEditPost = (post: ForumPost) => {
    setEditingPostId(post.id);
    setEditingPostContent(post.content);
    setEditingPostSpoiler(post.isSpoiler);
  };

  const handleSaveEditPost = async (post: ForumPost) => {
    const trimmed = editingPostContent.trim();
    if (!trimmed) {
      toast.error('Yanıt içeriği boş olamaz.');
      return;
    }
    if (trimmed.length > MAX_REPLY_LENGTH) {
      toast.error(`Yanıt en fazla ${MAX_REPLY_LENGTH.toLocaleString('tr-TR')} karakter olabilir.`);
      return;
    }

    setIsSavingPostEdit(true);
    try {
      await updateForumPost(post.id, {
        content: trimmed,
        isSpoiler: editingPostSpoiler,
      });

      const updatedPosts = posts.map((item) =>
        item.id === post.id
          ? {
              ...item,
              content: trimmed,
              isSpoiler: editingPostSpoiler,
              updatedAt: new Date().toISOString(),
            }
          : item,
      );
      setPosts(updatedPosts);
      setEditingPostId(null);
      if (topic) {
        void enrichMentions(topic, updatedPosts);
      }
      toast.success('Yanıt güncellendi.');
    } catch (error) {
      console.error('Yanıt güncelleme hatası:', error);
      toast.error('Yanıt güncellenemedi.');
    } finally {
      setIsSavingPostEdit(false);
    }
  };

  const handleDeletePostConfirm = async () => {
    if (!deletePostTarget || isDeletingPost) return;
    setIsDeletingPost(true);

    try {
      await deleteForumPost(deletePostTarget.id);
      setPosts((prev) => prev.filter((item) => item.id !== deletePostTarget.id));
      setTopic((prev) =>
        prev ? { ...prev, replyCount: Math.max(0, prev.replyCount - 1) } : prev,
      );
      if (replyToPost?.id === deletePostTarget.id) {
        setReplyToPost(null);
      }
      setDeletePostTarget(null);
      toast.success('Yanıt silindi.');
    } catch (error) {
      console.error('Yanıt silme hatası:', error);
      toast.error('Yanıt silinemedi.');
    } finally {
      setIsDeletingPost(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-4xl mx-auto px-4 pt-24 pb-16 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/community?tab=forum"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Topluluğa dön</span>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-card/50 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-28 w-full" />
            </div>
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : notFound || !topic ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-10 text-center space-y-3">
            <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/60" />
            <h1 className="text-xl font-bold">Konu bulunamadı</h1>
            <p className="text-sm text-muted-foreground">
              Aradığınız konu silinmiş olabilir veya mevcut değil.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/community?tab=forum">Foruma Dön</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Topic Main Card */}
            <article className="rounded-xl border border-border/70 bg-card/60 p-5 sm:p-6 space-y-5 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Link to={`/profile/${topic.userId}`} className="shrink-0">
                    <Avatar className="h-10 w-10 border border-border/60">
                      <AvatarImage src={topic.authorAvatar || undefined} alt={topic.authorUsername} />
                      <AvatarFallback>{getInitials(topic.authorUsername)}</AvatarFallback>
                    </Avatar>
                  </Link>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link
                        to={`/profile/${topic.userId}`}
                        className={cn(
                          'text-sm font-semibold hover:underline truncate max-w-[200px]',
                          getStaffTextClassName(topic.authorRole),
                        )}
                      >
                        {topic.authorUsername}
                      </Link>
                      <StaffBadge role={topic.authorRole} compact />
                      {topic.isPinned && (
                        <span title="Sabit konu" className="inline-flex">
                          <Pin className="h-3.5 w-3.5 text-primary shrink-0" />
                        </span>
                      )}
                      {topic.isLocked && (
                        <span title="Kilitli konu" className="inline-flex">
                          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span title={formatFullDate(topic.createdAt)}>
                        {formatRelativeTime(topic.createdAt)}
                      </span>
                      <span>·</span>
                      <Link
                        to={`/community?tab=forum&category=${topic.category}`}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors font-medium"
                      >
                        <Hash className="h-3 w-3" />
                        <span>{categoryMeta?.label || topic.category}</span>
                      </Link>
                    </div>
                  </div>
                </div>

                {user && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label="Konu seçenekleri"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {canManageTopic && (
                        <>
                          <DropdownMenuItem onClick={() => setIsEditTopicOpen(true)}>
                            <Edit3 className="h-4 w-4 mr-2" />
                            Düzenle
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setIsDeleteTopicDialogOpen(true)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Sil
                          </DropdownMenuItem>
                        </>
                      )}

                      {isStaff && (
                        <>
                          {canManageTopic && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            onClick={handleTogglePin}
                            disabled={isModActionLoading}
                          >
                            {topic.isPinned ? (
                              <>
                                <PinOff className="h-4 w-4 mr-2" />
                                Sabitlemeyi Kaldır
                              </>
                            ) : (
                              <>
                                <Pin className="h-4 w-4 mr-2" />
                                Konuyu Sabitle
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={handleToggleLock}
                            disabled={isModActionLoading}
                          >
                            {topic.isLocked ? (
                              <>
                                <LockOpen className="h-4 w-4 mr-2" />
                                Kilidi Aç
                              </>
                            ) : (
                              <>
                                <Lock className="h-4 w-4 mr-2" />
                                Konuyu Kilitle
                              </>
                            )}
                          </DropdownMenuItem>
                        </>
                      )}

                      {user.id !== topic.userId && (
                        <>
                          {(canManageTopic || isStaff) && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            onClick={() =>
                              setReportTarget({
                                targetType: 'topic',
                                reportedUserId: topic.userId,
                                reportedUsername: topic.authorUsername,
                              })
                            }
                          >
                            <Flag className="h-4 w-4 mr-2" />
                            Bildir
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl font-bold tracking-tight break-words">
                {topic.title}
              </h1>

              {/* Linked Manga / Chapter Card */}
              {topic.mangaId && topic.mangaTitle && (
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3 min-w-0">
                  {topic.mangaCover && (
                    <Link to={`/manga/${topic.mangaId}`} className="shrink-0">
                      <OptimizedImage
                        src={topic.mangaCover}
                        alt={topic.mangaTitle}
                        transform={{ width: 96, quality: 80 }}
                        containerClassName="h-14 w-10 rounded overflow-hidden shrink-0 border border-border/50"
                        className="h-full w-full object-cover"
                      />
                    </Link>
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>Bağlı Seri</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <Link
                        to={`/manga/${topic.mangaId}`}
                        className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate"
                      >
                        {topic.mangaTitle}
                      </Link>
                      {topic.chapterId && typeof topic.chapterNumber === 'number' && (
                        <Link
                          to={`/manga/${topic.mangaId}/chapter/${topic.chapterId}`}
                          className="text-xs font-medium text-primary hover:underline shrink-0"
                        >
                          Bölüm {topic.chapterNumber}
                          {topic.chapterTitle ? ` — ${topic.chapterTitle}` : ''}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <ForumRichContent
                content={topic.content}
                isSpoiler={topic.isSpoiler}
                mentionUserIdByUsername={knownUsersMap}
              />

              <div className="pt-3 border-t border-border/50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={topic.viewerHasLiked ? 'default' : 'outline'}
                    size="sm"
                    onClick={handleToggleTopicLike}
                    disabled={isLikingTopic}
                    className={cn(
                      'gap-1.5 h-8',
                      topic.viewerHasLiked &&
                        'bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 border-rose-500/30',
                    )}
                  >
                    <Heart
                      className={cn('h-4 w-4', topic.viewerHasLiked && 'fill-current')}
                    />
                    <span className="tabular-nums">{topic.likeCount}</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleShareTopic}
                    className="gap-1.5 h-8"
                  >
                    <Share2 className="h-4 w-4" />
                    <span>Paylaş</span>
                  </Button>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  <MessageSquare className="h-4 w-4" />
                  <span>{topic.replyCount} yanıt</span>
                </div>
              </div>
            </article>

            {/* Reply Composer */}
            <section
              aria-label="Yanıt yaz"
              className="rounded-xl border border-border/60 bg-card/50 p-4 sm:p-5 space-y-3"
            >
              {topic.isLocked ? (
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground py-1">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>Bu konu kilitli olduğu için yeni yanıt eklenemiyor.</span>
                </div>
              ) : !user ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Bu konuya yanıt yazmak için hesabınıza giriş yapın.
                  </p>
                  <Button asChild size="sm" className="shrink-0">
                    <Link to="/auth">Giriş Yap</Link>
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmitReply} className="space-y-3">
                  {replyToPost && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <CornerUpLeft className="h-3.5 w-3.5 text-primary shrink-0" />
                        <div className="min-w-0">
                          <span className="font-semibold text-foreground">
                            @{replyToPost.authorUsername}
                          </span>{' '}
                          <span className="text-muted-foreground">yanıtına cevap: </span>
                          <span className="text-muted-foreground truncate">
                            {replyToPost.isSpoiler
                              ? 'Spoiler içerikli yanıt'
                              : replyToPost.content.slice(0, 90)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyToPost(null)}
                        aria-label="Alıntıyı iptal et"
                        className="p-1 text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  <Textarea
                    ref={replyTextareaRef}
                    value={replyContent}
                    onChange={(event) => setReplyContent(event.target.value)}
                    placeholder="Yanıtınızı yazın... (@kullanici ile bahsedebilirsiniz)"
                    rows={3}
                    maxLength={MAX_REPLY_LENGTH}
                    disabled={isSubmittingReply}
                    className="resize-y min-h-[96px]"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Switch
                        id="reply-spoiler-switch"
                        checked={replyIsSpoiler}
                        onCheckedChange={setReplyIsSpoiler}
                        disabled={isSubmittingReply}
                      />
                      <Label htmlFor="reply-spoiler-switch" className="text-sm cursor-pointer">
                        Spoiler içerir
                      </Label>
                    </div>

                    <div className="flex items-center gap-3 ml-auto">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {replyContent.length.toLocaleString('tr-TR')} /{' '}
                        {MAX_REPLY_LENGTH.toLocaleString('tr-TR')}
                      </span>
                      <Button
                        type="submit"
                        disabled={isSubmittingReply || !replyContent.trim()}
                        className="gap-1.5"
                      >
                        {isSubmittingReply ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        <span>Yanıt Gönder</span>
                      </Button>
                    </div>
                  </div>
                </form>
              )}
            </section>

            {/* Posts List */}
            <section aria-label="Yanıtlar" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Yanıtlar ({topic.replyCount})</h2>
              </div>

              {posts.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
                  Henüz yanıt yazılmamış. İlk yanıtı sen paylaşabilirsin.
                </div>
              ) : (
                <div className="space-y-3">
                  {posts.map((post) => {
                    const canManagePost = Boolean(user && (user.id === post.userId || isStaff));
                    const isEditing = editingPostId === post.id;
                    const isHighlighted = highlightedPostId === post.id;

                    return (
                      <article
                        key={post.id}
                        id={`post-${post.id}`}
                        className={cn(
                          'rounded-xl border bg-card/50 p-4 sm:p-5 space-y-3 transition-colors min-w-0',
                          isHighlighted
                            ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                            : 'border-border/60',
                        )}
                      >
                        {/* Post Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Link to={`/profile/${post.userId}`} className="shrink-0">
                              <Avatar className="h-8 w-8 border border-border/60">
                                <AvatarImage
                                  src={post.authorAvatar || undefined}
                                  alt={post.authorUsername}
                                />
                                <AvatarFallback className="text-xs">
                                  {getInitials(post.authorUsername)}
                                </AvatarFallback>
                              </Avatar>
                            </Link>
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0 text-xs">
                              <Link
                                to={`/profile/${post.userId}`}
                                className={cn(
                                  'font-semibold hover:underline truncate max-w-[180px]',
                                  getStaffTextClassName(post.authorRole),
                                )}
                              >
                                {post.authorUsername}
                              </Link>
                              <StaffBadge role={post.authorRole} compact />
                              <span
                                className="text-muted-foreground shrink-0"
                                title={formatFullDate(post.createdAt)}
                              >
                                · {formatRelativeTime(post.createdAt)}
                              </span>
                            </div>
                          </div>

                          {user && (canManagePost || user.id !== post.userId) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  aria-label="Yanıt seçenekleri"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                {canManagePost && (
                                  <>
                                    <DropdownMenuItem onClick={() => handleStartEditPost(post)}>
                                      <Edit3 className="h-4 w-4 mr-2" />
                                      Düzenle
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => setDeletePostTarget(post)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Sil
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {user.id !== post.userId && (
                                  <>
                                    {canManagePost && <DropdownMenuSeparator />}
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setReportTarget({
                                          targetType: 'post',
                                          postId: post.id,
                                          reportedUserId: post.userId,
                                          reportedUsername: post.authorUsername,
                                        })
                                      }
                                    >
                                      <Flag className="h-4 w-4 mr-2" />
                                      Bildir
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>

                        {/* Quoted Parent Box */}
                        {post.parentPostId && (
                          <div className="rounded-lg border-l-2 border-primary/60 bg-muted/35 px-3 py-2 text-xs space-y-1">
                            <span className="font-semibold text-foreground/90">
                              @{post.parentAuthorUsername || 'Kullanıcı'}
                            </span>
                            {post.parentIsSpoiler ? (
                              <p className="flex items-center gap-1.5 text-amber-500/90">
                                <EyeOff className="h-3.5 w-3.5 shrink-0" />
                                <span>Spoiler içerikli yanıt</span>
                              </p>
                            ) : (
                              <p className="text-muted-foreground line-clamp-2 break-words">
                                {post.parentContent || 'Yanıt silinmiş.'}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Post Content or Inline Editor */}
                        {isEditing ? (
                          <div className="space-y-3 pt-1">
                            <Textarea
                              value={editingPostContent}
                              onChange={(event) => setEditingPostContent(event.target.value)}
                              rows={3}
                              maxLength={MAX_REPLY_LENGTH}
                              disabled={isSavingPostEdit}
                            />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <Switch
                                  id={`edit-post-spoiler-${post.id}`}
                                  checked={editingPostSpoiler}
                                  onCheckedChange={setEditingPostSpoiler}
                                  disabled={isSavingPostEdit}
                                />
                                <Label
                                  htmlFor={`edit-post-spoiler-${post.id}`}
                                  className="text-xs cursor-pointer"
                                >
                                  Spoiler içerir
                                </Label>
                              </div>
                              <div className="flex items-center gap-2 ml-auto">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEditingPostId(null)}
                                  disabled={isSavingPostEdit}
                                >
                                  İptal
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleSaveEditPost(post)}
                                  disabled={isSavingPostEdit || !editingPostContent.trim()}
                                  className="gap-1.5"
                                >
                                  {isSavingPostEdit && (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  )}
                                  <span>Kaydet</span>
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <ForumRichContent
                            content={post.content}
                            isSpoiler={post.isSpoiler}
                            mentionUserIdByUsername={knownUsersMap}
                          />
                        )}

                        {/* Post Footer */}
                        <div className="pt-1 flex items-center gap-4 text-xs text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => handleTogglePostLike(post)}
                            disabled={Boolean(likingPostIds[post.id])}
                            className={cn(
                              'inline-flex items-center gap-1 transition-colors tabular-nums',
                              post.viewerHasLiked
                                ? 'text-rose-500 font-medium'
                                : 'hover:text-rose-500',
                            )}
                          >
                            <Heart
                              className={cn('h-3.5 w-3.5', post.viewerHasLiked && 'fill-current')}
                            />
                            <span>{post.likeCount}</span>
                          </button>

                          {user && !topic.isLocked && (
                            <button
                              type="button"
                              onClick={() => handleQuotePost(post)}
                              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              <CornerUpLeft className="h-3.5 w-3.5" />
                              <span>Alıntıla</span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {hasMorePosts && (
                <div className="flex justify-center pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadMorePosts}
                    disabled={isLoadingMorePosts}
                    className="gap-2"
                  >
                    {isLoadingMorePosts && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>Daha fazla yanıt yükle</span>
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Edit Topic Modal */}
      {topic && (
        <ForumTopicComposerModal
          open={isEditTopicOpen}
          onOpenChange={setIsEditTopicOpen}
          editTopic={topic}
          onSaved={(updatedTopic) => {
            setTopic(updatedTopic);
            void enrichMentions(updatedTopic, posts);
          }}
        />
      )}

      {/* Report Dialog */}
      {topic && reportTarget && (
        <ForumReportDialog
          open={Boolean(reportTarget)}
          onOpenChange={(open) => {
            if (!open) setReportTarget(null);
          }}
          targetType={reportTarget.targetType}
          topicId={topic.id}
          postId={reportTarget.postId}
          reportedUserId={reportTarget.reportedUserId}
          reportedUsername={reportTarget.reportedUsername}
        />
      )}

      {/* Delete Topic AlertDialog */}
      <AlertDialog
        open={isDeleteTopicDialogOpen}
        onOpenChange={(open) => {
          if (!isDeletingTopic) setIsDeleteTopicDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konuyu silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>
              Bu işlem geri alınamaz. Konu ve altındaki tüm yanıtlar kalıcı olarak silinir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingTopic}>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteTopicConfirm();
              }}
              disabled={isDeletingTopic}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingTopic && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Post AlertDialog */}
      <AlertDialog
        open={Boolean(deletePostTarget)}
        onOpenChange={(open) => {
          if (!open && !isDeletingPost) setDeletePostTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Yanıtı silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>
              Bu işlem geri alınamaz ve yanıt kalıcı olarak silinir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingPost}>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeletePostConfirm();
              }}
              disabled={isDeletingPost}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingPost && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ForumTopicDetail;
