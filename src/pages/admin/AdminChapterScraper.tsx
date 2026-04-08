import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    Download,
    RefreshCw,
    Loader2,
    Globe,
    Check,
    ChevronsUpDown,
    BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from 'sonner';
import { getAllMangas, getMangaById, saveManga } from '@/lib/database';
import { createNotificationForFollowers } from '@/lib/storage';
import { Manga, Chapter } from '@/lib/types';
import {
    fetchScraperContent,
    getAvailableScraperProviders,
    getDefaultScraperProviderForSource,
    getScraperProviderLabel,
    readPreferredScraperProvider,
    type ScraperProvider,
    writePreferredScraperProvider,
} from '@/lib/scraperProxy';
import {
    buildScrapedChapterPaginationCandidates,
    buildScrapeSearchUrl,
    detectScrapeSourceFromUrl,
    applyChapterImageResultOptions,
    extractChapterImageResult,
    extractScrapedMangaCards,
    extractScrapedChapterLinks,
    extractScrapedChapterPaginationUrls,
    extractSiyahMelekChapterLinksFromHtml,
    extractSiyahMelekChapterPaginationUrlsFromHtml,
    getAvailableScrapeSources,
    getScrapeSourceLabel,
    isAdultOnlyScrapeSource,
    isDirectScrapeLink,
    normalizeScrapeUrl,
    normalizeScrapeSeriesUrl,
    readPreferredScrapeSource,
    type ScrapedChapterImageResult,
    type ScrapeSource,
    writePreferredScrapeSource,
} from '@/lib/scraper/scrapeSources';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';
import {
    readSiyahMelekSkipPromoFirstPage,
    writeSiyahMelekSkipPromoFirstPage,
} from '@/lib/scraper/siyahmelekSettings';
import { cn } from '@/lib/utils';
import { getMangaTypeLabel } from '@/lib/mangaType';

interface ScrapedMangaCard {
    title: string;
    link: string;
    cover: string;
    genres: string[];
    source: ScrapeSource;
}

interface ScrapedChapter {
    name: string;
    link: string;
    number: number;
    source: ScrapeSource;
    prefetchedImageResult?: ScrapedChapterImageResult;
}

interface ChapterImportCandidate extends ScrapedChapter {
    changeType: 'new' | 'updated';
    existingChapterId?: string;
    existingChapterTitle?: string;
}

const normalizeChapterTitle = (value?: string | null, number?: number) => (
    (value?.replace(/\s+/g, ' ').trim() || `bolum ${number ?? ''}`)
        .toLocaleLowerCase('tr-TR')
);

