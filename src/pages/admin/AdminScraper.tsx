import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    Download,
    ArrowRight,
    Loader2,
    Globe,
    ExternalLink,
    Plus,
    Copy,
    Clipboard,
    Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ensureArtistByName, ensureAuthorByName, linkMangaToArtist, linkMangaToAuthor, saveManga } from '@/lib/database';
import { Manga, Chapter } from '@/lib/types';
import { normalizeGenres } from '@/lib/mockData';
import { getAdultContentFormatLabel } from '@/lib/adultContentFormat';
import { getMangaTypeLabel } from '@/lib/mangaType';
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
    extractScrapedChapterLinks,
    extractScrapedChapterPaginationUrls,
    extractScrapedMangaCards,
    extractScrapedMangaDetail,
    extractSiyahMelekChapterLinksFromHtml,
    extractSiyahMelekChapterPaginationUrlsFromHtml,
    getScrapedStatusLabel,
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
import {
    readSiyahMelekSkipPromoFirstPage,
    writeSiyahMelekSkipPromoFirstPage,
} from '@/lib/scraper/siyahmelekSettings';
import {
    buildSiyahMelekBrowserChapterImageCaptureScript,
    buildSiyahMelekBrowserCaptureScript,
    buildSiyahMelekDraftFromBrowserCapture,
    mergeSiyahMelekBrowserCapturedChapterResults,
    parseSiyahMelekBrowserCapture,
} from '@/lib/scraper/siyahmelekBrowserCapture';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';

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

interface ScrapedMangaDraft extends Partial<Manga> {
    _rawChapters: ScrapedChapter[];
    source: ScrapeSource;
}

const normalizeScrapedText = (value?: string | null) =>
    value?.replace(/\s+/g, ' ').trim() || '';

const toScrapedKey = (value?: string | null) =>
    normalizeScrapedText(value).toLocaleLowerCase('tr-TR');

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

const getScrapedSummaryField = (doc: Document, labels: string[]) => {
    const normalizedLabels = labels.map((label) => label.toLocaleLowerCase('tr-TR'));

    const matchedItem = Array.from(doc.querySelectorAll('.post-content_item')).find((element) => {
        const text = element.textContent?.toLocaleLowerCase('tr-TR') || '';
        return normalizedLabels.some((label) => text.includes(label));
    });

    return normalizeScrapedText(
        matchedItem?.querySelector('.summary-content, .author-content a, .artist-content a')?.textContent ||
        matchedItem?.querySelector('.summary-content')?.textContent
    );
};

const inferScrapedMangaType = (doc: Document, genres: string[], fallbackGenres: string[]) => {
    const typeSource = [
        getScrapedSummaryField(doc, ['tip', 'type']),
        getScrapedSummaryField(doc, ['alternatif']),
        getScrapedSummaryField(doc, ['kategori', 'categories']),
        genres.join(', '),
        fallbackGenres.join(', '),
    ].join(' ');

    const normalizedSource = typeSource.toLocaleLowerCase('tr-TR');

    if (normalizedSource.includes('manhwa')) {
        return 'manhwa' as const;
    }

    if (normalizedSource.includes('manhua')) {
        return 'manhua' as const;
    }

    if (normalizedSource.includes('webtoon')) {
        return 'webtoon' as const;
    }

    return 'manga' as const;
};

const BLOCKED_ALT_TITLE_PATTERNS = ['güncellenecek', 'guncellenecek'];

const sanitizeAlternativeTitles = (rawText: string, mainTitle?: string) => {
    const mainKey = toScrapedKey(mainTitle);

    return Array.from(
        new Set(
            rawText
                .split(/[,\n]/)
                .map((title) => normalizeScrapedText(title))
                .filter((title) => {
                    const key = toScrapedKey(title);
                    return (
                        key.length > 0 &&
                        key !== mainKey &&
                        !BLOCKED_ALT_TITLE_PATTERNS.some((pattern) => key.includes(pattern))
                    );
                })
        )
    );
};

