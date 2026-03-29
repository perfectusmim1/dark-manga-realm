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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ensureArtistByName, ensureAuthorByName, linkMangaToArtist, linkMangaToAuthor, saveManga } from '@/lib/database';
import { Manga, Chapter } from '@/lib/types';
import { normalizeGenres } from '@/lib/mockData';
import {
    fetchScraperContent,
    getAvailableScraperProviders,
    getScraperProviderLabel,
    readPreferredScraperProvider,
    type ScraperProvider,
    writePreferredScraperProvider,
} from '@/lib/scraperProxy';
import {
    buildScrapeSearchUrl,
    detectScrapeSourceFromUrl,
    extractChapterImageUrls,
    extractScrapedMangaCards,
    extractScrapedMangaDetail,
    getScrapedStatusLabel,
    getAvailableScrapeSources,
    getScrapeSourceLabel,
    isDirectScrapeLink,
    normalizeScrapeUrl,
    readPreferredScrapeSource,
    type ScrapeSource,
    writePreferredScrapeSource,
} from '@/lib/scraper/scrapeSources';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useAuth } from '@/contexts/AuthContext';

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
    normalizeScrapedText(value).split(/[,，]/)[0]?.trim() || '';

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

const AdminScraper: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { access, isLoading: accessLoading } = useAdminAccess();
    const canUseScraper = access.canAccessAdminPanel && access.role === 'admin';
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

    useEffect(() => {
        if (accessLoading || !user) {
            return;
        }

        if (!canUseScraper) {
            toast.error('Bu sayfa yalnızca admin hesabına açıktır');
            navigate('/admin', { replace: true });
        }
    }, [accessLoading, canUseScraper, navigate, user]);

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

    if (accessLoading || !user || !canUseScraper) {
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
                link: normalizeScrapeUrl(sourceToUse, rawQuery),
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
            toast.error('Veri çekilirken bir hata oluştu');
        } finally {
            setLoading(false);
        }
    };

    const fetchMangaDetails = async (card: ScrapedMangaCard, source: ScrapeSource = card.source) => {
        setFetchingDetails(true);
        setSelectedManga({ ...card, source });
        setFetchedData(null);

        try {
            const html = await fetchScraperContent(card.link, { provider: scraperProvider, source });

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const extractedManga = extractScrapedMangaDetail(doc, source, card);
            const scrapedManga: ScrapedMangaDraft = {
                ...extractedManga,
                source,
                _rawChapters: extractedManga._rawChapters.map((chapter) => ({
                    ...chapter,
                    source,
                })),
            };

            setSelectedChapterIndices(scrapedManga._rawChapters.map((_, i) => i));
            setFetchedData(scrapedManga);
            toast.success('Manga detayları çekildi');
        } catch (err) {
            console.error(err);
            toast.error('Detaylar çekilirken bir hata oluştu');
        } finally {
            setFetchingDetails(false);
        }
    };

    const handleImportManga = async () => {
        if (!fetchedData) return;
        setLoading(true);

        try {
            const rawChapters = fetchedData._rawChapters;
            const selectedChaptersToImport = rawChapters.filter((_, i) => selectedChapterIndices.includes(i));
            const activeScrapeSource = fetchedData.source;

            if (selectedChaptersToImport.length === 0) {
                toast.error('Lütfen en az bir bölüm seçin');
                setLoading(false);
                return;
            }

            const mangaId = `manga-${Date.now()}`;

            // For chapters, we need to visit EACH chapter link to get image URLs.
            // This can be heavy, so we'll do it sequentially or in chunks.
            const chapters: Chapter[] = [];

            toast.info(`${selectedChaptersToImport.length} bölüm için görsel linkleri çekiliyor...`);

            // Max 10 chapters for initial import to avoid rate limit/timeout? 
            // Or just do all but warn user.
            for (let i = 0; i < selectedChaptersToImport.length; i++) {
                const rc = selectedChaptersToImport[i];
                try {
                    // Increased delay to be safer
                    if (i > 0) await new Promise(resolve => setTimeout(resolve, 800));

                    const chHtml = await fetchScraperContent(rc.link, { provider: scraperProvider, source: rc.source || activeScrapeSource });
                    const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');
                    const images = extractChapterImageUrls(chDoc, rc.source || activeScrapeSource);

                    if (images.length === 0) {
                        console.warn(`Bölüm ${rc.number} için görsel bulunamadı.`);
                        toast.error(`Bölüm ${rc.number} için görsel bulunamadı, boş geçiliyor.`);
                    }

                    chapters.push({
                        id: `chapter-${Date.now()}-${i}`,
                        number: rc.number,
                        title: rc.name,
                        pages: images,
                        releaseDate: new Date().toISOString(),
                        views: 0,
                    });

                    if ((i + 1) % 5 === 0 || i === selectedChaptersToImport.length - 1) {
                        toast.info(`${i + 1} / ${selectedChaptersToImport.length} bölüm tamamlandı...`);
                    }
                } catch (e) {
                    console.error(`Bölüm ${rc.number} çekilemedi:`, e);
                    toast.error(`Bölüm ${rc.number} atlandı (Hata: ${e instanceof Error ? e.message : 'Proxy hatası'})`);
                }
            }

            const normalizedAuthorName = normalizeScrapedText(fetchedData.author);
            const normalizedArtistName = normalizeScrapedText(fetchedData.artist);

            const [authorEntity, artistEntity] = await Promise.all([
                normalizedAuthorName ? ensureAuthorByName(normalizedAuthorName) : Promise.resolve(null),
                normalizedArtistName ? ensureArtistByName(normalizedArtistName) : Promise.resolve(null),
            ]);

            const finalManga: Manga = {
                id: mangaId,
                title: fetchedData.title!,
                alternativeTitles: fetchedData.alternativeTitles || [],
                description: fetchedData.description!,
                cover: fetchedData.cover!,
                banner: fetchedData.banner || fetchedData.cover!,
                author: authorEntity?.name || normalizedAuthorName || '',
                artist: artistEntity?.name || normalizedArtistName || undefined,
                status: fetchedData.status!,
                type: fetchedData.type!,
                genres: fetchedData.genres!,
                releaseYear: fetchedData.releaseYear,
                chapters: chapters,
                views: 0,
                ratings: [],
                averageRating: 0,
                reviewCount: 0,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
            };

            await saveManga(finalManga);

            if (authorEntity) {
                await linkMangaToAuthor(mangaId, authorEntity.id);
            }

            if (artistEntity) {
                await linkMangaToArtist(mangaId, artistEntity.id);
            }

            toast.success('Manga başarıyla eklendi');
            navigate('/admin/mangas');
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
                                            <p className="text-sm text-muted-foreground">Yazar: {fetchedData.author}</p>
                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors uppercase">{fetchedData.type}</Badge>
                                                <Badge variant="outline" className="bg-secondary text-muted-foreground border-border hover:bg-secondary/80 transition-colors">{getScrapedStatusLabel(fetchedData.status)}</Badge>
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
                            <Button className="w-full" onClick={handleImportManga} disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                Onayla ve İçe Aktar
                            </Button>
                        </CardFooter>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default AdminScraper;
