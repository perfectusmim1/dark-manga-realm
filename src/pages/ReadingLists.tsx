import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    List,
    Plus,
    Globe,
    Lock,
    Trash2,
    Edit2,
    ChevronRight,
    Compass,
    Search,
    X,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { getReadingLists, deleteReadingList } from '@/lib/database';
import { ReadingList } from '@/lib/types';
import { toast } from 'sonner';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import CreateReadingListModal from '@/components/manga/CreateReadingListModal';
import ReadingListCover from '@/components/manga/ReadingListCover';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import OfflineNotice from '@/components/offline/OfflineNotice';
import VirtualCardGrid from '@/components/performance/VirtualCardGrid';

type ReadingListSort = 'newest' | 'name' | 'count';
type ReadingListVisibilityFilter = 'all' | 'public' | 'private';

const ReadingLists: React.FC = () => {
    const { user, isLoading: authLoading } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const [lists, setLists] = useState<ReadingList[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingList, setEditingList] = useState<ReadingList | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [visibilityFilter, setVisibilityFilter] = useState<ReadingListVisibilityFilter>('all');
    const [sortBy, setSortBy] = useState<ReadingListSort>('newest');

    useEffect(() => {
        if (authLoading) {
            return;
        }

        let isCancelled = false;

        const fetchLists = async () => {
            if (!user) {
                setLists([]);
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                const userLists = await getReadingLists(user.id);
                if (isCancelled) return;

                setLists(userLists);
            } catch (err) {
                if (isCancelled) return;

                console.error('Liste yükleme hatası:', err);
                toast.error('Listeler yüklenemedi');
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        void fetchLists();

        return () => {
            isCancelled = true;
        };
    }, [authLoading, isOnline, user?.id]);

    const filteredLists = useMemo(() => {
        const needle = searchQuery.trim().toLocaleLowerCase('tr-TR');
        return [...lists]
            .filter((list) => {
                if (visibilityFilter === 'public' && !list.isPublic) return false;
                if (visibilityFilter === 'private' && list.isPublic) return false;
                if (!needle) return true;
                return (
                    list.name.toLocaleLowerCase('tr-TR').includes(needle)
                    || (list.description || '').toLocaleLowerCase('tr-TR').includes(needle)
                );
            })
            .sort((a, b) => {
                if (sortBy === 'name') {
                    return a.name.localeCompare(b.name, 'tr-TR');
                }
                if (sortBy === 'count') {
                    return (b.itemsCount ?? b.items?.length ?? 0) - (a.itemsCount ?? a.items?.length ?? 0);
                }
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
    }, [lists, searchQuery, visibilityFilter, sortBy]);

    if (authLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container mx-auto max-w-6xl px-4 pb-10 pt-20">
                    <div className="mb-6">
                        <Skeleton className="h-8 w-52 mb-2" />
                        <Skeleton className="h-4 w-72" />
                    </div>
                    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-56 w-full rounded-xl" />
                        ))}
                    </div>
                </main>
            </div>
        );
    }

    const handleDelete = async () => {
        if (!deleteConfirmId) return;
        try {
            await deleteReadingList(deleteConfirmId);
            setLists(prev => prev.filter(l => l.id !== deleteConfirmId));
            toast.success(isOnline ? 'Liste silindi' : 'Liste silindi, tekrar çevrimiçi olduğunda eşitlenecek');
        } catch (err) {
            toast.error('Liste silinemedi');
        } finally {
            setDeleteConfirmId(null);
        }
    };

    const handleCreateSuccess = (newList: ReadingList) => {
        if (editingList) {
            setLists(prev => prev.map(l => l.id === newList.id ? newList : l));
        } else {
            setLists(prev => [newList, ...prev]);
        }
    };

    const handleEdit = (list: ReadingList) => {
        setEditingList(list);
        setIsModalOpen(true);
    };

    const handleOpenCreateModal = () => {
        setEditingList(null);
        setIsModalOpen(true);
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <div className="text-center">
                        <List className="mx-auto h-14 w-14 text-muted-foreground/50" />
                        <h1 className="mt-4 text-xl font-bold sm:text-2xl">Okuma Listelerim</h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Okuma listelerinizi görmek için giriş yapmalısınız
                        </p>
                        <Button asChild size="sm" className="mt-4">
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

            <main className="container mx-auto max-w-6xl px-4 pb-10 pt-20">
                <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-baseline gap-2.5">
                        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Okuma Listelerim</h1>
                        {!isLoading && lists.length > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums">({lists.length})</span>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                            <Link to="/community?tab=reading-lists">
                                <Compass className="h-3.5 w-3.5" />
                                Topluluk Listeleri
                            </Link>
                        </Button>
                        <Button onClick={handleOpenCreateModal} size="sm" className="h-8 gap-1.5 text-xs">
                            <Plus className="h-3.5 w-3.5" />
                            Yeni Liste
                        </Button>
                    </div>
                </div>

                {!isLoading && lists.length > 0 && (
                    <div className="mb-5 flex flex-wrap items-center gap-2.5">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Listelerimde ara..."
                                aria-label="Listelerimde ara"
                                className="pl-8 pr-8 h-9 text-sm bg-card/60"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    aria-label="Aramayı temizle"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>

                        <div className="inline-flex items-center rounded-lg border border-border/60 bg-card/60 p-0.5 text-xs">
                            {(
                                [
                                    { id: 'all', label: 'Tümü' },
                                    { id: 'public', label: 'Herkese Açık' },
                                    { id: 'private', label: 'Özel' },
                                ] as const
                            ).map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setVisibilityFilter(opt.id)}
                                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                                        visibilityFilter === opt.id
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as ReadingListSort)}>
                            <SelectTrigger className="w-[145px] h-9 text-sm bg-card/60" aria-label="Sıralama">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="newest">En Yeni</SelectItem>
                                <SelectItem value="count">En Çok Seri</SelectItem>
                                <SelectItem value="name">Ada Göre</SelectItem>
                            </SelectContent>
                        </Select>

                        {(searchQuery || visibilityFilter !== 'all' || sortBy !== 'newest') && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                                onClick={() => {
                                    setSearchQuery('');
                                    setVisibilityFilter('all');
                                    setSortBy('newest');
                                }}
                            >
                                <X className="h-3.5 w-3.5" />
                                Sıfırla
                            </Button>
                        )}
                    </div>
                )}

                {!isOnline && (
                    <OfflineNotice
                        compact
                        className="mb-5 text-left"
                        description="Listeler yerel önbellekten gösteriliyor. Çevrimdışıyken oluşturduğunuz, düzenlediğiniz veya sildiğiniz listeler bağlantı geri geldiğinde otomatik eşitlenir."
                    />
                )}

                {isLoading ? (
                    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-56 w-full rounded-xl" />
                        ))}
                    </div>
                ) : lists.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-center rounded-xl border border-border/60 bg-card/40">
                        <div className="mb-3 rounded-full bg-secondary p-4">
                            <List className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h2 className="text-lg font-semibold">Henüz listeniz yok</h2>
                        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                            Yeni bir liste oluşturarak favori serilerinizi organize etmeye başlayın.
                        </p>
                        <Button onClick={handleOpenCreateModal} size="sm" className="mt-5 gap-1.5">
                            <Plus className="h-4 w-4" />
                            İlk Listeni Oluştur
                        </Button>
                    </div>
                ) : filteredLists.length === 0 ? (
                    <div className="rounded-xl border border-border/60 bg-card/40 p-8 text-center space-y-2.5">
                        <p className="text-sm font-semibold">Filtreye uygun liste bulunamadı</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setSearchQuery('');
                                setVisibilityFilter('all');
                                setSortBy('newest');
                            }}
                        >
                            Filtreleri Sıfırla
                        </Button>
                    </div>
                ) : (
                    <VirtualCardGrid
                        items={filteredLists}
                        getItemKey={(list) => list.id}
                        gridClassName="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
                        getColumnCount={(width) => {
                            if (width >= 1024) return 3;
                            if (width >= 640) return 2;
                            return 1;
                        }}
                        gapPx={14}
                        estimatedItemHeight={240}
                        overscanRows={3}
                        minRowsBeforeVirtualize={4}
                        renderItem={(list, index) => {
                            const listCount = list.itemsCount ?? list.items?.length ?? 0;
                            return (
                                <article
                                    className="group relative animate-fade-up flex flex-col justify-between gap-2.5 rounded-xl border border-border/60 bg-card/70 p-3.5 transition-colors hover:border-primary/45 hover:bg-card/90 min-w-0"
                                    style={{
                                        animationDelay: `${0.05 + Math.min(index, 11) * 0.025}s`,
                                    }}
                                >
                                    {/* Top Meta + Actions */}
                                    <div className="flex items-center justify-between gap-2 min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                                            <Badge variant="secondary" className="h-5 gap-1 px-1.5 py-0 text-[10px] font-medium">
                                                {list.isPublic ? <Globe className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                                                {list.isPublic ? 'Herkese Açık' : 'Özel'}
                                            </Badge>
                                            <span className="opacity-60">·</span>
                                            <span className="tabular-nums font-medium text-foreground/80">{listCount} seri</span>
                                            <span className="opacity-60 hidden sm:inline">·</span>
                                            <span className="hidden sm:inline">{new Date(list.createdAt).toLocaleDateString('tr-TR')}</span>
                                        </div>

                                        <div className="flex items-center gap-0.5 shrink-0">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Listeyi düzenle"
                                                className="h-7 w-7 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                                onClick={() => handleEdit(list)}
                                            >
                                                <Edit2 className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Listeyi sil"
                                                className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => setDeleteConfirmId(list.id)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Title & Excerpt */}
                                    <Link to={`/reading-lists/${list.id}`} className="block space-y-0.5 min-w-0">
                                        <h3 className="truncate text-sm sm:text-base font-bold text-foreground group-hover:text-primary transition-colors">
                                            {list.name}
                                        </h3>
                                        <p className="line-clamp-1 text-xs text-muted-foreground min-h-[1rem]">
                                            {list.description || 'Açıklama belirtilmemiş.'}
                                        </p>
                                    </Link>

                                    {/* Comix-style 4-cover preview strip */}
                                    <Link to={`/reading-lists/${list.id}`} className="block">
                                        <ReadingListCover
                                            variant="strip"
                                            imageUrl={list.imageUrl}
                                            previewCovers={list.previewCovers}
                                            totalCount={listCount}
                                            alt={list.name}
                                            className={list.imageUrl ? 'aspect-[20/7] w-full rounded-lg' : undefined}
                                        />
                                    </Link>

                                    <div className="flex items-center justify-end pt-0.5">
                                        <Link
                                            to={`/reading-lists/${list.id}`}
                                            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                                        >
                                            <span>Tümünü gör</span>
                                            <ChevronRight className="h-3 w-3" />
                                        </Link>
                                    </div>
                                </article>
                            );
                        }}
                    />
                )}
            </main>

            <CreateReadingListModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                userId={user.id}
                onSuccess={handleCreateSuccess}
                editList={editingList}
            />

            <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Listeyi silmek istediğinize emin misiniz?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu işlem geri alınamaz. Liste ve içindeki tüm seriler listeden kaldırılacaktır (seriler silinmez).
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ReadingLists;
