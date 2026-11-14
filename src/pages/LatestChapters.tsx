import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ChevronRight, Clock, Search, X } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LanguageFlag } from '@/components/ui/LanguageFlag';
import { Skeleton } from '@/components/ui/skeleton';
import { formatChapterNumberLabel, sanitizeChapterTitle } from '@/lib/chapterTitle';
import { getLatestChapters, getLatestChaptersFeedStats, LatestChapterFeedItem } from '@/lib/database';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import AppPagination from '@/components/ui/AppPagination';
import OptimizedImage from '@/components/media/OptimizedImage';
import { getMangaTypeLabel } from '@/lib/mangaType';
import { getLanguageInfoByCode, getSeriesLanguageInfo } from '@/lib/seriesLanguage';
import { normalizeComparableText, normalizeLooseComparableText } from '@/lib/textMatching';
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
            <div className="mb-5 rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5">
                <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-xl bg-primary/10" />
                        <div className="space-y-1.5">
                            <Skeleton className="h-7 w-40 sm:h-8 sm:w-48" />
                            <Skeleton className="h-3.5 w-44" />
                        </div>
                    </div>
                    <Skeleton className="h-9 w-full rounded-lg sm:h-10 sm:w-72 md:w-80" />
                </div>
            </div>

            <div className="grid gap-2.5 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 12 }).map((_, index) => (
                    <div
                        key={`latest-chapters-skeleton-${index}`}
                        className="rounded-xl border border-border/60 bg-card/60 p-2.5 sm:p-3"
                    >
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-20 w-14 shrink-0 rounded-lg sm:h-24 sm:w-16" />

                            <div className="min-w-0 flex-1 space-y-2">
                                <Skeleton className="h-4 w-4/5" />
                                <Skeleton className="h-5 w-32 rounded-md" />
                                <div className="flex items-center justify-between pt-0.5">
                                    <Skeleton className="h-3 w-28" />
                                    <Skeleton className="h-3.5 w-10" />
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
    const [quickFilter, setQuickFilter] = React.useState('');
    const deferredQuickFilter = React.useDeferredValue(quickFilter);
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
        setQuickFilter('');
        setSearchParams(newPage > 1 ? { page: String(newPage) } : {});
    };

    const normalizedQuickFilter = normalizeComparableText(deferredQuickFilter);
    const looseQuickFilter = normalizeLooseComparableText(deferredQuickFilter);

    const visibleChapters = React.useMemo(() => {
        const seenChapterIds = new Set<string>();
        const deduped = chapters.filter((item) => {
            if (!item?.chapterId || seenChapterIds.has(item.chapterId)) {
                return false;
            }
            seenChapterIds.add(item.chapterId);
            return true;
        });

        if (!normalizedQuickFilter) {
            return deduped;
        }

        return deduped.filter((chapter) => {
            const chapterNumLabel = formatChapterNumberLabel(chapter.chapterNumber);
            const sanitizedTitle = sanitizeChapterTitle(chapter.chapterNumber, chapter.chapterTitle) || '';
            const haystack = [
                chapter.mangaTitle,
                chapter.chapterTitle || '',
                sanitizedTitle,
                chapterNumLabel,
                `Bölüm ${chapterNumLabel}`,
            ].join(' ');

            return (
                normalizeComparableText(haystack).includes(normalizedQuickFilter)
                || (looseQuickFilter.length > 0 && normalizeLooseComparableText(haystack).includes(looseQuickFilter))
            );
        });
    }, [chapters, looseQuickFilter, normalizedQuickFilter]);

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
                <div className="mb-5 rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5 animate-fade-up">
                    <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <Clock className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Son Bölümler</h1>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    Son 24 saatte {recentChapterCount} bölüm eklendi
                                </p>
                            </div>
                        </div>

                        <div className="relative w-full shrink-0 sm:w-72 md:w-80">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                type="search"
                                value={quickFilter}
                                onChange={(event) => setQuickFilter(event.target.value)}
                                placeholder="Seri veya bölüm ara..."
                                aria-label="Seri veya bölüm ara"
                                className="h-9 w-full pl-9 pr-9 text-sm sm:h-10 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
                            />
                            {quickFilter && (
                                <button
                                    type="button"
                                    onClick={() => setQuickFilter('')}
                                    aria-label="Filtreyi temizle"
                                    title="Filtreyi temizle"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {visibleChapters.length > 0 ? (
                    <div className="grid gap-2.5 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {visibleChapters.map((chapter, index) => {
                            const sanitizedChapterTitle = sanitizeChapterTitle(chapter.chapterNumber, chapter.chapterTitle);
                            const chapterNumLabel = formatChapterNumberLabel(chapter.chapterNumber);
                            const chTitleLower = (chapter.chapterTitle || '').toLowerCase();

                            return (
                                <Link
                                    key={chapter.chapterId}
                                    to={`/manga/${chapter.mangaId}/chapter/${chapter.chapterId}`}
                                    className={cn(
                                        'group flex items-center gap-3 rounded-xl border border-border/60 bg-card/80 p-2.5 sm:p-3 transition-colors hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background animate-card-reveal-fast',
                                        index >= 12 && 'cv-auto-row',
                                    )}
                                >
                                    <div className="h-20 w-14 sm:h-24 sm:w-16 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-secondary">
                                        <OptimizedImage
                                            src={chapter.mangaCover}
                                            alt={chapter.mangaTitle}
                                            width={64}
                                            height={96}
                                            allowProxy
                                            containerClassName="h-full w-full"
                                            className="h-full w-full object-cover"
                                        />
                                    </div>

                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                            <h2 className="min-w-0 flex-1 text-sm sm:text-[15px] font-bold leading-snug line-clamp-1 transition-colors group-hover:text-primary group-focus-visible:text-primary">
                                                {chapter.mangaTitle}
                                            </h2>
                                            {(() => {
                                                if (chTitleLower.includes('[raw]') || chTitleLower.includes('(raw)')) {
                                                    return (
                                                        <Badge variant="outline" className="inline-flex h-[18px] shrink-0 items-center justify-center px-1.5 py-0 text-[9px] font-black uppercase border-purple-500/40 bg-purple-500/15 text-purple-400">
                                                            RAW
                                                        </Badge>
                                                    );
                                                }
                                                if (chTitleLower.includes('[en]') || chTitleLower.includes('(en)')) {
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
                                                            className={cn('inline-flex h-[18px] shrink-0 items-center justify-center px-1.5 py-0 text-[9px] font-black uppercase', lang.badgeClassName)}
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
                                        </div>

                                        <div className="flex min-w-0 items-center">
                                            <span className="inline-flex min-w-0 max-w-full items-center rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                                <span className="truncate">
                                                    Bölüm {chapterNumLabel}
                                                    {sanitizedChapterTitle ? ` • ${sanitizedChapterTitle}` : ''}
                                                </span>
                                            </span>
                                        </div>

                                        <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                            <div className="flex min-w-0 items-center gap-1.5 truncate">
                                                {chapter.mangaType ? (
                                                    <>
                                                        <span className="shrink-0 font-medium text-foreground/75">
                                                            {getMangaTypeLabel(chapter.mangaType)}
                                                        </span>
                                                        <span aria-hidden>•</span>
                                                    </>
                                                ) : null}
                                                <span className="truncate">
                                                    {formatDistanceToNow(new Date(chapter.addedAt), { addSuffix: true, locale: tr })}
                                                </span>
                                            </div>

                                            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary">
                                                Oku
                                                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                                            </span>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                ) : chapters.length > 0 ? (
                    <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/30 p-6 text-center">
                        <Search className="h-10 w-10 text-muted-foreground/60" />
                        <h2 className="mt-3 text-lg font-semibold">Eşleşen bölüm bulunamadı</h2>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setQuickFilter('')}
                            className="mt-4 h-9 text-xs"
                        >
                            Filtreyi Temizle
                        </Button>
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
