import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { AlertTriangle, Eye, EyeOff, MessageCircle, Reply, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import StaffBadge from '@/components/user/StaffBadge';
import { useAuth } from '@/contexts/AuthContext';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { Comment } from '@/lib/types';
import { getEntityCommentsV2, toggleCommentDislike, toggleCommentLike } from '@/lib/database';
import { applyOptimisticReaction, getReactionScore, hasReaction, type ReactionType } from '@/lib/reactions';
import { createCommentNotification } from '@/lib/storage';
import { PAGE_COMMENTS_UPDATED_EVENT, PageCommentsUpdatedDetail } from '@/lib/pageCommentEvents';
import { toast } from 'sonner';

interface PageCommentRailProps {
    mangaId: string;
    mangaTitle: string;
    chapterId: string;
    currentPage: number;
    enabled: boolean;
}

interface RailLayout {
    top: number;
    height: number;
    left: {
        x: number;
        width: number;
    } | null;
    right: {
        x: number;
        width: number;
    } | null;
}

const MIN_RAIL_WIDTH = 170;
const IDEAL_RAIL_WIDTH = 228;
const RAIL_GAP = 20;
const CARD_HEIGHT_BUDGET = 208;

const pageCommentCache = new Map<string, Comment[]>();

const buildCacheKey = (chapterId: string, pageNumber: number) => `${chapterId}:${pageNumber}`;

const getPreviewMedia = (comment: Comment) => comment.gifUrl || comment.mediaUrls?.[0] || comment.mediaUrl || null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const sortCommentsForRail = (items: Comment[]) => items.slice().sort((a, b) => {
    const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
    if (pinDiff !== 0) {
        return pinDiff;
    }

    const scoreDiff = getReactionScore(b) - getReactionScore(a);
    if (scoreDiff !== 0) {
        return scoreDiff;
    }

    const likeDiff = b.likes - a.likes;
    if (likeDiff !== 0) {
        return likeDiff;
    }

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
});

const PageCommentRail: React.FC<PageCommentRailProps> = ({
    mangaId,
    mangaTitle,
    chapterId,
    currentPage,
    enabled,
}) => {
    const { user } = useAuth();
    const [comments, setComments] = useState<Comment[]>([]);
    const [refreshTick, setRefreshTick] = useState(0);
    const [layout, setLayout] = useState<RailLayout | null>(null);
    const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
    const [pendingCommentReactions, setPendingCommentReactions] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!enabled || !mangaId || !chapterId || currentPage < 1) {
            setComments([]);
            return;
        }

        const cacheKey = buildCacheKey(chapterId, currentPage);
        const cachedComments = pageCommentCache.get(cacheKey);
        if (cachedComments) {
            setComments(cachedComments);
        }

        let isCancelled = false;
        const timerId = window.setTimeout(async () => {
            const fetchedComments = await getEntityCommentsV2('manga', mangaId, chapterId, 'popular', {
                pageNumber: currentPage,
            });

            if (isCancelled) {
                return;
            }

            pageCommentCache.set(cacheKey, fetchedComments);
            setComments(fetchedComments);
        }, cachedComments ? 0 : 140);

        return () => {
            isCancelled = true;
            window.clearTimeout(timerId);
        };
    }, [chapterId, currentPage, enabled, mangaId, refreshTick]);

    useEffect(() => {
        const handleCommentsUpdated = (event: Event) => {
            const { detail } = event as CustomEvent<PageCommentsUpdatedDetail>;
            if (!detail || detail.chapterId !== chapterId || detail.pageNumber !== currentPage) {
                return;
            }

            pageCommentCache.delete(buildCacheKey(chapterId, currentPage));
            setRefreshTick((previous) => previous + 1);
        };

        window.addEventListener(PAGE_COMMENTS_UPDATED_EVENT, handleCommentsUpdated);
        return () => {
            window.removeEventListener(PAGE_COMMENTS_UPDATED_EVENT, handleCommentsUpdated);
        };
    }, [chapterId, currentPage]);

    useEffect(() => {
        setRevealedSpoilers({});
    }, [chapterId, currentPage]);

    useEffect(() => {
        if (!enabled) {
            setLayout(null);
            return;
        }

        let frameId = 0;

        const updateLayout = () => {
            const pageElement = document.querySelector(`[data-reader-page-number="${currentPage}"]`) as HTMLElement | null;

            if (!pageElement) {
                setLayout(null);
                return;
            }

            const rect = pageElement.getBoundingClientRect();
            const top = rect.top + window.scrollY;
            const height = rect.height;

            if (height < 140) {
                setLayout(null);
                return;
            }

            const leftAvailable = rect.left - RAIL_GAP - 24;
            const rightAvailable = window.innerWidth - rect.right - RAIL_GAP - 24;

            const leftWidth = leftAvailable >= MIN_RAIL_WIDTH ? Math.min(IDEAL_RAIL_WIDTH, leftAvailable) : 0;
            const rightWidth = rightAvailable >= MIN_RAIL_WIDTH ? Math.min(IDEAL_RAIL_WIDTH, rightAvailable) : 0;

            setLayout({
                top,
                height,
                left: leftWidth > 0
                    ? {
                        x: rect.left + window.scrollX - RAIL_GAP - leftWidth,
                        width: leftWidth,
                    }
                    : null,
                right: rightWidth > 0
                    ? {
                        x: rect.right + window.scrollX + RAIL_GAP,
                        width: rightWidth,
                    }
                    : null,
            });
        };

        const scheduleUpdate = () => {
            window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(updateLayout);
        };

        scheduleUpdate();
        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
        };
    }, [currentPage, enabled]);

    const visibleSides = useMemo(() => {
        if (!layout) {
            return 0;
        }

        return Number(Boolean(layout.left)) + Number(Boolean(layout.right));
    }, [layout]);

    const maxCardsPerSide = useMemo(() => {
        if (!layout) {
            return 0;
        }

        return Math.max(1, Math.min(8, Math.floor(layout.height / CARD_HEIGHT_BUDGET)));
    }, [layout]);

    const maxVisibleComments = useMemo(() => {
        if (!visibleSides || !maxCardsPerSide) {
            return 0;
        }

        return visibleSides * maxCardsPerSide;
    }, [maxCardsPerSide, visibleSides]);

    const visibleComments = useMemo(
        () => comments.slice(0, maxVisibleComments),
        [comments, maxVisibleComments]
    );

    const leftColumnComments = useMemo(() => {
        if (!layout?.left) {
            return [];
        }

        return visibleComments.filter((_, index) => {
            if (!layout.right) {
                return true;
            }

            return index % 2 === 0;
        }).slice(0, maxCardsPerSide);
    }, [layout, maxCardsPerSide, visibleComments]);

    const rightColumnComments = useMemo(() => {
        if (!layout?.right) {
            return [];
        }

        if (!layout.left) {
            return visibleComments.slice(0, maxCardsPerSide);
        }

        return visibleComments.filter((_, index) => index % 2 === 1).slice(0, maxCardsPerSide);
    }, [layout, maxCardsPerSide, visibleComments]);

    const applyCommentsToCache = (nextComments: Comment[]) => {
        pageCommentCache.set(buildCacheKey(chapterId, currentPage), nextComments);
        setComments(nextComments);
    };

    const toggleSpoiler = (commentId: string) => {
        setRevealedSpoilers((current) => ({
            ...current,
            [commentId]: !current[commentId],
        }));
    };

    const handleReaction = async (
        commentId: string,
        reactionType: ReactionType,
        event: React.MouseEvent<HTMLButtonElement>,
    ) => {
        event.stopPropagation();

        if (!user) {
            toast.error('Tepki bırakmak için giriş yapmalısınız');
            return;
        }

        if (pendingCommentReactions[commentId]) {
            return;
        }

        const targetComment = comments.find((comment) => comment.id === commentId);
        if (!targetComment) {
            return;
        }

        const wasLiked = hasReaction(targetComment, user.id, 'like');
        const previousComments = comments;
        const nextComments = sortCommentsForRail(comments.map((comment) => {
            if (comment.id !== commentId) {
                return comment;
            }

            return applyOptimisticReaction(comment, user.id, reactionType);
        }));

        setPendingCommentReactions((previous) => ({ ...previous, [commentId]: true }));
        applyCommentsToCache(nextComments);

        try {
            if (reactionType === 'like') {
                await toggleCommentLike(commentId, user.id, 'manga');
            } else {
                await toggleCommentDislike(commentId, user.id, 'manga');
            }

            if (reactionType === 'like' && !wasLiked && targetComment.userId !== user.id) {
                await createCommentNotification(
                    targetComment.userId,
                    'like',
                    user.id,
                    user.username,
                    mangaId,
                    mangaTitle,
                    targetComment.id,
                    chapterId,
                    'manga',
                    targetComment.pageNumber
                );
            }
        } catch (error) {
            console.error('Page comment rail reaction error:', error);
            applyCommentsToCache(previousComments);
            toast.error('Tepki güncellenemedi');
        } finally {
            setPendingCommentReactions((previous) => {
                const next = { ...previous };
                delete next[commentId];
                return next;
            });
        }
    };

    if (!enabled || !layout || visibleComments.length === 0) {
        return null;
    }

    const renderCommentCard = (comment: Comment, index: number, total: number, side: 'left' | 'right') => {
        const previewMedia = getPreviewMedia(comment);
        const isSpoilerHidden = comment.isSpoiler && !revealedSpoilers[comment.id];
        const topPercent = ((index + 1) / (total + 1)) * 100;
        const drift = side === 'left' ? -8 : 8;
        const rotation = side === 'left' ? -2.5 : 2.5;

        return (
            <div
                key={comment.id}
                className="pointer-events-auto absolute left-0 right-0"
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                    top: `${topPercent}%`,
                    transform: `translateY(-50%) translateX(${drift}px) rotate(${rotation}deg)`,
                }}
            >
                <div
                    className="overflow-hidden rounded-2xl border border-sky-300/20 bg-slate-950/82 p-3 shadow-[0_20px_48px_rgba(2,8,23,0.62)] backdrop-blur-xl"
                    style={{
                        animation: `pageCommentFloat ${7 + index}s ease-in-out ${index * 0.35}s infinite`,
                    }}
                >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_58%)] pointer-events-none" />
                    <div className="relative flex items-start gap-3">
                        <Avatar className="h-8 w-8 shrink-0 border border-white/10">
                            <AvatarImage src={comment.userAvatar} />
                            <AvatarFallback>{comment.username[0]?.toUpperCase() || '?'}</AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 space-y-1">
                                    <div className="flex items-center gap-1.5">
                                        <p
                                            className={`min-w-0 flex-1 truncate text-xs font-semibold ${
                                                comment.userRole ? getStaffTextClassName(comment.userRole, false) : 'text-foreground'
                                            }`}
                                        >
                                            {comment.username}
                                        </p>
                                        <StaffBadge role={comment.userRole} compact />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: tr })}
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={(event) => void handleReaction(comment.id, 'like', event)}
                                    disabled={Boolean(pendingCommentReactions[comment.id])}
                                    className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] transition-colors ${
                                        hasReaction(comment, user?.id, 'like')
                                            ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                                            : 'border-white/10 bg-white/5 text-emerald-300 hover:border-emerald-300/30 hover:bg-emerald-500/10'
                                    }`}
                                >
                                    <ThumbsUp className="h-3 w-3" />
                                    <span className="font-semibold">{comment.likes}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={(event) => void handleReaction(comment.id, 'dislike', event)}
                                    disabled={Boolean(pendingCommentReactions[comment.id])}
                                    className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] transition-colors ${
                                        hasReaction(comment, user?.id, 'dislike')
                                            ? 'border-red-400/40 bg-red-500/15 text-red-200'
                                            : 'border-white/10 bg-white/5 text-red-300 hover:border-red-300/30 hover:bg-red-500/10'
                                    }`}
                                >
                                    <ThumbsDown className="h-3 w-3" />
                                    <span className="font-semibold">{comment.dislikes}</span>
                                </button>
                            </div>

                            {comment.parentId ? (
                                <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                                    <Reply className="h-3 w-3" />
                                    Yanıt
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                                    <MessageCircle className="h-3 w-3" />
                                    Yorum
                                </Badge>
                            )}

                            {isSpoilerHidden ? (
                                <button
                                    type="button"
                                    onClick={() => toggleSpoiler(comment.id)}
                                    aria-label="Spoiler içeren sayfa yorumunu göster"
                                    aria-expanded={false}
                                    className="group w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-left text-[11px] text-amber-100 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:border-amber-400/50 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <span className="flex items-center gap-2 font-semibold">
                                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                                Spoiler yorum
                                            </span>
                                            <span className="mt-1 block pl-[1.35rem] text-[10px] text-amber-100/80">
                                                Dokunarak veya tıklayarak açılır.
                                            </span>
                                        </div>
                                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-amber-50/90">
                                            <Eye className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none" />
                                            Aç
                                        </span>
                                    </div>
                                </button>
                            ) : (
                                <>
                                    {comment.content && (
                                        <p className="line-clamp-5 text-xs leading-relaxed text-slate-100">
                                            {comment.content}
                                        </p>
                                    )}

                                    {comment.isSpoiler && (
                                        <button
                                            type="button"
                                            onClick={() => toggleSpoiler(comment.id)}
                                            className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] font-medium text-amber-100 transition-colors hover:border-amber-300/35 hover:bg-amber-400/15"
                                        >
                                            <EyeOff className="h-3 w-3" />
                                            Spoileri Gizle
                                        </button>
                                    )}

                                    {previewMedia && (
                                        <div className="overflow-hidden rounded-xl border border-white/10 bg-card/50">
                                            <img
                                                src={previewMedia}
                                                alt="Yorum medyası"
                                                className="h-24 w-full object-cover"
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <style>
                {`
                    @keyframes pageCommentFloat {
                        0%, 100% {
                            transform: translateY(0px);
                        }
                        50% {
                            transform: translateY(-8px);
                        }
                    }
                `}
            </style>

            {layout.left && leftColumnComments.length > 0 && (
                <div
                    className="pointer-events-none absolute z-30 hidden xl:block"
                    style={{
                        top: layout.top,
                        left: layout.left.x,
                        width: layout.left.width,
                        height: layout.height,
                    }}
                >
                    {leftColumnComments.map((comment, index) =>
                        renderCommentCard(comment, index, leftColumnComments.length, 'left')
                    )}
                </div>
            )}

            {layout.right && rightColumnComments.length > 0 && (
                <div
                    className="pointer-events-none absolute z-30 hidden xl:block"
                    style={{
                        top: layout.top,
                        left: layout.right.x,
                        width: layout.right.width,
                        height: layout.height,
                    }}
                >
                    {rightColumnComments.map((comment, index) =>
                        renderCommentCard(comment, index, rightColumnComments.length, 'right')
                    )}
                </div>
            )}
        </>
    );
};

export default PageCommentRail;
