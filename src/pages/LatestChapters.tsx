import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { BookOpen, Clock } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/badge';
import { LanguageFlag } from '@/components/ui/LanguageFlag';
import { Skeleton } from '@/components/ui/skeleton';
import { formatChapterNumberLabel, sanitizeChapterTitle } from '@/lib/chapterTitle';
import { getLatestChapters, getLatestChaptersFeedStats, LatestChapterFeedItem } from '@/lib/database';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import AppPagination from '@/components/ui/AppPagination';
import OptimizedImage from '@/components/media/OptimizedImage';
import { getLanguageInfoByCode, getSeriesLanguageInfo } from '@/lib/seriesLanguage';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 30;
const LATEST_CHAPTERS_PAGE_CACHE_TTL_MS = 3 * 60_000;
const LATEST_CHAPTERS_PAGE_STALE_TTL_MS = 15 * 60_000;
const latestChaptersPageCache = new Map<string, { fetchedAt: number; chapters: LatestChapterFeedItem[] }>();
let latestChaptersPageCacheUserId: string | null | undefined = undefined;
let latestChaptersStatsCache: {
    audienceKey: string;
    fetchedAt: number;
    recentChapterCount: number;
    totalChaptersCount: number;
} | null = null;

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
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const pageParam = parseInt(searchParams.get('page') || '1', 10);
    const currentPage = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const audienceKey = user?.preferences?.content?.adult_mode === true ? 'adult' : 'safe';
    const initialCacheKey = `${audienceKey}:${currentPage}`;
    const initialCached = latestChaptersPageCache.get(initialCacheKey);
    const isSameCachedUser =
        latestChaptersPageCacheUserId === undefined || latestChaptersPageCacheUserId === (user?.id ?? null);
    const hasUsableInitialCache = Boolean(
        isSameCachedUser
        && initialCached
        && initialCached.chapters.length > 0
        && Date.now() - initialCached.fetchedAt < LATEST_CHAPTERS_PAGE_STALE_TTL_MS,
    );

    const [chapters, setChapters] = React.useState<LatestChapterFeedItem[]>(
        hasUsableInitialCache && initialCached ? initialCached.chapters : [],
    );
    const [mangaLangMap, setMangaLangMap] = React.useState<Record<string, ReturnType<typeof getSeriesLanguageInfo>>>({});
    const [isLoading, setIsLoading] = React.useState(!hasUsableInitialCache);
    const [recentChapterCount, setRecentChapterCount] = React.useState(
        latestChaptersStatsCache && latestChaptersStatsCache.audienceKey === audienceKey
            ? latestChaptersStatsCache.recentChapterCount
            : 0,
    );
    const [totalChaptersCount, setTotalChaptersCount] = React.useState(
        latestChaptersStatsCache && latestChaptersStatsCache.audienceKey === audienceKey
            ? latestChaptersStatsCache.totalChaptersCount
            : 0,
    );
    const countsLoadedRef = React.useRef(
        Boolean(
            latestChaptersStatsCache
            && latestChaptersStatsCache.audienceKey === audienceKey
            && Date.now() - latestChaptersStatsCache.fetchedAt < LATEST_CHAPTERS_PAGE_CACHE_TTL_MS,
        ),
    );
    const requestGenerationRef = React.useRef(0);

    const totalPages = Math.max(1, Math.ceil(totalChaptersCount / PAGE_SIZE));

    const resolveChapterLanguages = React.useCallback((data: LatestChapterFeedItem[]) => {
        const preResolvedLangMap: Record<string, ReturnType<typeof getSeriesLanguageInfo>> = {};
        const missingLangMangaIds: string[] = [];
        for (const item of data) {
            if (item.langCode) {
                preResolvedLangMap[item.mangaId] = getLanguageInfoByCode(item.langCode);
            } else {
                missingLangMangaIds.push(item.mangaId);
            }
        }
        if (Object.keys(preResolvedLangMap).length > 0) {
            setMangaLangMap((prev) => ({ ...prev, ...preResolvedLangMap }));
        }

        const uniqueMissingIds = Array.from(new Set(missingLangMangaIds));
        if (uniqueMissingIds.length > 0) {
            void Promise.resolve(
                supabase
                    .from('mangas')
                    .select('id, title, genres, details, source_links')
                    .in('id', uniqueMissingIds),
            )
                .then(({ data: mangasData }) => {
                    if (mangasData) {
                        const langMap: Record<string, ReturnType<typeof getSeriesLanguageInfo>> = {};
                        for (const m of mangasData) {
                            langMap[m.id] = getSeriesLanguageInfo(m as any);
                        }
                        setMangaLangMap((prev) => ({ ...prev, ...langMap }));
                    }
                })
                .catch(() => undefined);
        }
    }, []);

    React.useEffect(() => {
        const nextUserKey = user?.id ?? null;
        if (latestChaptersPageCacheUserId !== undefined && latestChaptersPageCacheUserId !== nextUserKey) {
            latestChaptersPageCache.clear();
            latestChaptersStatsCache = null;
            countsLoadedRef.current = false;
        }
        latestChaptersPageCacheUserId = nextUserKey;
    }, [user?.id]);

    const loadChapters = React.useCallback(async (page: number) => {
        if (!isOnline) {
            setIsLoading(false);
            return;
        }

        const nextUserKey = user?.id ?? null;
        if (latestChaptersPageCacheUserId !== undefined && latestChaptersPageCacheUserId !== nextUserKey) {
            latestChaptersPageCache.clear();
            latestChaptersStatsCache = null;
            countsLoadedRef.current = false;
        }
        latestChaptersPageCacheUserId = nextUserKey;

        if (!countsLoadedRef.current) {
            void getLatestChaptersFeedStats()
                .then((stats) => {
                    setRecentChapterCount(stats.recentChapterCount);
                    setTotalChaptersCount(stats.totalChaptersCount);
                    countsLoadedRef.current = true;
                    latestChaptersStatsCache = {
                        audienceKey,
                        fetchedAt: Date.now(),
                        recentChapterCount: stats.recentChapterCount,
                        totalChaptersCount: stats.totalChaptersCount,
                    };
                })
                .catch(() => {});
        }

        const cacheKey = `${audienceKey}:${page}`;
        const cached = latestChaptersPageCache.get(cacheKey);
        const cacheAge = cached ? Date.now() - cached.fetchedAt : Infinity;
        if (cached && cacheAge < LATEST_CHAPTERS_PAGE_CACHE_TTL_MS) {
            setChapters(cached.chapters);
            setIsLoading(false);
            resolveChapterLanguages(cached.chapters);
            return;
        }

        const hasStaleCachedData = Boolean(
            cached && cached.chapters.length > 0 && cacheAge < LATEST_CHAPTERS_PAGE_STALE_TTL_MS,
        );
        if (hasStaleCachedData && cached) {
            setChapters(cached.chapters);
            setIsLoading(false);
            resolveChapterLanguages(cached.chapters);
        } else {
            setIsLoading(true);
        }

        const requestGeneration = ++requestGenerationRef.current;
        try {
            const offset = (page - 1) * PAGE_SIZE;

            const data = await getLatestChapters(PAGE_SIZE, offset);
            if (requestGeneration !== requestGenerationRef.current) {
                return;
            }

            latestChaptersPageCache.set(cacheKey, {
                fetchedAt: Date.now(),
                chapters: data,
            });
            setChapters(data);
            resolveChapterLanguages(data);
        } catch (error) {
            if (requestGeneration === requestGenerationRef.current) {
                console.error('Latest chapters page error:', error);
            }
        } finally {
            if (requestGeneration === requestGenerationRef.current) {
                setIsLoading(false);
            }
        }
    }, [audienceKey, isOnline, resolveChapterLanguages, user?.id]);

    React.useEffect(() => {
        void loadChapters(currentPage);
    }, [currentPage, loadChapters]);

    const handlePageChange = (newPage: number) => {
        setSearchParams(newPage > 1 ? { page: String(newPage) } : {});
    };

    if (!isOnline) {
        return (
            <OfflineRequiredScreen
                description="Son bölümler akışı için internete bağlanın."
                actionHref="/downloads"
                actionLabel="İndirilenlere Git"
            />
        );
    }

    if (isLoading && chapters.length === 0) {
        return <LatestChaptersSkeleton />;
    }

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <div className="mb-8 animate-fade-up">
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
                        {chapters.map((chapter) => (
                            <Link
                                key={chapter.chapterId}
                                to={`/manga/${chapter.mangaId}/chapter/${chapter.chapterId}`}
                                className="group flex items-center gap-4 rounded-[24px] border border-border bg-card/40 p-4 transition-[border-color,background-color] duration-200 hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background animate-card-reveal-fast sm:gap-5"
                            >
                                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-secondary/40 shadow-sm sm:h-28 sm:w-28 lg:h-32 lg:w-32">
                                    <OptimizedImage
                                        src={chapter.mangaCover}
                                        alt={chapter.mangaTitle}
                                        width={128}
                                        height={128}
                                        allowProxy
                                        containerClassName="h-full w-full"
                                        className="h-full w-full object-cover"
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
                                                {(() => {
                                                    const chTitle = (chapter.chapterTitle || '').toLowerCase();
                                                    if (chTitle.includes('[raw]') || chTitle.includes('(raw)')) {
                                                        return (
                                                            <Badge variant="outline" className="inline-flex h-5 items-center justify-center text-[10px] font-black uppercase px-1.5 py-0 border-purple-500/40 bg-purple-500/15 text-purple-400">
                                                                RAW
                                                            </Badge>
                                                        );
                                                    }
                                                    if (chTitle.includes('[en]') || chTitle.includes('(en)')) {
                                                        const enLang = getLanguageInfoByCode('en');
                                                        return (
                                                            <span title={enLang.label} className="inline-flex shrink-0 items-center">
                                                                <LanguageFlag code="en" label={enLang.label} className="h-3.5 w-5" />
                                                            </span>
                                                        );
                                                    }
                                                    const lang = mangaLangMap[chapter.mangaId] || getSeriesLanguageInfo({ title: chapter.mangaTitle });
                                                    if (lang.language === 'tr') return null;
                                                    if (lang.language === 'raw') {
                                                        return (
                                                            <Badge
                                                                variant="outline"
                                                                className={cn('inline-flex h-5 items-center justify-center px-1.5 py-0 text-[10px] font-black uppercase', lang.badgeClassName)}
                                                            >
                                                                <LanguageFlag code={lang.language} label={lang.label} />
                                                            </Badge>
                                                        );
                                                    }
                                                    return (
                                                        <span title={lang.label} className="inline-flex shrink-0 items-center">
                                                            <LanguageFlag code={lang.language} label={lang.label} className="h-3.5 w-5" />
                                                        </span>
                                                    );
                                                })()}
                                                <span className="text-[11px] text-muted-foreground">
                                                    {new Date(chapter.addedAt).toLocaleDateString('tr-TR', {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </span>
                                            </div>
                                            <h2 className="line-clamp-1 font-semibold transition-colors group-hover:text-primary group-focus-visible:text-primary">
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