const getMediaTypeLabel = (type?: Manga['type']) => {
    return getMangaTypeLabel(type);
};

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
    const [skipSiyahMelekPromoFirstPage, setSkipSiyahMelekPromoFirstPage] = useState(() => readSiyahMelekSkipPromoFirstPage());
    const [browserCaptureInput, setBrowserCaptureInput] = useState('');
    const adultFormatLabel = fetchedData ? getAdultContentFormatLabel({
        isAdult: fetchedData.isAdult,
        type: fetchedData.type,
        genres: fetchedData.genres,
    }) : null;
    const [processingBrowserCapture, setProcessingBrowserCapture] = useState(false);
    const browserCaptureFileInputRef = useRef<HTMLInputElement | null>(null);

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
        setResults([]);
        setSelectedManga(null);
        setFetchedData(null);
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

    const fetchMangaDetails = async (card: ScrapedMangaCard, source: ScrapeSource = card.source) => {
        const normalizedSeriesLink = normalizeScrapeSeriesUrl(source, card.link);
        setFetchingDetails(true);
        setSelectedManga({ ...card, link: normalizedSeriesLink, source });
        setFetchedData(null);

        try {
            const html = await fetchScraperContent(normalizedSeriesLink, { provider: scraperProvider, source });

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const extractedManga = extractScrapedMangaDetail(doc, source, { ...card, link: normalizedSeriesLink });
            let mergedChapters = source === 'siyahmelek'
                ? extractSiyahMelekChapterLinksFromHtml(html, normalizedSeriesLink, extractedManga.title || card.title)
                : extractedManga._rawChapters;

            if (mergedChapters.length === 0) {
                mergedChapters = extractedManga._rawChapters;
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
                        mergedChapters.map((chapter) => [normalizeScrapeUrl(source, chapter.link), chapter]),
                    );
                    let consecutivePagesWithoutNewChapters = 0;

                    for (const pageUrl of paginationUrls) {
                        try {
                            const pageHtml = await fetchScraperContent(pageUrl, { provider: scraperProvider, source });
                            const pageDoc = parser.parseFromString(pageHtml, 'text/html');
                            const pageChapters = extractSiyahMelekChapterLinksFromHtml(
                                pageHtml,
                                normalizedSeriesLink,
                                extractedManga.title || card.title,
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
                        } catch (pageError) {
                            consecutivePagesWithoutNewChapters += 1;
                            console.warn('SiyahMelek chapter page fetch failed', { pageUrl, pageError });
                        }

                        if (consecutivePagesWithoutNewChapters >= 2) {
                            break;
                        }
                    }

                    mergedChapters = Array.from(chapterMap.values()).sort((left, right) => left.number - right.number);
                }
            }

            const scrapedManga: ScrapedMangaDraft = {
                ...extractedManga,
                isAdult: extractedManga.isAdult || isAdultOnlyScrapeSource(source),
                source,
                _rawChapters: mergedChapters.map((chapter) => ({
                    ...chapter,
                    source,
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

    const handleCopySiyahMelekBrowserScript = async () => {
        try {
            await navigator.clipboard.writeText(buildSiyahMelekBrowserCaptureScript());
            toast.success('SiyahMelek seri scripti panoya kopyalandı');
        } catch {
            toast.error('Script panoya kopyalanamadı');
        }
    };

    const handleCopySelectedChapterCaptureScript = async () => {
        if (!fetchedData || fetchedData.source !== 'siyahmelek') {
            toast.error('Önce SiyahMelek serisini çözümleyin');
            return;
        }

        const selectedChapters = fetchedData._rawChapters.filter((_, index) => selectedChapterIndices.includes(index));
        if (selectedChapters.length === 0) {
            toast.error('Önce en az bir bölüm seçin');
            return;
        }

        if (selectedChapters.length > 15) {
            toast.info('SiyahMelek için 10-15 bölüm halinde yakalama daha stabil çalışır.');
        }

        try {
            await navigator.clipboard.writeText(
                buildSiyahMelekBrowserChapterImageCaptureScript(selectedChapters),
            );
            toast.success(`Seçili ${selectedChapters.length} bölüm için görsel scripti panoya kopyalandı`);
        } catch {
            toast.error('Seçili bölüm scripti panoya kopyalanamadı');
        }
    };

    const handlePasteBrowserCapture = async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            if (!clipboardText.trim()) {
                toast.error('Panoda yapıştırılacak veri bulunamadı');
                return;
            }

            setBrowserCaptureInput(clipboardText);
            toast.success('Tarayıcı yakalama verisi alındı');
        } catch {
            toast.error('Pano erişimi başarısız oldu');
        }
    };

    const applyBrowserCaptureValue = async (rawValue: string) => {
        setProcessingBrowserCapture(true);

        try {
            const parsedPayload = parseSiyahMelekBrowserCapture(rawValue);
            if (!parsedPayload) {
                throw new Error('Aktarılan veri geçerli bir SiyahMelek capture çıktısı değil');
            }

            if ('mode' in parsedPayload && parsedPayload.mode === 'chapter_images') {
                if (!fetchedData || fetchedData.source !== 'siyahmelek') {
                    throw new Error('Önce seri metadata verisini çözümleyin');
                }

                const mergedChapters = mergeSiyahMelekBrowserCapturedChapterResults(
                    fetchedData._rawChapters,
                    parsedPayload.chapters,
                    fetchedData.title,
                );

                const mergedCount = mergedChapters.filter((chapter) => chapter.prefetchedImageResult).length;
                setFetchedData({
                    ...fetchedData,
                    _rawChapters: mergedChapters,
                });
                setBrowserCaptureInput(rawValue);
                toast.success(`Tarayıcıdan ${mergedCount} bölüm için görsel sonucu işlendi`);
                return;
            }

            const draft = buildSiyahMelekDraftFromBrowserCapture(parsedPayload);
            const sourcedDraft: ScrapedMangaDraft = {
                ...draft,
                source: 'siyahmelek',
                _rawChapters: draft._rawChapters.map((chapter) => ({
                    ...chapter,
                    source: 'siyahmelek' as const,
                })),
            };
            const draftCard: ScrapedMangaCard = {
                title: sourcedDraft.title || 'SiyahMelek serisi',
                link: normalizeScrapeSeriesUrl('siyahmelek', parsedPayload.mangaUrl),
                cover: sourcedDraft.cover || '',
                genres: sourcedDraft.genres || [],
                source: 'siyahmelek',
            };

            writePreferredScrapeSource('siyahmelek');
            setScrapeSource('siyahmelek');
            const nextProvider = getDefaultScraperProviderForSource('siyahmelek');
            writePreferredScraperProvider(nextProvider);
            setScraperProvider(nextProvider);
            setSearchQuery(draftCard.link);
            setResults([draftCard]);
            setSelectedManga(draftCard);
            setFetchedData(sourcedDraft);
            setSelectedChapterIndices(sourcedDraft._rawChapters.map((_, index) => index));
            setBrowserCaptureInput(rawValue);

            toast.success(`Tarayıcı oturumundan ${sourcedDraft._rawChapters.length} bölüm çözümlendi`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Tarayıcı yakalama verisi işlenemedi');
        } finally {
            setProcessingBrowserCapture(false);
        }
    };

    const handleApplyBrowserCapture = async () => {
        await applyBrowserCaptureValue(browserCaptureInput);
    };

    const handleBrowserCaptureFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        try {
            const text = await file.text();
            if (!text.trim()) {
                toast.error('Seçilen capture dosyası boş');
                return;
            }

            setBrowserCaptureInput(text);
            await applyBrowserCaptureValue(text);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Capture dosyası okunamadı');
        }
    };

    const handleImportManga = async () => {
        if (!fetchedData) return;
        setLoading(true);

        try {
            const rawChapters = fetchedData._rawChapters;
            const selectedChaptersToImport = rawChapters.filter((_, i) => selectedChapterIndices.includes(i));
            const activeScrapeSource = fetchedData.source;
            const isAdultImport = fetchedData.isAdult === true || isAdultOnlyScrapeSource(activeScrapeSource);

            if (selectedChaptersToImport.length === 0) {
                toast.error('Lütfen en az bir bölüm seçin');
                setLoading(false);
                return;
            }

            if (activeScrapeSource === 'siyahmelek') {
                const chaptersMissingImageCapture = selectedChaptersToImport.filter((chapter) => !chapter.prefetchedImageResult);
                if (scraperProvider !== 'localhost' && chaptersMissingImageCapture.length > 0) {
                    toast.error(`Seçili ${chaptersMissingImageCapture.length} bölüm için görsel yakalama eksik. Önce seçili bölüm scriptini çalıştırın.`);
                    setLoading(false);
                    return;
                }
            }

            const mangaId = `manga-${Date.now()}`;

            // For chapters, we need to visit EACH chapter link to get image URLs.
            // This can be heavy, so we'll do it sequentially or in chunks.
            const chapters: Chapter[] = [];
            let lockedChapterCount = 0;
            let failedChapterCount = 0;

            toast.info(`${selectedChaptersToImport.length} bölüm için görsel linkleri çekiliyor...`);

            // Max 10 chapters for initial import to avoid rate limit/timeout? 
            // Or just do all but warn user.
            for (let i = 0; i < selectedChaptersToImport.length; i++) {
                const rc = selectedChaptersToImport[i];
                try {
                    let imageResult = rc.prefetchedImageResult
                        ? applyChapterImageResultOptions(
                            rc.prefetchedImageResult,
                            rc.source || activeScrapeSource,
                            { excludeSiyahMelekPromoFirstPage: skipSiyahMelekPromoFirstPage },
                        )
                        : undefined;

                    if (!imageResult) {
                        if (i > 0) await new Promise(resolve => setTimeout(resolve, 800));

                        const chHtml = await fetchScraperContent(rc.link, { provider: scraperProvider, source: rc.source || activeScrapeSource });
                        const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');
                        imageResult = extractChapterImageResult(
                            chDoc,
                            rc.source || activeScrapeSource,
                            { excludeSiyahMelekPromoFirstPage: skipSiyahMelekPromoFirstPage },
                        );
                    }

                    if (imageResult.status === 'locked') {
                        lockedChapterCount += 1;
                        toast.info(`Bölüm ${rc.number} VIP/kilitli olduğu için atlandı.`);
                        continue;
                    }

                    if (imageResult.status === 'error') {
                        failedChapterCount += 1;
                        console.warn('Chapter image missing during admin import', {
                            chapterNumber: rc.number,
                            reason: imageResult.reason,
                        });
                        toast.error(`Bölüm ${rc.number} için görsel bulunamadı, atlandı.`);
                        continue;
                    }

                    chapters.push({
                        id: `chapter-${Date.now()}-${i}`,
                        number: rc.number,
                        title: rc.name,
                        pages: imageResult.images,
                        releaseDate: new Date().toISOString(),
                        views: 0,
                    });

                    if ((i + 1) % 5 === 0 || i === selectedChaptersToImport.length - 1) {
                        toast.info(`${i + 1} / ${selectedChaptersToImport.length} bölüm tamamlandı...`);
                    }
                } catch (e) {
                    failedChapterCount += 1;
                    console.error('Chapter fetch failed during admin import', { chapterNumber: rc.number, error: e });
                    toast.error(`Bölüm ${rc.number} atlandı (Hata: ${e instanceof Error ? e.message : 'Proxy hatası'})`);
                }
            }

            if (chapters.length === 0) {
                const summaryMessage = lockedChapterCount > 0 && failedChapterCount === 0
                    ? 'Seçilen bölümlerin tamamı VIP/kilitli durumda, seri boş olarak eklenmedi.'
                    : 'İçe aktarılabilecek açık bölüm bulunamadı, seri kaydedilmedi.';
                toast.error(summaryMessage);
                setLoading(false);
                return;
            }

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

            const finalManga: Manga = {
                id: mangaId,
                title: fetchedData.title!,
                alternativeTitles: fetchedData.alternativeTitles || [],
                description: fetchedData.description!,
                cover: fetchedData.cover!,
                banner: fetchedData.banner || fetchedData.cover!,
                author: normalizedAuthorLabel || '',
                artist: normalizedArtistLabel || undefined,
                status: fetchedData.status!,
                type: fetchedData.type!,
                genres: fetchedData.genres!,
                releaseYear: fetchedData.releaseYear,
                chapters: chapters,
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

            if (lockedChapterCount > 0 || failedChapterCount > 0) {
                toast.success(`Manga eklendi. Açık bölüm: ${chapters.length}, kilitli atlanan: ${lockedChapterCount}, hatalı atlanan: ${failedChapterCount}`);
            } else {
                toast.success('Manga başarıyla eklendi');
            }
            navigate(isAdultImport ? '/admin/adult-mangas' : '/admin/mangas');
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
                    <p className="text-muted-foreground">Dış sitelerden manga ve webtoon verilerini otomatik olarak çekin.</p>
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

            <Card>
                <CardHeader>
                    <CardTitle>Manga Ara veya Link Yapıştır</CardTitle>
                    <CardDescription>
                        {getScrapeSourceLabel(scrapeSource)} üzerinden manga araması yapın veya direkt seri sayfasının linkini yapıştırın.
                    </CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
            </Card>

            {scrapeSource === 'siyahmelek' && scraperProvider === 'localhost' ? (
                <Card className="border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-emerald-100">
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Localhost Modu</Badge>
                            SiyahMelek Yerel Scraper
                        </CardTitle>
                        <CardDescription className="text-emerald-100/80">
                            En basit ve stabil yol bu. Cookie ve user-agent kendi bilgisayarında kalır, panel sadece sonucu alır.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-emerald-50/90">
                        <div className="rounded-xl border border-emerald-500/20 bg-black/20 p-4">
                            <p>1. <span className="font-mono">local-scraper.config.example.json</span> dosyasını <span className="font-mono">local-scraper.config.json</span> olarak kopyala.</p>
                            <p>2. İçine kendi site origin’ini, `cf_clearance` ve `wordpress_logged_in` cookie’lerini koy.</p>
                            <p>3. Terminalde `npm run scraper:local` çalıştır.</p>
                            <p>4. Sonra yukarıdan SiyahMelek linkini direkt yapıştır ve `Linki Çek` de.</p>
                        </div>
                        <p className="text-xs text-emerald-100/70">
                            Tarayıcı scriptleri hala yedek yöntem olarak duruyor, ama localhost çalışıyorsa onlara gerek yok.
                        </p>
                    </CardContent>
                </Card>
            ) : null}

            {scrapeSource === 'siyahmelek' && scraperProvider !== 'localhost' ? (
                <Card className="border-rose-500/20 bg-[radial-gradient(circle_at_top_left,rgba(244,63,94,0.14),transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-rose-100">
                            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-300">Yedek Yöntem</Badge>
                            Tarayıcı Yakalama
                        </CardTitle>
                        <CardDescription className="text-rose-100/80">
                            Localhost scraper kullanmıyorsan, SiyahMelek verisini tarayıcı oturumundan elle yakala.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
                            <div className="space-y-3">
                                <div className="rounded-xl border border-rose-500/20 bg-black/20 p-4 text-sm text-rose-50/90">
                                    <p className="font-semibold text-rose-100">Kullanım</p>
                                    <p className="mt-2">1. Önce seri scriptini çalıştır, temiz metadata ve bölüm listesi gelsin.</p>
                                    <p>2. ToonParrot içinde import edeceğin bölümleri seç.</p>
                                    <p>3. Sonra seçili bölüm scriptini çalıştır, sadece o bölümlerin görselleri gelsin.</p>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <Button type="button" variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20" onClick={handleCopySiyahMelekBrowserScript}>
                                        <Copy className="mr-2 h-4 w-4" />
                                        Seri Scripti Kopyala
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                                        onClick={handleCopySelectedChapterCaptureScript}
                                        disabled={!fetchedData || fetchedData.source !== 'siyahmelek' || selectedChapterIndices.length === 0}
                                    >
                                        <Copy className="mr-2 h-4 w-4" />
                                        Seçili Bölüm Scripti
                                    </Button>
                                    <Button type="button" variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20" onClick={handlePasteBrowserCapture}>
                                        <Clipboard className="mr-2 h-4 w-4" />
                                        Panodan Al
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                                        onClick={() => browserCaptureFileInputRef.current?.click()}
                                    >
                                        <Upload className="mr-2 h-4 w-4" />
                                        Capture Dosyası
                                    </Button>
                                    <input
                                        ref={browserCaptureFileInputRef}
                                        type="file"
                                        accept=".json,application/json"
                                        className="hidden"
                                        onChange={handleBrowserCaptureFileChange}
                                    />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Textarea
                                    value={browserCaptureInput}
                                    onChange={(event) => setBrowserCaptureInput(event.target.value)}
                                    placeholder="SiyahMelek seri metadata veya seçili bölüm görsel JSON verisini buraya yapıştırın"
                                    className="min-h-[180px] border-rose-500/20 bg-black/20 text-rose-50 placeholder:text-rose-100/35"
                                />
                                <Button
                                    type="button"
                                    className="w-full bg-rose-600 text-white hover:bg-rose-500"
                                    disabled={processingBrowserCapture || !browserCaptureInput.trim()}
                                    onClick={handleApplyBrowserCapture}
                                >
                                    {processingBrowserCapture ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                    Yakalanan Veriyi Çözümle
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

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
                                                {item.source === 'siyahmelek' ? (
                                                    <Badge variant="outline" className="h-4 border-rose-500/20 bg-rose-500/10 px-1 text-[10px] text-rose-500">
                                                        18+
                                                    </Badge>
                                                ) : null}
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
                                            <p className="text-sm text-muted-foreground">Yazar: {fetchedData.author}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {adultFormatLabel && adultFormatLabel !== getMediaTypeLabel(fetchedData.type) ? (
                                                    <Badge variant="outline" className="border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20">
                                                        {adultFormatLabel}
                                                    </Badge>
                                                ) : null}
                                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors">
                                                    {getMediaTypeLabel(fetchedData.type)}
                                                </Badge>
                                                <Badge variant="outline" className="bg-secondary text-muted-foreground border-border hover:bg-secondary/80 transition-colors">{getScrapedStatusLabel(fetchedData.status)}</Badge>
                                                {fetchedData.isAdult ? (
                                                    <Badge variant="outline" className="border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20">
                                                        18+ İçerik
                                                    </Badge>
                                                ) : null}
                                                {fetchedData.source === 'siyahmelek' && fetchedData._rawChapters.some((chapter) => chapter.prefetchedImageResult) ? (
                                                    <Badge variant="outline" className="border-sky-500/20 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20">
                                                        Tarayıcı Oturumu
                                                    </Badge>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>

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
                                        <p className="text-sm text-muted-foreground line-clamp-4">{fetchedData.description}</p>
                                    </div>

                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center justify-between border-b pb-1">
                                            <div className="flex items-center gap-4">
                                                <span className="font-semibold text-muted-foreground">Bölüm Sayısı: <span className="text-foreground">{fetchedData._rawChapters.length}</span></span>
                                                {fetchedData.source === 'siyahmelek' && scraperProvider !== 'localhost' ? (
                                                    <span className="font-semibold text-muted-foreground">
                                                        Görseli Hazır:
                                                        <span className="text-foreground"> {fetchedData._rawChapters.filter((chapter) => chapter.prefetchedImageResult).length}</span>
                                                    </span>
                                                ) : null}
                                                {fetchedData.source === 'siyahmelek' && scraperProvider === 'localhost' ? (
                                                    <span className="font-semibold text-muted-foreground">
                                                        Görseller:
                                                        <span className="text-foreground"> içe aktarımda otomatik çekilecek</span>
                                                    </span>
                                                ) : null}
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
                                                            setSelectedChapterIndices(prev =>
                                                                prev.includes(originalIdx)
                                                                    ? prev.filter(id => id !== originalIdx)
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
                            <div className="flex w-full flex-col gap-2 sm:flex-row">
                                {fetchedData.source === 'siyahmelek' ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full sm:w-auto"
                                        onClick={handleCopySelectedChapterCaptureScript}
                                        disabled={loading || selectedChapterIndices.length === 0}
                                    >
                                        <Copy className="mr-2 h-4 w-4" />
                                        Seçili Bölüm Scripti
                                    </Button>
                                ) : null}
                                <Button className="w-full" onClick={handleImportManga} disabled={loading}>
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                    Onayla ve İçe Aktar
                                </Button>
                            </div>
                        </CardFooter>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default AdminScraper;
