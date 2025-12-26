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

const ReadingLists: React.FC = () => {
    const { user } = useAuth();
    const [lists, setLists] = useState<ReadingList[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    useEffect(() => {
        if (user) {
            fetchLists();
        }
    }, [user]);

    const fetchLists = async () => {
        if (!user) return;
        try {
            setIsLoading(true);
            const userLists = await getReadingLists(user.id);
            setLists(userLists);
        } catch (err) {
            console.error('Liste yükleme hatası:', err);
            toast.error('Listeler yüklenemedi');
        } finally {
            setIsLoading(false);
        }
    };

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
                            Manga detay sayfalarından "Listeye Ekle" butonuna basarak ilk listenizi oluşturabilirsiniz.
                        </p>
                        <Button asChild className="mt-6">
                            <Link to="/browse">Manga Keşfet</Link>
                        </Button>
                    </div>
                ) : (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {lists.map((list) => (
                            <div
                                key={list.id}
                                className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5"
                            >
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
                                </div>

                                <p className="mb-6 line-clamp-2 text-sm text-muted-foreground min-h-[40px]">
                                    {list.description || 'Açıklama belirtilmemiş.'}
                                </p>

                                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                                    <Button asChild variant="ghost" size="sm" className="gap-2 hover:text-primary">
                                        <Link to={`/reading-lists/${list.id}`}>
                                            İncele <ChevronRight className="h-4 w-4" />
                                        </Link>
                                    </Button>

                                    <div className="flex items-center gap-1">
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
                            </div>
                        ))}
                    </div>
                )}
            </main>

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
