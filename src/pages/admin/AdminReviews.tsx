import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    ArrowUpRight,
    ChevronDown,
    ChevronUp,
    Loader2,
    Search,
    Star,
    Trash2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import StaffBadge from '@/components/user/StaffBadge';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { AdminReview, deleteReview, getAdminReviewsPage } from '@/lib/database';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const PAGE_SIZE = 30;
const INTERACTIVE_REVIEW_SELECTOR = 'button, a, input, textarea, select, [role="button"], [data-prevent-card-toggle="true"]';
const REVIEW_PREVIEW_TOGGLE_THRESHOLD = 420;

const AdminReviews: React.FC = () => {
    const { access } = useAdminAccess();
    const [reviews, setReviews] = useState<AdminReview[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});
    const [selectedReviews, setSelectedReviews] = useState<Set<string>>(new Set());
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
    const [page, setPage] = useState(0);
    const [totalReviews, setTotalReviews] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const canDeleteReviews = access.role === 'admin';

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setSearchQuery(searchInput.trim());
            setSelectedReviews(new Set());
            setExpandedReviews({});
        }, 250);

        return () => window.clearTimeout(timeout);
    }, [searchInput]);

    useEffect(() => {
        void loadReviewsPage(0, true);
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
                void loadReviewsPage(page + 1, false);
            }
        }, { rootMargin: '300px 0px' });

        observer.observe(target);

        return () => observer.disconnect();
    }, [hasMore, isInitialLoading, isLoadingMore, page, searchQuery]);

    const mergeReviews = (existing: AdminReview[], incoming: AdminReview[]) => {
        const next = [...existing];
        const knownIds = new Set(existing.map((review) => review.id));

        incoming.forEach((review) => {
            if (!knownIds.has(review.id)) {
                next.push(review);
            }
        });

        return next;
    };

    const loadReviewsPage = async (targetPage: number, reset: boolean) => {
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
            const result = await getAdminReviewsPage(targetPage, PAGE_SIZE, searchQuery);
            setReviews((current) => (reset ? result.reviews : mergeReviews(current, result.reviews)));
            setPage(targetPage);
            setTotalReviews(result.total);
            setHasMore((targetPage + 1) * PAGE_SIZE < result.total);
        } catch (error) {
            console.error('Admin reviews load error:', error);
            toast.error('İncelemeler yüklenemedi');
        } finally {
            setIsInitialLoading(false);
            setIsLoadingMore(false);
            setIsRefreshing(false);
        }
    };

    const refreshReviews = async () => {
        setSelectedReviews(new Set());
        await loadReviewsPage(0, true);
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteReview(id);
            toast.success('İnceleme silindi');
            setDeleteId(null);
            await refreshReviews();
        } catch (error) {
            console.error('Delete review error:', error);
            toast.error('İnceleme silinemedi');
        }
    };

    const handleBulkDelete = async () => {
        try {
            await Promise.all(Array.from(selectedReviews).map((id) => deleteReview(id)));
            toast.success(`${selectedReviews.size} inceleme silindi`);
            setBulkDeleteConfirm(false);
            await refreshReviews();
        } catch (error) {
            console.error('Bulk delete reviews error:', error);
            toast.error('Toplu silme başarısız oldu');
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedReviews((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleReviewCardClick = (id: string, event: React.MouseEvent<HTMLElement>) => {
        const interactiveTarget = event.target instanceof HTMLElement
            ? event.target.closest(INTERACTIVE_REVIEW_SELECTOR)
            : null;

        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
            return;
        }

        toggleSelect(id);
    };

    const handleReviewCardKeyDown = (id: string, event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const interactiveTarget = event.target instanceof HTMLElement
            ? event.target.closest(INTERACTIVE_REVIEW_SELECTOR)
            : null;

        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
            return;
        }

        event.preventDefault();
        toggleSelect(id);
    };

    const toggleSelectLoaded = () => {
        const loadedIds = reviews.map((review) => review.id);
        const isAllLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selectedReviews.has(id));

        if (isAllLoadedSelected) {
            setSelectedReviews(new Set());
            return;
        }

        setSelectedReviews(new Set(loadedIds));
    };

    const loadedCount = reviews.length;
    const selectedLoadedCount = reviews.filter((review) => selectedReviews.has(review.id)).length;
    const allLoadedSelected = loadedCount > 0 && selectedLoadedCount === loadedCount;
    const partiallySelected = selectedLoadedCount > 0 && selectedLoadedCount < loadedCount;

    const toggleExpandedReview = (reviewId: string) => {
        setExpandedReviews((current) => ({
            ...current,
            [reviewId]: !current[reviewId],
        }));
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-3 text-2xl font-bold sm:text-3xl">
                        <Star className="h-7 w-7 text-primary" />
                        İncelemeler
                    </h1>
                    <p className="text-muted-foreground">Kullanıcı incelemelerini seri, kullanıcı ve puan detaylarıyla yönetin.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="px-3 py-1">
                        {totalReviews} toplam inceleme
                    </Badge>
                    <Badge variant="outline" className="px-3 py-1">
                        {loadedCount} yüklü
                    </Badge>
                    {selectedReviews.size > 0 && canDeleteReviews && (
                        <Button variant="destructive" onClick={() => setBulkDeleteConfirm(true)} className="w-full sm:w-auto">
                            <Trash2 className="mr-2 h-4 w-4" />
                            {selectedReviews.size} İnceleme Sil
                        </Button>
                    )}
                </div>
            </div>

            <div className="rounded-2xl border border-border bg-card/60 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="İnceleme, kullanıcı veya seri ara..."
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

                        <Button variant="outline" onClick={() => void refreshReviews()} disabled={isRefreshing} className="w-full sm:w-auto">
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
                            <p className="mt-3 text-sm text-muted-foreground">İncelemeler yükleniyor...</p>
                        </div>
                    </div>
                ) : reviews.length === 0 ? (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40">
                        <Star className="h-12 w-12 text-muted-foreground/30" />
                        <p className="mt-3 text-lg font-medium">İnceleme bulunamadı</p>
                        <p className="mt-1 text-sm text-muted-foreground">Arama filtresini değiştirip tekrar deneyin.</p>
                    </div>
                ) : (
                    reviews.map((review) => (
                        <div
                            key={review.id}
                            className={cn(
                                'cursor-pointer rounded-2xl border bg-card/60 p-4 transition-colors',
                                selectedReviews.has(review.id)
                                    ? 'border-primary/50 bg-primary/5'
                                    : 'border-border hover:border-primary/20',
                            )}
                            onClick={(event) => handleReviewCardClick(review.id, event)}
                            onKeyDown={(event) => handleReviewCardKeyDown(review.id, event)}
                            role="checkbox"
                            aria-checked={selectedReviews.has(review.id)}
                            tabIndex={0}
                        >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="flex gap-4">
                                    <div className="pt-1">
                                        <Checkbox
                                            checked={selectedReviews.has(review.id)}
                                            onCheckedChange={() => toggleSelect(review.id)}
                                            data-prevent-card-toggle="true"
                                        />
                                    </div>

                                    <div className="min-w-0 flex-1 space-y-4">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <Link
                                                        to={`/profile/${review.userId}`}
                                                        className="flex items-center gap-3 transition-colors hover:text-primary"
                                                    >
                                                        <Avatar className="h-11 w-11 border border-primary/20">
                                                            <AvatarImage src={review.userAvatar} alt={review.username} />
                                                            <AvatarFallback>{review.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="font-semibold">{review.username}</span>
                                                    </Link>
                                                    <StaffBadge role={review.userRole} compact />
                                                    <Badge variant="outline">{review.mangaTitle}</Badge>
                                                    <Badge className="gap-1 border-yellow-500/20 bg-yellow-500/10 text-yellow-200">
                                                        <Star className="h-3.5 w-3.5 fill-current" />
                                                        {review.averageScore.toFixed(1)}
                                                    </Badge>
                                                </div>

                                                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                                    <span>{formatDistanceToNow(new Date(review.createdAt), { addSuffix: true, locale: tr })}</span>
                                                    <span>{review.likes} beğeni</span>
                                                    <span>{review.dislikes} dislike</span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-5 gap-1 rounded-xl border border-border bg-background/40 p-2 text-center text-[11px] sm:min-w-[240px]">
                                                <div>
                                                    <p className="text-muted-foreground">H</p>
                                                    <p className="font-semibold">{review.rating_story}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground">K</p>
                                                    <p className="font-semibold">{review.rating_characters}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground">Ç</p>
                                                    <p className="font-semibold">{review.rating_art}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground">İ</p>
                                                    <p className="font-semibold">{review.rating_progression}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground">S</p>
                                                    <p className="font-semibold">{review.rating_engagement}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-2xl border border-border/60 bg-background/30 p-4">
                                            <p
                                                className={cn(
                                                    'whitespace-pre-wrap break-words text-sm text-foreground/90',
                                                    !expandedReviews[review.id] && 'line-clamp-6',
                                                )}
                                            >
                                                {review.content}
                                            </p>
                                            {review.content.trim().length > REVIEW_PREVIEW_TOGGLE_THRESHOLD ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="mt-3 gap-2 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                                                    onClick={() => toggleExpandedReview(review.id)}
                                                    data-prevent-card-toggle="true"
                                                >
                                                    {expandedReviews[review.id] ? (
                                                        <>
                                                            Daha Az Göster
                                                            <ChevronUp className="h-4 w-4" />
                                                        </>
                                                    ) : (
                                                        <>
                                                            Devamını Gör
                                                            <ChevronDown className="h-4 w-4" />
                                                        </>
                                                    )}
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-2 lg:pl-4">
                                    <Button asChild variant="outline" size="sm" className="gap-2" data-prevent-card-toggle="true">
                                        <Link to={review.targetHref}>
                                            <ArrowUpRight className="h-4 w-4" />
                                            Seriye Git
                                        </Link>
                                    </Button>
                                    {canDeleteReviews ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                            onClick={() => setDeleteId(review.id)}
                                            data-prevent-card-toggle="true"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {!isInitialLoading && reviews.length > 0 && (
                <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center">
                    {isLoadingMore ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Daha fazla inceleme yükleniyor...
                        </div>
                    ) : hasMore ? (
                        <span className="text-sm text-muted-foreground">
                            Aşağı kaydırdıkça yeni incelemeler yüklenecek
                        </span>
                    ) : (
                        <span className="text-sm text-muted-foreground">
                            Tüm incelemeler yüklendi
                        </span>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={Boolean(deleteId)}
                onOpenChange={(open) => {
                    if (!open) {
                        setDeleteId(null);
                    }
                }}
                title="İnceleme Sil"
                description="Bu incelemeyi silmek istediğinizden emin misiniz? Bu işlem geri alınamaz."
                confirmLabel="Sil"
                cancelLabel="İptal"
                onConfirm={() => deleteId && void handleDelete(deleteId)}
                destructive
            />

            <ConfirmDialog
                open={bulkDeleteConfirm}
                onOpenChange={setBulkDeleteConfirm}
                title="Toplu Silme"
                description={`${selectedReviews.size} incelemeyi silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`}
                confirmLabel={`${selectedReviews.size} İnceleme Sil`}
                cancelLabel="İptal"
                onConfirm={() => void handleBulkDelete()}
                destructive
            />
        </div>
    );
};

export default AdminReviews;
