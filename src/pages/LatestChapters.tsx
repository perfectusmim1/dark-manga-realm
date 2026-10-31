import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { BookOpen, Clock } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatChapterNumberLabel, sanitizeChapterTitle } from '@/lib/chapterTitle';
import { getLatestChapters, getLatestChaptersCountLast24Hours, getTotalLatestChaptersCount, LatestChapterFeedItem } from '@/lib/database';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import AppPagination from '@/components/ui/AppPagination';

const PAGE_SIZE = 30;

const LatestChaptersSkeleton: React.FC = () => (
    <div className="min-h-screen bg-background">
        <Header />

        <main className="container pb-12 pt-20">
            <div className="mb-8">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 rounded-2xl bg-primary/10" />
                    <div className="space-y-2">
                        <Skeleton className="h-10 w-56 sm:w-72" />
                        <Skeleton className="h-5 w-[22rem] max-w-[75vw]" />
                    </div>
                </div>
                <Skeleton className="mt-4 h-8 w-48 rounded-full" />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
                {Array.from({ length: 9 }).map((_, index) => (
                    <div
                        key={`latest-chapters-skeleton-${index}`}
                        className="rounded-[24px] border border-border bg-card/40 p-4 sm:p-5"
                    >
                        <div className="flex items-center gap-4 sm:gap-5">
                            <Skeleton className="h-24 w-24 shrink-0 rounded-2xl sm:h-28 sm:w-28 lg:h-32 lg:w-32" />

                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="mb-2 flex flex-wrap items-center gap-2">
                                            <Skeleton className="h-6 w-32 rounded-full" />
                                            <Skeleton className="h-4 w-20" />
                                        </div>
                                        <Skeleton className="h-8 w-4/5 max-w-[18rem]" />
                                        <Skeleton className="mt-2 h-7 w-32" />
                                    </div>

                                    <Skeleton className="h-7 w-32 shrink-0 rounded-full" />
                                </div>

                                <div className="mt-4 flex items-center gap-2">
                                    <Skeleton className="h-4 w-4 rounded-sm" />
                                    <Skeleton className="h-5 w-44 max-w-[70%]" />
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </main>
    </div>
);

const LatestChapters: React.FC = () => {
    const { isOnline } = useEffectiveOnlineStatus();
    const [searchParams, setSearchParams] = useSearchParams();
    const pageParam = parseInt(searchParams.get('page') || '1', 10);
    const currentPage = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

    const [chapters, setChapters] = React.useState<LatestChapterFeedItem[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [recentChapterCount, setRecentChapterCount] = React.useState(0);
    const [totalChaptersCount, setTotalChaptersCount] = React.useState(0);

    const totalPages = Math.max(1, Math.ceil(totalChaptersCount / PAGE_SIZE));

    if (!isOnline) {
        return (
            <OfflineRequiredScreen
                description="Son bölümler akışı için internete bağlanın."
                actionHref="/downloads"
                actionLabel="İndirilenlere Git"
            />
        );
    }

    const loadChapters = React.useCallback(async (page: number) => {
        setIsLoading(true);
        try {
            const offset = (page - 1) * PAGE_SIZE;
            const [data, countLast24Hours, totalCount] = await Promise.all([
                getLatestChapters(PAGE_SIZE, offset),
                getLatestChaptersCountLast24Hours(),
                getTotalLatestChaptersCount(),
            ]);

            setChapters(data);
            setRecentChapterCount(countLast24Hours);
            setTotalChaptersCount(totalCount);
        } catch (error) {
            console.error('Latest chapters page error:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    React.useEffect(() => {
        loadChapters(currentPage);
    }, [currentPage, loadChapters]);

    const handlePageChange = (newPage: number) => {
        setSearchParams(newPage > 1 ? { page: String(newPage) } : {});
    };

    if (isLoading && chapters.length === 0) {
        return <LatestChaptersSkeleton />;
    }

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Clock className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">Son Bölümler</h1>
                            
                        </div>
                    </div>
                    <div className="mt-4">
                        <Badge variant="secondary" className="px-3 py-1 text-xs">
                            Son 24 saatte {recentChapterCount} bölüm eklendi
                        </Badge>
                    </div>
                </div>

                {chapters.length > 0 ? (
                    <div className="grid gap-4 xl:grid-cols-3">
                        {chapters.map((chapter, index) => (
                            <Link
                                key={chapter.chapterId}
                                to={`/manga/${chapter.mangaId}/chapter/${chapter.chapterId}`}
                                className="group flex items-center gap-4 rounded-[24px] border border-border bg-card/40 p-4 opacity-0 transition-all duration-200 hover:border-primary/40 hover:bg-card animate-card-reveal-fast sm:gap-5"
                                style={{
                                    animationDelay: `${index * 12}ms`,
                                    animationFillMode: 'forwards',
                                }}
                            >
                                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-secondary/40 shadow-sm sm:h-28 sm:w-28 lg:h-32 lg:w-32">
                                    <img
                                        src={chapter.mangaCover}
                                        alt={chapter.mangaTitle}
                                        loading="lazy"
                                        decoding="async"
                                        className="h-full w-full object-cover "
                                    />
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                                {chapter.mangaType && (
                                                    <Badge variant="outline" className="text-[10px] uppercase">
                                                        {chapter.mangaType}
                                                    </Badge>
                                                )}
                                                <span className="text-[11px] text-muted-foreground">
                                                    {new Date(chapter.addedAt).toLocaleDateString('tr-TR', {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </span>
                                            </div>
                                            <h2 className="line-clamp-1 font-semibold transition-colors group-hover:text-primary">
                                                {chapter.mangaTitle}
                                            </h2>
                                            <p className="mt-1 line-clamp-1 text-sm text-primary">
                                                Bölüm {formatChapterNumberLabel(chapter.chapterNumber)}
                                                {sanitizeChapterTitle(chapter.chapterNumber, chapter.chapterTitle) ? ` • ${sanitizeChapterTitle(chapter.chapterNumber, chapter.chapterTitle)}` : ''}
                                            </p>
                                        </div>

                                        <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-[10px]">
                                            {formatDistanceToNow(new Date(chapter.addedAt), { addSuffix: true, locale: tr })}
                                        </Badge>
                                    </div>

                                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                                        <BookOpen className="h-3.5 w-3.5" />
                                        <span className="line-clamp-1">
                                            {chapter.releaseDate
                                                ? `Yayın tarihi: ${new Date(chapter.releaseDate).toLocaleDateString('tr-TR')}`
                                                : 'Yayın tarihi bilgisi yok'}
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-dashed border-border bg-card/30">
                        <div className="text-center">
                            <Clock className="mx-auto h-14 w-14 text-muted-foreground/60" />
                            <h2 className="mt-4 text-xl font-semibold">Henüz bölüm yok</h2>
                            <p className="mt-2 text-muted-foreground">
                                Yeni bölümler eklendikçe burada görünecek.
                            </p>
                        </div>
                    </div>
                )}

                {chapters.length > 0 && totalPages > 1 && (
                    <AppPagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                    />
                )}
            </main>
        </div>
    );
};

export default LatestChapters;
