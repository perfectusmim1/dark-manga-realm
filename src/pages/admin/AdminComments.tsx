import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    ArrowUpRight,
    Loader2,
    MessageSquare,
    Pin,
    Search,
    Trash2,
} from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { deleteComment, getAdminCommentsPage, getMangaTitlesByIds, setCommentPinned } from '@/lib/database';
import { Comment } from '@/lib/types';
import { toast } from 'sonner';

const PAGE_SIZE = 30;
const INTERACTIVE_COMMENT_SELECTOR = 'button, a, input, textarea, select, [role="button"], [data-prevent-card-toggle="true"]';

const buildAdminCommentTargetHref = (comment: Comment): string | null => {
    if (!comment.mangaId) {
        return null;
    }

    const commentId = encodeURIComponent(comment.id);

    if (!comment.chapterId) {
        return `/manga/${comment.mangaId}?commentId=${commentId}`;
    }

    const params = new URLSearchParams({
        commentId: comment.id,
    });

    if (comment.pageNumber && comment.pageNumber > 0) {
        params.set('page', String(comment.pageNumber));
        params.set('commentScope', 'page');
        params.set('commentPage', String(comment.pageNumber));
    } else {
        params.set('page', '1');
        params.set('commentScope', 'chapter');
    }

    return `/manga/${comment.mangaId}/chapter/${comment.chapterId}?${params.toString()}`;
};

