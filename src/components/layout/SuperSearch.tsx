import React, { useState, useEffect, useMemo } from 'react';
import {
    Search,
    ArrowLeft,
    Star,
    Sparkles,
    BookOpen
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Manga } from '@/lib/types';
import {
    Dialog,
    DialogContent,
    DialogTrigger,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { addFavorite, removeFavorite, isFavorite } from '@/lib/storage';
import { toast } from 'sonner';
import { matchesMangaSearch } from '@/lib/searchMatching';
import { getMangaTypeLabel } from '@/lib/mangaType';

let mangaSummariesLoaderPromise: Promise<(() => Promise<Manga[]>)> | null = null;

const loadMangaSummaries = async () => {
    if (!mangaSummariesLoaderPromise) {
        mangaSummariesLoaderPromise = import('@/lib/database').then((module) => module.getMangaSummaries);
    }

    const getMangaSummaries = await mangaSummariesLoaderPromise;
    return getMangaSummaries();
};

const SuperSearch: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [allMangas, setAllMangas] = useState<Manga[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [activeGenre, setActiveGenre] = useState('Hepsi');
    const [favorites, setFavorites] = useState<Record<string, boolean>>({});
    const { user } = useAuth();
    const [popularMangas, setPopularMangas] = useState<Manga[]>([]);
    const [randomShowcase, setRandomShowcase] = useState<Manga[]>([]);

    const navigate = useNavigate();

    useEffect(() => {
        if (isOpen) {
            const loadData = async () => {
                setIsLoading(true);
                try {
                    const data = await loadMangaSummaries();
                    setAllMangas(data);

                    // Set popular mangas (top 5 by views or just first 5 if views are equal)
                    const popular = [...data]
                        .sort((a, b) => (b.views || 0) - (a.views || 0))
                        .slice(0, 5);
                    setPopularMangas(popular);

                    const randomCards = [...data]
                        .sort(() => Math.random() - 0.5)
                        .slice(0, 4);
                    setRandomShowcase(randomCards);

                    if (user) {
                        const favStatus: Record<string, boolean> = {};
                        await Promise.all(data.map(async (m) => {
                            favStatus[m.id] = await isFavorite(user.id, m.id);
                        }));
                        setFavorites(favStatus);
                    }
                } catch (err) {
                    console.error('Failed to load data for search:', err);
                } finally {
                    setIsLoading(false);
                }
            };
            loadData();
        }
    }, [isOpen, user]);

    const genres = useMemo(() => {
        const allGenres = allMangas.flatMap(m => m.genres);
        return ['Hepsi', ...Array.from(new Set(allGenres))].slice(0, 10);
    }, [allMangas]);

    const filteredMangas = useMemo(() => {
        if (!searchQuery.trim()) return [];

        return allMangas.filter(m => {
            const matchesSearch = matchesMangaSearch(m, searchQuery);
            const matchesGenre = activeGenre === 'Hepsi' || m.genres.includes(activeGenre);

            return matchesSearch && matchesGenre;
        });
    }, [searchQuery, allMangas, activeGenre]);

    const handleResultClick = (id: string) => {
        navigate(`/manga/${id}`);
        setIsOpen(false);
        setSearchQuery('');
    };

    const handleToggleFavorite = async (e: React.MouseEvent, mangaId: string) => {
        e.stopPropagation();
        if (!user) {
            toast.error('Favorilere eklemek için giriş yapmalısınız');
            return;
        }

        try {
            const isFav = favorites[mangaId];
            if (isFav) {
                await removeFavorite(user.id, mangaId);
                setFavorites(prev => ({ ...prev, [mangaId]: false }));
                toast.success('Favorilerden kaldırıldı');
            } else {
                await addFavorite(user.id, mangaId);
                setFavorites(prev => ({ ...prev, [mangaId]: true }));
                toast.success('Favorilere eklendi');
            }
        } catch (err) {
            toast.error('İşlem başarısız oldu');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-secondary/80">
                    <Search className="h-5 w-5 text-muted-foreground" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl p-0 gap-0 bg-[#1A1A1A] border-none shadow-2xl rounded-2xl overflow-hidden sm:max-w-2xl [&>button]:hidden">
                <DialogTitle className="sr-only">Manga Arama</DialogTitle>
                <DialogDescription className="sr-only">
                    Manga, yazar, çizer veya kategoriye göre arama yapın.
                </DialogDescription>
                <div className="flex flex-col h-[600px]">
                    {/* Search Header */}
                    <div className="flex items-center gap-3 p-4 border-b border-white/5 bg-[#141414] relative pr-4">
                        <div className="flex items-center gap-3 flex-1 px-3 bg-white/5 rounded-xl border border-white/5 focus-within:border-white/10 transition-colors">
                            {searchQuery ? (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="p-1 hover:bg-white/5 rounded-md transition-colors"
                                >
                                    <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                                </button>
                            ) : (
                                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <input
                                autoFocus
                                placeholder="Manga, yazar veya çizer ara..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 bg-transparent border-none outline-none py-2.5 text-[15px] placeholder:text-muted-foreground/30 text-white"
                            />
                        </div>
                    </div>

                    <ScrollArea className="flex-1">
                        <div className="p-6">
                            {!searchQuery ? (
                                <>
                                    {/* Popular Searches */}
                                    <div className="mb-8">
                                        <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em] mb-4">POPÜLER ARAMALAR</h3>
                                        <div className="space-y-1">
                                            {isLoading ? (
                                                <div className="space-y-2">
                                                    {[1, 2, 3, 4, 5].map((n) => (
                                                        <div key={n} className="h-10 w-full bg-white/5 animate-pulse rounded-xl" />
                                                    ))}
                                                </div>
                                            ) : popularMangas.length > 0 ? (
                                                popularMangas.map((m, i) => (
                                                    <button
                                                        key={m.id}
                                                        onClick={() => handleResultClick(m.id)}
                                                        className="flex items-center gap-4 w-full p-2.5 rounded-xl hover:bg-white/5 text-left transition-colors group"
                                                    >
                                                        <span className="text-muted-foreground/30 font-bold text-xs w-6 italic shrink-0 flex items-center justify-center"># {i + 1}</span>
                                                        <span className="text-[14px] font-medium text-white/80 group-hover:text-white transition-colors py-0.5">{m.title}</span>
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="py-8 text-center text-muted-foreground text-xs italic">
                                                    Henüz popüler arama verisi bulunmuyor.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-6">
                                    {/* Genres/Filters */}
                                    <div className="flex flex-wrap gap-2">
                                        {genres.map(genre => (
                                            <button
                                                key={genre}
                                                onClick={() => setActiveGenre(genre)}
                                                className={cn(
                                                    "px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200",
                                                    activeGenre === genre
                                                        ? "bg-white text-black"
                                                        : "bg-[#2A2A2A] text-white/60 hover:bg-[#3A3A3A] hover:text-white"
                                                )}
                                            >
                                                {genre}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Results List */}
                                    <div className="space-y-1">
                                        {isLoading ? (
                                            <div className="py-12 text-center text-muted-foreground animate-pulse">
                                                Sonuçlar yükleniyor...
                                            </div>
                                        ) : filteredMangas.length === 0 ? (
                                            <div className="py-12 text-center text-muted-foreground">
                                                Eşleşen sonuç bulunamadı.
                                            </div>
                                        ) : (
                                            filteredMangas.map((manga) => (
                                                <div
                                                    key={manga.id}
                                                    onClick={() => handleResultClick(manga.id)}
                                                    className="flex gap-4 p-3 rounded-2xl hover:bg-white/5 cursor-pointer text-left transition-all group items-start relative"
                                                >
                                                    <div className="relative aspect-[3/4] w-[70px] flex-shrink-0 overflow-hidden rounded-lg shadow-xl border border-white/10 group-hover:border-white/20 transition-all">
                                                        <img
                                                            src={manga.cover}
                                                            alt={manga.title}
                                                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0 pt-0.5">
                                                        <div className="flex items-start justify-between gap-4">
                                                            <h4 className="text-[15px] font-bold text-white transition-colors line-clamp-1 leading-tight">
                                                                {highlightText(manga.title, searchQuery)}
                                                            </h4>
                                                            <button
                                                                onClick={(e) => handleToggleFavorite(e, manga.id)}
                                                                className="relative z-10 p-1.5 -m-1.5 rounded-full hover:bg-white/10 transition-colors group/star"
                                                            >
                                                                <Star
                                                                    className={cn(
                                                                        "h-4 w-4 shrink-0 transition-all",
                                                                        favorites[manga.id]
                                                                            ? "text-yellow-400 fill-yellow-400"
                                                                            : "text-white/20 group-hover/star:text-white"
                                                                    )}
                                                                />
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 mt-0.5 mb-1.5">
                                                            <span className="text-[11px] font-semibold text-white/40">
                                                                {new Date(manga.lastUpdated).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                            </span>
                                                            <span className="text-[11px] text-white/40">•</span>
                                                            <span className="text-[11px] font-semibold text-white/40 capitalize">Seri</span>
                                                        </div>
                                                        <p className="text-[12px] text-white/30 line-clamp-2 leading-snug font-medium italic">
                                                            "{manga.description}"
                                                        </p>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {!searchQuery && randomShowcase.length > 0 && (
                                <div>
                                    <div className="mb-4 flex items-center gap-2">
                                        <Sparkles className="h-4 w-4 text-primary" />
                                        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                                            RASTGELE SERİLER
                                        </h3>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                        {randomShowcase.map((manga) => (
                                            <button
                                                key={manga.id}
                                                onClick={() => handleResultClick(manga.id)}
                                                className="group overflow-hidden rounded-2xl border border-white/5 bg-[#141414] text-left transition-all hover:border-primary/30 hover:bg-white/[0.04] hover:shadow-[0_0_24px_rgba(59,130,246,0.12)]"
                                            >
                                                <div className="relative aspect-[2/3] overflow-hidden">
                                                    <img
                                                        src={manga.cover}
                                                        alt={manga.title}
                                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                    />
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
                                                    <Badge
                                                        variant="secondary"
                                                        className={`absolute left-2 top-2 border-none text-[9px] font-bold shadow-lg ${
                                                            manga.type === 'manhwa'
                                                                ? 'bg-orange-600/90 text-white shadow-orange-500/20'
                                                                : manga.type === 'manhua'
                                                                    ? 'bg-emerald-600/90 text-white shadow-emerald-500/20'
                                                                    : manga.type === 'webtoon'
                                                                        ? 'bg-sky-600/90 text-white shadow-sky-500/20'
                                                                        : manga.type === 'hentai'
          ? 'bg-pink-600/90 text-white shadow-pink-500/20'
                                                                            : manga.type === 'webtoon_hentai'
                                                                                ? 'bg-rose-600/90 text-white shadow-rose-500/20'
                                                                        : 'bg-primary/90 text-primary-foreground shadow-primary/20'
                                                        }`}
                                                    >
                                                        {getMangaTypeLabel(manga.type)}
                                                    </Badge>
                                                    <Badge
                                                        variant="outline"
                                                        className="absolute bottom-2 right-2 border-white/10 bg-black/60 px-1.5 text-[9px] text-white backdrop-blur-md"
                                                    >
                                                        {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam' : 'Ara'}
                                                    </Badge>
                                                </div>

                                                <div className="space-y-1.5 p-3">
                                                    <p className="line-clamp-2 min-h-[2.5rem] text-[12px] font-bold leading-5 text-white/90 transition-colors group-hover:text-white">
                                                        {manga.title}
                                                    </p>
                                                    <p className="line-clamp-1 text-[10px] text-white/40">
                                                        {manga.author}
                                                    </p>
                                                    <div className="flex items-center gap-1.5 text-[10px] text-primary/90">
                                                        <BookOpen className="h-3 w-3" />
                                                        <span>{typeof manga.chapterCount === 'number' ? manga.chapterCount : manga.chapters.length} bölüm</span>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
};

// Helper for title highlighting
const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');
    const normalizedText = text.toLocaleLowerCase('tr-TR');

    if (!normalizedQuery) {
        return text;
    }

    const parts: Array<{ value: string; highlighted: boolean }> = [];
    let cursor = 0;

    while (cursor < text.length) {
        const matchIndex = normalizedText.indexOf(normalizedQuery, cursor);

        if (matchIndex === -1) {
            parts.push({ value: text.slice(cursor), highlighted: false });
            break;
        }

        if (matchIndex > cursor) {
            parts.push({ value: text.slice(cursor, matchIndex), highlighted: false });
        }

        parts.push({
            value: text.slice(matchIndex, matchIndex + normalizedQuery.length),
            highlighted: true,
        });
        cursor = matchIndex + normalizedQuery.length;
    }

    return (
        <span>
            {parts.map((part, i) =>
                part.highlighted
                    ? <span key={i} className="bg-yellow-400/90 text-black px-0.5 rounded-sm shrink-0">{part.value}</span>
                    : <React.Fragment key={i}>{part.value}</React.Fragment>
            )}
        </span>
    );
};

export default SuperSearch;
