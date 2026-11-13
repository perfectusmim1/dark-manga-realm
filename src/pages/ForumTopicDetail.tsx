import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  Edit3,
  Flag,
  Hash,
  Heart,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  MoreVertical,
  Pin,
  PinOff,
  Send,
  Share2,
  Trash2,
  UserX,
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
import {
  mergeForumTextAndMedia,
  splitForumTextAndMedia,
  validateForumMediaUrls,
} from '@/lib/forumMedia';
import { blockUser, getBlockedUserIds } from '@/lib/profile';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';
import Header from '@/components/layout/Header';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import OptimizedImage from '@/components/media/OptimizedImage';
import StaffBadge from '@/components/user/StaffBadge';
import ForumMediaAttachmentField from '@/components/community/ForumMediaAttachmentField';
import ForumReportDialog from '@/components/community/ForumReportDialog';
import ForumRichContent from '@/components/community/ForumRichContent';
import ForumTopicComposerModal from '@/components/community/ForumTopicComposerModal';
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

const POSTS_PAGE_SIZE = 60;
const MAX_REPLY_LENGTH = 10000;
const EDITED_THRESHOLD_MS = 2000;

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

const isEditedTimestamp = (createdAt?: string | null, updatedAt?: string | null): boolean => {
  if (!createdAt || !updatedAt) return false;
  const created = new Date(createdAt).getTime();
  const updated = new Date(updatedAt).getTime();
  return Number.isFinite(created) && Number.isFinite(updated) && updated - created > EDITED_THRESHOLD_MS;
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
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);

  const [mentionUserIdByUsername, setMentionUserIdByUsername] = useState<Record<string, string>>({});

  // Topic interactions & moderation
  const [isLikingTopic, setIsLikingTopic] = useState(false);
  const [isModActionLoading, setIsModActionLoading] = useState(false);
  const [isEditTopicOpen, setIsEditTopicOpen] = useState(false);
  const [isDeleteTopicDialogOpen, setIsDeleteTopicDialogOpen] = useState(false);
  const [isDeletingTopic, setIsDeletingTopic] = useState(false);

  // Top-level comment composer
  const [replyContent, setReplyContent] = useState('');
  const [replyMediaUrls, setReplyMediaUrls] = useState<string[]>([]);
  const [replyIsSpoiler, setReplyIsSpoiler] = useState(false);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  // Inline reply composer beneath a specific comment/reply
  const [inlineReplyTarget, setInlineReplyTarget] = useState<ForumPost | null>(null);
  const [inlineReplyContent, setInlineReplyContent] = useState('');
  const [inlineReplyMediaUrls, setInlineReplyMediaUrls] = useState<string[]>([]);
  const [inlineReplySpoiler, setInlineReplySpoiler] = useState(false);
  const [isSubmittingInlineReply, setIsSubmittingInlineReply] = useState(false);

  // Thread expand state (collapsed by default)
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

  // Post interactions & inline edit
  const [likingPostIds, setLikingPostIds] = useState<Record<string, boolean>>({});
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState('');
  const [editingPostMediaUrls, setEditingPostMediaUrls] = useState<string[]>([]);
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

  // Load viewer's blocked user IDs
  useEffect(() => {
    if (!user?.id) {
      setBlockedUserIds([]);
      return;
    }

    let cancelled = false;
    getBlockedUserIds(user.id).then(({ ids }) => {
      if (!cancelled) {
        setBlockedUserIds(ids || []);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const blockedUserSet = useMemo(() => new Set(blockedUserIds), [blockedUserIds]);

  const visiblePosts = useMemo(
    () => posts.filter((post) => !blockedUserSet.has(post.userId)),
    [posts, blockedUserSet],
  );

  // Group into root comments & flat chronological replies under each root comment
  const { rootPosts, repliesByRootId, rootIdByPostId } = useMemo(() => {
    const postById = new Map(visiblePosts.map((post) => [post.id, post]));
    const resolvedRootMap = new Map<string, string>();

    const resolveRootId = (post: ForumPost): string => {
      const cached = resolvedRootMap.get(post.id);
      if (cached) return cached;

      const visited = new Set<string>([post.id]);
      let current = post;

      while (current.parentPostId) {
        if (visited.has(current.parentPostId)) {
          break;
        }
        const parent = postById.get(current.parentPostId);
        if (!parent) {
          // If the direct parent isn't visible/loaded yet, attach at root level or treat cleanly
          break;
        }
        visited.add(parent.id);
        current = parent;
      }

      const rootId = current.parentPostId && !postById.has(current.parentPostId)
        ? post.id
        : current.id;
      resolvedRootMap.set(post.id, rootId);
      return rootId;
    };

    const roots: ForumPost[] = [];
    const groupedReplies: Record<string, ForumPost[]> = {};

    for (const post of visiblePosts) {
      const rootId = resolveRootId(post);
      if (rootId === post.id) {
        roots.push(post);
      } else {
        if (!groupedReplies[rootId]) {
          groupedReplies[rootId] = [];
        }
        groupedReplies[rootId].push(post);
      }
    }

    return {
      rootPosts: roots,
      repliesByRootId: groupedReplies,
      rootIdByPostId: resolvedRootMap,
    };
  }, [visiblePosts]);

  const knownUsersMap = useMemo(() => {
    const map: Record<string, string> = { ...mentionUserIdByUsername };
    if (topic?.authorUsername && topic.userId) {
      map[topic.authorUsername.toLowerCase()] = topic.userId;
    }
    if (topic?.lastPostUsername && topic.lastPostUserId) {
      map[topic.lastPostUsername.toLowerCase()] = topic.lastPostUserId;
    }
    for (const post of visiblePosts) {
      if (post.authorUsername && post.userId) {
        map[post.authorUsername.toLowerCase()] = post.userId;
      }
    }
    return map;
  }, [mentionUserIdByUsername, topic, visiblePosts]);

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

  // Smooth scroll and temporary highlight when ?postId= matches a loaded post (auto-expand parent thread if needed)
  useEffect(() => {
    if (!targetPostId || isLoading || hasScrolledToTargetRef.current) return;
    const match = visiblePosts.find((post) => post.id === targetPostId);
    if (!match) return;

    const rootId = rootIdByPostId.get(match.id) || match.id;
    if (rootId !== match.id) {
      setExpandedThreads((prev) => ({ ...prev, [rootId]: true }));
    }

    hasScrolledToTargetRef.current = true;
    const scrollTimer = window.setTimeout(() => {
      const element = document.getElementById(`post-${targetPostId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedPostId(targetPostId);
      }
    }, 120);

    const clearTimer = window.setTimeout(() => {
      setHighlightedPostId((current) => (current === targetPostId ? null : current));
    }, 3200);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [targetPostId, visiblePosts, rootIdByPostId, isLoading]);

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

  const handleBlockForumUser = async (targetUserId: string, targetUsername?: string) => {
    if (!user) {
      toast.error('Kullanıcı engellemek için giriş yapmalısınız.');
      return;
    }
    if (targetUserId === user.id) return;

    try {
      const { error } = await blockUser(user.id, targetUserId);
      if (error && (error as { code?: string })?.code !== '23505') {
        throw error;
      }

      setBlockedUserIds((prev) => Array.from(new Set([...prev, targetUserId])));
      if (topic?.userId === targetUserId) {
        toast.success(`${targetUsername || 'Kullanıcı'} engellendi.`);
        navigate('/community?tab=forum', { replace: true });
        return;
      }
      toast.success(`${targetUsername || 'Kullanıcı'} engellendi.`);
    } catch (error) {
      console.error('Forum kullanıcı engelleme hatası:', error);
      toast.error('Kullanıcı engellenemedi.');
    }
  };

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

  const refreshAfterPostCreate = async (createdPostId: string, rootThreadId?: string) => {
    if (!topic) return;
    setTopic((prev) => (prev ? { ...prev, replyCount: prev.replyCount + 1 } : prev));
    if (rootThreadId) {
      setExpandedThreads((prev) => ({ ...prev, [rootThreadId]: true }));
    }

    if (!hasMorePosts) {
      const res = await getForumTopicPosts(topic.id, POSTS_PAGE_SIZE, posts.length);
      const merged = dedupeById([...posts, ...res.posts]);
      setPosts(merged);
      setHasMorePosts(res.hasMore);
      void enrichMentions(topic, merged);

      window.setTimeout(() => {
        document
          .getElementById(`post-${createdPostId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedPostId(createdPostId);
        window.setTimeout(() => {
          setHighlightedPostId((curr) => (curr === createdPostId ? null : curr));
        }, 2800);
      }, 100);
    }
  };

  const handleSubmitRootComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!topic) return;

    if (!user) {
      toast.error('Yorum yazmak için giriş yapmalısınız.');
      return;
    }

    if (topic.isLocked) {
      toast.error('Bu konu kilitli olduğu için yorum yazılamaz.');
      return;
    }

    if (!validateForumMediaUrls(replyMediaUrls)) {
      toast.error('Lütfen geçerli görsel veya GIF bağlantıları (http:// veya https://) girin.');
      return;
    }

    const mergedContent = mergeForumTextAndMedia(replyContent, replyMediaUrls);
    if (!mergedContent) {
      toast.error('Yorum içeriği veya görseli boş olamaz.');
      return;
    }
    if (mergedContent.length > MAX_REPLY_LENGTH) {
      toast.error(`Yorum en fazla ${MAX_REPLY_LENGTH.toLocaleString('tr-TR')} karakter olabilir.`);
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
        parentPostId: null,
        parentAuthorId: null,
        content: mergedContent,
        isSpoiler: replyIsSpoiler,
        knownUserMap: knownUsersMap,
      });

      setReplyContent('');
      setReplyMediaUrls([]);
      setReplyIsSpoiler(false);
      await refreshAfterPostCreate(created.id);
      toast.success('Yorumunuz gönderildi.');
    } catch (error) {
      console.error('Yorum gönderme hatası:', error);
      toast.error('Yorum gönderilemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleOpenInlineReply = (target: ForumPost) => {
    if (!user) {
      toast.error('Yanıt yazmak için giriş yapmalısınız.');
      return;
    }
    if (topic?.isLocked) return;

    if (inlineReplyTarget?.id === target.id) {
      setInlineReplyTarget(null);
      setInlineReplyContent('');
      setInlineReplyMediaUrls([]);
      setInlineReplySpoiler(false);
      return;
    }

    const targetRootId = rootIdByPostId.get(target.id) || target.id;
    const isNestedTarget = targetRootId !== target.id;
    setInlineReplyTarget(target);
    setInlineReplyContent(isNestedTarget && target.authorUsername ? `@${target.authorUsername} ` : '');
    setInlineReplyMediaUrls([]);
    setInlineReplySpoiler(false);
  };

  const handleSubmitInlineReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!topic || !inlineReplyTarget) return;

    if (!user) {
      toast.error('Yanıt yazmak için giriş yapmalısınız.');
      return;
    }
    if (topic.isLocked) {
      toast.error('Bu konu kilitli olduğu için yanıt yazılamaz.');
      return;
    }
    if (!validateForumMediaUrls(inlineReplyMediaUrls)) {
      toast.error('Lütfen geçerli görsel veya GIF bağlantıları (http:// veya https://) girin.');
      return;
    }

    const mergedContent = mergeForumTextAndMedia(inlineReplyContent, inlineReplyMediaUrls);
    if (!mergedContent) {
      toast.error('Yanıt içeriği veya görseli boş olamaz.');
      return;
    }
    if (mergedContent.length > MAX_REPLY_LENGTH) {
      toast.error(`Yanıt en fazla ${MAX_REPLY_LENGTH.toLocaleString('tr-TR')} karakter olabilir.`);
      return;
    }

    const targetRootId = rootIdByPostId.get(inlineReplyTarget.id) || inlineReplyTarget.id;
    setIsSubmittingInlineReply(true);

    try {
      const created = await createForumPost({
        topicId: topic.id,
        topicTitle: topic.title,
        topicAuthorId: topic.userId,
        userId: user.id,
        actorUsername: user.username || 'Kullanıcı',
        parentPostId: inlineReplyTarget.id,
        parentAuthorId: inlineReplyTarget.userId,
        content: mergedContent,
        isSpoiler: inlineReplySpoiler,
        knownUserMap: knownUsersMap,
      });

      setInlineReplyTarget(null);
      setInlineReplyContent('');
      setInlineReplyMediaUrls([]);
      setInlineReplySpoiler(false);
      await refreshAfterPostCreate(created.id, targetRootId);
      toast.success('Yanıtınız gönderildi.');
    } catch (error) {
      console.error('Yanıt gönderme hatası:', error);
      toast.error('Yanıt gönderilemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsSubmittingInlineReply(false);
    }
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
    const parsed = splitForumTextAndMedia(post.content);
    setEditingPostId(post.id);
    setEditingPostContent(parsed.body);
    setEditingPostMediaUrls(parsed.mediaUrls);
    setEditingPostSpoiler(post.isSpoiler);
  };

  const handleSaveEditPost = async (post: ForumPost) => {
    if (!validateForumMediaUrls(editingPostMediaUrls)) {
      toast.error('Lütfen geçerli görsel veya GIF bağlantıları (http:// veya https://) girin.');
      return;
    }

    const merged = mergeForumTextAndMedia(editingPostContent, editingPostMediaUrls);
    if (!merged) {
      toast.error('Yanıt içeriği veya görseli boş olamaz.');
      return;
    }
    if (merged.length > MAX_REPLY_LENGTH) {
      toast.error(`Yanıt en fazla ${MAX_REPLY_LENGTH.toLocaleString('tr-TR')} karakter olabilir.`);
      return;
    }

    setIsSavingPostEdit(true);
    try {
      await updateForumPost(post.id, {
        content: merged,
        isSpoiler: editingPostSpoiler,
      });

      const updatedPosts = posts.map((item) =>
        item.id === post.id
          ? {
              ...item,
              content: merged,
              isSpoiler: editingPostSpoiler,
              updatedAt: new Date().toISOString(),
            }
          : item,
      );
      setPosts(updatedPosts);
      setEditingPostId(null);
      setEditingPostMediaUrls([]);
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
      if (inlineReplyTarget?.id === deletePostTarget.id) {
        setInlineReplyTarget(null);
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

  const renderInlineReplyBox = (target: ForumPost) => {
    if (!inlineReplyTarget || inlineReplyTarget.id !== target.id || !user || topic?.isLocked) {
      return null;
    }

    const canSubmit = Boolean(
      inlineReplyContent.trim() || inlineReplyMediaUrls.some((url) => url.trim()),
    );

    return (
      <form
        onSubmit={handleSubmitInlineReply}
        className="mt-3 rounded-xl border border-border/70 bg-card/70 p-3 sm:p-3.5 space-y-2.5"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">@{target.authorUsername}</span>{' '}
            kullanıcısına yanıt yazıyorsunuz
          </span>
        </div>

        <Textarea
          value={inlineReplyContent}
          onChange={(event) => setInlineReplyContent(event.target.value)}
          placeholder={`@${target.authorUsername} için yanıt yaz... (@kullanici ile bahsedebilirsiniz)`}
          rows={2}
          maxLength={MAX_REPLY_LENGTH}
          disabled={isSubmittingInlineReply}
          autoFocus
          className="min-h-[76px] resize-y text-sm"
        />

        <ForumMediaAttachmentField
          mediaUrls={inlineReplyMediaUrls}
          onChange={setInlineReplyMediaUrls}
          disabled={isSubmittingInlineReply}
          compact
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-2">
            <Switch
              id={`inline-reply-spoiler-${target.id}`}
              checked={inlineReplySpoiler}
              onCheckedChange={setInlineReplySpoiler}
              disabled={isSubmittingInlineReply}
            />
            <Label
              htmlFor={`inline-reply-spoiler-${target.id}`}
              className="text-xs cursor-pointer text-muted-foreground"
            >
              Spoiler içerir
            </Label>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setInlineReplyTarget(null)}
              disabled={isSubmittingInlineReply}
              className="h-8 text-xs"
            >
              İptal
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmittingInlineReply || !canSubmit}
              className="h-8 gap-1.5 text-xs"
            >
              {isSubmittingInlineReply ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Yanıtla</span>
            </Button>
          </div>
        </div>
      </form>
    );
  };

  const renderPostActionsMenu = (post: ForumPost) => {
    if (!user) return null;
    const canManagePost = Boolean(user.id === post.userId || isStaff);
    const canActOnOtherUser = user.id !== post.userId;

    if (!canManagePost && !canActOnOtherUser) {
      return null;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/70 shrink-0"
            aria-label="Yorum seçenekleri"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
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
          {canActOnOtherUser && (
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
                Şikâyet
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleBlockForumUser(post.userId, post.authorUsername)}
                className="text-rose-500 focus:bg-rose-500/10 focus:text-rose-400"
              >
                <UserX className="h-4 w-4 mr-2" />
                Engelle
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderPostEditor = (post: ForumPost) => {
    const canSave = Boolean(
      editingPostContent.trim() || editingPostMediaUrls.some((url) => url.trim()),
    );

    return (
      <div className="space-y-3 pt-1">
        <Textarea
          value={editingPostContent}
          onChange={(event) => setEditingPostContent(event.target.value)}
          rows={3}
          maxLength={MAX_REPLY_LENGTH}
          disabled={isSavingPostEdit}
        />
        <ForumMediaAttachmentField
          mediaUrls={editingPostMediaUrls}
          onChange={setEditingPostMediaUrls}
          disabled={isSavingPostEdit}
          compact
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
              disabled={isSavingPostEdit || !canSave}
              className="gap-1.5"
            >
              {isSavingPostEdit && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Kaydet</span>
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const canSubmitRoot = Boolean(
    replyContent.trim() || replyMediaUrls.some((url) => url.trim()),
  );

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
                      {isEditedTimestamp(topic.createdAt, topic.updatedAt) && (
                        <>
                          <span>·</span>
                          <span>Düzenlendi</span>
                        </>
                      )}
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
                        className="h-8 w-8 rounded-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/70"
                        aria-label="Konu seçenekleri"
                      >
                        <MoreVertical className="h-4 w-4" />
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
                            Şikâyet
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              handleBlockForumUser(topic.userId, topic.authorUsername)
                            }
                            className="text-rose-500 focus:bg-rose-500/10 focus:text-rose-400"
                          >
                            <UserX className="h-4 w-4 mr-2" />
                            Engelle
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
                        allowProxy
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
                  <span>{topic.replyCount} yorum</span>
                </div>
              </div>
            </article>

            {/* New Root Comment Composer */}
            <section aria-label="Yorum yaz">
              {topic.isLocked ? (
                <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 flex items-center gap-2.5 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>Bu konu kilitli olduğu için yeni yorum eklenemiyor.</span>
                </div>
              ) : !user ? (
                <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Tartışmaya katılmak için hesabınıza giriş yapın.
                  </p>
                  <Button asChild size="sm" className="shrink-0 w-fit">
                    <Link to="/auth">Giriş Yap</Link>
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmitRootComment}
                  className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 border border-border/60 shrink-0 hidden sm:flex">
                      <AvatarImage src={user.avatar || undefined} alt={user.username} />
                      <AvatarFallback className="text-xs">
                        {getInitials(user.username)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1 space-y-2.5">
                      <Textarea
                        value={replyContent}
                        onChange={(event) => setReplyContent(event.target.value)}
                        placeholder="Yorumunuzu yazın... (@kullanici ile bahsedebilirsiniz)"
                        rows={3}
                        maxLength={MAX_REPLY_LENGTH}
                        disabled={isSubmittingReply}
                        className="resize-y min-h-[90px]"
                      />

                      <ForumMediaAttachmentField
                        mediaUrls={replyMediaUrls}
                        onChange={setReplyMediaUrls}
                        disabled={isSubmittingReply}
                      />

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reply-spoiler-switch"
                            checked={replyIsSpoiler}
                            onCheckedChange={setReplyIsSpoiler}
                            disabled={isSubmittingReply}
                          />
                          <Label htmlFor="reply-spoiler-switch" className="text-xs sm:text-sm cursor-pointer">
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
                            size="sm"
                            disabled={isSubmittingReply || !canSubmitRoot}
                            className="gap-1.5"
                          >
                            {isSubmittingReply ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            <span>Gönder</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              )}
            </section>

            {/* Left-Aligned Comment Thread Stream */}
            <section aria-label="Yorumlar" className="space-y-1">
              <div className="flex items-center justify-between pb-2 border-b border-border/50">
                <h2 className="text-base font-semibold">
                  Yorumlar ({visiblePosts.length})
                </h2>
              </div>

              {rootPosts.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Henüz yorum yazılmamış. İlk yorumu sen paylaşabilirsin.
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {rootPosts.map((rootPost) => {
                    const threadReplies = repliesByRootId[rootPost.id] || [];
                    const hasReplies = threadReplies.length > 0;
                    const isExpanded = Boolean(expandedThreads[rootPost.id]);
                    const isEditingRoot = editingPostId === rootPost.id;
                    const isRootHighlighted = highlightedPostId === rootPost.id;

                    // Deduplicate mini avatars of respondents (max 3)
                    const miniRepliers: ForumPost[] = [];
                    const seenReplierIds = new Set<string>();
                    for (const r of threadReplies) {
                      if (!seenReplierIds.has(r.userId)) {
                        seenReplierIds.add(r.userId);
                        miniRepliers.push(r);
                        if (miniRepliers.length >= 3) break;
                      }
                    }

                    return (
                      <div
                        key={rootPost.id}
                        id={`post-${rootPost.id}`}
                        className={cn(
                          'py-4 transition-colors rounded-lg',
                          isRootHighlighted && 'bg-primary/5 ring-1 ring-primary/40 px-3 -mx-3',
                        )}
                      >
                        <div className="flex items-stretch gap-3.5 min-w-0">
                          {/* Left Avatar + Vertical Connector Column */}
                          <div className="w-10 shrink-0 flex flex-col items-center">
                            <Link to={`/profile/${rootPost.userId}`} className="shrink-0">
                              <Avatar className="h-10 w-10 border border-border/60">
                                <AvatarImage
                                  src={rootPost.authorAvatar || undefined}
                                  alt={rootPost.authorUsername}
                                />
                                <AvatarFallback className="text-xs">
                                  {getInitials(rootPost.authorUsername)}
                                </AvatarFallback>
                              </Avatar>
                            </Link>
                            {hasReplies && (
                              <div className="w-[1.5px] flex-1 bg-border/75 mt-2 rounded-full" />
                            )}
                          </div>

                          {/* Right Main Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap min-w-0 text-xs pt-0.5">
                                <Link
                                  to={`/profile/${rootPost.userId}`}
                                  className={cn(
                                    'text-sm font-semibold hover:underline truncate max-w-[200px]',
                                    getStaffTextClassName(rootPost.authorRole),
                                  )}
                                >
                                  {rootPost.authorUsername}
                                </Link>
                                <StaffBadge role={rootPost.authorRole} compact />
                                <span
                                  className="text-muted-foreground shrink-0"
                                  title={formatFullDate(rootPost.createdAt)}
                                >
                                  {formatRelativeTime(rootPost.createdAt)}
                                </span>
                                {isEditedTimestamp(rootPost.createdAt, rootPost.updatedAt) && (
                                  <span className="text-muted-foreground shrink-0">
                                    · Düzenlendi
                                  </span>
                                )}
                              </div>

                              {renderPostActionsMenu(rootPost)}
                            </div>

                            <div className="mt-1.5">
                              {isEditingRoot ? (
                                renderPostEditor(rootPost)
                              ) : (
                                <ForumRichContent
                                  content={rootPost.content}
                                  isSpoiler={rootPost.isSpoiler}
                                  mentionUserIdByUsername={knownUsersMap}
                                />
                              )}
                            </div>

                            {/* Root Post Footer Actions */}
                            <div className="mt-2.5 flex items-center gap-3.5 text-xs text-muted-foreground">
                              <button
                                type="button"
                                onClick={() => handleTogglePostLike(rootPost)}
                                disabled={Boolean(likingPostIds[rootPost.id])}
                                className={cn(
                                  'inline-flex items-center gap-1.5 transition-colors tabular-nums',
                                  rootPost.viewerHasLiked
                                    ? 'text-rose-500 font-medium'
                                    : 'hover:text-rose-500',
                                )}
                              >
                                <Heart
                                  className={cn(
                                    'h-4 w-4',
                                    rootPost.viewerHasLiked && 'fill-current',
                                  )}
                                />
                                <span>{rootPost.likeCount}</span>
                              </button>

                              {miniRepliers.length > 0 && (
                                <div className="flex items-center -space-x-1.5">
                                  {miniRepliers.map((replier) => (
                                    <Avatar
                                      key={replier.id}
                                      className="h-5 w-5 ring-2 ring-background border border-border/60"
                                    >
                                      <AvatarImage
                                        src={replier.authorAvatar || undefined}
                                        alt={replier.authorUsername}
                                      />
                                      <AvatarFallback className="text-[9px]">
                                        {getInitials(replier.authorUsername)}
                                      </AvatarFallback>
                                    </Avatar>
                                  ))}
                                </div>
                              )}

                              {!topic.isLocked && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenInlineReply(rootPost)}
                                  className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors font-medium"
                                >
                                  <CornerUpLeft className="h-3.5 w-3.5" />
                                  <span>Yanıtla</span>
                                </button>
                              )}
                            </div>

                            {renderInlineReplyBox(rootPost)}
                          </div>
                        </div>

                        {/* Curved L-Connector & Collapsible Reply Toggle */}
                        {hasReplies && (
                          <div className="flex items-center">
                            <div className="w-[54px] shrink-0 flex justify-start pl-[19.25px]">
                              <div className="w-6 h-4 border-l-[1.5px] border-b-[1.5px] border-border/75 rounded-bl-xl -mt-1.5" />
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedThreads((prev) => ({
                                  ...prev,
                                  [rootPost.id]: !prev[rootPost.id],
                                }))
                              }
                              className="inline-flex items-center gap-1.5 pt-1 text-xs font-semibold text-foreground/85 hover:text-primary transition-colors"
                            >
                              <span>
                                {isExpanded
                                  ? `${threadReplies.length} yanıtı gizle`
                                  : `${threadReplies.length} yanıt`}
                              </span>
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        )}

                        {/* Expanded Nested Replies List */}
                        {hasReplies && isExpanded && (
                          <div className="mt-3 ml-[54px] space-y-4 border-l border-border/50 pl-4">
                            {threadReplies.map((reply) => {
                              const isEditingReply = editingPostId === reply.id;
                              const isReplyHighlighted = highlightedPostId === reply.id;

                              return (
                                <div
                                  key={reply.id}
                                  id={`post-${reply.id}`}
                                  className={cn(
                                    'flex items-start gap-3 min-w-0 rounded-lg transition-colors',
                                    isReplyHighlighted &&
                                      'bg-primary/5 ring-1 ring-primary/40 p-2 -m-2',
                                  )}
                                >
                                  <Link to={`/profile/${reply.userId}`} className="shrink-0">
                                    <Avatar className="h-8 w-8 border border-border/60">
                                      <AvatarImage
                                        src={reply.authorAvatar || undefined}
                                        alt={reply.authorUsername}
                                      />
                                      <AvatarFallback className="text-[11px]">
                                        {getInitials(reply.authorUsername)}
                                      </AvatarFallback>
                                    </Avatar>
                                  </Link>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex items-center gap-1.5 flex-wrap min-w-0 text-xs pt-0.5">
                                        <Link
                                          to={`/profile/${reply.userId}`}
                                          className={cn(
                                            'text-sm font-semibold hover:underline truncate max-w-[180px]',
                                            getStaffTextClassName(reply.authorRole),
                                          )}
                                        >
                                          {reply.authorUsername}
                                        </Link>
                                        <StaffBadge role={reply.authorRole} compact />
                                        <span
                                          className="text-muted-foreground shrink-0"
                                          title={formatFullDate(reply.createdAt)}
                                        >
                                          {formatRelativeTime(reply.createdAt)}
                                        </span>
                                        {isEditedTimestamp(reply.createdAt, reply.updatedAt) && (
                                          <span className="text-muted-foreground shrink-0">
                                            · Düzenlendi
                                          </span>
                                        )}
                                      </div>

                                      {renderPostActionsMenu(reply)}
                                    </div>

                                    <div className="mt-1">
                                      {isEditingReply ? (
                                        renderPostEditor(reply)
                                      ) : (
                                        <ForumRichContent
                                          content={reply.content}
                                          isSpoiler={reply.isSpoiler}
                                          mentionUserIdByUsername={knownUsersMap}
                                        />
                                      )}
                                    </div>

                                    <div className="mt-2 flex items-center gap-3.5 text-xs text-muted-foreground">
                                      <button
                                        type="button"
                                        onClick={() => handleTogglePostLike(reply)}
                                        disabled={Boolean(likingPostIds[reply.id])}
                                        className={cn(
                                          'inline-flex items-center gap-1.5 transition-colors tabular-nums',
                                          reply.viewerHasLiked
                                            ? 'text-rose-500 font-medium'
                                            : 'hover:text-rose-500',
                                        )}
                                      >
                                        <Heart
                                          className={cn(
                                            'h-3.5 w-3.5',
                                            reply.viewerHasLiked && 'fill-current',
                                          )}
                                        />
                                        <span>{reply.likeCount}</span>
                                      </button>

                                      {!topic.isLocked && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenInlineReply(reply)}
                                          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors font-medium"
                                        >
                                          <CornerUpLeft className="h-3.5 w-3.5" />
                                          <span>Yanıtla</span>
                                        </button>
                                      )}
                                    </div>

                                    {renderInlineReplyBox(reply)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {hasMorePosts && (
                <div className="flex justify-center pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadMorePosts}
                    disabled={isLoadingMorePosts}
                    className="gap-2"
                  >
                    {isLoadingMorePosts && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>Daha fazla yorum yükle</span>
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