const AdminComments: React.FC = () => {
    const [comments, setComments] = useState<Comment[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedComments, setSelectedComments] = useState<Set<string>>(new Set());
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
    const [mangaCache, setMangaCache] = useState<Record<string, string>>({});
    const [page, setPage] = useState(0);
    const [totalComments, setTotalComments] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [updatingCommentId, setUpdatingCommentId] = useState<string | null>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setSearchQuery(searchInput.trim());
            setSelectedComments(new Set());
        }, 250);

        return () => window.clearTimeout(timeout);
    }, [searchInput]);

    useEffect(() => {
        void loadCommentsPage(0, true);
    }, [searchQuery]);

    useEffect(() => {
        if (!hasMore || isInitialLoading || isLoadingMore) {
            return;
        }

        const target = loadMoreRef.current;
        if (!target) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry?.isIntersecting) {
                void loadCommentsPage(page + 1, false);
            }
        }, { rootMargin: '300px 0px' });

        observer.observe(target);

        return () => observer.disconnect();
    }, [hasMore, isInitialLoading, isLoadingMore, page, searchQuery]);

    const mergeComments = (existing: Comment[], incoming: Comment[]) => {
        const next = [...existing];
        const knownIds = new Set(existing.map((comment) => comment.id));

        incoming.forEach((comment) => {
            if (!knownIds.has(comment.id)) {
                next.push(comment);
            }
        });

        return next;
    };

    const loadCommentsPage = async (targetPage: number, reset: boolean) => {
        if ((!reset && (isInitialLoading || isLoadingMore || isRefreshing)) || targetPage < 0) {
            return;
        }

        if (reset) {
            setIsInitialLoading(true);
            setIsRefreshing(true);
        } else {
            setIsLoadingMore(true);
        }

        try {
            const result = await getAdminCommentsPage(targetPage, PAGE_SIZE, searchQuery);
            const titles = await getMangaTitlesByIds(result.comments.map((comment) => comment.mangaId || ''));

            setMangaCache((current) => ({ ...current, ...titles }));
            setComments((current) => reset ? result.comments : mergeComments(current, result.comments));
            setPage(targetPage);
            setTotalComments(result.total);
            setHasMore((targetPage + 1) * PAGE_SIZE < result.total);
        } catch (error) {
            console.error('Admin comments load error:', error);
            toast.error('Yorumlar yüklenemedi');
        } finally {
            setIsInitialLoading(false);
            setIsLoadingMore(false);
            setIsRefreshing(false);
        }
    };

    const refreshComments = async () => {
        setSelectedComments(new Set());
        await loadCommentsPage(0, true);
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteComment(id);
            toast.success('Yorum silindi');
            setDeleteId(null);
            await refreshComments();
        } catch (error) {
            console.error('Delete comment error:', error);
            toast.error('Yorum silinemedi');
        }
    };

    const handleTogglePin = async (comment: Comment) => {
        try {
            setUpdatingCommentId(comment.id);
            await setCommentPinned(comment.id, !comment.isPinned);
            toast.success(comment.isPinned ? 'Yorum sabitlemesi kaldırıldı' : 'Yorum sabitlendi');
            await refreshComments();
        } catch (error) {
            console.error('Toggle pin error:', error);
            toast.error('Yorum güncellenemedi');
        } finally {
            setUpdatingCommentId(null);
        }
    };

    const handleBulkDelete = async () => {
        try {
            await Promise.all(Array.from(selectedComments).map((id) => deleteComment(id)));
            toast.success(`${selectedComments.size} yorum silindi`);
            setBulkDeleteConfirm(false);
            await refreshComments();
        } catch (error) {
            console.error('Bulk delete comments error:', error);
            toast.error('Toplu silme başarısız oldu');
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedComments((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleCommentCardClick = (id: string, event: React.MouseEvent<HTMLElement>) => {
        const interactiveTarget = event.target instanceof HTMLElement
            ? event.target.closest(INTERACTIVE_COMMENT_SELECTOR)
            : null;

        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
            return;
        }

        toggleSelect(id);
    };

    const handleCommentCardKeyDown = (id: string, event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const interactiveTarget = event.target instanceof HTMLElement
            ? event.target.closest(INTERACTIVE_COMMENT_SELECTOR)
            : null;

        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
            return;
        }

        event.preventDefault();
        toggleSelect(id);
    };

    const toggleSelectLoaded = () => {
        const loadedIds = comments.map((comment) => comment.id);
        const isAllLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selectedComments.has(id));

        if (isAllLoadedSelected) {
            setSelectedComments(new Set());
            return;
        }

        setSelectedComments(new Set(loadedIds));
    };

    const getMangaTitle = (mangaId?: string) => {
        if (!mangaId) {
            return 'Genel yorum';
        }

        return mangaCache[mangaId] || 'Yükleniyor...';
    };

    const loadedCount = comments.length;
    const selectedLoadedCount = comments.filter((comment) => selectedComments.has(comment.id)).length;
    const allLoadedSelected = loadedCount > 0 && selectedLoadedCount === loadedCount;
    const partiallySelected = selectedLoadedCount > 0 && selectedLoadedCount < loadedCount;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold sm:text-3xl">Yorumlar</h1>
                    <p className="text-muted-foreground">Yorumları daha hızlı inceleyip yönetin.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="px-3 py-1">
                        {totalComments} toplam yorum
                    </Badge>
                    <Badge variant="outline" className="px-3 py-1">
                        {loadedCount} yüklü
                    </Badge>
                    {selectedComments.size > 0 && (
                        <Button variant="destructive" onClick={() => setBulkDeleteConfirm(true)} className="w-full sm:w-auto">
                            <Trash2 className="mr-2 h-4 w-4" />
                            {selectedComments.size} Yorum Sil
                        </Button>
                    )}
                </div>
            </div>

            <div className="rounded-2xl border border-border bg-card/60 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Yorum veya kullanıcı ara..."
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            className="pl-10"
                        />
                    </div>

                    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                        <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                            <Checkbox
                                checked={allLoadedSelected ? true : partiallySelected ? 'indeterminate' : false}
                                onCheckedChange={toggleSelectLoaded}
                            />
                            <span className="text-sm text-muted-foreground">Yüklüleri seç</span>
                        </div>

                        <Button variant="outline" onClick={() => void refreshComments()} disabled={isRefreshing} className="w-full sm:w-auto">
                            {isRefreshing ? 'Yenileniyor...' : 'Yenile'}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                {isInitialLoading ? (
                    <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card/40">
                        <div className="text-center">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                            <p className="mt-3 text-sm text-muted-foreground">Yorumlar yükleniyor...</p>
                        </div>
                    </div>
                ) : comments.length === 0 ? (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40">
                        <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
                        <p className="mt-3 text-lg font-medium">Yorum bulunamadı</p>
                        <p className="mt-1 text-sm text-muted-foreground">Arama filtresini değiştirip tekrar deneyin.</p>
                    </div>
                ) : (
                    comments.map((comment) => {
                        const commentTargetHref = buildAdminCommentTargetHref(comment);

                        return (
                        <div
                            key={comment.id}
                            className={`cursor-pointer rounded-2xl border bg-card/60 p-4 transition-colors ${selectedComments.has(comment.id) ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/20'}`}
                            onClick={(event) => handleCommentCardClick(comment.id, event)}
                            onKeyDown={(event) => handleCommentCardKeyDown(comment.id, event)}
                            role="checkbox"
                            aria-checked={selectedComments.has(comment.id)}
                            tabIndex={0}
                        >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="flex gap-4">
                                    <div className="pt-1">
                                        <Checkbox
                                            checked={selectedComments.has(comment.id)}
                                            onCheckedChange={() => toggleSelect(comment.id)}
                                            data-prevent-card-toggle="true"
                                        />
                                    </div>

                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                                        {comment.username[0]?.toUpperCase() || '?'}
                                    </div>

                                    <div className="min-w-0 space-y-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Link
                                                to={`/profile/${comment.userId}`}
                                                className="font-semibold transition-colors hover:text-primary"
                                            >
                                                {comment.username}
                                            </Link>
                                            <Badge variant="outline">{getMangaTitle(comment.mangaId)}</Badge>
                                            {comment.isPinned && (
                                                <Badge variant="secondary" className="bg-primary/15 text-primary">
                                                    Sabit
                                                </Badge>
                                            )}
                                            {comment.parentId && <Badge variant="outline">Yanıt</Badge>}
                                            {comment.gifUrl && <Badge variant="secondary">GIF</Badge>}
                                            {(comment.mediaUrls?.length || comment.mediaUrl) && <Badge variant="secondary">Medya</Badge>}
                                            {comment.isSpoiler && <Badge variant="outline">Spoiler</Badge>}
                                        </div>

                                        <div className="space-y-1">
                                            {comment.title && (
                                                <p className="text-sm font-semibold text-primary">{comment.title}</p>
                                            )}
                                            <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                                                {comment.content}
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                            <span>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: tr })}</span>
                                            <span>{comment.likes} beğeni</span>
                                            {comment.chapterId && <span>bölüm yorumu</span>}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-2 lg:pl-4">
                                    {commentTargetHref && (
                                        <Button asChild variant="outline" size="sm" className="gap-2" data-prevent-card-toggle="true">
                                            <Link to={commentTargetHref}>
                                                <ArrowUpRight className="h-4 w-4" />
                                                Yoruma Git
                                            </Link>
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        disabled={updatingCommentId === comment.id}
                                        className={comment.isPinned ? 'text-primary hover:bg-primary/10 hover:text-primary' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}
                                        onClick={() => void handleTogglePin(comment)}
                                        data-prevent-card-toggle="true"
                                    >
                                        {updatingCommentId === comment.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Pin className={`h-4 w-4 ${comment.isPinned ? 'fill-current' : ''}`} />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => setDeleteId(comment.id)}
                                        data-prevent-card-toggle="true"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )})
                )}
            </div>

            {!isInitialLoading && comments.length > 0 && (
                <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center">
                    {isLoadingMore ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Daha fazla yorum yükleniyor...
                        </div>
                    ) : hasMore ? (
                        <span className="text-sm text-muted-foreground">
                            Aşağı kaydırdıkça yeni yorumlar yüklenecek
                        </span>
                    ) : (
                        <span className="text-sm text-muted-foreground">
                            Tüm yorumlar yüklendi
                        </span>
                    )}
                </div>
            )}

            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Yorum Sil</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu yorumu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteId && void handleDelete(deleteId)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Toplu Silme</AlertDialogTitle>
                        <AlertDialogDescription>
                            {selectedComments.size} yorumu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => void handleBulkDelete()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {selectedComments.size} Yorum Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdminComments;
