import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    List,
    Plus,
    Globe,
    Lock,
    Trash2,
    Edit2,
    ExternalLink,
    BookOpen,
    ChevronRight,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getReadingLists, deleteReadingList, getReadingListById } from '@/lib/database';
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

const ReadingLists: React.FC = () => {
    const { user, isLoading: authLoading } = useAuth();
    const [lists, setLists] = useState<ReadingList[]>([]);
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
    }, [authLoading, user?.id]);

    if (authLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container pb-12 pt-20">
                    <div className="mb-8">
                        <Skeleton className="h-10 w-56 mb-3" />
                        <Skeleton className="h-5 w-80" />
                    </div>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-xl" />
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
            toast.success('Liste silindi');
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

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div>
                        <h1 className="text-3xl font-bold">Okuma Listelerim</h1>
                        <p className="text-muted-foreground">Oluşturduğunuz tüm manga koleksiyonları</p>
                    </div>
                    <Button onClick={handleOpenCreateModal} className="gap-2 self-start sm:self-auto">
                        <Plus className="h-4 w-4" />
                        Yeni Liste Oluştur
                    </Button>
                </div>

                {isLoading ? (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-xl" />
                        ))}
                    </div>
                ) : lists.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="mb-4 rounded-full bg-secondary p-6">
                            <List className="h-12 w-12 text-muted-foreground" />
                        </div>
                        <h2 className="text-xl font-semibold">Henüz listeniz yok</h2>
                        <p className="mt-2 max-w-xs text-muted-foreground">
                            Yeni bir liste oluşturarak favori mangalarınızı organize etmeye başlayın.
                        </p>
                        <Button onClick={handleOpenCreateModal} className="mt-6 gap-2">
                            <Plus className="h-4 w-4" />
                            İlk Listeni Oluştur
                        </Button>
                    </div>
                ) : (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {lists.map((list, index) => (
                            <div
                                key={list.id}
                                className="group relative animate-fade-up overflow-hidden rounded-xl border border-border bg-card opacity-0 transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5"
                                style={{ animationDelay: `${0.08 + Math.min(index, 10) * 0.03}s`, animationFillMode: 'forwards' }}
                            >
                                <ReadingListCover
                                    imageUrl={list.imageUrl}
                                    alt={list.name}
                                    className="h-40 w-full"
                                    iconClassName="h-10 w-10"
                                />

                                <div className="p-6">
                                    <div className="mb-4 flex items-start justify-between">
                                        <div className="flex flex-col gap-1">
                                            <h3 className="line-clamp-1 text-xl font-bold">{list.name}</h3>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                                                    {list.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                                                    {list.isPublic ? 'Herkese Açık' : 'Özel'}
                                                </Badge>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(list.createdAt).toLocaleDateString('tr-TR')}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                                onClick={() => handleEdit(list)}
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => setDeleteConfirmId(list.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    <p className="mb-6 min-h-[40px] line-clamp-2 text-sm text-muted-foreground">
                                        {list.description || 'Açıklama belirtilmemiş.'}
                                    </p>

                                    <div className="flex items-center justify-between border-t border-border/50 pt-4">
                                        <Button asChild variant="ghost" size="sm" className="gap-2 hover:text-primary">
                                            <Link to={`/reading-lists/${list.id}`}>
                                                İncele <ChevronRight className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
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
