import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    Library as LibraryIcon,
    BookOpen,
    Clock,
    CheckCircle,
    PauseCircle,
    XCircle,
    ChevronDown,
    Play,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import {
    getFavorites,
    updateFavoriteCategory,
    removeFavorite,
    getLatestProgress
} from '../lib/storage';
import { getMangaById } from '@/lib/database';
import { Manga, LibraryCategory, Favorite, ReadingProgress } from '@/lib/types';
import { toast } from 'sonner';
import LibrarySkeleton from '@/components/skeletons/LibrarySkeleton';

interface LibraryItem {
    favorite: Favorite;
    manga: Manga | undefined;
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
    const [activeTab, setActiveTab] = useState<LibraryCategory | 'all'>('all');
    const [libraryItems, setLibraryItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchLibrary();
    }, [activeTab, user]);

    const fetchLibrary = async () => {
        if (!user) return;

        try {
            setIsLoading(true);
            const favorites = await getFavorites(user.id);

            let filtered = favorites;
            if (activeTab !== 'all') {
                filtered = favorites.filter(f => f.category === activeTab);
            }

            const items = await Promise.all(filtered.map(async fav => {
                const progress = await getLatestProgress(user.id, fav.mangaId);
                // The manga details are already in fav due to our new getFavorites join
                return {
                    favorite: fav,
                    manga: {
                        id: fav.mangaId,
                        title: fav.mangaTitle,
                        cover: fav.mangaCover,
                        author: '', // Basic info
                        chapters: [] // We'll handle links differently
                    },
                    progress: progress,
                };
            }));

            setLibraryItems(items);
        } catch (err) {
            console.error('Library fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCategoryChange = async (mangaId: string, category: LibraryCategory) => {
        if (!user) return;
        await updateFavoriteCategory(user.id, mangaId, category);
        fetchLibrary();
        toast.success('Kategori güncellendi');
    };

    const handleRemove = async (mangaId: string) => {
        if (!user) return;
        await removeFavorite(user.id, mangaId);
        fetchLibrary();
        toast.success('Kütüphaneden kaldırıldı');
    };

    const getCategoryBadge = (category: LibraryCategory | undefined) => {
        const config = categoryConfig.find(c => c.key === category);
        if (!config) return null;

        return (
            <Badge variant="secondary" className={`${config.color} bg-opacity-20`}>
                <config.icon className="mr-1 h-3 w-3" />
                {config.label}
            </Badge>
        );
    };

    if (isLoading && user) {
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

            <main className="container pb-12 pt-20">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Kütüphanem</h1>
                    <p className="text-muted-foreground">Favori mangalarınızı kategorilere ayırın</p>
                </div>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LibraryCategory | 'all')}>
                    <TabsList className="mb-6 flex-wrap h-auto gap-2">
                        <TabsTrigger value="all" className="gap-2">
                            <LibraryIcon className="h-4 w-4" />
                            Tümü
                        </TabsTrigger>
                        {categoryConfig.map((cat) => (
                            <TabsTrigger key={cat.key} value={cat.key} className="gap-2">
                                <cat.icon className={`h-4 w-4 ${cat.color}`} />
                                {cat.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <TabsContent value={activeTab} className="mt-0">
                        {libraryItems.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16">
                                <LibraryIcon className="h-16 w-16 text-muted-foreground/50" />
                                <p className="mt-4 text-muted-foreground">
                                    {activeTab === 'all'
                                        ? 'Kütüphaneniz boş. Manga detay sayfasından favorilere ekleyin.'
                                        : 'Bu kategoride manga bulunmuyor.'}
                                </p>
                                <Button asChild className="mt-4">
                                    <Link to="/browse">Manga Keşfet</Link>
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {libraryItems.map(({ favorite, manga, progress }) => (
                                    <div
                                        key={favorite.mangaId}
                                        className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-lg"
                                    >
                                        <Link to={`/manga/${manga!.id}`}>
                                            <img
                                                src={manga!.cover}
                                                alt={manga!.title}
                                                className="h-24 w-16 rounded-lg object-cover"
                                            />
                                        </Link>

                                        <div className="flex-1 min-w-0">
                                            <Link to={`/manga/${manga!.id}`}>
                                                <h3 className="font-semibold hover:text-primary transition-colors">
                                                    {manga!.title}
                                                </h3>
                                            </Link>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {manga!.author} • {manga!.chapters.length} bölüm
                                            </p>

                                            <div className="flex items-center gap-2 mt-2">
                                                {getCategoryBadge(favorite.category)}
                                                <Badge variant="outline" className="capitalize">
                                                    {manga!.type}
                                                </Badge>
                                                {progress && (
                                                    <span className="text-xs text-muted-foreground">
                                                        Son okunan: Bölüm {progress.chapterNumber}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {progress ? (
                                                <Button asChild size="sm">
                                                    <Link to={`/manga/${manga!.id}/chapter/${progress.chapterId}`}>
                                                        <Play className="mr-1 h-4 w-4" />
                                                        Devam Et
                                                    </Link>
                                                </Button>
                                            ) : (
                                                <Button asChild size="sm">
                                                    <Link to={`/manga/${manga!.id}/chapter/${manga!.chapters[0]?.id}`}>
                                                        <Play className="mr-1 h-4 w-4" />
                                                        Başla
                                                    </Link>
                                                </Button>
                                            )}

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="outline" size="sm">
                                                        Kategori
                                                        <ChevronDown className="ml-1 h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent>
                                                    {categoryConfig.map((cat) => (
                                                        <DropdownMenuItem
                                                            key={cat.key}
                                                            onClick={() => handleCategoryChange(manga!.id, cat.key)}
                                                            className={favorite.category === cat.key ? 'bg-secondary' : ''}
                                                        >
                                                            <cat.icon className={`mr-2 h-4 w-4 ${cat.color}`} />
                                                            {cat.label}
                                                        </DropdownMenuItem>
                                                    ))}
                                                    <DropdownMenuItem
                                                        onClick={() => handleRemove(manga!.id)}
                                                        className="text-destructive"
                                                    >
                                                        <XCircle className="mr-2 h-4 w-4" />
                                                        Kaldır
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
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
