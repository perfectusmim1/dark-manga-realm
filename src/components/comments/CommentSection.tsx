import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Link, useLocation } from 'react-router-dom';
import {
    AlertTriangle,
    MessageCircle,
    ThumbsUp,
    Edit2,
    Trash2,
    Reply,
    Image,
    Send,
    X,
    MoreVertical,
    ChevronDown,
    ChevronUp,
    Eye,
    EyeOff,
    Link2,
    Pin,
    Flag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { Comment } from '@/lib/types';
import {
    updateComment,
    deleteComment,
    toggleCommentLike,
    getMangaById,
    getCharacterById,
    getEntityCommentsV2,
    getEntityReactions,
    getUserEntityReaction,
    addEntityReactionV2,
    addCommentV2,
    setCommentPinned,
    createCommentReport,
} from '@/lib/database';
import { commentHasRenderableContent, isValidCommentMediaUrls, stripCommentFormatting } from '@/lib/commentContent';
import { getBlockedUserIds } from '@/lib/profile';
import { createCommentNotification } from '@/lib/storage';
import { clearTargetCommentFromCurrentUrl, getTargetCommentIdFromLocation } from '@/lib/commentNavigation';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CommentSectionProps {
    mangaId?: string;
    entityId?: string;
    entityType?: 'manga' | 'character' | 'author' | 'artist';
    chapterId?: string;
    blockedUserIds?: string[];
}

const TENOR_API_KEY = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
const PARENT_COMMENTS_PER_PAGE = 15;
const COMMENT_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REPLY_INDENT_LEVEL = 3;
const COMMENT_HIGHLIGHT_DURATION_MS = 2600;

interface CommentDraft {
    title: string;
    body: string;
    mediaUrls: string[];
    isSpoiler: boolean;
    gifUrl: string | null;
}

const createEmptyDraft = (overrides?: Partial<CommentDraft>): CommentDraft => ({
    title: '',
    body: '',
    mediaUrls: [],
    isSpoiler: false,
    gifUrl: null,
    ...overrides,
});

const canEditComment = (comment: Comment) =>
    Date.now() - new Date(comment.createdAt).getTime() <= COMMENT_EDIT_WINDOW_MS;

const normalizeDraft = (draft: CommentDraft) => ({
    ...draft,
    title: draft.title.trim(),
    body: draft.body.trim(),
    mediaUrls: draft.mediaUrls.map((url) => url.trim()).filter(Boolean),
});

const extractMentionPrefix = (value: string) => value.match(/^@[\w.-]+\s+/)?.[0] || null;

const keepMentionPrefix = (value: string, mentionPrefix: string | null) => {
    if (!mentionPrefix) {
        return value;
    }

    if (value.startsWith(mentionPrefix)) {
        return value;
    }

    return `${mentionPrefix}${value.replace(/^@[\w.-]+\s*/, '')}`;
};

const highlightMentions = (content: string) => {
    const parts = content.split(/(@[\w.-]+)/g);

    return parts.map((part, i) => {
        if (part.startsWith('@')) {
            return <span key={i} className="font-medium text-sky-400">{part}</span>;
        }

        return <React.Fragment key={i}>{part}</React.Fragment>;
    });
};

const getCommentMediaUrls = (comment: Comment) => {
    if (comment.mediaUrls?.length) {
        return comment.mediaUrls;
    }

    return comment.mediaUrl ? [comment.mediaUrl] : [];
};

const renderFormattedText = (content: string) => {
    const plainText = stripCommentFormatting(content).replace(/\r\n/g, '\n');
    const lines = plainText.split('\n');

    return lines.map((line, index) => (
        <React.Fragment key={`${line}-${index}`}>
            {index > 0 && <br />}
            {highlightMentions(line)}
        </React.Fragment>
    ));
};

interface CommentComposerProps {
    draft: CommentDraft;
    placeholder: string;
    submitLabel: string;
    avatar?: string;
    username?: string;
    compact?: boolean;
    onDraftChange: (draft: CommentDraft) => void;
    onOpenGifPicker: () => void;
    onSubmit: () => void;
    onCancel?: () => void;
}

const CommentComposer: React.FC<CommentComposerProps> = ({
    draft,
    placeholder,
    submitLabel,
    avatar,
    username,
    compact = false,
    onDraftChange,
    onOpenGifPicker,
    onSubmit,
    onCancel,
}) => {
    const hasContent = commentHasRenderableContent({
        body: draft.body,
        mediaUrls: draft.mediaUrls,
        gifUrl: draft.gifUrl,
    });
    const [showMediaFields, setShowMediaFields] = useState(draft.mediaUrls.length > 0);

    useEffect(() => {
        if (draft.mediaUrls.length > 0) {
            setShowMediaFields(true);
        }
    }, [draft.mediaUrls.length]);

    const setField = <K extends keyof CommentDraft>(field: K, value: CommentDraft[K]) => {
        onDraftChange({
            ...draft,
            [field]: value,
        });
    };

    const updateMediaUrl = (index: number, value: string) => {
        const nextMediaUrls = [...draft.mediaUrls];
        nextMediaUrls[index] = value;
        setField('mediaUrls', nextMediaUrls);
    };

    const addMediaField = () => {
        setShowMediaFields(true);
        setField('mediaUrls', [...draft.mediaUrls, '']);
    };

    const removeMediaField = (index: number) => {
        const nextMediaUrls = draft.mediaUrls.filter((_, mediaIndex) => mediaIndex !== index);
        setField('mediaUrls', nextMediaUrls);
        if (nextMediaUrls.length === 0) {
            setShowMediaFields(false);
        }
    };

    return (
        <div className={cn('rounded-2xl border border-border/70 bg-card/80', compact ? 'p-3' : 'p-4')}>
            <div className="flex gap-3">
                {username && (
                    <Avatar className={compact ? 'h-8 w-8' : 'h-10 w-10'}>
                        <AvatarImage src={avatar} />
                        <AvatarFallback>{username[0]?.toUpperCase() || '?'}</AvatarFallback>
                    </Avatar>
                )}

                <div className="flex-1 space-y-3">
                    <Textarea
                        placeholder={placeholder}
                        value={draft.body}
                        onChange={(event) => setField('body', event.target.value)}
                        className={compact ? 'min-h-[88px]' : 'min-h-[120px]'}
                    />

                    {(draft.gifUrl || draft.mediaUrls.length > 0) && (
                        <div className="flex flex-wrap gap-3">
                            {draft.gifUrl && (
                                <div className="relative overflow-hidden rounded-xl border border-border bg-background/70">
                                    <img src={draft.gifUrl} alt="Seçili GIF" className="max-h-32 rounded-xl object-cover" />
                                    <Button size="icon" variant="destructive" className="absolute right-2 top-2 h-7 w-7" onClick={() => setField('gifUrl', null)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {draft.mediaUrls.filter(Boolean).map((mediaUrl, index) => (
                                <div key={`${mediaUrl}-${index}`} className="flex min-w-[220px] items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                                    <Link2 className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{mediaUrl}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {showMediaFields && (
                        <div className="space-y-2 rounded-xl border border-border/60 bg-background/30 p-3">
                            {draft.mediaUrls.map((mediaUrl, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <Input
                                        placeholder={`Görsel Linki ${index + 1}`}
                                        value={mediaUrl}
                                        onChange={(event) => updateMediaUrl(index, event.target.value)}
                                        className="h-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" onClick={() => removeMediaField(index)}>
                                        Kaldır
                                    </Button>
                                </div>
                            ))}

                            <Button type="button" variant="outline" size="sm" onClick={addMediaField}>
                                Bir Tane Daha Ekle
                            </Button>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={onOpenGifPicker}>
                                <Image className="mr-2 h-4 w-4" />
                                GIF Ekle
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => {
                                if (draft.mediaUrls.length === 0) {
                                    addMediaField();
                                } else {
                                    setShowMediaFields((previous) => !previous);
                                }
                            }}>
                                <Link2 className="mr-2 h-4 w-4" />
                                Görsel Ekle
                            </Button>
                            <label className="ml-1 flex items-center gap-2 text-sm text-muted-foreground">
                                <Checkbox
                                    checked={draft.isSpoiler}
                                    onCheckedChange={(checked) => setField('isSpoiler', checked === true)}
                                />
                                Spoiler Olarak İşaretle
                            </label>
                        </div>

                        <div className="flex items-center gap-2">
                            {onCancel && (
                                <Button variant="ghost" size="sm" onClick={onCancel}>
                                    İptal
                                </Button>
                            )}

                            <Button size="sm" onClick={onSubmit} disabled={!hasContent}>
                                <Send className="mr-2 h-4 w-4" />
                                {submitLabel}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CommentSection: React.FC<CommentSectionProps> = ({ mangaId: propMangaId, entityId: propEntityId, entityType: propEntityType = 'manga', chapterId, blockedUserIds = [] }) => {
    const { user } = useAuth();
    const location = useLocation();
    const entityId = propEntityId || propMangaId || '';
    const entityType = propEntityType;

    const [comments, setComments] = useState<Comment[]>([]);
    const [relationshipBlockedUserIds, setRelationshipBlockedUserIds] = useState<string[]>([]);
    const [newDraft, setNewDraft] = useState<CommentDraft>(createEmptyDraft());
    const [newComposerVersion, setNewComposerVersion] = useState(0);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<CommentDraft>(createEmptyDraft());
    const [editMention, setEditMention] = useState<string | null>(null);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyDraft, setReplyDraft] = useState<CommentDraft>(createEmptyDraft());
    const [replyMention, setReplyMention] = useState<string | null>(null);
    const [showGifPicker, setShowGifPicker] = useState(false);
    const [gifSearch, setGifSearch] = useState('');
    const [gifs, setGifs] = useState<any[]>([]);
    const [gifTarget, setGifTarget] = useState<'new' | 'edit' | 'reply'>('new');
    const [sortBy, setSortBy] = useState<'newest' | 'popular'>('newest');
    const [currentPage, setCurrentPage] = useState(1);
    const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);
    const [pendingScrollCommentId, setPendingScrollCommentId] = useState<string | null>(null);
    const [reactions, setReactions] = useState<Record<string, number>>({});
    const [userReaction, setUserReaction] = useState<string | null>(null);
    const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
    const [expandedMedia, setExpandedMedia] = useState<Record<string, boolean>>({});
    const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
    const [mediaLoadErrors, setMediaLoadErrors] = useState<Record<string, boolean>>({});
    const [reportingComment, setReportingComment] = useState<Comment | null>(null);
    const [reportReason, setReportReason] = useState('Spam veya alakasız');
    const [reportDetails, setReportDetails] = useState('');
    const [isSubmittingReport, setIsSubmittingReport] = useState(false);
    const highlightTimeoutRef = useRef<number | null>(null);
    const commentPreferences = {
        autoShowMedia: user?.preferences?.comments?.auto_show_media ?? false,
        autoShowGifs: user?.preferences?.comments?.auto_show_gifs ?? false,
        autoShowReplies: user?.preferences?.comments?.auto_show_replies ?? false,
    };

    useEffect(() => {
        loadComments();
        loadReactions();
    }, [entityId, entityType, chapterId, sortBy]);

    useEffect(() => {
        setCurrentPage(1);
        setHighlightedCommentId(null);
        setPendingScrollCommentId(null);
    }, [entityId, entityType, chapterId, sortBy]);

    useEffect(() => () => {
        if (highlightTimeoutRef.current !== null) {
            window.clearTimeout(highlightTimeoutRef.current);
        }
    }, []);

    useEffect(() => {
        if (!user?.id) {
            setRelationshipBlockedUserIds([]);
            return;
        }

        getBlockedUserIds(user.id).then(({ ids }) => {
            setRelationshipBlockedUserIds(ids || []);
        });
    }, [user?.id]);

    const loadComments = async () => {
        const loadedComments = await getEntityCommentsV2(entityType, entityId, chapterId, sortBy);
        setComments(loadedComments);
    };

    const loadReactions = async () => {
        const counts = await getEntityReactions(entityType, entityId, chapterId);
        setReactions(counts);

        if (!user) {
            setUserReaction(null);
            return;
        }

        const ur = await getUserEntityReaction(entityType, entityId, user.id, chapterId);
        setUserReaction(ur);
    };

    const sortCommentsForState = (items: Comment[]) => items.slice().sort((a, b) => {
        const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinDiff !== 0) {
            return pinDiff;
        }

        if (sortBy === 'popular') {
            const likeDiff = b.likes - a.likes;
            if (likeDiff !== 0) {
                return likeDiff;
            }
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const shouldAutoExpandMedia = (comment: Comment) =>
        (commentPreferences.autoShowMedia && getCommentMediaUrls(comment).length > 0) ||
        (commentPreferences.autoShowGifs && Boolean(comment.gifUrl));

    useEffect(() => {
        setExpandedMedia((previous) => {
            let changed = false;
            const next = { ...previous };

            for (const comment of comments) {
                if (shouldAutoExpandMedia(comment) && !next[comment.id]) {
                    next[comment.id] = true;
                    changed = true;
                }
            }

            return changed ? next : previous;
        });
    }, [comments, commentPreferences.autoShowMedia, commentPreferences.autoShowGifs]);

    const handleReaction = async (type: string) => {
        if (!user) {
            toast.error('Tepki bırakmak için giriş yapmalısınız');
            return;
        }
        try {
            await addEntityReactionV2(entityType, entityId, user.id, type, chapterId);
            await loadReactions();
        } catch {
            toast.error('İşlem başarısız oldu');
        }
    };

    const reactionTypes = [
        { type: 'like', label: 'Beğendim', emoji: '👍' },
        { type: 'funny', label: 'Eğlenceli', emoji: '😂' },
        { type: 'love', label: 'Bayıldım', emoji: '😍' },
        { type: 'wow', label: 'Oha', emoji: '😲' },
        { type: 'angry', label: 'Sinir Bozucu', emoji: '😡' },
        { type: 'sad', label: 'Üzüldüm', emoji: '😢' },
    ];
    const commentReportReasons = [
        'Spam veya alakasız',
        'Hakaret veya nefret',
        'Spoiler bildirimi',
        'Yanlış bilgi',
        'Reklam veya dolandırıcılık',
        'Diğer',
    ];

    const searchGifs = async (query: string) => {
        if (!query.trim()) {
            setGifs([]);
            return;
        }

        try {
            const response = await fetch(
                `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&limit=20&media_filter=gif`
            );
            const data = await response.json();
            setGifs(data.results || []);
        } catch (error) {
            console.error('GIF search error:', error);
            try {
                const giphyResponse = await fetch(
                    `https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(query)}&limit=20`
                );
                const giphyData = await giphyResponse.json();
                setGifs(giphyData.data?.map((g: any) => ({
                    id: g.id,
                    media_formats: { tinygif: { url: g.images.fixed_height.url } }
                })) || []);
            } catch {
                toast.error('GIF araması başarısız oldu');
            }
        }
    };

    const validateDraft = (draft: CommentDraft) => {
        const normalizedDraft = normalizeDraft(draft);

        if (!commentHasRenderableContent({
            body: normalizedDraft.body,
            title: normalizedDraft.title,
            mediaUrls: normalizedDraft.mediaUrls,
            gifUrl: normalizedDraft.gifUrl,
        })) {
            toast.error('Yorum, başlık, medya veya GIF eklemelisiniz');
            return null;
        }

        if (!isValidCommentMediaUrls(normalizedDraft.mediaUrls)) {
            toast.error('Tüm görsel bağlantıları geçerli olmalı');
            return null;
        }

        return normalizedDraft;
    };

    const handleSubmitComment = async () => {
        if (!user) {
            toast.error('Yorum yapmak için giriş yapmalısınız');
            return;
        }

        const normalizedDraft = validateDraft(newDraft);
        if (!normalizedDraft) {
            return;
        }

        const createdComment = await addCommentV2({
            mangaId: entityType === 'manga' ? entityId : undefined,
            entityId: entityType !== 'manga' ? entityId : undefined,
            entityType,
            chapterId,
            userId: user.id,
            username: user.username,
            userAvatar: user.avatar,
            content: normalizedDraft.body,
            title: normalizedDraft.title || undefined,
            mediaUrl: normalizedDraft.mediaUrls[0] || undefined,
            mediaUrls: normalizedDraft.mediaUrls,
            isSpoiler: normalizedDraft.isSpoiler,
            gifUrl: normalizedDraft.gifUrl || undefined,
        });

        setNewDraft(createEmptyDraft());
        setNewComposerVersion((previous) => previous + 1);
        setCurrentPage(1);
        setComments((previous) => sortCommentsForState([createdComment, ...previous]));
        toast.success('Yorum eklendi');
    };

    const handleEditComment = async (commentId: string) => {
        const normalizedDraft = validateDraft(editDraft);
        if (!normalizedDraft) {
            return;
        }

        await updateComment(commentId, {
            content: normalizedDraft.body,
            title: normalizedDraft.title || undefined,
            mediaUrl: normalizedDraft.mediaUrls[0] || undefined,
            mediaUrls: normalizedDraft.mediaUrls,
            isSpoiler: normalizedDraft.isSpoiler,
            gifUrl: normalizedDraft.gifUrl || undefined,
        }, entityType);

        setEditingId(null);
        setEditDraft(createEmptyDraft());
        setEditMention(null);
        await loadComments();
            toast.success('Yorum güncellendi');
    };

    const handleDeleteComment = async (commentId: string) => {
        await deleteComment(commentId, entityType);
        await loadComments();
        toast.success('Yorum silindi');
    };

    const handleTogglePin = async (comment: Comment) => {
        if (user?.role !== 'admin' && user?.role !== 'moderator') {
            toast.error('Bu işlem için yetkiniz yok');
            return;
        }

        await setCommentPinned(comment.id, !comment.isPinned, entityType);
        await loadComments();
            toast.success(comment.isPinned ? 'Yorum sabitlemesi kaldırıldı' : 'Yorum sabitlendi');
    };

    const openCommentReport = (comment: Comment) => {
        if (!user) {
            toast.error('Yorum bildirmek için giriş yapmalısınız');
            return;
        }

        if (comment.userId === user.id) {
            toast.error('Kendi yorumunuzu bildiremezsiniz');
            return;
        }

        setReportingComment(comment);
        setReportReason('Spam veya alakasız');
        setReportDetails('');
    };

    const handleSubmitCommentReport = async () => {
        if (!user || !reportingComment) {
            toast.error('Bildirim için önce giriş yapmalısınız');
            return;
        }

        try {
            setIsSubmittingReport(true);
            await createCommentReport({
                commentId: reportingComment.id,
                commentEntityType: entityType,
                targetEntityId: entityId,
                reporterId: user.id,
                reportedUserId: reportingComment.userId,
                reason: reportReason,
                details: reportDetails,
            });
            toast.success('Yorum bildirimi admin ekibine iletildi');
            setReportingComment(null);
            setReportDetails('');
        } catch (error) {
            console.error('Comment report submit error:', error);
            toast.error('Yorum bildirimi gönderilemedi');
        } finally {
            setIsSubmittingReport(false);
        }
    };

    const handleReply = async (parentId: string) => {
        if (!user) {
            toast.error('Yanıt vermek için giriş yapmalısınız');
            return;
        }

        const parentComment = comments.find(c => c.id === parentId);
        if (!parentComment) {
            toast.error('Yanıtlanacak yorum bulunamadı');
            return;
        }

        const normalizedDraft = validateDraft({
            ...replyDraft,
            body: keepMentionPrefix(replyDraft.body, replyMention),
        });

        if (!normalizedDraft) {
            return;
        }

        const newCommentObj = await addCommentV2({
            mangaId: entityType === 'manga' ? entityId : undefined,
            entityId: entityType !== 'manga' ? entityId : undefined,
            entityType,
            chapterId,
            userId: user.id,
            username: user.username,
            userAvatar: user.avatar,
            content: normalizedDraft.body,
            title: normalizedDraft.title || undefined,
            mediaUrl: normalizedDraft.mediaUrls[0] || undefined,
            mediaUrls: normalizedDraft.mediaUrls,
            isSpoiler: normalizedDraft.isSpoiler,
            gifUrl: normalizedDraft.gifUrl || undefined,
            parentId,
        });

        setExpandedReplies(prev => ({ ...prev, [parentId]: true }));
        setReplyingTo(null);
        setReplyMention(null);
        setReplyDraft(createEmptyDraft());
        setComments((previous) => sortCommentsForState([newCommentObj, ...previous]));
            toast.success('Yanıt eklendi');

        if (parentComment && parentComment.userId !== user.id) {
            void (async () => {
                let entityTitle = 'Manga';
                if (entityType === 'manga') {
                    const manga = await getMangaById(entityId);
                    entityTitle = manga?.title || 'Manga';
                } else if (entityType === 'character') {
                    const character = await getCharacterById(entityId);
                    entityTitle = character?.name || 'Karakter';
                }

                await createCommentNotification(
                    parentComment.userId,
                    'reply',
                    user.id,
                    user.username,
                    entityId,
                    entityTitle,
                    newCommentObj.id,
                    chapterId,
                    entityType
                );
            })();
        }
    };

    const handleLike = async (commentId: string) => {
        if (!user) {
            toast.error('Beğenmek için giriş yapmalısınız');
            return;
        }

        const comment = comments.find(c => c.id === commentId);
        const wasLiked = comment?.likedBy.includes(user.id);

        await toggleCommentLike(commentId, user.id, entityType);

        if (!wasLiked && comment && comment.userId !== user.id) {
            let entityTitle = 'Manga';
            if (entityType === 'manga') {
                const manga = await getMangaById(entityId);
                entityTitle = manga?.title || 'Manga';
            } else if (entityType === 'character') {
                const character = await getCharacterById(entityId);
                entityTitle = character?.name || 'Karakter';
            }

            await createCommentNotification(
                comment.userId,
                'like',
                user.id,
                user.username,
                entityId,
                entityTitle,
                comment.id,
                chapterId,
                entityType
            );
        }

        await loadComments();
    };

    const selectGif = (gifUrl: string) => {
        if (gifTarget === 'new') {
            setNewDraft(prev => ({ ...prev, gifUrl }));
        } else if (gifTarget === 'edit') {
            setEditDraft(prev => ({ ...prev, gifUrl }));
        } else {
            setReplyDraft(prev => ({ ...prev, gifUrl }));
        }
        setShowGifPicker(false);
        setGifSearch('');
        setGifs([]);
    };

    const startEdit = (comment: Comment) => {
        if (!canEditComment(comment)) {
            toast.error('Yorumlar yalnızca ilk 24 saat içinde düzenlenebilir');
            return;
        }

        setEditingId(comment.id);
        setReplyingTo(null);
        setEditMention(extractMentionPrefix(comment.content));
        setEditDraft(createEmptyDraft({
            title: comment.title || '',
            body: comment.content,
            mediaUrls: getCommentMediaUrls(comment),
            isSpoiler: Boolean(comment.isSpoiler),
            gifUrl: comment.gifUrl || null,
        }));
    };

    const openReplyComposer = (comment: Comment) => {
        const mentionPrefix = `@${comment.username} `;

        if (replyingTo === comment.id) {
            setReplyingTo(null);
            setReplyMention(null);
            setReplyDraft(createEmptyDraft());
            return;
        }

        setEditingId(null);
        setReplyingTo(comment.id);
        setReplyMention(mentionPrefix);
        setReplyDraft(createEmptyDraft({ body: mentionPrefix }));
        setExpandedReplies(prev => ({ ...prev, [comment.id]: true }));
    };

    const mergedBlockedUserIds = useMemo(
        () => Array.from(new Set([...blockedUserIds, ...relationshipBlockedUserIds])),
        [blockedUserIds, relationshipBlockedUserIds]
    );

    const visibleComments = useMemo(
        () => comments.filter((comment) => !mergedBlockedUserIds.includes(comment.userId)),
        [comments, mergedBlockedUserIds]
    );

    const commentChildrenMap = useMemo(() => visibleComments.reduce<Record<string, Comment[]>>((accumulator, comment) => {
        const key = comment.parentId || 'root';

        if (!accumulator[key]) {
            accumulator[key] = [];
        }

        accumulator[key].push(comment);
        return accumulator;
    }, {}), [visibleComments]);

    const parentComments = commentChildrenMap.root || [];
    const totalPages = Math.max(1, Math.ceil(parentComments.length / PARENT_COMMENTS_PER_PAGE));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const displayedParentComments = parentComments.slice(
        (safeCurrentPage - 1) * PARENT_COMMENTS_PER_PAGE,
        safeCurrentPage * PARENT_COMMENTS_PER_PAGE
    );
    const getReplies = (parentId: string) => commentChildrenMap[parentId] || [];
    const commentById = useMemo(
        () => visibleComments.reduce<Record<string, Comment>>((accumulator, comment) => {
            accumulator[comment.id] = comment;
            return accumulator;
        }, {}),
        [visibleComments]
    );

    const getCommentRootParentId = (commentId: string) => {
        let current = commentById[commentId];

        while (current?.parentId) {
            current = commentById[current.parentId];
        }

        return current?.id || null;
    };

    const getCommentAncestorIds = (commentId: string) => {
        const ancestors: string[] = [];
        let current = commentById[commentId];

        while (current?.parentId) {
            ancestors.push(current.parentId);
            current = commentById[current.parentId];
        }

        return ancestors;
    };

    const getCommentPage = (commentId: string) => {
        const rootParentId = getCommentRootParentId(commentId);
        if (!rootParentId) {
            return 1;
        }

        const parentIndex = parentComments.findIndex((comment) => comment.id === rootParentId);
        if (parentIndex === -1) {
            return 1;
        }

        return Math.floor(parentIndex / PARENT_COMMENTS_PER_PAGE) + 1;
    };

    const getReplyCount = (parentId: string): number => {
        const replies = getReplies(parentId);

        if (replies.length === 0) {
            return 0;
        }

        return replies.reduce((total, reply) => total + 1 + getReplyCount(reply.id), 0);
    };

    useEffect(() => {
        if (!commentPreferences.autoShowReplies) {
            return;
        }

        setExpandedReplies((previous) => {
            let changed = false;
            const next = { ...previous };

            for (const [parentId, replies] of Object.entries(commentChildrenMap)) {
                if (parentId === 'root' || replies.length === 0) {
                    continue;
                }

                if (!next[parentId]) {
                    next[parentId] = true;
                    changed = true;
                }
            }

            return changed ? next : previous;
        });
    }, [commentChildrenMap, commentPreferences.autoShowReplies]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    useEffect(() => {
        const targetCommentId = getTargetCommentIdFromLocation(location.search, location.hash);
        if (!targetCommentId || !commentById[targetCommentId]) {
            return;
        }

        const targetPage = getCommentPage(targetCommentId);
        const ancestorIds = getCommentAncestorIds(targetCommentId);

        setExpandedReplies((previous) => {
            const next = { ...previous };
            let changed = false;

            for (const ancestorId of ancestorIds) {
                if (!next[ancestorId]) {
                    next[ancestorId] = true;
                    changed = true;
                }
            }

            return changed ? next : previous;
        });
        setCurrentPage(targetPage);
        setPendingScrollCommentId(targetCommentId);
    }, [commentById, getCommentPage, getCommentAncestorIds, location.hash, location.search]);

    useEffect(() => {
        if (!pendingScrollCommentId) {
            return;
        }

        let attempts = 0;
        let isCancelled = false;
        let timerId: number | null = null;

        const scrollToComment = () => {
            if (isCancelled) {
                return;
            }

            const targetElement = document.querySelector<HTMLElement>(`[data-comment-id="${pendingScrollCommentId}"]`);
            if (!targetElement) {
                if (attempts < 10) {
                    attempts += 1;
                    timerId = window.setTimeout(scrollToComment, 120);
                }
                return;
            }

            const targetTop = window.scrollY + targetElement.getBoundingClientRect().top - 140;
            window.scrollTo({
                top: Math.max(0, targetTop),
                behavior: 'smooth',
            });

            if (highlightTimeoutRef.current !== null) {
                window.clearTimeout(highlightTimeoutRef.current);
            }

            setHighlightedCommentId(pendingScrollCommentId);
            highlightTimeoutRef.current = window.setTimeout(() => {
                setHighlightedCommentId((current) => current === pendingScrollCommentId ? null : current);
            }, COMMENT_HIGHLIGHT_DURATION_MS);

            setPendingScrollCommentId(null);
            clearTargetCommentFromCurrentUrl();
        };

        timerId = window.setTimeout(scrollToComment, 80);

        return () => {
            isCancelled = true;
            if (timerId !== null) {
                window.clearTimeout(timerId);
            }
        };
    }, [displayedParentComments, expandedReplies, pendingScrollCommentId]);

    const paginationWindow = useMemo(() => {
        if (totalPages <= 5) {
            return Array.from({ length: totalPages }, (_, index) => index + 1);
        }

        const start = Math.max(1, safeCurrentPage - 2);
        const end = Math.min(totalPages, start + 4);
        const adjustedStart = Math.max(1, end - 4);

        return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index);
    }, [safeCurrentPage, totalPages]);

    const toggleReplies = (commentId: string) => {
        setExpandedReplies(prev => ({ ...prev, [commentId]: !prev[commentId] }));
    };

    const toggleMedia = (commentId: string) => {
        setExpandedMedia(prev => ({ ...prev, [commentId]: !prev[commentId] }));
    };

    const toggleSpoiler = (commentId: string) => {
        setRevealedSpoilers(prev => ({ ...prev, [commentId]: !prev[commentId] }));
    };

    const markMediaAsFailed = (key: string) => {
        setMediaLoadErrors(prev => ({ ...prev, [key]: true }));
    };

    const getReplyIndentClass = (depth: number) => {
        if (depth <= 1) {
            return '';
        }

        if (depth === 2) {
            return 'ml-4';
        }

        if (depth === 3) {
            return 'ml-8';
        }

        return '';
    };

    const getReplyThreadClassName = (depth: number) => {
        if (depth === 1) {
            return 'space-y-3 border-l-2 border-border pl-4';
        }

        if (depth > MAX_REPLY_INDENT_LEVEL) {
            return 'mt-3 space-y-3';
        }

        return cn('mt-3 space-y-3 border-l border-border/60 pl-3', getReplyIndentClass(depth));
    };

    const renderReplyThread = (parentId: string, depth = 1): React.ReactNode => {
        const replies = getReplies(parentId);

        if (replies.length === 0) {
            return null;
        }

        return (
            <div className={getReplyThreadClassName(depth)}>
                {replies.map((reply) => {
                    const hasNestedReplies = getReplies(reply.id).length > 0;
                    const useNestedCardStyle = depth >= 2;
                    const nextDepth = depth + 1;
                    const nestedReplies = hasNestedReplies ? renderReplyThread(reply.id, nextDepth) : null;
                    const renderNestedAsSibling = depth >= MAX_REPLY_INDENT_LEVEL;

                    return (
                        <div
                            key={reply.id}
                            data-comment-id={reply.id}
                            className={cn(
                                'relative overflow-hidden rounded-lg transition-all',
                                highlightedCommentId === reply.id && 'ring-2 ring-primary/70 bg-primary/10 shadow-[0_0_28px_rgba(59,130,246,0.22)]',
                                reply.isPinned
                                    ? 'border border-primary/30 bg-primary/5 p-2'
                                    : useNestedCardStyle
                                        ? 'border border-border/60 bg-background/30 p-3'
                                        : ''
                            )}
                        >
                            <div className="flex gap-2 transition-all duration-300">
                                <Link to={`/profile/${reply.userId}`} className="shrink-0 transition-transform hover:scale-105">
                                    <Avatar className="h-8 w-8 border border-transparent text-foreground transition-colors hover:border-primary">
                                        <AvatarImage src={reply.userAvatar} />
                                        <AvatarFallback>{reply.username[0].toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                </Link>

                                <div className="flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Link to={`/profile/${reply.userId}`} className="text-sm font-medium text-foreground transition-colors hover:text-primary hover:underline">
                                                {reply.username}
                                            </Link>
                                            {reply.isPinned && (
                                                <Badge variant="secondary" className="h-5 gap-1 px-2 text-[10px] uppercase tracking-wide">
                                                    <Pin className="h-3 w-3" />
                                                    Sabit
                                                </Badge>
                                            )}
                                            <span className="text-xs text-muted-foreground">
                                                {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true, locale: tr })}
                                                {reply.updatedAt && new Date(reply.updatedAt).getTime() - new Date(reply.createdAt).getTime() > 2000 && ' (düzenlendi)'}
                                            </span>
                                        </div>

                                        {(user?.id === reply.userId || user?.role === 'admin' || user?.role === 'moderator') && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {(user?.role === 'admin' || user?.role === 'moderator') && (
                                                        <DropdownMenuItem onClick={() => handleTogglePin(reply)}>
                                                            <Pin className="mr-2 h-4 w-4" />
                                                            {reply.isPinned ? 'Sabitlemeyi Kaldır' : 'Sabitle'}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {canEditComment(reply) && (
                                                        <DropdownMenuItem onClick={() => startEdit(reply)}>
                                                            <Edit2 className="mr-2 h-4 w-4" />
                                                            Düzenle
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem
                                                        onClick={() => handleDeleteComment(reply.id)}
                                                        className="text-destructive"
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Sil
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </div>

                                    {editingId === reply.id ? (
                                        <div className="mt-2">
                                            <CommentComposer
                                                key={`edit-${reply.id}`}
                                                draft={editDraft}
                                                placeholder="Yorumu düzenle..."
                                                submitLabel="Kaydet"
                                                compact
                                                onDraftChange={(draft) => setEditDraft({ ...draft, body: keepMentionPrefix(draft.body, editMention) })}
                                                onOpenGifPicker={() => {
                                                    setGifTarget('edit');
                                                    setShowGifPicker(true);
                                                }}
                                                onSubmit={() => handleEditComment(reply.id)}
                                                onCancel={() => {
                                                    setEditingId(null);
                                                    setEditMention(null);
                                                    setEditDraft(createEmptyDraft());
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {reply.title && <h4 className="font-bold text-foreground">{reply.title}</h4>}
                                            <p className="text-sm leading-relaxed text-foreground/90">
                                                {renderFormattedText(reply.content)}
                                            </p>
                                            {(getCommentMediaUrls(reply).length > 0 || reply.gifUrl) && (
                                                <Button variant="outline" size="sm" onClick={() => toggleMedia(reply.id)}>
                                                    {expandedMedia[reply.id] ? 'Medyayı Gizle' : 'Medyayı Görüntüle'}
                                                </Button>
                                            )}
                                            {expandedMedia[reply.id] && getCommentMediaUrls(reply).map((mediaUrl, index) => (
                                                <img
                                                    key={`${reply.id}-media-${index}`}
                                                    src={mediaUrl}
                                                    alt={`Reply media ${index + 1}`}
                                                    className="mt-2 max-h-64 rounded-lg"
                                                    onError={() => markMediaAsFailed(`${reply.id}:media:${index}`)}
                                                />
                                            ))}
                                            {expandedMedia[reply.id] && reply.gifUrl && (
                                                <img
                                                    src={reply.gifUrl}
                                                    alt="Reply GIF"
                                                    className="mt-2 max-h-48 rounded-lg"
                                                    onError={() => markMediaAsFailed(`${reply.id}:gif`)}
                                                />
                                            )}
                                        </div>
                                    )}

                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => handleLike(reply.id)} className={reply.likedBy.includes(user?.id || '') ? 'text-primary' : ''}>
                                            <ThumbsUp className="mr-1 h-4 w-4" />
                                            {reply.likes}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => openReplyComposer(reply)}>
                                            <Reply className="mr-1 h-4 w-4" />
                                            Yanıtla
                                        </Button>
                                        {user && user.id !== reply.userId && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openCommentReport(reply)}
                                                className="text-muted-foreground hover:text-amber-200"
                                            >
                                                <Flag className="mr-1 h-4 w-4" />
                                                Bildir
                                            </Button>
                                        )}
                                    </div>

                                    {replyingTo === reply.id && user && (
                                        <div className="mt-3">
                                            <CommentComposer
                                                key={`reply-${reply.id}`}
                                                draft={replyDraft}
                                                placeholder={`@${reply.username} için yanıt yaz...`}
                                                submitLabel="Yanıtı Gönder"
                                                compact
                                                onDraftChange={(draft) => setReplyDraft({ ...draft, body: keepMentionPrefix(draft.body, replyMention) })}
                                                onOpenGifPicker={() => {
                                                    setGifTarget('reply');
                                                    setShowGifPicker(true);
                                                }}
                                                onSubmit={() => handleReply(reply.id)}
                                                onCancel={() => {
                                                    setReplyingTo(null);
                                                    setReplyMention(null);
                                                    setReplyDraft(createEmptyDraft());
                                                }}
                                            />
                                        </div>
                                    )}

                                    {!renderNestedAsSibling && nestedReplies}
                                </div>
                            </div>

                            {renderNestedAsSibling && nestedReplies}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="space-y-8">
            <div className="text-center space-y-6 py-6 pb-12 border-b border-border/50">
                <div className="space-y-1">
                    <h2 className="text-2xl font-black tracking-tight">Ne Düşünüyorsun?</h2>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Emojiler</p>
                </div>

                <div className="flex flex-wrap justify-center gap-4">
                    {reactionTypes.map((r) => (
                        <div key={r.type} className="flex flex-col items-center gap-2">
                            <button
                                onClick={() => handleReaction(r.type)}
                                className={`group flex items-center gap-2 px-6 py-2.5 rounded-full border-2 transition-all duration-300 ${userReaction === r.type
                                    ? 'bg-primary/20 border-primary text-primary shadow-lg shadow-primary/10'
                                    : 'bg-card border-border hover:border-primary/50 hover:bg-secondary/50'
                                    }`}
                            >
                                <span className="text-xl transition-transform group-hover:scale-125 duration-300">
                                    {r.emoji}
                                </span>
                                <span className="font-bold text-sm min-w-[2ch]">
                                    {reactions[r.type] || 0}
                                </span>
                            </button>
                            <span className={`text-xs font-semibold ${userReaction === r.type ? 'text-primary' : 'text-muted-foreground'}`}>
                                {r.label}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <MessageCircle className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-bold">Yorumlar ({visibleComments.length})</h3>
                    {parentComments.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                            Sayfa {safeCurrentPage} / {totalPages}
                        </span>
                    )}
                </div>

                <div className="flex items-center bg-secondary/30 rounded-lg p-1">
                    <button
                        onClick={() => setSortBy('newest')}
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${sortBy === 'newest'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        En Yeni
                    </button>
                    <button
                        onClick={() => setSortBy('popular')}
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${sortBy === 'popular'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        Popüler
                    </button>
                </div>
            </div>

            {user ? (
                <CommentComposer
                    key={`new-${newComposerVersion}`}
                    avatar={user.avatar}
                    username={user.username}
                    draft={newDraft}
                    placeholder="Bir yorum yazın, başlık ekleyin, spoiler işaretleyin veya görsel bağlantısı bırakın..."
                    submitLabel="Gönder"
                    onDraftChange={setNewDraft}
                    onOpenGifPicker={() => {
                        setGifTarget('new');
                        setShowGifPicker(true);
                    }}
                    onSubmit={handleSubmitComment}
                />
            ) : (
                <div className="rounded-lg border border-border bg-card/50 p-4 text-center">
                    <p className="text-muted-foreground">Yorum yapmak için <a href="/auth" className="text-primary hover:underline">giriş yapın</a></p>
                </div>
            )}

            <div className="space-y-4">
                {displayedParentComments.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                        Henüz yorum yok. İlk yorumu siz yapın!
                    </div>
                ) : (
                    <>
                        {displayedParentComments.map((comment) => {
                            return (
                                <div
                                    key={comment.id}
                                    data-comment-id={comment.id}
                                    className={cn(
                                        'relative overflow-hidden rounded-lg border p-4 transition-all',
                                        highlightedCommentId === comment.id && 'ring-2 ring-primary/70 bg-primary/10 shadow-[0_0_32px_rgba(59,130,246,0.22)]',
                                        comment.isPinned ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/50'
                                    )}
                                >
                                    <div className="transition-all duration-300">
                                        <div className="flex gap-3">
                                            <Link to={`/profile/${comment.userId}`} className="shrink-0 transition-transform hover:scale-105">
                                                <Avatar className="h-10 w-10 border border-transparent hover:border-primary transition-colors cursor-pointer text-foreground">
                                                    <AvatarImage src={comment.userAvatar} />
                                                    <AvatarFallback>{comment.username[0].toUpperCase()}</AvatarFallback>
                                                </Avatar>
                                            </Link>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Link to={`/profile/${comment.userId}`} className="font-medium hover:text-primary hover:underline transition-colors cursor-pointer text-foreground">
                                                            {comment.username}
                                                        </Link>
                                                        {comment.isPinned && (
                                                            <Badge variant="secondary" className="h-5 gap-1 px-2 text-[10px] uppercase tracking-wide">
                                                                <Pin className="h-3 w-3" />
                                                                Sabit
                                                            </Badge>
                                                        )}
                                                        <span className="text-xs text-muted-foreground">
                                                            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: tr })}
                                                            {comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 2000 && ' (düzenlendi)'}
                                                        </span>
                                                    </div>

                                                    {(user?.id === comment.userId || user?.role === 'admin' || user?.role === 'moderator') && (
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                                    <MoreVertical className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                {(user?.role === 'admin' || user?.role === 'moderator') && (
                                                                    <DropdownMenuItem onClick={() => handleTogglePin(comment)}>
                                                                        <Pin className="mr-2 h-4 w-4" />
                                                                        {comment.isPinned ? 'Sabitlemeyi Kaldır' : 'Sabitle'}
                                                                    </DropdownMenuItem>
                                                                )}
                                                                                            {canEditComment(comment) && (
                                                                                                <DropdownMenuItem onClick={() => startEdit(comment)}>
                                                                                                    <Edit2 className="mr-2 h-4 w-4" />
                                                                                                    Düzenle
                                                                                                </DropdownMenuItem>
                                                                                            )}
                                                                <DropdownMenuItem
                                                                    onClick={() => handleDeleteComment(comment.id)}
                                                                    className="text-destructive"
                                                                >
                                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                                    Sil
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    )}
                                                </div>

                                                {editingId === comment.id ? (
                                                    <div className="mt-2">
                                                        <CommentComposer
                                                            key={`edit-${comment.id}`}
                                                            draft={editDraft}
                                                            placeholder="Yorumu düzenle..."
                                                            submitLabel="Kaydet"
                                                            compact
                                                            onDraftChange={(draft) => setEditDraft({ ...draft, body: keepMentionPrefix(draft.body, editMention) })}
                                                            onOpenGifPicker={() => {
                                                                setGifTarget('edit');
                                                                setShowGifPicker(true);
                                                            }}
                                                            onSubmit={() => handleEditComment(comment.id)}
                                                            onCancel={() => {
                                                                setEditingId(null);
                                                                setEditMention(null);
                                                                setEditDraft(createEmptyDraft());
                                                            }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="mt-2 space-y-2">
                                                        {comment.isSpoiler && !revealedSpoilers[comment.id] ? (
                                                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <span className="flex items-center gap-2">
                                                                        <AlertTriangle className="h-4 w-4" />
                                                                        Bu yorum spoiler olarak işaretlendi.
                                                                    </span>
                                                                    <Button size="sm" variant="secondary" onClick={() => toggleSpoiler(comment.id)}>
                                                                        <Eye className="mr-2 h-4 w-4" />
                                                                        Spoileri Göster
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {comment.title && <h4 className="font-bold text-foreground">{comment.title}</h4>}
                                                                <p className="text-foreground/90 leading-relaxed font-sans">
                                                                    {renderFormattedText(comment.content)}
                                                                </p>

                                                                {comment.isSpoiler && (
                                                                    <Button variant="ghost" size="sm" className="px-0 text-amber-200 hover:text-amber-100" onClick={() => toggleSpoiler(comment.id)}>
                                                                        <EyeOff className="mr-2 h-4 w-4" />
                                                                        Spoileri Gizle
                                                                    </Button>
                                                                )}

                                                                {(getCommentMediaUrls(comment).length > 0 || comment.gifUrl) && (
                                                                    <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                                                                        <Button variant="outline" size="sm" onClick={() => toggleMedia(comment.id)}>
                                                                            {expandedMedia[comment.id] ? (
                                                                                <>
                                                                                    <EyeOff className="mr-2 h-4 w-4" />
                                                                                    Medyayı Gizle
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <Eye className="mr-2 h-4 w-4" />
                                                                                    Medyayı Görüntüle
                                                                                </>
                                                                            )}
                                                                        </Button>

                                                                        {expandedMedia[comment.id] && (
                                                                            <div className="mt-3 space-y-3">
                                                                                {getCommentMediaUrls(comment).map((mediaUrl, index) => (
                                                                                    mediaLoadErrors[`${comment.id}:media:${index}`] ? (
                                                                                        <div key={`${comment.id}-media-error-${index}`} className="text-sm text-destructive">Görsel yüklenemedi.</div>
                                                                                    ) : (
                                                                                        <img
                                                                                            key={`${comment.id}-media-${index}`}
                                                                                            src={mediaUrl}
                                                                                            alt={`Comment media ${index + 1}`}
                                                                                            className="max-h-[30rem] w-full rounded-lg object-contain"
                                                                                            onError={() => markMediaAsFailed(`${comment.id}:media:${index}`)}
                                                                                        />
                                                                                    )
                                                                                ))}

                                                                                {comment.gifUrl && (
                                                                                    mediaLoadErrors[`${comment.id}:gif`] ? (
                                                                                        <div className="text-sm text-destructive">GIF yüklenemedi.</div>
                                                                                    ) : (
                                                                                        <img
                                                                                            src={comment.gifUrl}
                                                                                            alt="Comment GIF"
                                                                                            className="max-h-48 rounded-lg"
                                                                                            onError={() => markMediaAsFailed(`${comment.id}:gif`)}
                                                                                        />
                                                                                    )
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="mt-3 flex items-center gap-4">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleLike(comment.id)}
                                                        className={comment.likedBy.includes(user?.id || '') ? 'text-primary' : ''}
                                                    >
                                                        <ThumbsUp className="mr-1 h-4 w-4" />
                                                        {comment.likes}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => openReplyComposer(comment)}
                                                    >
                                                        <Reply className="mr-1 h-4 w-4" />
                                                        Yanıtla
                                                    </Button>
                                                    {user && user.id !== comment.userId && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => openCommentReport(comment)}
                                                            className="text-muted-foreground hover:text-amber-200"
                                                        >
                                                            <Flag className="mr-1 h-4 w-4" />
                                                            Bildir
                                                        </Button>
                                                    )}
                                                    {getReplies(comment.id).length > 0 && (
                                                        <Button variant="ghost" size="sm" onClick={() => toggleReplies(comment.id)}>
                                                            {expandedReplies[comment.id] ? (
                                                                <>
                                                                    <ChevronUp className="mr-1 h-4 w-4" />
                                                                    Yanıtları Gizle
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <ChevronDown className="mr-1 h-4 w-4" />
                                                                    Yanıtları Göster ({getReplyCount(comment.id)})
                                                                </>
                                                            )}
                                                        </Button>
                                                    )}
                                                </div>

                                                {replyingTo === comment.id && user && (
                                                    <div className="mt-3">
                                                        <CommentComposer
                                                            key={`reply-${comment.id}`}
                                                            draft={replyDraft}
                                                            placeholder={`@${comment.username} için yanıt yaz...`}
                                                            submitLabel="Yanıtı Gönder"
                                                            compact
                                                            onDraftChange={(draft) => setReplyDraft({ ...draft, body: keepMentionPrefix(draft.body, replyMention) })}
                                                            onOpenGifPicker={() => {
                                                                setGifTarget('reply');
                                                                setShowGifPicker(true);
                                                            }}
                                                            onSubmit={() => handleReply(comment.id)}
                                                            onCancel={() => {
                                                                setReplyingTo(null);
                                                                setReplyMention(null);
                                                                setReplyDraft(createEmptyDraft());
                                                            }}
                                                        />
                                                    </div>
                                                )}

                                                {getReplies(comment.id).length > 0 && (
                                                    <div
                                                        className={cn(
                                                            'grid transition-all duration-200 ease-out',
                                                            expandedReplies[comment.id] ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                                                        )}
                                                    >
                                                        <div className="min-h-0 overflow-hidden">
                                                            {renderReplyThread(comment.id)}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {totalPages > 1 && (
                            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-border/50 pt-4">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={safeCurrentPage === 1}
                                    onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                                >
                                    Önceki
                                </Button>

                                {paginationWindow.map((pageNumber) => (
                                    <Button
                                        key={pageNumber}
                                        variant={pageNumber === safeCurrentPage ? 'default' : 'ghost'}
                                        size="sm"
                                        onClick={() => setCurrentPage(pageNumber)}
                                    >
                                        {pageNumber}
                                    </Button>
                                ))}

                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={safeCurrentPage === totalPages}
                                    onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                                >
                                    Sonraki
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <Dialog open={Boolean(reportingComment)} onOpenChange={(open) => {
                if (!open) {
                    setReportingComment(null);
                    setReportDetails('');
                }
            }}>
                <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>Yorumu Bildir</DialogTitle>
                        <DialogDescription>
                            Problemli yorumları buradan admin paneline iletebilirsiniz.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                            <p className="text-sm font-medium">{reportingComment?.username}</p>
                            <p className="mt-2 text-sm text-muted-foreground line-clamp-4">
                                {reportingComment?.content ? stripCommentFormatting(reportingComment.content) : 'Yorum önizlemesi bulunamadı.'}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Neden</label>
                            <div className="flex flex-wrap gap-2">
                                {commentReportReasons.map((reason) => (
                                    <Button
                                        key={reason}
                                        type="button"
                                        variant={reportReason === reason ? 'default' : 'outline'}
                                        size="sm"
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
                                placeholder="İsterseniz yoruma dair kısa bir not ekleyin."
                                className="min-h-[140px]"
                                maxLength={500}
                            />
                            <p className="text-xs text-muted-foreground">{reportDetails.length}/500</p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setReportingComment(null);
                                setReportDetails('');
                            }}
                        >
                            İptal
                        </Button>
                        <Button onClick={handleSubmitCommentReport} disabled={isSubmittingReport}>
                            {isSubmittingReport ? 'Gönderiliyor...' : 'Bildirimi Gönder'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showGifPicker} onOpenChange={setShowGifPicker}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>GIF Seç</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <input
                            type="text"
                            placeholder="GIF ara..."
                            value={gifSearch}
                            onChange={(e) => {
                                setGifSearch(e.target.value);
                                searchGifs(e.target.value);
                            }}
                            className="w-full rounded-lg border border-border bg-background px-4 py-2"
                        />
                        <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto">
                            {gifs.map((gif) => (
                                <button
                                    key={gif.id}
                                    onClick={() => selectGif(gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url)}
                                    className="overflow-hidden rounded-lg transition-transform hover:scale-105"
                                >
                                    <img
                                        src={gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url}
                                        alt="GIF"
                                        className="h-24 w-full object-cover"
                                    />
                                </button>
                            ))}
                        </div>
                        {gifs.length === 0 && gifSearch && (
                            <p className="py-8 text-center text-muted-foreground">GIF bulunamadı</p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default CommentSection;
