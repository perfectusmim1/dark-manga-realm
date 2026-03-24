import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
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
    addCommentV2
} from '@/lib/database';
import { commentHasRenderableContent, isValidCommentMediaUrls, stripCommentFormatting } from '@/lib/commentContent';
import { getBlockedUserIds } from '@/lib/profile';
import { createCommentNotification } from '@/lib/storage';
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
const MAX_VISIBLE_PARENT_COMMENTS = 8;

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
            return <span key={i} className="font-medium text-primary">{part}</span>;
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
            {line}
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
                                    <img src={draft.gifUrl} alt="Secili GIF" className="max-h-32 rounded-xl object-cover" />
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
                                        placeholder={`Gorsel linki ${index + 1}`}
                                        value={mediaUrl}
                                        onChange={(event) => updateMediaUrl(index, event.target.value)}
                                        className="h-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" onClick={() => removeMediaField(index)}>
                                        Kaldir
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
                                Gorsel Ekle
                            </Button>
                            <label className="ml-1 flex items-center gap-2 text-sm text-muted-foreground">
                                <Checkbox
                                    checked={draft.isSpoiler}
                                    onCheckedChange={(checked) => setField('isSpoiler', checked === true)}
                                />
                                Spoiler olarak isaretle
                            </label>
                        </div>

                        <div className="flex items-center gap-2">
                            {onCancel && (
                                <Button variant="ghost" size="sm" onClick={onCancel}>
                                    Iptal
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
    const [showAllComments, setShowAllComments] = useState(false);
    const [sortBy, setSortBy] = useState<'newest' | 'popular'>('newest');
    const [reactions, setReactions] = useState<Record<string, number>>({});
    const [userReaction, setUserReaction] = useState<string | null>(null);
    const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
    const [expandedMedia, setExpandedMedia] = useState<Record<string, boolean>>({});
    const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
    const [mediaLoadErrors, setMediaLoadErrors] = useState<Record<string, boolean>>({});

    useEffect(() => {
        loadComments();
        loadReactions();
    }, [entityId, entityType, chapterId, sortBy]);

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

    const handleReaction = async (type: string) => {
        if (!user) {
            toast.error('Tepki birakmak icin giris yapmalisiniz');
            return;
        }
        try {
            await addEntityReactionV2(entityType, entityId, user.id, type, chapterId);
            await loadReactions();
        } catch {
            toast.error('Islem basarisiz oldu');
        }
    };

    const reactionTypes = [
        { type: 'like', label: 'Begendim', emoji: '👍' },
        { type: 'funny', label: 'Eglenceli', emoji: '😂' },
        { type: 'love', label: 'Bayildim', emoji: '😍' },
        { type: 'wow', label: 'Oha', emoji: '😲' },
        { type: 'angry', label: 'Sinir Bozucu', emoji: '😡' },
        { type: 'sad', label: 'Uzuldu m', emoji: '😢' },
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
                toast.error('GIF aramasi basarisiz oldu');
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
            toast.error('Yorum, baslik, medya veya GIF eklemelisiniz');
            return null;
        }

        if (!isValidCommentMediaUrls(normalizedDraft.mediaUrls)) {
            toast.error('Tum gorsel baglantilari gecerli olmali');
            return null;
        }

        return normalizedDraft;
    };

    const handleSubmitComment = async () => {
        if (!user) {
            toast.error('Yorum yapmak icin giris yapmalisiniz');
            return;
        }

        const normalizedDraft = validateDraft(newDraft);
        if (!normalizedDraft) {
            return;
        }

        await addCommentV2({
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
        await loadComments();
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
        toast.success('Yorum guncellendi');
    };

    const handleDeleteComment = async (commentId: string) => {
        await deleteComment(commentId, entityType);
        await loadComments();
        toast.success('Yorum silindi');
    };

    const handleReply = async (parentId: string) => {
        if (!user) {
            toast.error('Yanit vermek icin giris yapmalisiniz');
            return;
        }

        const parentComment = comments.find(c => c.id === parentId);
        if (!parentComment) {
            toast.error('Yanitlanacak yorum bulunamadi');
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

        if (parentComment && parentComment.userId !== user.id) {
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
        }

        setExpandedReplies(prev => ({ ...prev, [parentId]: true }));
        setReplyingTo(null);
        setReplyMention(null);
        setReplyDraft(createEmptyDraft());
        await loadComments();
        toast.success('Yanit eklendi');
    };

    const handleLike = async (commentId: string) => {
        if (!user) {
            toast.error('Begenmek icin giris yapmalisiniz');
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
    const displayedParentComments = showAllComments ? parentComments : parentComments.slice(0, MAX_VISIBLE_PARENT_COMMENTS);
    const getReplies = (parentId: string) => commentChildrenMap[parentId] || [];

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
                    placeholder="Bir yorum yazin, baslik ekleyin, spoiler isaretleyin veya gorsel baglantisi birakin..."
                    submitLabel="Gonder"
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
                                <div key={comment.id} className="relative rounded-lg border border-border bg-card/50 p-4 transition-all overflow-hidden">
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
                                                                <DropdownMenuItem onClick={() => startEdit(comment)}>
                                                                    <Edit2 className="mr-2 h-4 w-4" />
                                                                    Düzenle
                                                                </DropdownMenuItem>
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
                                                            placeholder="Yorumu duzenle..."
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
                                                                        Bu yorum spoiler olarak isaretlendi.
                                                                    </span>
                                                                    <Button size="sm" variant="secondary" onClick={() => toggleSpoiler(comment.id)}>
                                                                        <Eye className="mr-2 h-4 w-4" />
                                                                        Spoileri Goster
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
                                                                                    Medyayi Gizle
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <Eye className="mr-2 h-4 w-4" />
                                                                                    Medyayi Goruntule
                                                                                </>
                                                                            )}
                                                                        </Button>

                                                                        {expandedMedia[comment.id] && (
                                                                            <div className="mt-3 space-y-3">
                                                                                {getCommentMediaUrls(comment).map((mediaUrl, index) => (
                                                                                    mediaLoadErrors[`${comment.id}:media:${index}`] ? (
                                                                                        <div key={`${comment.id}-media-error-${index}`} className="text-sm text-destructive">Gorsel yuklenemedi.</div>
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
                                                                                        <div className="text-sm text-destructive">GIF yuklenemedi.</div>
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
                                                    {getReplies(comment.id).length > 0 && (
                                                        <Button variant="ghost" size="sm" onClick={() => toggleReplies(comment.id)}>
                                                            {expandedReplies[comment.id] ? (
                                                                <>
                                                                    <ChevronUp className="mr-1 h-4 w-4" />
                                                                    Yanitlari Gizle
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <ChevronDown className="mr-1 h-4 w-4" />
                                                                    Yanitlari Goster ({getReplies(comment.id).length})
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
                                                            placeholder={`@${comment.username} icin yanit yaz...`}
                                                            submitLabel="Yaniti Gonder"
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

                                                {getReplies(comment.id).length > 0 && expandedReplies[comment.id] && (
                                                    <div className="mt-4 space-y-3 border-l-2 border-border pl-4">
                                                        {getReplies(comment.id).map((reply) => {
                                                            return (
                                                                <div key={reply.id} className="relative transition-all overflow-hidden rounded-lg">
                                                                    <div className="flex gap-2 transition-all duration-300">
                                                                        <Link to={`/profile/${reply.userId}`} className="shrink-0 transition-transform hover:scale-105">
                                                                            <Avatar className="h-8 w-8 border border-transparent hover:border-primary transition-colors cursor-pointer text-foreground">
                                                                                <AvatarImage src={reply.userAvatar} />
                                                                                <AvatarFallback>{reply.username[0].toUpperCase()}</AvatarFallback>
                                                                            </Avatar>
                                                                        </Link>
                                                                        <div className="flex-1">
                                                                            <div className="flex items-center justify-between">
                                                                                <div className="flex items-center gap-2">
                                                                                    <Link to={`/profile/${reply.userId}`} className="text-sm font-medium hover:text-primary hover:underline transition-colors text-foreground">
                                                                                        {reply.username}
                                                                                    </Link>
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
                                                                                            <DropdownMenuItem onClick={() => startEdit(reply)}>
                                                                                                <Edit2 className="mr-2 h-4 w-4" />
                                                                                                Düzenle
                                                                                            </DropdownMenuItem>
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
                                                                                        placeholder="Yorumu duzenle..."
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
                                                                                    <p className="text-sm text-foreground/90 leading-relaxed">
                                                                                        {renderFormattedText(reply.content)}
                                                                                    </p>
                                                                                    {(getCommentMediaUrls(reply).length > 0 || reply.gifUrl) && (
                                                                                        <Button variant="outline" size="sm" onClick={() => toggleMedia(reply.id)}>
                                                                                            {expandedMedia[reply.id] ? 'Medyayi Gizle' : 'Medyayi Goruntule'}
                                                                                        </Button>
                                                                                    )}
                                                                                    {expandedMedia[reply.id] && getCommentMediaUrls(reply).map((mediaUrl, index) => (
                                                                                        <img
                                                                                            key={`${reply.id}-media-${index}`}
                                                                                            src={mediaUrl}
                                                                                            alt={`Reply media ${index + 1}`}
                                                                                            className="max-h-64 rounded-lg mt-2"
                                                                                            onError={() => markMediaAsFailed(`${reply.id}:media:${index}`)}
                                                                                        />
                                                                                    ))}
                                                                                    {expandedMedia[reply.id] && reply.gifUrl && (
                                                                                        <img
                                                                                            src={reply.gifUrl}
                                                                                            alt="Reply GIF"
                                                                                            className="max-h-48 rounded-lg mt-2"
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
                                                                                    Yanitla
                                                                                </Button>
                                                                            </div>

                                                                            {replyingTo === reply.id && user && (
                                                                                <div className="mt-3">
                                                                                    <CommentComposer
                                                                                        key={`reply-${reply.id}`}
                                                                                        draft={replyDraft}
                                                                                        placeholder={`@${reply.username} icin yanit yaz...`}
                                                                                        submitLabel="Yaniti Gonder"
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

                                                                            {getReplies(reply.id).length > 0 && (
                                                                                <div className="mt-3 space-y-3 border-l border-border/60 pl-3">
                                                                                    {getReplies(reply.id).map((nestedReply) => (
                                                                                        <div key={nestedReply.id} className="rounded-lg border border-border/60 bg-background/30 p-3">
                                                                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                                                <span className="font-medium text-foreground">{nestedReply.username}</span>
                                                                                                <span>{formatDistanceToNow(new Date(nestedReply.createdAt), { addSuffix: true, locale: tr })}</span>
                                                                                            </div>
                                                                                            <p className="mt-1 text-sm leading-relaxed">
                                                                                                {renderFormattedText(nestedReply.content)}
                                                                                            </p>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {parentComments.length > MAX_VISIBLE_PARENT_COMMENTS && (
                            <Button
                                variant="ghost"
                                className="w-full mt-4"
                                onClick={() => setShowAllComments(!showAllComments)}
                            >
                                {showAllComments ? (
                                    <>
                                        <ChevronUp className="mr-2 h-4 w-4" />
                                        Daha Az Göster
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown className="mr-2 h-4 w-4" />
                                        Tüm Yorumları Gör ({parentComments.length - MAX_VISIBLE_PARENT_COMMENTS} daha)
                                    </>
                                )}
                            </Button>
                        )}
                    </>
                )}
            </div>

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