const AdminChapterScraper: React.FC = () => {
    const navigate = useNavigate();
    const { isAllowed: canUseScraper, isLoading: accessLoading } = useAdminPageGuard({ requiredRole: 'admin' });
    const availableScraperProviders = getAvailableScraperProviders();
    const availableScrapeSources = getAvailableScrapeSources();

    // Local State
    const [localMangas, setLocalMangas] = useState<Manga[]>([]);
    const [selectedLocalMangaId, setSelectedLocalMangaId] = useState<string>('');
    const [localMangaDetails, setLocalMangaDetails] = useState<Manga | null>(null);
    const [loadingLocal, setLoadingLocal] = useState(false);
    const [localMangaPickerOpen, setLocalMangaPickerOpen] = useState(false);
    const [localMangaSearch, setLocalMangaSearch] = useState('');

    // Source State
    const [searchQuery, setSearchQuery] = useState('');
    const [loadingSource, setLoadingSource] = useState(false);
    const [sourceResults, setSourceResults] = useState<ScrapedMangaCard[]>([]);
    const [selectedSourceManga, setSelectedSourceManga] = useState<ScrapedMangaCard | null>(null);
    const [fetchingDetails, setFetchingDetails] = useState(false);
    const [sourceChapters, setSourceChapters] = useState<ScrapedChapter[]>([]);
    const [newChapters, setNewChapters] = useState<ChapterImportCandidate[]>([]);
    const [selectedChapterIndices, setSelectedChapterIndices] = useState<number[]>([]);

    // Import State
    const [importing, setImporting] = useState(false);
    const [scrapeSource, setScrapeSource] = useState<ScrapeSource>(() => readPreferredScrapeSource());
    const [scraperProvider, setScraperProvider] = useState<ScraperProvider>(() => readPreferredScraperProvider());
    const [skipSiyahMelekPromoFirstPage, setSkipSiyahMelekPromoFirstPage] = useState(() => readSiyahMelekSkipPromoFirstPage());
    const sourceSearchBlocked = isAdultOnlyScrapeSource(scrapeSource) && localMangaDetails?.isAdult !== true;
    const filteredLocalMangas = useMemo(() => {
        const query = localMangaSearch.trim().toLocaleLowerCase('tr-TR');

        const scored = localMangas
            .map((manga) => {
                if (!query) {
                    return { manga, score: 0 };
                }

                const haystacks = [
                    manga.title,
                    manga.author,
                    manga.artist,
                    ...(manga.alternativeTitles || []),
                ]
                    .filter(Boolean)
                    .map((value) => value.toLocaleLowerCase('tr-TR'));

                let score = -1;

                for (const value of haystacks) {
                    if (value === query) {
                        score = Math.max(score, 100);
                    } else if (value.startsWith(query)) {
                        score = Math.max(score, 80);
                    } else if (value.includes(query)) {
                        score = Math.max(score, 50);
                    }
                }

                return { manga, score };
            })
            .filter(({ score }) => !query || score >= 0)
            .sort((left, right) => {
                if (right.score !== left.score) {
                    return right.score - left.score;
                }

                return left.manga.title.localeCompare(right.manga.title, 'tr');
            });

        return scored.map(({ manga }) => manga);
    }, [localMangas, localMangaSearch]);

    useEffect(() => {
        if (!canUseScraper) {
            return;
        }

        loadLocalMangas();
    }, [canUseScraper]);

    useEffect(() => {
        if (availableScraperProviders.includes(scraperProvider)) {
            return;
        }

        const nextProvider = readPreferredScraperProvider();
        setScraperProvider(nextProvider);
    }, [availableScraperProviders, scraperProvider]);

    useEffect(() => {
        if (!availableScrapeSources.includes(scrapeSource)) {
            const nextSource = readPreferredScrapeSource();
            setScrapeSource(nextSource);
        }
    }, [availableScrapeSources, availableScraperProviders, scrapeSource, scraperProvider]);

    if (accessLoading || !canUseScraper) {
        return null;
    }

    const handleScraperProviderChange = (nextProvider: ScraperProvider) => {
        writePreferredScraperProvider(nextProvider);
        setScraperProvider(nextProvider);
        toast.success(`Scraper sağlayıcısı: ${getScraperProviderLabel(nextProvider)}`);
    };

    const handleScrapeSourceChange = (nextSource: ScrapeSource) => {
        writePreferredScrapeSource(nextSource);
        setScrapeSource(nextSource);
        setSourceResults([]);
        setSelectedSourceManga(null);
        setSourceChapters([]);
        setNewChapters([]);
        setSelectedChapterIndices([]);

        if (nextSource === 'siyahmelek') {
            const preferredProvider = getDefaultScraperProviderForSource(nextSource);
            writePreferredScraperProvider(preferredProvider);
            setScraperProvider(preferredProvider);
        }

        toast.success(`Kaynak site: ${getScrapeSourceLabel(nextSource)}`);
    };

    const handleSkipSiyahMelekPromoFirstPageChange = (checked: boolean) => {
        writeSiyahMelekSkipPromoFirstPage(checked);
        setSkipSiyahMelekPromoFirstPage(checked);
        toast.success(checked ? 'SiyahMelek ilk reklam sayfası atlanacak' : 'SiyahMelek ilk sayfası korunacak');
    };

    const ensureAdultCompatibleLocalManga = (source: ScrapeSource) => {
        if (!isAdultOnlyScrapeSource(source)) {
            return true;
        }

        if (!localMangaDetails) {
            toast.error('SiyahMelek için önce sitedeki 18+ seriyi seçin.');
            return false;
        }

        if (localMangaDetails.isAdult !== true) {
            toast.error('SiyahMelek sadece 18+ seriler için kullanılabilir. Önce bu seriyi 18+ olarak işaretleyin.');
            return false;
        }

        return true;
    };

    const loadLocalMangas = async () => {
        setLoadingLocal(true);
        try {
            const data = await getAllMangas({ includePrivate: true });
            setLocalMangas(data);
        } catch (err) {
            toast.error('Mangalar yüklenemedi');
        } finally {
            setLoadingLocal(false);
        }
    };

    const applyParsedSourceChapters = (chapters: ScrapedChapter[]) => {
        setSourceChapters(chapters);

        if (!localMangaDetails) {
            setNewChapters([]);
            setSelectedChapterIndices([]);
            return;
        }

        const localChapterByNumber = new Map(
            localMangaDetails.chapters.map((chapter) => [Number(chapter.number), chapter]),
        );
        const diff = chapters.flatMap<ChapterImportCandidate>((scrapedChapter) => {
            const existingChapter = localChapterByNumber.get(Number(scrapedChapter.number));
            if (!existingChapter) {
                return [{ ...scrapedChapter, changeType: 'new' as const }];
            }

            const titleChanged = normalizeChapterTitle(existingChapter.title, Number(existingChapter.number))
                !== normalizeChapterTitle(scrapedChapter.name, Number(scrapedChapter.number));

            if (!titleChanged) {
                return [];
            }

            return [{
                ...scrapedChapter,
                changeType: 'updated' as const,
                existingChapterId: existingChapter.id,
                existingChapterTitle: existingChapter.title,
            }];
        });

        setNewChapters(diff);
        setSelectedChapterIndices(diff.map((_, index) => index));

        if (diff.length === 0) {
            toast.info('Bu manga zaten güncel.');
            return;
        }

        toast.success(`${diff.length} yeni veya güncellenecek bölüm bulundu!`);
    };

    const handleLocalMangaChange = async (mangaId: string) => {
        setSelectedLocalMangaId(mangaId);
        setLocalMangaPickerOpen(false);
        setLocalMangaSearch('');
        setLoadingLocal(true);
        try {
            const details = await getMangaById(mangaId, { includePrivate: true, includePages: true });
            setLocalMangaDetails(details);
            // Pre-fill search query with title for convenience
            if (details) setSearchQuery(details.title);
        } catch (err) {
            toast.error('Manga detayları yüklenemedi');
        } finally {
            setLoadingLocal(false);
        }
    };

    const handleSourceSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const rawQuery = searchQuery.trim();
        const detectedSource = rawQuery.startsWith('http') ? detectScrapeSourceFromUrl(rawQuery) : null;
        const sourceToUse = detectedSource || scrapeSource;

        if (!ensureAdultCompatibleLocalManga(sourceToUse)) {
            return;
        }

        if (rawQuery.startsWith('http') && isDirectScrapeLink(sourceToUse, rawQuery)) {
            if (detectedSource && detectedSource !== scrapeSource) {
                handleScrapeSourceChange(detectedSource);
            }

            toast.info('Direkt link algılandı, bölümler kontrol ediliyor...');
            fetchSourceChapters({
                title: 'Linkten Çekilen Manga',
                link: normalizeScrapeSeriesUrl(sourceToUse, rawQuery),
                cover: '',
                genres: [],
                source: sourceToUse,
            }, sourceToUse);
            return;
        }

        setLoadingSource(true);
        setSourceResults([]);
        setSelectedSourceManga(null);
        setSourceChapters([]);
        setNewChapters([]);
        setSelectedChapterIndices([]);

        try {
            const url = buildScrapeSearchUrl(sourceToUse, rawQuery);
            const html = await fetchScraperContent(url, { provider: scraperProvider, source: sourceToUse });
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const results = extractScrapedMangaCards(doc, sourceToUse, html).map((result) => ({
                ...result,
                source: sourceToUse,
            }));

            setSourceResults(results);
            if (results.length === 0) toast.error('Sonuç bulunamadı');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Arama başarısız oldu');
        } finally {
            setLoadingSource(false);
        }
    };

    const fetchSourceChapters = async (card: ScrapedMangaCard, source: ScrapeSource = card.source) => {
        if (!ensureAdultCompatibleLocalManga(source)) {
            return;
        }

        const normalizedSeriesLink = normalizeScrapeSeriesUrl(source, card.link);
        setSelectedSourceManga({ ...card, link: normalizedSeriesLink, source });
        setFetchingDetails(true);
        setSourceChapters([]);
        setNewChapters([]);
        setSelectedChapterIndices([]);

        try {
            const html = await fetchScraperContent(normalizedSeriesLink, { provider: scraperProvider, source });
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            let parsedChapters = source === 'siyahmelek'
                ? extractSiyahMelekChapterLinksFromHtml(html, normalizedSeriesLink, card.title)
                : extractScrapedChapterLinks(doc, source);

            if (parsedChapters.length === 0) {
                parsedChapters = extractScrapedChapterLinks(doc, source);
            }

            if (source === 'siyahmelek') {
                const explicitPaginationUrls = Array.from(new Set([
                    ...extractScrapedChapterPaginationUrls(doc, source, normalizedSeriesLink),
                    ...extractSiyahMelekChapterPaginationUrlsFromHtml(html, normalizedSeriesLink),
                ]));
                const paginationUrls = buildScrapedChapterPaginationCandidates(
                    source,
                    normalizedSeriesLink,
                    explicitPaginationUrls,
                );

                if (paginationUrls.length > 0) {
                    const chapterMap = new Map(
                        parsedChapters.map((chapter) => [normalizeScrapeUrl(source, chapter.link), chapter]),
                    );
                    let consecutivePagesWithoutNewChapters = 0;

                    for (const pageUrl of paginationUrls) {
                        try {
                            const pageHtml = await fetchScraperContent(pageUrl, { provider: scraperProvider, source });
                            const pageDoc = parser.parseFromString(pageHtml, 'text/html');
                            const pageChapters = extractSiyahMelekChapterLinksFromHtml(
                                pageHtml,
                                normalizedSeriesLink,
                                card.title,
                            );
                            const normalizedPageChapters = pageChapters.length > 0
                                ? pageChapters
                                : extractScrapedChapterLinks(pageDoc, source);
                            let newChapterCount = 0;

                            for (const chapter of normalizedPageChapters) {
                                const chapterKey = normalizeScrapeUrl(source, chapter.link);
                                if (!chapterMap.has(chapterKey)) {
                                    newChapterCount += 1;
                                }
                                chapterMap.set(chapterKey, chapter);
                            }

                            consecutivePagesWithoutNewChapters = newChapterCount === 0
                                ? consecutivePagesWithoutNewChapters + 1
                                : 0;
                        } catch {
                            consecutivePagesWithoutNewChapters += 1;
                        }

                        if (consecutivePagesWithoutNewChapters >= 2) {
                            break;
                        }
                    }

                    parsedChapters = Array.from(chapterMap.values()).sort((left, right) => left.number - right.number);
                }
            }

            const sourcedChapters = parsedChapters.map((chapter) => ({
                ...chapter,
                source,
            }));
            applyParsedSourceChapters(sourcedChapters);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Bölümler çekilemedi');
        } finally {
            setFetchingDetails(false);
        }
    };

    const handleImportNewChapters = async () => {
        if (!localMangaDetails || newChapters.length === 0) return;

        if (!ensureAdultCompatibleLocalManga(selectedSourceManga?.source || scrapeSource)) {
            return;
        }

        const chaptersToImport = newChapters.filter((_, i) => selectedChapterIndices.includes(i));
        if (chaptersToImport.length === 0) {
            toast.error('Lütfen en az bir bölüm seçin');
            return;
        }

        if ((selectedSourceManga?.source || scrapeSource) === 'siyahmelek') {
            const chaptersMissingImageCapture = chaptersToImport.filter((chapter) => !chapter.prefetchedImageResult);
            if (scraperProvider !== 'localhost' && chaptersMissingImageCapture.length > 0) {
                toast.error(`Seçili ${chaptersMissingImageCapture.length} bölüm için görsel yakalama eksik. Önce seçili bölüm scriptini çalıştırın.`);
                return;
            }
        }

        setImporting(true);

        try {
            const importedChapters: Chapter[] = [...localMangaDetails.chapters];
            const importedThisRun: Chapter[] = [];
            let updatedThisRun = 0;
            let lockedChapterCount = 0;
            let failedChapterCount = 0;

            for (let i = 0; i < chaptersToImport.length; i++) {
                const sc = chaptersToImport[i];
                try {
                    let imageResult = sc.prefetchedImageResult
                        ? applyChapterImageResultOptions(
                            sc.prefetchedImageResult,
                            sc.source,
                            { excludeSiyahMelekPromoFirstPage: skipSiyahMelekPromoFirstPage },
                        )
                        : undefined;

                    if (!imageResult) {
                        if (i > 0) await new Promise(resolve => setTimeout(resolve, 800));

                        const chHtml = await fetchScraperContent(sc.link, { provider: scraperProvider, source: sc.source });
                        const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');
                        imageResult = extractChapterImageResult(
                            chDoc,
                            sc.source,
                            { excludeSiyahMelekPromoFirstPage: skipSiyahMelekPromoFirstPage },
                        );
                    }
                    const existingChapterIndex = importedChapters.findIndex((chapter) => (
                        chapter.id === sc.existingChapterId
                        || Number(chapter.number) === Number(sc.number)
                    ));
                    const existingChapter = existingChapterIndex >= 0 ? importedChapters[existingChapterIndex] : null;

                    if (imageResult.status === 'locked') {
                        lockedChapterCount += 1;
                        toast.info(`Bölüm ${sc.number} VIP/kilitli olduğu için atlandı.`);
                        continue;
                    }

                    if (imageResult.status === 'error') {
                        failedChapterCount += 1;
                        toast.error(`Bölüm ${sc.number} için görsel bulunamadı, atlanıyor.`);
                        continue;
                    }

                    const importedChapter: Chapter = {
                        id: existingChapter?.id || `chapter-${Date.now()}-${sc.number}`,
                        number: sc.number,
                        title: sc.name,
                        pages: imageResult.images,
                        releaseDate: existingChapter?.releaseDate || new Date().toISOString(),
                        views: existingChapter?.views || 0,
                    };

                    if (existingChapterIndex >= 0) {
                        importedChapters[existingChapterIndex] = importedChapter;
                        updatedThisRun += 1;
                    } else {
                        importedChapters.push(importedChapter);
                        importedThisRun.push(importedChapter);
                    }

                    toast.info(`Bölüm ${sc.number} ${sc.changeType === 'updated' ? 'güncellendi' : 'yüklendi'}... (${i + 1}/${chaptersToImport.length})`);
                } catch (e) {
                    failedChapterCount += 1;
                    toast.error(`Bölüm ${sc.number} hata verdi, atlanıyor.`);
                }
            }

            if (importedThisRun.length === 0 && updatedThisRun === 0) {
                if (lockedChapterCount > 0 && failedChapterCount === 0) {
                    toast.info('Seçilen bölümlerin tamamı VIP/kilitli durumda, güncelleme yapılmadı.');
                } else {
                    toast.error('Aktarılabilecek açık bölüm bulunamadı.');
                }
                return;
            }

            // Save updated manga
            const updatedManga: Manga = {
                ...localMangaDetails,
                chapters: importedChapters,
                lastUpdated: new Date().toISOString(),
            };

            await saveManga(updatedManga);

            if (importedThisRun.length > 0) {
                await Promise.all(
                    importedThisRun.map((chapter) =>
                        createNotificationForFollowers(
                            localMangaDetails.id,
                            localMangaDetails.title,
                            localMangaDetails.cover,
                            chapter.id,
                            chapter.number
                        )
                    )
                );
            }

            toast.success(`${importedThisRun.length} yeni bölüm eklendi, ${updatedThisRun} bölüm güncellendi, ${lockedChapterCount} kilitli bölüm atlandı${failedChapterCount > 0 ? `, ${failedChapterCount} bölüm hata verdi` : ''}.`);
            navigate(`/admin/mangas/${localMangaDetails.id}`);
        } catch (err) {
            toast.error('Güncelleme sırasında bir hata oluştu');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <RefreshCw className="h-6 w-6" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold sm:text-3xl">Bölüm Çekme</h1>
                    <p className="text-muted-foreground">Eski mangalarınız için yeni bölümleri otomatik bulun ve yükleyin.</p>
                </div>
                <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:flex-wrap sm:items-center">
                    <Select value={scrapeSource} onValueChange={(value) => handleScrapeSourceChange(value as ScrapeSource)}>
                        <SelectTrigger className="h-8 w-full border-primary/20 bg-primary/5 text-xs text-primary sm:w-[190px]">
                            <SelectValue placeholder="Kaynak site seç" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableScrapeSources.map((source) => (
                                <SelectItem key={source} value={source}>
                                    {getScrapeSourceLabel(source)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={scraperProvider} onValueChange={(value) => handleScraperProviderChange(value as ScraperProvider)}>
                        <SelectTrigger className="h-8 w-full border-primary/20 bg-primary/5 text-xs text-primary sm:w-[170px]">
                            <SelectValue placeholder="Proxy seç" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableScraperProviders.map((provider) => (
                                <SelectItem key={provider} value={provider}>
                                    {getScraperProviderLabel(provider)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Badge variant="outline" className="h-8 gap-1 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors">
                        <Globe className="h-4 w-4" />
                        {getScrapeSourceLabel(scrapeSource)}
                    </Badge>
                </div>
            </div>

            {scrapeSource === 'siyahmelek' ? (
                <Card className="border-rose-500/20 bg-rose-500/5 backdrop-blur-sm">
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-rose-200">SiyahMelek İlk Sayfa Filtresi</p>
                            <p className="text-sm text-rose-100/80">
                                Bazı bölümlerde ilk görsel reklam oluyor. Açıkken `0001.jpg` olan ilk sayfa otomatik atlanır.
                            </p>
                        </div>
                        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-black/20 px-3 py-2">
                            <span className="text-sm text-rose-100">{skipSiyahMelekPromoFirstPage ? 'Açık' : 'Kapalı'}</span>
                            <Switch
                                checked={skipSiyahMelekPromoFirstPage}
                                onCheckedChange={handleSkipSiyahMelekPromoFirstPageChange}
                                aria-label="SiyahMelek reklam ilk sayfasını atla"
                            />
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            <div className="grid gap-6 md:grid-cols-2">
                {/* Step 1: Select Local Manga */}
                <Card className="border-border bg-card/50 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">1</span>
                            Kendi Sitemizden Manga Seçin
                        </CardTitle>
                        <CardDescription>Yeni bölümlerini kontrol etmek istediğiniz mangayı seçin.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Dialog open={localMangaPickerOpen} onOpenChange={setLocalMangaPickerOpen}>
                            <DialogTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={localMangaPickerOpen}
                                    className="h-auto min-h-14 w-full justify-between rounded-xl border-border bg-background px-3 py-2 text-left"
                                >
                                    {localMangaDetails ? (
                                        <div className="flex min-w-0 items-center gap-3">
                                            <img
                                                src={localMangaDetails.cover}
                                                alt={localMangaDetails.title}
                                                className="h-12 w-9 rounded-md object-cover ring-1 ring-white/10"
                                            />
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{localMangaDetails.title}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                                    <span className="inline-flex items-center gap-1">
                                                        <BookOpen className="h-3.5 w-3.5" />
                                                        {localMangaDetails.chapters.length} bölüm
                                                    </span>
                                                    <Badge variant="outline" className="h-5 border-primary/20 bg-primary/5 px-1.5 text-[10px] text-primary">
                                                        {getMangaTypeLabel(localMangaDetails.type)}
                                                    </Badge>
                                                    {localMangaDetails.isAdult ? (
                                                        <Badge variant="outline" className="h-5 border-rose-500/20 bg-rose-500/10 px-1.5 text-[10px] text-rose-500">
                                                            18+
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-muted-foreground">Manga seçin...</span>
                                    )}
                                    <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 opacity-60" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="w-[min(96vw,820px)] max-w-[820px] rounded-2xl border-border p-0">
                                <DialogHeader className="border-b border-border px-4 py-3 text-left">
                                    <DialogTitle>Manga Seç</DialogTitle>
                                    <DialogDescription>
                                        Seri adı, yazar, çizer veya alternatif ada göre ara.
                                    </DialogDescription>
                                </DialogHeader>
                                <Command shouldFilter={false}>
                                    <CommandInput
                                        value={localMangaSearch}
                                        onValueChange={setLocalMangaSearch}
                                        placeholder="Seri adı, yazar veya alternatif ad ara..."
                                        className="h-11"
                                    />
                                    <CommandList>
                                        <CommandEmpty>Eşleşen manga bulunamadı.</CommandEmpty>
                                        <CommandGroup>
                                            <ScrollArea className="h-[min(62vh,420px)]">
                                                <div className="p-2">
                                                    {filteredLocalMangas.map((manga) => (
                                                        <CommandItem
                                                            key={manga.id}
                                                            value={manga.id}
                                                            onSelect={() => handleLocalMangaChange(manga.id)}
                                                            className="mb-2 flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 aria-selected:border-primary/25 aria-selected:bg-primary/10"
                                                        >
                                                            <img
                                                                src={manga.cover}
                                                                alt={manga.title}
                                                                className="h-14 w-10 rounded-md object-cover ring-1 ring-white/10"
                                                            />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="truncate text-sm font-semibold text-foreground">
                                                                    {manga.title}
                                                                </div>
                                                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                                                    {[manga.author, manga.artist].filter(Boolean).join(' • ') || 'Yazar / çizer bilgisi yok'}
                                                                </div>
                                                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                                    <Badge variant="outline" className="h-5 border-primary/20 bg-primary/5 px-1.5 text-[10px] text-primary">
                                                                        {getMangaTypeLabel(manga.type)}
                                                                    </Badge>
                                                                    <Badge variant="outline" className="h-5 border-border px-1.5 text-[10px] text-muted-foreground">
                                                                        {manga.chapters.length} bölüm
                                                                    </Badge>
                                                                    {manga.isAdult ? (
                                                                        <Badge variant="outline" className="h-5 border-rose-500/20 bg-rose-500/10 px-1.5 text-[10px] text-rose-500">
                                                                            18+
                                                                        </Badge>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                            <Check
                                                                className={cn(
                                                                    'h-4 w-4 text-primary transition-opacity',
                                                                    selectedLocalMangaId === manga.id ? 'opacity-100' : 'opacity-0',
                                                                )}
                                                            />
                                                        </CommandItem>
                                                    ))}
                                                </div>
                                            </ScrollArea>
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </DialogContent>
                        </Dialog>

                        {localMangaDetails && (
                            <div className="flex items-center gap-3 rounded-lg border border-border p-3 bg-card">
                                <img src={localMangaDetails.cover} className="h-16 w-12 rounded object-cover" />
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-bold">{localMangaDetails.title}</p>
                                        {localMangaDetails.isAdult ? (
                                            <Badge variant="outline" className="border-rose-500/20 bg-rose-500/10 text-rose-500">
                                                18+
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <p className="text-sm text-muted-foreground">Mevcut Bölüm Sayısı: {localMangaDetails.chapters.length}</p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Step 2: Search Source Manga */}
                <Card className="border-border bg-card/50 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span>
                            {getScrapeSourceLabel(scrapeSource)} Üzerinde Bulun
                        </CardTitle>
                        <CardDescription>Manganın güncel halini seçtiğiniz sitede bulun.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form onSubmit={handleSourceSearch} className="flex flex-col gap-2 sm:flex-row">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={`Manga adı veya ${getScrapeSourceLabel(scrapeSource)} URL...`}
                            />
                            <Button type="submit" disabled={loadingSource || sourceSearchBlocked}>
                                {loadingSource ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            </Button>
                        </form>

                        {sourceSearchBlocked ? (
                            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                                SiyahMelek sadece 18+ olarak işaretlenmiş yerel seriler için kullanılabilir.
                            </div>
                        ) : null}

                        <ScrollArea className="h-[200px] rounded-md border border-border p-2">
                            {sourceResults.length > 0 ? (
                                <div className="space-y-2">
                                    {sourceResults.map((m, i) => (
                                        <div
                                            key={i}
                                            onClick={() => fetchSourceChapters(m, m.source)}
                                            className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary ${selectedSourceManga?.link === m.link ? 'bg-primary/20 border-primary' : ''}`}
                                        >
                                            <img src={m.cover} className="h-10 w-8 rounded object-cover" />
                                            <div className="min-w-0">
                                                <span className="block truncate text-sm font-medium">{m.title}</span>
                                                {m.source === 'siyahmelek' ? (
                                                    <Badge variant="outline" className="mt-1 border-rose-500/20 bg-rose-500/10 text-[10px] text-rose-500">
                                                        18+
                                                    </Badge>
                                                ) : null}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-center text-sm text-muted-foreground mt-8">Henüz arama yapılmadı</p>
                            )}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>

            {/* Step 3: Result & Import */}
            {selectedSourceManga && (
                <Card className="border-border bg-card/50 backdrop-blur-sm overflow-hidden">
                    <CardHeader className="bg-primary/5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle>Durum Kontrolü</CardTitle>
                                <CardDescription>Kaynak site ile bizim sitemiz arasındaki farklar.</CardDescription>
                            </div>
                            <Button
                                disabled={newChapters.length === 0 || importing || sourceSearchBlocked}
                                onClick={handleImportNewChapters}
                                className="w-full gap-2 sm:w-auto"
                            >
                                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                {selectedChapterIndices.length > 0 ? `${selectedChapterIndices.length} Yeni Bölümü İçe Aktar` : 'Bölüm Seçilmedi'}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="grid md:grid-cols-2">
                            <div className="p-4 md:border-r md:border-border md:p-6">
                                <div className="mb-4 flex items-center justify-between">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Yeni / Güncellenecek Bölümler ({newChapters.length})</h3>
                                    {newChapters.length > 0 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-3 text-[10px] uppercase font-black tracking-wider transition-all"
                                            onClick={() => {
                                                if (selectedChapterIndices.length === newChapters.length) {
                                                    setSelectedChapterIndices([]);
                                                } else {
                                                    setSelectedChapterIndices(newChapters.map((_, i) => i));
                                                }
                                            }}
                                        >
                                            {selectedChapterIndices.length === newChapters.length ? 'Hiçbirini Seçme' : 'Tümünü Seç'}
                                        </Button>
                                    )}
                                </div>
                                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                    {newChapters.map((ch, i) => {
                                        const isSelected = selectedChapterIndices.includes(i);
                                        const isUpdate = ch.changeType === 'updated';
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => {
                                                    setSelectedChapterIndices(prev =>
                                                        prev.includes(i)
                                                            ? prev.filter(index => index !== i)
                                                            : [...prev, i]
                                                    );
                                                }}
                                                className={`flex flex-col items-center justify-center rounded-full w-16 h-16 transition-all duration-200 border-2 select-none ${isSelected
                                                    ? isUpdate
                                                        ? 'border-amber-500 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                                                        : 'border-green-500 bg-green-500/20 text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]'
                                                    : isUpdate
                                                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300/70 opacity-70'
                                                        : 'bg-red-500/10 border-red-500/50 text-red-400 opacity-60'
                                                    }`}
                                            >
                                                <span className="text-[10px] font-bold uppercase">{isUpdate ? 'Güncel' : 'Bölüm'}</span>
                                                <span className="text-sm font-black">{ch.number}</span>
                                            </button>
                                        );
                                    })}
                                    {newChapters.length === 0 && (
                                        <p className="col-span-full py-4 text-center text-sm text-green-500 font-medium">Bu manga tamamen güncel!</p>
                                    )}
                                </div>
                            </div>
                            <div className="bg-secondary/20 p-4 md:p-6">
                                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">Bilgi</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span>Kaynaktaki Toplam Bölüm:</span>
                                        <span className="font-bold">{sourceChapters.length}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>Bizdeki Toplam Bölüm:</span>
                                        <span className="font-bold">{localMangaDetails?.chapters.length || 0}</span>
                                    </div>
                                    <div className="pt-3 border-t border-border">
                                        <p className="text-xs text-muted-foreground italic">
                                            * Eksik bölümler ve aynı numarada başlığı değişen kayıtlar otomatik olarak işaretlenir.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default AdminChapterScraper;
