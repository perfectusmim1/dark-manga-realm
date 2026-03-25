import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    Download,
    ArrowRight,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Globe,
    ExternalLink,
    Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { saveManga } from '@/lib/database';
import { Manga, Chapter } from '@/lib/types';
import { normalizeGenres } from '@/lib/mockData';

interface ScrapedMangaCard {
    title: string;
    link: string;
    cover: string;
    genres: string[];
}

interface ScrapedChapter {
    name: string;
    link: string;
    number: number;
}

const AdminScraper: React.FC = () => {
    const navigate = useNavigate();
    const [sourceUrl, setSourceUrl] = useState('https://hayalistic.net/webtoonlar/');
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<ScrapedMangaCard[]>([]);
    const [selectedManga, setSelectedManga] = useState<ScrapedMangaCard | null>(null);
    const [fetchedData, setFetchedData] = useState<Partial<Manga> | null>(null);
    const [fetchingDetails, setFetchingDetails] = useState(false);
    const [selectedChapterIndices, setSelectedChapterIndices] = useState<number[]>([]);

    const fetchWithProxy = async (targetUrl: string) => {
        // 1. Priority: Supabase Edge Function
        try {
            const response = await fetch('https://gmczrwjjlysiryvwxkgb.supabase.co/functions/v1/proxy-scraper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: targetUrl })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.content) return data.content;
            }
        } catch (e) {
            console.warn('Edge Function failed, switching to backup proxies...', e);
        }

        // 2. Backup: Public Proxies
        const backups = [
            (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
            (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
            (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` // Additional backup
        ];

        let lastError = null;
        for (const proxy of backups) {
            try {
                const response = await fetch(proxy(targetUrl));
                if (response.ok) {
                    const data = await response.json().catch(() => null);
                    // allorigins returns {contents: "..."}
                    if (data && data.contents) return data.contents;
                    // codetabs returns text directly usually, but let's check text first if json fails
                    if (!data) {
                        return await response.text();
                    }
                    return data;
                }
            } catch (err) {
                lastError = err;
            }
        }

        // Final attempt: direct fetch (works if user has a CORS plugin or browser allows)
        try {
            const response = await fetch(targetUrl);
            if (response.ok) return await response.text();
        } catch (e) { }

        throw lastError || new Error('All proxies failed');
    };

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        // Check if searchQuery is a direct link
        if (searchQuery.trim().startsWith('http') && searchQuery.includes('hayalistic.net/manga/')) {
            toast.info('Direkt link algılandı, detaylar getiriliyor...');
            fetchMangaDetails({
                title: 'Linkten Çekilen Manga',
                link: searchQuery.trim(),
                cover: '',
                genres: []
            });
            return;
        }

        setLoading(true);
        setResults([]);
        setSelectedManga(null);
        setFetchedData(null);

        try {
            const url = searchQuery
                ? `https://hayalistic.net/?s=${encodeURIComponent(searchQuery)}&post_type=wp-manga`
                : 'https://hayalistic.net/webtoonlar/';

            const html = await fetchWithProxy(url);

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const cards: ScrapedMangaCard[] = [];

            // Hayalistic uses .page-item-detail.manga for list and .c-tabs-item__content for search
            const cardElements = doc.querySelectorAll('.page-item-detail.manga, .c-tabs-item__content, .manga-item');

            cardElements.forEach((el) => {
                const titleEl = el.querySelector('.post-title a, h3 a');
                const imgEl = el.querySelector('img');
                const genresEl = el.querySelectorAll('.list-genre a, .genres-item a');

                if (titleEl) {
                    cards.push({
                        title: titleEl.textContent?.trim() || '',
                        link: (titleEl as HTMLAnchorElement).href.replace(window.location.origin, 'https://hayalistic.net'),
                        cover: imgEl?.getAttribute('data-src') || imgEl?.src?.replace(window.location.origin, 'https://hayalistic.net') || '',
                        genres: normalizeGenres(Array.from(genresEl).map(g => g.textContent?.trim() || '')),
                    });
                }
            });

            setResults(cards);
            if (cards.length === 0) toast.error('Sonuç bulunamadı');
        } catch (err) {
            console.error(err);
            toast.error('Veri çekilirken bir hata oluştu');
        } finally {
            setLoading(false);
        }
    };

    const fetchMangaDetails = async (card: ScrapedMangaCard) => {
        setFetchingDetails(true);
        setSelectedManga(card);
        setFetchedData(null);

        try {
            const html = await fetchWithProxy(card.link);

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Scrape Title and Cover from Detail Page (important for direct link feature)
            const detailTitle = doc.querySelector('.post-title h1')?.textContent?.trim();
            const detailCoverImg = doc.querySelector('.summary_image img');
            const detailCover = detailCoverImg?.getAttribute('data-src') ||
                detailCoverImg?.getAttribute('data-lazy-src') ||
                detailCoverImg?.getAttribute('src');

            // Description - Target .summary__content as suggested by subagent
            let description = doc.querySelector('.description-summary .summary__content')?.textContent?.trim() ||
                doc.querySelector('.manga-excerpt')?.textContent?.trim() ||
                doc.querySelector('.post-content_item p')?.textContent?.trim() || '';

            // Status
            const statusText = Array.from(doc.querySelectorAll('.post-content_item'))
                .find(el => el.textContent?.includes('Durumu'))
                ?.querySelector('.summary-content')?.textContent?.trim() || 'ongoing';

            const status: Manga['status'] = statusText.toLocaleLowerCase('tr-TR').includes('tamam') || statusText.toLocaleLowerCase('tr-TR').includes('fin') ? 'completed' : 'ongoing';

            // Type
            const typeText = Array.from(doc.querySelectorAll('.post-content_item'))
                .find(el => el.textContent?.includes('Tip') || el.textContent?.includes('Tür'))
                ?.querySelector('.summary-content')?.textContent?.trim() || 'manga';

            const normalizedTypeText = typeText.toLocaleLowerCase('tr-TR');
            const type: Manga['type'] = normalizedTypeText.includes('webtoon') ? 'webtoon'
                : normalizedTypeText.includes('manhwa') ? 'manhwa'
                    : normalizedTypeText.includes('manhua') ? 'manhua'
                        : 'manga';

            // Author
            const author = Array.from(doc.querySelectorAll('.post-content_item'))
                .find(el => el.textContent?.toLocaleLowerCase('tr-TR').includes('yazar'))
                ?.querySelector('.author-content a, .summary-content')?.textContent?.trim() || 'Bilinmiyor';

            // Artist
            const artist = Array.from(doc.querySelectorAll('.post-content_item'))
                .find(el => el.textContent?.toLocaleLowerCase('tr-TR').includes('çizer'))
                ?.querySelector('.artist-content a, .summary-content')?.textContent?.trim() || author;

            // Alternative Titles
            const altTitlesText = Array.from(doc.querySelectorAll('.post-content_item'))
                .find(el => el.textContent?.toLocaleLowerCase('tr-TR').includes('diğer adları') || el.textContent?.toLocaleLowerCase('tr-TR').includes('alt isimler'))
                ?.querySelector('.summary-content')?.textContent?.trim() || '';
            const alternativeTitles = altTitlesText ? altTitlesText.split(',').map(t => t.trim()).filter(t => t !== '') : [];

            // Release Year
            const yearText = Array.from(doc.querySelectorAll('.post-content_item'))
                .find(el => el.textContent?.toLocaleLowerCase('tr-TR').includes('yıl') || el.textContent?.toLocaleLowerCase('tr-TR').includes('salınış'))
                ?.querySelector('.summary-content')?.textContent?.trim() || '';
            const releaseYear = yearText ? parseInt(yearText.match(/\d{4}/)?.[0] || '') : new Date().getFullYear();

            // Genres
            const genreElements = doc.querySelectorAll('.genres-content a');
            const genres = genreElements.length > 0
                ? normalizeGenres(Array.from(genreElements).map(g => g.textContent?.trim() || ''))
                : normalizeGenres(card.genres);

            // Chapters
            const chapterElements = doc.querySelectorAll('.wp-manga-chapter');
            const chapters: ScrapedChapter[] = [];

            chapterElements.forEach((el) => {
                const linkEl = el.querySelector('a');
                if (linkEl) {
                    const name = linkEl.textContent?.trim() || '';
                    const link = linkEl.href.replace(window.location.origin, 'https://hayalistic.net');
                    // Extract number more robustly
                    const numMatch = name.match(/(\d+(\.\d+)?)/);
                    const number = numMatch ? parseFloat(numMatch[1]) : 0;

                    chapters.push({ name, link, number });
                }
            });

            // Sort chapters by number ascending
            chapters.sort((a, b) => a.number - b.number);

            const finalTitle = detailTitle || card.title;
            const finalCover = detailCover || card.cover || '';

            const scrapedManga: Partial<Manga> = {
                title: finalTitle,
                alternativeTitles,
                description,
                cover: finalCover,
                banner: finalCover,
                author,
                artist,
                status,
                type,
                genres: normalizeGenres(genres.filter(g => g && g !== '')),
                releaseYear,
                chapters: [], // We'll fetch pages for each chapter if needed, but for now just meta
                views: 0,
                ratings: [],
            };

            // Store temporary chapters for the preview/import flow
            (scrapedManga as any)._rawChapters = chapters;

            setSelectedChapterIndices(chapters.map((_, i) => i));
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
            const rawChapters = (fetchedData as any)._rawChapters as ScrapedChapter[];
            const selectedChaptersToImport = rawChapters.filter((_, i) => selectedChapterIndices.includes(i));

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

                    const chHtml = await fetchWithProxy(rc.link);
                    const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');

                    // 1. Method: Try standard selectors
                    let images = Array.from(chDoc.querySelectorAll('.reading-content img, .wp-manga-chapter-img, .page-break img, .entry-content img'))
                        .map(img => {
                            const src = (img.getAttribute('src') || '').trim();
                            const dataSrc = (img.getAttribute('data-src') || '').trim();
                            const dataLazySrc = (img.getAttribute('data-lazy-src') || '').trim();
                            const dataCdn = (img.getAttribute('data-cdn') || '').trim();

                            const finalSrc = (dataSrc.startsWith('http') ? dataSrc :
                                dataLazySrc.startsWith('http') ? dataLazySrc :
                                    dataCdn.startsWith('http') ? dataCdn :
                                        src.startsWith('http') && !src.includes('base64') ? src : '').trim();

                            return finalSrc;
                        })
                        .filter(src => src !== '');

                    // 2. Method: If no images found, try to find chapter_data in scripts (Common in Madara)
                    if (images.length === 0) {
                        const scripts = chDoc.querySelectorAll('script');
                        for (const script of Array.from(scripts)) {
                            const content = script.textContent || '';
                            if (content.includes('chapter_data')) {
                                try {
                                    // Try to extract JSON from var chapter_data = {...};
                                    const match = content.match(/chapter_data\s*=\s*({.*?});/s);
                                    if (match) {
                                        const jsonData = JSON.parse(match[1]);
                                        if (jsonData.images && Array.isArray(jsonData.images)) {
                                            images = jsonData.images.map((img: any) => img.src).filter((src: string) => src && src.startsWith('http'));
                                        }
                                    }
                                } catch (e) {
                                    console.warn('Script parsing failed', e);
                                }
                            }
                        }
                    }

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

            const finalManga: Manga = {
                id: mangaId,
                title: fetchedData.title!,
                alternativeTitles: fetchedData.alternativeTitles || [],
                description: fetchedData.description!,
                cover: fetchedData.cover!,
                banner: fetchedData.banner!,
                author: fetchedData.author!,
                artist: fetchedData.artist!,
                status: fetchedData.status!,
                type: fetchedData.type!,
                genres: fetchedData.genres!,
                releaseYear: fetchedData.releaseYear!,
                chapters: chapters,
                views: 0,
                ratings: [],
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
            };

            await saveManga(finalManga);
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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">İçerik Çekici (Scraper)</h1>
                    <p className="text-muted-foreground">Dış sitelerden manga ve webtoon verilerini otomatik olarak çekin.</p>
                </div>
                <div className="flex gap-2">
                    <Badge variant="outline" className="h-8 gap-1 bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 transition-colors">
                        <Globe className="h-4 w-4" />
                        Hayalistic.net
                    </Badge>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Manga Ara veya Link Yapıştır</CardTitle>
                    <CardDescription>
                        Hayalistic üzerinden manga araması yapın veya direkt seri sayfasının linkini yapıştırın.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSearch} className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Manga adı yazın veya https://hayalistic.net/manga/... linkini yapıştırın"
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

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Results List */}
                <Card className="flex flex-col h-[600px]">
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
                <Card className="flex flex-col h-[600px]">
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
                                    <div className="flex gap-4">
                                        <div className="w-32 shrink-0 overflow-hidden rounded-lg border border-border">
                                            <img src={fetchedData.cover} alt="Cover" className="w-full object-cover" />
                                        </div>
                                        <div className="space-y-2">
                                            <h2 className="text-xl font-bold">{fetchedData.title}</h2>
                                            <p className="text-sm text-muted-foreground">Yazar: {fetchedData.author}</p>
                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors uppercase">{fetchedData.type}</Badge>
                                                <Badge variant="outline" className="bg-secondary text-muted-foreground border-border hover:bg-secondary/80 transition-colors">{fetchedData.status}</Badge>
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
                                                <span className="font-semibold text-muted-foreground">Bölüm Sayısı: <span className="text-foreground">{(fetchedData as any)._rawChapters?.length || 0}</span></span>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 px-3 text-[10px] uppercase font-black tracking-wider transition-all"
                                                    onClick={() => {
                                                        const allChapters = (fetchedData as any)._rawChapters || [];
                                                        if (selectedChapterIndices.length === allChapters.length) {
                                                            setSelectedChapterIndices([]);
                                                        } else {
                                                            setSelectedChapterIndices(allChapters.map((_, i) => i));
                                                        }
                                                    }}
                                                >
                                                    {selectedChapterIndices.length === ((fetchedData as any)._rawChapters?.length || 0) ? 'Hiçbirini Seçme' : 'Tümünü Seç'}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="max-h-32 overflow-y-auto space-y-1 mt-2 pr-2">
                                            {((fetchedData as any)._rawChapters as ScrapedChapter[])?.slice().reverse().map((ch, revIdx, arr) => {
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
