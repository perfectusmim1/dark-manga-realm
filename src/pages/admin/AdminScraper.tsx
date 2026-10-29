import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    Download,
    ArrowRight,
    Loader2,
    Globe,
    ExternalLink,
    Plus,
    Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
    ensureArtistByName,
    ensureAuthorByName,
    getAllMangas,
    linkMangaToArtist,
    linkMangaToAuthor,
    saveManga,
} from '@/lib/database';
import { Manga, Chapter } from '@/lib/types';
import { normalizeGenres } from '@/lib/mockData';
import { getAdultContentFormatLabel } from '@/lib/adultContentFormat';
import { getMangaTypeLabel } from '@/lib/mangaType';
import {
    fetchScraperContent,
    getAvailableScraperProviders,
    getScraperProviderLabel,
    readPreferredScraperProvider,
    type ScraperProvider,
    writePreferredScraperProvider,
} from '@/lib/scraperProxy';
import {
    areSeriesTitlesMatching,
    buildScrapeSearchUrl,
    detectScrapeSourceFromUrl,
    extractChapterImageResult,
    extractScrapedMangaCards,
    extractScrapedMangaDetail,
    getAvailableScrapeSources,
    getScrapedStatusLabel,
    getScrapeSourceLabel,
    isAdultOnlyScrapeSource,
    isDirectScrapeLink,
    normalizeScrapeSeriesUrl,
    readPreferredScrapeSource,
    sanitizeAndDedupePageUrls,
    SCRAPER_SOURCES,
    type ScrapedChapter,
    type ScrapedMangaCard,
    type ScrapedMangaDraft,
    type ScraperSourceKey,
    type ScrapeSource,
    writePreferredScrapeSource,
} from '@/lib/scraper/scrapeSources';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';

const normalizeScrapedText = (value?: string | null) =>
    value?.replace(/\s+/g, ' ').trim() || '';

const extractPrimaryScrapedPersonName = (value?: string | null) =>
    normalizeScrapedText(value);

const splitScrapedEntityNames = (value?: string | null) => {
    const normalized = normalizeScrapedText(value);
    if (!normalized) {
        return [] as string[];
    }

    return Array.from(
        new Set(
            normalized
                .split(/[,，;\n|/]+/g)
                .map((item) => extractPrimaryScrapedPersonName(item))
                .filter(Boolean),
        ),
    );
};

const getMediaTypeLabel = (type?: Manga['type']) => {
    return getMangaTypeLabel(type);
};

/**
 * Birincil kaynakta görsel eksik veya bozuk çıktığında diğer 4 kaynaktan
 * (okutoon, mangacix, golgebahcesi, dxdfansub) aynı seriyi arayıp bölümü tamamlar.
 */
async function tryRecoverChapterImagesFromFallbackSources(
    seriesTitle: string,
    alternativeTitles: string[] | undefined,
    chapterNumber: number,
    primarySource: ScrapeSource,
    scraperProvider: ScraperProvider,
    cachedSourceChapters: Map<ScraperSourceKey, ScrapedChapter[]>,
): Promise<{ images: string[]; source: ScraperSourceKey } | null> {
    const fallbackSources = SCRAPER_SOURCES.filter((s) => s !== primarySource);

    for (const fbSource of fallbackSources) {
        try {
            let candidateChapters = cachedSourceChapters.get(fbSource);

            if (!candidateChapters) {
                const searchUrl = buildScrapeSearchUrl(fbSource, seriesTitle);
                const searchHtml = await fetchScraperContent(searchUrl, { provider: scraperProvider, source: fbSource });
                const parser = new DOMParser();
                const searchDoc = parser.parseFromString(searchHtml, 'text/html');
                const cards = extractScrapedMangaCards(searchDoc, fbSource, searchHtml);

                const matchedCard = cards.find((card) =>
                    areSeriesTitlesMatching(
                        { title: seriesTitle, alternativeTitles },
                        { title: card.title },
                    ),
                );

                if (!matchedCard) {
                    cachedSourceChapters.set(fbSource, []);
                    continue;
                }

                const seriesUrl = normalizeScrapeSeriesUrl(fbSource, matchedCard.link);
                const seriesHtml = await fetchScraperContent(seriesUrl, { provider: scraperProvider, source: fbSource });
                const seriesDoc = parser.parseFromString(seriesHtml, 'text/html');
                const detail = extractScrapedMangaDetail(seriesDoc, fbSource, { ...matchedCard, link: seriesUrl });
                candidateChapters = detail._rawChapters;
                cachedSourceChapters.set(fbSource, candidateChapters);
            }

            const matchedChapter = candidateChapters.find(
                (ch) => Number(ch.number) === Number(chapterNumber),
            );

            if (!matchedChapter) {
                continue;
            }

            const chHtml = await fetchScraperContent(matchedChapter.link, { provider: scraperProvider, source: fbSource });
            const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');
            const imgResult = extractChapterImageResult(chDoc, fbSource, undefined, chHtml);
            const cleanPages = sanitizeAndDedupePageUrls(imgResult.images, fbSource);

            if (cleanPages.length > 0) {
                return { images: cleanPages, source: fbSource };
            }
        } catch (fbErr) {
            console.warn(`Fallback recovery failed for ${fbSource} chapter ${chapterNumber}`, fbErr);
        }
    }

    return null;
}

