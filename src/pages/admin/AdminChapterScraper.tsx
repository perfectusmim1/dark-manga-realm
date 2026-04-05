import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    Download,
    RefreshCw,
    Loader2,
    Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    extractScrapedChapterLinks,
    getAvailableScrapeSources,
    getScrapeSourceLabel,
    isDirectScrapeLink,
    normalizeScrapeUrl,
    readPreferredScrapeSource,
    type ScrapeSource,
    writePreferredScrapeSource,
} from '@/lib/scraper/scrapeSources';
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
        toast.success(`Kaynak site: ${getScrapeSourceLabel(nextSource)}`);
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

    const handleLocalMangaChange = async (mangaId: string) => {
        setSelectedLocalMangaId(mangaId);
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

        if (rawQuery.startsWith('http') && isDirectScrapeLink(sourceToUse, rawQuery)) {
            if (detectedSource && detectedSource !== scrapeSource) {
                handleScrapeSourceChange(detectedSource);
            }

            toast.info('Direkt link algılandı, bölümler kontrol ediliyor...');
            fetchSourceChapters({
                title: 'Linkten Çekilen Manga',
                link: normalizeScrapeUrl(sourceToUse, rawQuery),
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
            toast.error('Arama başarısız oldu');
        } finally {
            setLoadingSource(false);
        }
    };

    const fetchSourceChapters = async (card: ScrapedMangaCard, source: ScrapeSource = card.source) => {
        setSelectedSourceManga({ ...card, source });
        setFetchingDetails(true);
        setSourceChapters([]);
        setNewChapters([]);

        try {
            const html = await fetchScraperContent(card.link, { provider: scraperProvider, source });
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const parsedChapters = extractScrapedChapterLinks(doc, source).map((chapter) => ({
                ...chapter,
                source,
            }));
            setSourceChapters(parsedChapters);

            // Compare with local chapters
            if (localMangaDetails) {
                const localChapterByNumber = new Map(
                    localMangaDetails.chapters.map((chapter) => [Number(chapter.number), chapter]),
                );
                const diff = parsedChapters.flatMap<ChapterImportCandidate>((scrapedChapter) => {
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
                setSelectedChapterIndices(diff.map((_, i) => i));

                if (diff.length === 0) {
                    toast.info('Bu manga zaten güncel.');
                } else {
                    toast.success(`${diff.length} yeni veya güncellenecek bölüm bulundu!`);
                }
            }
        } catch (err) {
            toast.error('Bölümler çekilemedi');
        } finally {
            setFetchingDetails(false);
        }
    };

    const handleImportNewChapters = async () => {
        if (!localMangaDetails || newChapters.length === 0) return;

        const chaptersToImport = newChapters.filter((_, i) => selectedChapterIndices.includes(i));
        if (chaptersToImport.length === 0) {
            toast.error('Lütfen en az bir bölüm seçin');
            return;
        }

        setImporting(true);

        try {
            const importedChapters: Chapter[] = [...localMangaDetails.chapters];
            const importedThisRun: Chapter[] = [];

            for (let i = 0; i < chaptersToImport.length; i++) {
                const sc = chaptersToImport[i];
                try {
                    // Small delay to prevent proxy ban
                    if (i > 0) await new Promise(resolve => setTimeout(resolve, 800));

                    const chHtml = await fetchScraperContent(sc.link, { provider: scraperProvider, source: sc.source });
                    const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');
                    const images = extractChapterImageUrls(chDoc, sc.source);
                    const existingChapterIndex = importedChapters.findIndex((chapter) => (
                        chapter.id === sc.existingChapterId
                        || Number(chapter.number) === Number(sc.number)
                    ));
                    const existingChapter = existingChapterIndex >= 0 ? importedChapters[existingChapterIndex] : null;

                    if (images.length === 0) {
                        toast.error(`Bölüm ${sc.number} için görsel bulunamadı, atlanıyor.`);
                        continue;
                    }

                    const importedChapter: Chapter = {
                        id: existingChapter?.id || `chapter-${Date.now()}-${sc.number}`,
                        number: sc.number,
                        title: sc.name,
                        pages: images,
                        releaseDate: existingChapter?.releaseDate || new Date().toISOString(),
                        views: existingChapter?.views || 0,
                    };

                    if (existingChapterIndex >= 0) {
                        importedChapters[existingChapterIndex] = importedChapter;
                    } else {
                        importedChapters.push(importedChapter);
                        importedThisRun.push(importedChapter);
                    }

                    toast.info(`Bölüm ${sc.number} ${sc.changeType === 'updated' ? 'güncellendi' : 'yüklendi'}... (${i + 1}/${chaptersToImport.length})`);
                } catch (e) {
                    toast.error(`Bölüm ${sc.number} hata verdi, atlanıyor.`);
                }
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

            const updatedCount = chaptersToImport.filter((chapter) => chapter.changeType === 'updated').length;
            toast.success(`${importedThisRun.length} yeni bölüm eklendi, ${updatedCount} bölüm güncellendi!`);
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
                        <Select onValueChange={handleLocalMangaChange} value={selectedLocalMangaId}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Manga seçin..." />
                            </SelectTrigger>
                            <SelectContent>
                                {localMangas.map(m => (
                                    <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {localMangaDetails && (
                            <div className="flex items-center gap-3 rounded-lg border border-border p-3 bg-card">
                                <img src={localMangaDetails.cover} className="h-16 w-12 rounded object-cover" />
                                <div>
                                    <p className="font-bold">{localMangaDetails.title}</p>
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
                            <Button type="submit" disabled={loadingSource}>
                                {loadingSource ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            </Button>
                        </form>

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
                                            <span className="text-sm font-medium">{m.title}</span>
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
                                disabled={newChapters.length === 0 || importing}
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
