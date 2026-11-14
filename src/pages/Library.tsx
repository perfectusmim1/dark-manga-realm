import React, { useState, useEffect, useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    Library as LibraryIcon,
    BookOpen,
    Clock,
    CheckCircle,
    PauseCircle,
    XCircle,
    Play,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import OptimizedImage from '@/components/media/OptimizedImage';
import { useAuth } from '@/contexts/AuthContext';
import {
    getFavorites,
    updateFavoriteCategory,
    removeFavorite,
    getLatestProgress,
} from '../lib/storage';
import { Manga, LibraryCategory, Favorite, ReadingProgress } from '@/lib/types';
import { toast } from 'sonner';
import LibrarySkeleton from '@/components/skeletons/LibrarySkeleton';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { syncMangaToExternalProviders } from '@/lib/externalSync';

interface LibraryItem {
    favorite: Favorite;
    manga: Pick<Manga, 'id' | 'title' | 'cover' | 'author' | 'chapters'>;
    progress: ReadingProgress | undefined;
}

const categoryConfig: { key: LibraryCategory; label: string; icon: React.ElementType; color: string }[] = [
    { key: 'reading', label: 'Okuyorum', icon: BookOpen, color: 'text-green-500' },
    { key: 'plan_to_read', label: 'Okuyacağım', icon: Clock, color: 'text-primary' },
    { key: 'completed', label: 'Tamamladım', icon: CheckCircle, color: 'text-purple-500' },
    { key: 'on_hold', label: 'Beklemede', icon: PauseCircle, color: 'text-orange-500' },
    { key: 'dropped', label: 'Bıraktım', icon: XCircle, color: 'text-red-500' },
];

const Library: React.FC = () => {
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const [activeTab, setActiveTab] = useState<LibraryCategory | 'all'>('all');
    const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase('tr-TR'));
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

    useEffect(() => {
        fetchLibrary();
    }, [activeTab, user?.id]);

    const fetchLibrary = async () => {
        if (!user) return;

        try {
            if (hasLoadedOnce) {
                setIsRefreshing(true);
            } else {
                setIsInitialLoading(true);
            }
            const favorites = await getFavorites(user.id);

            let filtered = favorites;
            if (activeTab !== 'all') {
                filtered = favorites.filter(f => f.category === activeTab);
            }

            const items: LibraryItem[] = await Promise.all(filtered.map(async fav => {
                const progress = await getLatestProgress(user.id, fav.mangaId);
                return {
                    favorite: fav,
                    manga: {
                        id: fav.mangaId,
                        title: fav.mangaTitle || 'Seri',
                        cover: fav.mangaCover || '',
                        author: '',
                        chapters: [],
                    },
                    progress,
                };
            }));

            setLibraryItems(items);
        } catch (err) {
            console.error('Library fetch error:', err);
        } finally {
            setIsInitialLoading(false);
            setIsRefreshing(false);
            setHasLoadedOnce(true);
        }
    };

    const filteredItems = useMemo(() => {
        if (!deferredSearchQuery) {
            return libraryItems;
        }

        return libraryItems.filter((item) =>
            (item.manga.title || '').toLocaleLowerCase('tr-TR').includes(deferredSearchQuery),
        );
    }, [deferredSearchQuery, libraryItems]);

    const triggerExternalSync = async (
        mangaId: string,
        trigger: 'category' | 'favorite',
    ) => {
        if (!isOnline) {
            return;
        }

        try {
            await syncMangaToExternalProviders({
                mangaId,
                trigger,
            });
        } catch (error) {
            console.warn(`External sync after ${trigger} change failed:`, error);
        }
    };

    const handleCategoryChange = async (mangaId: string, category: LibraryCategory) => {
        if (!user) return;
        try {
            await updateFavoriteCategory(user.id, mangaId, category);
            void triggerExternalSync(mangaId, 'category');
            toast.success(
                isOnline
                    ? 'Kategori güncellendi'
                    : 'Kategori güncellendi, tekrar çevrimiçi olduğunda eşitlenecek'
            );
            await fetchLibrary();
        } catch (err) {
            console.error('Category update failed:', err);
            toast.error('Kategori güncellenemedi');
        }
    };

    const handleRemove = async (mangaId: string) => {
        if (!user) return;
        try {
            await removeFavorite(user.id, mangaId);
            void triggerExternalSync(mangaId, 'favorite');
            await fetchLibrary();
            toast.success(
                isOnline
                    ? 'Kütüphaneden kaldırıldı'
                    : 'Kütüphaneden kaldırıldı, tekrar çevrimiçi olduğunda eşitlenecek'
            );
        } catch (err) {
            console.error('Favorite removal failed:', err);
            toast.error('Seri kütüphaneden kaldırılamadı');
        }
    };

    if (isInitialLoading && user) {
        return (
            <>
                <Header />
                <LibrarySkeleton />
            </>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <div className="text-center">
                        <LibraryIcon className="mx-auto h-16 w-16 text-muted-foreground/50" />
                        <h1 className="mt-4 text-2xl font-bold">Kütüphane</h1>
                        <p className="mt-2 text-muted-foreground">
                            Kütüphanenizi görmek için giriş yapmalısınız
                        </p>
                        <Button asChild className="mt-4">
                            <Link to="/auth">Giriş Yap</Link>
                        </Button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-16">
                <div className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:py-8">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Kütüphanem</h1>
                    <div className="relative w-full sm:w-72">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Kütüphanede ara..."
                            className="h-10 rounded-xl pl-9 pr-8"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                aria-label="Aramayı temizle"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LibraryCategory | 'all')}>
                    <TabsList className="mb-5 flex h-auto w-full justify-start gap-1.5 overflow-x-auto rounded-xl bg-secondary/40 p-1">
                        <TabsTrigger value="all" className="shrink-0 gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-sm">
                            <LibraryIcon className="h-4 w-4" />
                            Tümü
                        </TabsTrigger>
                        {categoryConfig.map((cat) => (
                            <TabsTrigger key={cat.key} value={cat.key} className="shrink-0 gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-sm">
                                <cat.icon className={`h-4 w-4 ${cat.color}`} />
                                {cat.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <TabsContent value={activeTab} className={`mt-0 transition-opacity duration-200 ${isRefreshing ? 'opacity-75' : 'opacity-100'}`}>
                        {filteredItems.length === 0 ? (
                            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 py-14 text-center">
                                <LibraryIcon className="h-14 w-14 text-muted-foreground/50" />
                                <p className="mt-4 text-sm text-muted-foreground">
                                    {searchQuery.trim()
                                        ? 'Aramanızla eşleşen seri bulunamadı.'
                                        : activeTab === 'all'
                                            ? 'Kütüphaneniz boş. Manga detay sayfasından favorilere ekleyin.'
                                            : 'Bu kategoride manga bulunmuyor.'}
                                </p>
                                {searchQuery.trim() ? (
                                    <Button className="mt-4" size="sm" onClick={() => setSearchQuery('')}>
                                        Aramayı Temizle
                                    </Button>
                                ) : (
                                    <Button asChild className="mt-4" size="sm">
                                        <Link to="/browse">Manga Keşfet</Link>
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="grid gap-2.5 sm:gap-3 md:grid-cols-2">
                                {filteredItems.map(({ favorite, manga, progress }, index) => (
                                    <div
                                        key={favorite.mangaId}
                                        className={cn(
                                            'animate-fade-up flex items-center gap-3 rounded-xl border border-border/60 bg-card/75 p-2.5 sm:p-3.5 transition-colors hover:border-primary/40 hover:bg-card',
                                            index >= 10 && 'cv-auto-row',
                                        )}
                                        style={{ animationDelay: `${0.04 + Math.min(index, 10) * 0.025}s` }}
                                    >
                                        <Link
                                            to={`/manga/${manga.id}`}
                                            className="h-20 w-14 sm:h-24 sm:w-16 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-secondary"
                                        >
                                            {manga.cover ? (
                                                <OptimizedImage
                                                    src={manga.cover}
                                                    alt={manga.title}
                                                    priority={index < 6}
                                                    rootMargin="480px 0px"
                                                    containerClassName="h-full w-full"
                                                    placeholderClassName="rounded-lg"
                                                    sizes="64px"
                                                    className="h-full w-full object-cover"
                                                />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-secondary/50 to-background text-lg font-bold text-muted-foreground">
                                                    {(manga.title || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
                                                </div>
                                            )}
                                        </Link>

                                        <div className="min-w-0 flex-1">
                                            <Link
                                                to={`/manga/${manga.id}`}
                                                className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                            >
                                                <h3 className="line-clamp-1 text-sm sm:text-base font-semibold transition-colors hover:text-primary">
                                                    {manga.title}
                                                </h3>
                                            </Link>

                                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                                {progress
                                                    ? `Son okunan: Bölüm ${progress.chapterNumber}`
                                                    : 'Henüz okuma kaydı yok'}
                                            </p>

                                            <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
                                                <Select
                                                    value={favorite.category || 'reading'}
                                                    onValueChange={(value) => handleCategoryChange(manga.id, value as LibraryCategory)}
                                                >
                                                    <SelectTrigger
                                                        className="h-8 w-auto min-w-[118px] max-w-[144px] rounded-lg bg-background/60 px-2.5 text-xs"
                                                        aria-label="Okuma durumu"
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {categoryConfig.map((cat) => (
                                                            <SelectItem key={cat.key} value={cat.key} className="text-xs">
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    <cat.icon className={`h-3.5 w-3.5 ${cat.color}`} />
                                                                    {cat.label}
                                                                </span>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>

                                                {progress ? (
                                                    <Button asChild size="sm" className="h-8 px-2.5 text-xs">
                                                        <Link to={`/manga/${manga.id}/chapter/${progress.chapterId}`}>
                                                            <Play className="mr-1 h-3.5 w-3.5" />
                                                            Devam Et
                                                        </Link>
                                                    </Button>
                                                ) : (
                                                    <Button asChild size="sm" variant="secondary" className="h-8 px-2.5 text-xs">
                                                        <Link to={`/manga/${manga.id}`}>
                                                            Detay
                                                        </Link>
                                                    </Button>
                                                )}

                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleRemove(manga.id)}
                                                    aria-label="Kütüphaneden kaldır"
                                                    title="Kütüphaneden kaldır"
                                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
};

export default Library;
