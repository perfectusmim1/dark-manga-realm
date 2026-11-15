import React, { useState, useEffect, useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    List,
    Plus,
    Globe,
    Lock,
    Trash2,
    Edit2,
    ChevronRight,
    Search,
    Share2,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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

const dedupeListsById = (items: ReadingList[]): ReadingList[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
};

const ReadingLists: React.FC = () => {
    useDocumentTitle('Okuma Listelerim');
    const { user, isLoading: authLoading } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const { disableHeavyEffects } = useDeviceProfile();
    const [lists, setLists] = useState<ReadingList[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase('tr-TR'));
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingList, setEditingList] = useState<ReadingList | null>(null);

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

                setLists(dedupeListsById(userLists));
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
        if (!deferredSearchQuery) {
            return lists;
        }
        return lists.filter((list) => {
            const name = (list.name || '').toLocaleLowerCase('tr-TR');
            const description = (list.description || '').toLocaleLowerCase('tr-TR');
            return name.includes(deferredSearchQuery) || description.includes(deferredSearchQuery);
        });
    }, [deferredSearchQuery, lists]);

    if (authLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container pb-12 pt-16">
                    <div className="py-6 sm:py-8">
                        <Skeleton className="mb-2 h-8 w-56" />
                        <Skeleton className="h-4 w-24" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-64 w-full rounded-xl" />
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
            setLists(prev => dedupeListsById([newList, ...prev]));
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

    const handleShareList = async (list: ReadingList) => {
        const shareUrl = `${window.location.origin}/reading-lists/${list.id}`;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
                toast.success('Liste bağlantısı kopyalandı');
                return;
            }
            toast.error('Bağlantı kopyalanamadı');
        } catch {
            toast.error('Bağlantı kopyalanamadı');
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <div className="text-center">
                        <List className="mx-auto h-16 w-16 text-muted-foreground/50" />
                        <h1 className="mt-4 text-2xl font-bold">Okuma Listelerim</h1>
                        <p className="mt-2 text-muted-foreground">
                            Okuma listelerinizi görmek için giriş yapmalısınız
                        </p>
                        <Button asChild className="mt-4">
                            <Link to="/auth">Giriş Yap</Link>
                        </Button>
                    </div>
                </main>
            </div>
        );
    }

    const hasSearch = Boolean(searchQuery.trim());

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-16">
                <div
                    className={cn(
                        'flex flex-col gap-4 py-6 sm:flex-row sm:items-end sm:justify-between sm:py-8',
                        !disableHeavyEffects && 'animate-fade-up',
                    )}
                >
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Okuma Listelerim</h1>
                        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                            {hasSearch
                                ? `${filteredLists.length} / ${lists.length} liste`
                                : `${lists.length} liste`}
                        </p>
                    </div>

                    <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                        {lists.length > 0 && (
                            <div className="relative w-full sm:w-60">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Listelerde ara..."
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
                        )}

                        <Button onClick={handleOpenCreateModal} className="w-full shrink-0 gap-2 sm:w-auto">
                            <Plus className="h-4 w-4" />
                            Yeni Liste Oluştur
                        </Button>
                    </div>
                </div>

                {!isOnline && (
                    <OfflineNotice
                        compact
                        className="mb-6 text-left"
                        description="Listeler yerel önbellekten gösteriliyor. Çevrimdışıyken oluşturduğunuz, düzenlediğiniz veya sildiğiniz listeler bağlantı geri geldiğinde otomatik eşitlenir."
                    />
                )}

                {isLoading ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-64 w-full rounded-xl" />
                        ))}
                    </div>
                ) : filteredLists.length === 0 ? (
                    <div className="flex min-h-[38vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 px-6 py-14 text-center">
                        <div className="mb-4 rounded-full bg-secondary/70 p-5">
                            <List className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <h2 className="text-xl font-semibold">
                            {hasSearch ? 'Eşleşen liste bulunamadı' : 'Henüz listeniz yok'}
                        </h2>
                        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                            {hasSearch
                                ? 'Arama terimini değiştirip tekrar deneyebilirsiniz.'
                                : 'Yeni bir liste oluşturarak beğendiğiniz serileri bir araya toplayabilirsiniz.'}
                        </p>
                        {hasSearch ? (
                            <Button onClick={() => setSearchQuery('')} variant="outline" className="mt-5">
                                Aramayı Temizle
                            </Button>
                        ) : (
                            <Button onClick={handleOpenCreateModal} className="mt-5 gap-2">
                                <Plus className="h-4 w-4" />
                                İlk Listenizi Oluşturun
                            </Button>
                        )}
                    </div>
                ) : (
                    <VirtualCardGrid
                        items={filteredLists}
                        getItemKey={(list) => list.id}
                        gridClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                        getColumnCount={(width) => {
                            if (width >= 1024) return 3;
                            if (width >= 640) return 2;
                            return 1;
                        }}
                        gapPx={16}
                        estimatedItemHeight={272}
                        overscanRows={3}
                        minRowsBeforeVirtualize={4}
                        renderItem={(list, index) => (
                            <div
                                className={cn(
                                    'group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/75 transition-colors hover:border-primary/40 hover:bg-card',
                                    !disableHeavyEffects && 'animate-fade-up',
                                    index >= 12 && 'cv-auto-card',
                                )}
                                style={disableHeavyEffects ? undefined : {
                                    animationDelay: `${0.06 + Math.min(index, 11) * 0.03}s`,
                                }}
                            >
                                <Link
                                    to={`/reading-lists/${list.id}`}
                                    className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
                                >
                                    <ReadingListCover
                                        imageUrl={list.imageUrl}
                                        alt={list.name}
                                        className="h-40 w-full"
                                        iconClassName="h-10 w-10"
                                    />
                                </Link>

                                <div className="flex flex-1 flex-col p-4 sm:p-5">
                                    <div className="mb-3 flex items-start justify-between gap-2.5">
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <Link
                                                to={`/reading-lists/${list.id}`}
                                                className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                            >
                                                <h3 className="line-clamp-1 text-base font-bold transition-colors group-hover:text-primary sm:text-lg">
                                                    {list.name}
                                                </h3>
                                            </Link>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                                                    {list.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                                                    {list.isPublic ? 'Herkese Açık' : 'Özel'}
                                                </Badge>
                                                {list.createdAt && !Number.isNaN(new Date(list.createdAt).getTime()) && (
                                                    <span className="text-xs text-muted-foreground">
                                                        {new Date(list.createdAt).toLocaleDateString('tr-TR')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 items-center gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Listeyi düzenle"
                                                title="Düzenle"
                                                className="h-8 w-8 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                                onClick={() => handleEdit(list)}
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Listeyi sil"
                                                title="Sil"
                                                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => setDeleteConfirmId(list.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {list.description && (
                                        <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
                                            {list.description}
                                        </p>
                                    )}

                                    <div className="mt-auto flex items-center justify-between border-t border-border/50 pt-3">
                                        <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5 hover:text-primary">
                                            <Link to={`/reading-lists/${list.id}`}>
                                                İncele
                                                <ChevronRight className="h-4 w-4" />
                                            </Link>
                                        </Button>

                                        {list.isPublic && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Liste bağlantısını kopyala"
                                                title="Bağlantıyı kopyala"
                                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                onClick={() => void handleShareList(list)}
                                            >
                                                <Share2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
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
