import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    Download,
    RefreshCw,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Globe,
    ExternalLink,
    ChevronDown,
    Plus,
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
import { Manga, Chapter } from '@/lib/types';

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

const AdminChapterScraper: React.FC = () => {
    const navigate = useNavigate();

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
    const [newChapters, setNewChapters] = useState<ScrapedChapter[]>([]);
    const [selectedChapterIndices, setSelectedChapterIndices] = useState<number[]>([]);

    // Import State
    const [importing, setImporting] = useState(false);

    useEffect(() => {
        loadLocalMangas();
    }, []);

    const loadLocalMangas = async () => {
        setLoadingLocal(true);
        try {
            const data = await getAllMangas();
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
            const details = await getMangaById(mangaId);
            setLocalMangaDetails(details);
            // Pre-fill search query with title for convenience
            if (details) setSearchQuery(details.title);
        } catch (err) {
            toast.error('Manga detayları yüklenemedi');
        } finally {
            setLoadingLocal(false);
        }
    };

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
            (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
        ];

        let lastError = null;
        for (const proxy of backups) {
            try {
                const response = await fetch(proxy(targetUrl));
                if (response.ok) {
                    const data = await response.json().catch(() => null);
                    if (data && data.contents) return data.contents;
                    if (!data) {
                        return await response.text();
                    }
                    return typeof data === 'string' ? data : JSON.stringify(data);
                }
            } catch (err) {
                lastError = err;
            }
        }

        // Final attempt: direct fetch
        try {
            const response = await fetch(targetUrl);
            if (response.ok) return await response.text();
        } catch (e) { }

        throw lastError || new Error('All proxies failed');
    };

    const handleSourceSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        if (searchQuery.trim().startsWith('http') && searchQuery.includes('hayalistic.net/manga/')) {
            toast.info('Direkt link algılandı, bölümler kontrol ediliyor...');
            fetchSourceChapters({
                title: 'Linkten Çekilen Manga',
                link: searchQuery.trim(),
                cover: '',
                genres: []
            });
            return;
        }

        setLoadingSource(true);
        setSourceResults([]);
        setSelectedSourceManga(null);
        setSourceChapters([]);
        setNewChapters([]);

        try {
            const url = `https://hayalistic.net/?s=${encodeURIComponent(searchQuery)}&post_type=wp-manga`;
            const html = await fetchWithProxy(url);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const items = doc.querySelectorAll('.c-tabs-item__content');

            const results: ScrapedMangaCard[] = [];
            items.forEach(item => {
                const titleEl = item.querySelector('.post-title h3 a');
                const link = titleEl?.getAttribute('href') || '';
                const title = titleEl?.textContent?.trim() || '';
                const imgEl = item.querySelector('img');
                const cover = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '';

                if (title && link) {
                    results.push({ title, link, cover, genres: [] });
                }
            });

            setSourceResults(results);
            if (results.length === 0) toast.error('Sonuç bulunamadı');
        } catch (err) {
            toast.error('Arama başarısız oldu');
        } finally {
            setLoadingSource(false);
        }
    };

    const fetchSourceChapters = async (card: ScrapedMangaCard) => {
        setSelectedSourceManga(card);
        setFetchingDetails(true);
        setSourceChapters([]);
        setNewChapters([]);

        try {
            const html = await fetchWithProxy(card.link);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const chapterElements = doc.querySelectorAll('.wp-manga-chapter');
            const chapters: ScrapedChapter[] = [];

            chapterElements.forEach((el) => {
                const linkEl = el.querySelector('a');
                if (linkEl) {
                    const name = linkEl.textContent?.trim() || '';
                    const link = linkEl.href.replace(window.location.origin, 'https://hayalistic.net');
                    const numMatch = name.match(/(\d+(\.\d+)?)/);
                    const number = numMatch ? parseFloat(numMatch[1]) : 0;
                    chapters.push({ name, link, number });
                }
            });

            // Sort by number asc
            chapters.sort((a, b) => a.number - b.number);
            setSourceChapters(chapters);

            // Compare with local chapters
            if (localMangaDetails) {
                const localChapterNumbers = localMangaDetails.chapters.map(c => c.number);
                const diff = chapters.filter(sc => !localChapterNumbers.includes(sc.number));
                setNewChapters(diff);
                setSelectedChapterIndices(diff.map((_, i) => i));

                if (diff.length === 0) {
                    toast.info('Bu manga zaten güncel.');
                } else {
                    toast.success(`${diff.length} yeni bölüm bulundu!`);
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

            for (let i = 0; i < chaptersToImport.length; i++) {
                const sc = chaptersToImport[i];
                try {
                    // Small delay to prevent proxy ban
                    if (i > 0) await new Promise(resolve => setTimeout(resolve, 800));

                    const chHtml = await fetchWithProxy(sc.link);
                    const chDoc = new DOMParser().parseFromString(chHtml, 'text/html');

                    // Same image extraction logic as Scraper
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

                    // Method 2: Script data extraction
                    if (images.length === 0) {
                        const scripts = chDoc.querySelectorAll('script');
                        for (const script of Array.from(scripts)) {
                            const content = script.textContent || '';
                            if (content.includes('chapter_data')) {
                                try {
                                    const match = content.match(/chapter_data\s*=\s*({.*?});/s);
                                    if (match) {
                                        const jsonData = JSON.parse(match[1]);
                                        if (jsonData.images && Array.isArray(jsonData.images)) {
                                            images = jsonData.images.map((img: any) => img.src).filter((src: string) => src && src.startsWith('http'));
                                        }
                                    }
                                } catch (e) { }
                            }
                        }
                    }

                    importedChapters.push({
                        id: `chapter-${Date.now()}-${sc.number}`,
                        number: sc.number,
                        title: sc.name,
                        pages: images,
                        releaseDate: new Date().toISOString(),
                        views: 0,
                    });

                    toast.info(`Bölüm ${sc.number} yüklendi... (${i + 1}/${chaptersToImport.length})`);
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
            toast.success(`${chaptersToImport.length} yeni bölüm başarıyla eklendi!`);
            navigate(`/admin/mangas/${localMangaDetails.id}`);
        } catch (err) {
            toast.error('Güncelleme sırasında bir hata oluştu');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <RefreshCw className="h-6 w-6" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold">Bölüm Çekme</h1>
                    <p className="text-muted-foreground">Eski mangalarınız için yeni bölümleri otomatik bulun ve yükleyin.</p>
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
                            Hayalistic Üzerinde Bulun
                        </CardTitle>
                        <CardDescription>Manganın güncel halini seçtiğiniz sitede bulun.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form onSubmit={handleSourceSearch} className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Manga adı veya URL..."
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
                                            onClick={() => fetchSourceChapters(m)}
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
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Durum Kontrolü</CardTitle>
                                <CardDescription>Kaynak site ile bizim sitemiz arasındaki farklar.</CardDescription>
                            </div>
                            <Button
                                disabled={newChapters.length === 0 || importing}
                                onClick={handleImportNewChapters}
                                className="gap-2"
                            >
                                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                {selectedChapterIndices.length > 0 ? `${selectedChapterIndices.length} Yeni Bölümü İçe Aktar` : 'Bölüm Seçilmedi'}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="grid md:grid-cols-2">
                            <div className="border-r border-border p-6">
                                <div className="mb-4 flex items-center justify-between">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Yeni Bölümler ({newChapters.length})</h3>
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
                                                    ? 'bg-green-500/20 border-green-500 text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]'
                                                    : 'bg-red-500/10 border-red-500/50 text-red-400 opacity-60'
                                                    }`}
                                            >
                                                <span className="text-[10px] font-bold uppercase">Bölüm</span>
                                                <span className="text-sm font-black">{ch.number}</span>
                                            </button>
                                        );
                                    })}
                                    {newChapters.length === 0 && (
                                        <p className="col-span-full py-4 text-center text-sm text-green-500 font-medium">Bu manga tamamen güncel!</p>
                                    )}
                                </div>
                            </div>
                            <div className="p-6 bg-secondary/20">
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
                                            * Bölüm numaraları karşılaştırılarak bizde eksik olanlar otomatik olarak belirlenir.
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