const AdminScraper: React.FC = () => {
    const navigate = useNavigate();
    const { isAllowed: canUseScraper, isLoading: accessLoading } = useAdminPageGuard({ requiredRole: 'admin' });
    const availableScraperProviders = getAvailableScraperProviders();
    const availableScrapeSources = getAvailableScrapeSources();
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<ScrapedMangaCard[]>([]);
    const [selectedManga, setSelectedManga] = useState<ScrapedMangaCard | null>(null);
    const [fetchedData, setFetchedData] = useState<ScrapedMangaDraft | null>(null);
    const [fetchingDetails, setFetchingDetails] = useState(false);
    const [selectedChapterIndices, setSelectedChapterIndices] = useState<number[]>([]);
    const [scrapeSource, setScrapeSource] = useState<ScrapeSource>(() => readPreferredScrapeSource());
    const [scraperProvider, setScraperProvider] = useState<ScraperProvider>(() => readPreferredScraperProvider());
    const [autoRecoverFromFallbacks, setAutoRecoverFromFallbacks] = useState(true);

    const adultFormatLabel = fetchedData ? getAdultContentFormatLabel({
        isAdult: fetchedData.isAdult,
        type: fetchedData.type,
        genres: fetchedData.genres,
    }) : null;

    useEffect(() => {
        if (availableScraperProviders.includes(scraperProvider)) {
            return;
        }

        const nextProvider = readPreferredScraperProvider();
        setScraperProvider(nextProvider);
    }, [availableScraperProviders, scraperProvider]);

    useEffect(() => {
        if (!availableScrapeSources.includes(scrapeSource as ScraperSourceKey)) {
            const nextSource = readPreferredScrapeSource();
            setScrapeSource(nextSource);
        }
    }, [availableScrapeSources, scrapeSource]);

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
        setResults([]);
        setSelectedManga(null);
        setFetchedData(null);
        setSelectedChapterIndices([]);
        toast.success(`Kaynak site: ${getScrapeSourceLabel(nextSource)}`);
    };

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const rawQuery = searchQuery.trim();
        const detectedSource = rawQuery.startsWith('http') ? detectScrapeSourceFromUrl(rawQuery) : null;
        const sourceToUse = detectedSource || scrapeSource;

        if (rawQuery.startsWith('http') && isDirectScrapeLink(sourceToUse, rawQuery)) {
            if (detectedSource && detectedSource !== scrapeSource) {
                handleScrapeSourceChange(detectedSource);
            }

            toast.info('Direkt link algılandı, detaylar getiriliyor...');
            fetchMangaDetails({
                title: 'Linkten Çekilen Manga',
                link: normalizeScrapeSeriesUrl(sourceToUse, rawQuery),
                cover: '',
                genres: [],
                source: sourceToUse,
            }, sourceToUse);
            return;
        }

        setLoading(true);
        setResults([]);
        setSelectedManga(null);
        setFetchedData(null);

        try {
            const url = buildScrapeSearchUrl(sourceToUse, rawQuery);
            const html = await fetchScraperContent(url, { provider: scraperProvider, source: sourceToUse });

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const cards = extractScrapedMangaCards(doc, sourceToUse, html).map((card) => ({
                ...card,
                genres: normalizeGenres(card.genres),
                source: sourceToUse,
            }));
            setResults(cards);
            if (cards.length === 0) toast.error('Sonuç bulunamadı');
        } catch (err) {
            console.error(err);
            toast.error(err instanceof Error ? err.message : 'Veri çekilirken bir hata oluştu');
        } finally {
            setLoading(false);
        }
    };

    const fetchMangaDetails = async (card: ScrapedMangaCard, source: ScrapeSource = card.source || scrapeSource) => {
        const normalizedSeriesLink = normalizeScrapeSeriesUrl(source, card.link);
        setFetchingDetails(true);
        setSelectedManga({ ...card, link: normalizedSeriesLink, source });
        setFetchedData(null);

        try {
            const html = await fetchScraperContent(normalizedSeriesLink, { provider: scraperProvider, source });
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const extractedManga = extractScrapedMangaDetail(doc, source, { ...card, link: normalizedSeriesLink });
            const mergedChapters = extractedManga._rawChapters;

            const scrapedManga: ScrapedMangaDraft = {
                ...extractedManga,
                isAdult: extractedManga.isAdult || isAdultOnlyScrapeSource(source),
                _rawChapters: mergedChapters.map((chapter) => ({
                    ...chapter,
                })),
            };

            setSelectedChapterIndices(scrapedManga._rawChapters.map((_, i) => i));
            setFetchedData(scrapedManga);
            toast.success('Manga detayları çekildi');
        } catch (err) {
            console.error(err);
            toast.error(err instanceof Error ? err.message : 'Detaylar çekilirken bir hata oluştu');
        } finally {
            setFetchingDetails(false);
        }
    };

    const handleImportManga = async () => {
        if (!fetchedData || !fetchedData.title) return;
        setLoading(true);

        try {
            const rawChapters = fetchedData._rawChapters;
            const selectedChaptersToImport = rawChapters.filter((_, i) => selectedChapterIndices.includes(i));
            const activeScrapeSource = scrapeSource;
            const isAdultImport = fetchedData.isAdult === true || isAdultOnlyScrapeSource(activeScrapeSource);

            if (selectedChaptersToImport.length === 0) {
                toast.error('Lütfen en az bir bölüm seçin');
                setLoading(false);
                return;
            }

            // 1. DUPLICATE CHECK: Search existing mangas
            const existingMangas = await getAllMangas({ includePrivate: true });
            const targetDraft = {
                title: fetchedData.title,
                alternativeTitles: fetchedData.alternativeTitles || [],
            };
            const matchedExisting = existingMangas.find((m) =>
                areSeriesTitlesMatching(targetDraft, {
                    title: m.title,
                    alternativeTitles: m.alternativeTitles,
                }),
            );

            const mangaId = matchedExisting ? matchedExisting.id : `manga-${Date.now()}`;
            const chapters: Chapter[] = matchedExisting ? [...matchedExisting.chapters] : [];
            let newlyAddedCount = 0;
            let updatedCount = 0;
            let lockedChapterCount = 0;
            let failedChapterCount = 0;
            let fallbackRecoveredCount = 0;

            const fallbackCache = new Map<ScraperSourceKey, ScrapedChapter[]>();

            toast.info(`${selectedChaptersToImport.length} bölüm için görsel linkleri çekiliyor...`);

            for (let i = 0; i < selectedChaptersToImport.length; i++) {
                const rc = selectedChaptersToImport[i];
                try {
                    let imageResult = rc.prefetchedImageResult;

                    if (!imageResult) {
                        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 600));

                        const chHtml = await fetchScraperContent(rc.link, { provider: scraperProvider, source: activeScrapeSource });
                        const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');
                        imageResult = extractChapterImageResult(chDoc, activeScrapeSource, undefined, chHtml);
                    }

                    let cleanPages = imageResult ? sanitizeAndDedupePageUrls(imageResult.images, activeScrapeSource) : [];

                    // Fallback recovery if empty/error and enabled
                    if (cleanPages.length === 0 && autoRecoverFromFallbacks) {
                        toast.info(`Bölüm ${rc.number} birincil kaynakta eksik, yedek kaynaklardan aranıyor...`);
                        const recovered = await tryRecoverChapterImagesFromFallbackSources(
                            fetchedData.title,
                            fetchedData.alternativeTitles,
                            rc.number,
                            activeScrapeSource,
                            scraperProvider,
                            fallbackCache,
                        );
                        if (recovered && recovered.images.length > 0) {
                            cleanPages = recovered.images;
                            fallbackRecoveredCount += 1;
                            toast.success(`Bölüm ${rc.number} ${getScrapeSourceLabel(recovered.source)} üzerinden tamamlandı (${cleanPages.length} görsel).`);
                        }
                    }

                    if (imageResult?.status === 'locked' && cleanPages.length === 0) {
                        lockedChapterCount += 1;
                        toast.info(`Bölüm ${rc.number} VIP/kilitli olduğu için atlandı.`);
                        continue;
                    }

                    if (cleanPages.length === 0) {
                        failedChapterCount += 1;
                        console.warn('Geçersiz/boş görsel linki, bölüm kaydedilmeyecek:', rc.number);
                        toast.error(`Bölüm ${rc.number} için geçerli görsel bulunamadı, atlandı.`);
                        continue;
                    }

                    const existingChapterIndex = chapters.findIndex(
                        (ch) => Number(ch.number) === Number(rc.number),
                    );

                    const chapterPayload: Chapter = {
                        id: existingChapterIndex >= 0 ? chapters[existingChapterIndex].id : `chapter-${Date.now()}-${i}`,
                        number: rc.number,
                        title: rc.name,
                        pages: cleanPages,
                        releaseDate: existingChapterIndex >= 0 ? chapters[existingChapterIndex].releaseDate : new Date().toISOString(),
                        views: existingChapterIndex >= 0 ? chapters[existingChapterIndex].views : 0,
                    };

                    if (existingChapterIndex >= 0) {
                        chapters[existingChapterIndex] = chapterPayload;
                        updatedCount += 1;
                    } else {
                        chapters.push(chapterPayload);
                        newlyAddedCount += 1;
                    }

                    if ((i + 1) % 5 === 0 || i === selectedChaptersToImport.length - 1) {
                        toast.info(`${i + 1} / ${selectedChaptersToImport.length} bölüm işlendi...`);
                    }
                } catch (e) {
                    failedChapterCount += 1;
                    console.error('Bölüm çekme hatası:', { chapterNumber: rc.number, error: e });
                    toast.error(`Bölüm ${rc.number} atlandı (Hata: ${e instanceof Error ? e.message : 'Bilinmeyen hata'})`);
                }
            }

            // DO NOT SAVE IF NO VALID CHAPTERS
            const totalValidChapters = chapters.filter((c) => Array.isArray(c.pages) && c.pages.length > 0);
            if (totalValidChapters.length === 0) {
                toast.error('İçe aktarılabilecek geçerli görsele sahip açık bölüm bulunamadı, seri kaydedilmedi.');
                setLoading(false);
                return;
            }

            // Sort chapters by number ascending
            chapters.sort((a, b) => Number(a.number) - Number(b.number));

            const normalizedAuthorNames = splitScrapedEntityNames(fetchedData.author);
            const normalizedArtistNames = splitScrapedEntityNames(fetchedData.artist);
            const authorEntities = (await Promise.all(
                normalizedAuthorNames.map((name) => ensureAuthorByName(name)),
            )).filter(Boolean);
            const artistEntities = (await Promise.all(
                normalizedArtistNames.map((name) => ensureArtistByName(name)),
            )).filter(Boolean);
            const normalizedAuthorLabel = normalizedAuthorNames.join(', ');
            const normalizedArtistLabel = normalizedArtistNames.join(', ');

            if (matchedExisting) {
                // Update existing manga
                const mergedAlternativeTitles = Array.from(new Set([
                    ...(matchedExisting.alternativeTitles || []),
                    ...(fetchedData.alternativeTitles || []),
                ]));
                const mergedGenres = Array.from(new Set([
                    ...(matchedExisting.genres || []),
                    ...(fetchedData.genres || []),
                ]));

                const updatedManga: Manga = {
                    ...matchedExisting,
                    alternativeTitles: mergedAlternativeTitles,
                    genres: mergedGenres,
                    chapters,
                    author: matchedExisting.author || normalizedAuthorLabel || '',
                    artist: matchedExisting.artist || normalizedArtistLabel || undefined,
                    description: matchedExisting.description || fetchedData.description || '',
                    cover: matchedExisting.cover || fetchedData.cover || '',
                    banner: matchedExisting.banner || fetchedData.banner || fetchedData.cover || '',
                    isAdult: matchedExisting.isAdult || isAdultImport,
                    lastUpdated: new Date().toISOString(),
                };

                await saveManga(updatedManga);

                for (const authorEntity of authorEntities) {
                    await linkMangaToAuthor(mangaId, authorEntity.id);
                }
                for (const artistEntity of artistEntities) {
                    await linkMangaToArtist(mangaId, artistEntity.id);
                }

                toast.success(
                    `"${matchedExisting.title}" zaten mevcut. Seri üzerine güncellendi (+${newlyAddedCount} yeni, ${updatedCount} güncellenen bölüm).`,
                );
                navigate(isAdultImport ? '/admin/adult-mangas' : `/admin/mangas/${mangaId}`);
            } else {
                // Create brand new manga
                const finalManga: Manga = {
                    id: mangaId,
                    title: fetchedData.title,
                    alternativeTitles: fetchedData.alternativeTitles || [],
                    description: fetchedData.description || '',
                    cover: fetchedData.cover || '',
                    banner: fetchedData.banner || fetchedData.cover || '',
                    author: normalizedAuthorLabel || '',
                    artist: normalizedArtistLabel || undefined,
                    status: fetchedData.status || 'ongoing',
                    type: fetchedData.type || 'webtoon',
                    genres: fetchedData.genres || [],
                    releaseYear: fetchedData.releaseYear,
                    chapters,
                    views: 0,
                    ratings: [],
                    averageRating: 0,
                    reviewCount: 0,
                    isAdult: isAdultImport,
                    createdAt: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                };

                await saveManga(finalManga);

                for (const authorEntity of authorEntities) {
                    await linkMangaToAuthor(mangaId, authorEntity.id);
                }
                for (const artistEntity of artistEntities) {
                    await linkMangaToArtist(mangaId, artistEntity.id);
                }

                const summaryParts = [`${chapters.length} bölüm eklendi`];
                if (fallbackRecoveredCount > 0) summaryParts.push(`${fallbackRecoveredCount} bölüm yedek kaynaktan tamamlandı`);
                if (failedChapterCount > 0) summaryParts.push(`${failedChapterCount} hatalı bölüm atlandı`);

                toast.success(`Manga başarıyla eklendi (${summaryParts.join(', ')}).`);
                navigate(isAdultImport ? '/admin/adult-mangas' : '/admin/mangas');
            }
        } catch (err) {
            console.error(err);
            toast.error('İçe aktarma sırasında hata oluştu');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold sm:text-3xl">İçerik Çekici (Scraper)</h1>
                    <p className="text-muted-foreground">Aktif 5 dış kaynaktan manga ve webtoon serilerini otomatik olarak çekin.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
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
                    <Badge variant="outline" className="h-8 gap-1 border-primary/20 bg-primary/5 text-primary transition-colors hover:bg-primary/10">
                        <Globe className="h-4 w-4" />
                        {getScrapeSourceLabel(scrapeSource)}
                    </Badge>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Manga Ara veya Link Yapıştır</CardTitle>
                    <CardDescription>
                        {getScrapeSourceLabel(scrapeSource)} üzerinden arama yapın veya doğrudan seri bağlantısını yapıştırın.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder={`Manga adı yazın veya ${getScrapeSourceLabel(scrapeSource)} seri linkini yapıştırın`}
                                className="pl-10"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <Button type="submit" disabled={loading}>
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                            {searchQuery.startsWith('http') ? 'Linki Çek' : 'Ara'}
                        </Button>
                    </form>

                    <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Sparkles className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-sm font-medium">Bozuk Bölümleri Yedek Kaynaklardan Tamamla</p>
                                <p className="text-xs text-muted-foreground">
                                    Seçilen kaynakta görsel eksik veya bozuksa diğer 4 kaynaktan (OkuToon, MangaCix, Gölge Bahçesi, DxDFansub) otomatik tamamlanır.
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={autoRecoverFromFallbacks}
                            onCheckedChange={setAutoRecoverFromFallbacks}
                            aria-label="Bozuk bölümleri yedek kaynaklardan tamamla"
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
                {/* Results List */}
                <Card className="flex h-[460px] flex-col lg:h-[600px]">
                    <CardHeader>
                        <CardTitle>Sonuçlar ({results.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0">
                        <ScrollArea className="h-full px-4">
                            <div className="space-y-4 py-4">
                                {results.map((item, i) => (
                                    <div
                                        key={i}
                                        className={`group flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50 cursor-pointer ${selectedManga?.link === item.link ? 'border-primary bg-primary/5' : 'border-border'
                                            }`}
                                        onClick={() => fetchMangaDetails(item)}
                                    >
                                        <div className="h-20 w-16 overflow-hidden rounded bg-muted">
                                            <img
                                                src={item.cover}
                                                alt={item.title}
                                                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                                onError={(e) => (e.currentTarget.src = 'https://placehold.co/150x200?text=Kapak+Yok')}
                                            />
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <h3 className="font-semibold line-clamp-1">{item.title}</h3>
                                            <div className="flex flex-wrap gap-1">
                                                {item.genres.slice(0, 3).map((g, gi) => (
                                                    <Badge key={gi} variant="secondary" className="text-[10px] px-1 h-4">
                                                        {g}
                                                    </Badge>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <ExternalLink className="h-3 w-3" />
                                                {new URL(item.link).hostname}
                                            </div>
                                        </div>
                                        <ArrowRight className={`h-5 w-5 transition-transform ${selectedManga?.link === item.link ? 'translate-x-1 text-primary' : 'text-muted-foreground'}`} />
                                    </div>
                                ))}
                                {results.length === 0 && !loading && (
                                    <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                                        <Search className="mb-4 h-12 w-12 opacity-20" />
                                        <p>Arama yaparak başlayın</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>

                {/* Preview / Detailed Fetch */}
                <Card className="flex h-[460px] flex-col lg:h-[600px]">
                    <CardHeader>
                        <CardTitle>Önizleme ve Detaylar</CardTitle>
                        <CardDescription>
                            Seçili manganın detaylarını inceleyin ve onaylayın.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden">
                        {fetchingDetails ? (
                            <div className="flex h-full flex-col items-center justify-center space-y-4">
                                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                                <p className="text-muted-foreground italic">Manga detayları çekiliyor...</p>
                            </div>
                        ) : fetchedData ? (
                            <ScrollArea className="h-full">
                                <div className="space-y-6 pb-4">
                                    <div className="flex flex-col gap-4 sm:flex-row">
                                        <div className="w-32 shrink-0 overflow-hidden rounded-lg border border-border">
                                            <img src={fetchedData.cover} alt="Cover" className="w-full object-cover" />
                                        </div>
                                        <div className="space-y-2">
                                            <h2 className="text-xl font-bold">{fetchedData.title}</h2>
                                            <p className="text-sm text-muted-foreground">Yazar: {fetchedData.author || 'Belirtilmedi'}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {adultFormatLabel && adultFormatLabel !== getMediaTypeLabel(fetchedData.type) ? (
                                                    <Badge variant="outline" className="border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20">
                                                        {adultFormatLabel}
                                                    </Badge>
                                                ) : null}
                                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors">
                                                    {getMediaTypeLabel(fetchedData.type)}
                                                </Badge>
                                                <Badge variant="outline" className="bg-secondary text-muted-foreground border-border hover:bg-secondary/80 transition-colors">
                                                    {getScrapedStatusLabel(fetchedData.status)}
                                                </Badge>
                                                {fetchedData.isAdult ? (
                                                    <Badge variant="outline" className="border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20">
                                                        18+ İçerik
                                                    </Badge>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>

                                    {fetchedData.alternativeTitles && fetchedData.alternativeTitles.length > 0 && (
                                        <div className="space-y-1">
                                            <h4 className="text-xs font-semibold text-muted-foreground">Alternatif İsimler</h4>
                                            <p className="text-xs text-muted-foreground">{fetchedData.alternativeTitles.join(' • ')}</p>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <h4 className="text-sm font-semibold">Türler</h4>
                                        <div className="flex flex-wrap gap-1">
                                            {fetchedData.genres?.map((g, i) => (
                                                <Badge key={i} variant="secondary" className="hover:bg-secondary/70 transition-colors">{g}</Badge>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <h4 className="text-sm font-semibold">Açıklama</h4>
                                        <p className="text-sm text-muted-foreground line-clamp-4">{fetchedData.description || 'Açıklama yok'}</p>
                                    </div>

                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center justify-between border-b pb-1">
                                            <div className="flex items-center gap-4">
                                                <span className="font-semibold text-muted-foreground">
                                                    Bölüm Sayısı: <span className="text-foreground">{fetchedData._rawChapters.length}</span>
                                                </span>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 px-3 text-[10px] uppercase font-black tracking-wider transition-all"
                                                    onClick={() => {
                                                        const allChapters = fetchedData._rawChapters;
                                                        if (selectedChapterIndices.length === allChapters.length) {
                                                            setSelectedChapterIndices([]);
                                                        } else {
                                                            setSelectedChapterIndices(allChapters.map((_, i) => i));
                                                        }
                                                    }}
                                                >
                                                    {selectedChapterIndices.length === fetchedData._rawChapters.length ? 'Hiçbirini Seçme' : 'Tümünü Seç'}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="max-h-32 overflow-y-auto space-y-1 mt-2 pr-2">
                                            {fetchedData._rawChapters.slice().reverse().map((ch, revIdx, arr) => {
                                                const originalIdx = arr.length - 1 - revIdx;
                                                const isSelected = selectedChapterIndices.includes(originalIdx);
                                                return (
                                                    <div
                                                        key={originalIdx}
                                                        onClick={() => {
                                                            setSelectedChapterIndices((prev) =>
                                                                prev.includes(originalIdx)
                                                                    ? prev.filter((id) => id !== originalIdx)
                                                                    : [...prev, originalIdx]
                                                            );
                                                        }}
                                                        className={`flex justify-between text-xs py-1 px-2 rounded cursor-pointer transition-colors ${isSelected
                                                            ? 'bg-green-500/20 hover:bg-green-500/30 text-green-500'
                                                            : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                                                            }`}
                                                    >
                                                        <span className="truncate">{ch.name}</span>
                                                        <span className="opacity-70">#{ch.number}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </ScrollArea>
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center space-y-4 text-center text-muted-foreground opacity-50">
                                <Download className="h-16 w-16" />
                                <p>Soldan bir manga seçerek <br /> detaylarını getirin.</p>
                            </div>
                        )}
                    </CardContent>
                    {fetchedData && (
                        <CardFooter className="border-t bg-muted/30 p-4">
                            <Button className="w-full" onClick={handleImportManga} disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                Onayla ve İçe Aktar ({selectedChapterIndices.length} Bölüm)
                            </Button>
                        </CardFooter>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default AdminScraper;
