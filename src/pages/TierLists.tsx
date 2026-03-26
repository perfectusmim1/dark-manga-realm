import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Book, Trash2, Edit2, Globe, Lock, ChevronRight } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
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
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

const TierLists: React.FC = () => {
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const navigate = useNavigate();
    const [lists, setLists] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    if (user && !isOnline) {
        return (
            <OfflineRequiredScreen
                description="Tier listelerine erişmek için internete bağlanın."
                actionHref="/downloads"
                actionLabel="İndirilenlere Git"
            />
        );
    }

    useEffect(() => {
        if (user) {
            fetchTierLists();
        }
    }, [user]);

    const fetchTierLists = async () => {
        try {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('tier_lists')
                .select('*')
                .eq('user_id', user?.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLists(data || []);
        } catch (err) {
            console.error('Tier Lists loading error:', err);
            toast.error('Tier listeleri yüklenemedi');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirmId) return;
        try {
            const { error } = await supabase.from('tier_lists').delete().eq('id', deleteConfirmId);
            if (error) throw error;
            setLists(prev => prev.filter(l => l.id !== deleteConfirmId));
            toast.success('Tier listesi başarıyla silindi.');
        } catch (err) {
            toast.error('Tier listesi silinemedi.');
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
                        <Book className="mx-auto h-16 w-16 text-muted-foreground/50" />
                        <h1 className="mt-4 text-2xl font-bold">Tier Listelerim</h1>
                        <p className="mt-2 text-muted-foreground">İçerikleri listelemek ve görebilmek için giriş yapmalısınız.</p>
                        <Button asChild className="mt-4">
                            <Link to="/auth">Giriş Yap</Link>
                        </Button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Header />

            <main className="container pb-12 pt-24 max-w-5xl">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-3">
                           <Book className="w-8 h-8 text-yellow-500" /> Tier Listelerim
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Özelleştirilmiş karakter ve seri sıralamalarınız! Favorilerini S veya F sınıfına koy.
                        </p>
                    </div>

                    <Button onClick={() => navigate('/tier-lists/create')} className="gap-2">
                        <Plus className="h-4 w-4" /> Yeni Sıralama Oluştur
                    </Button>
                </div>

                {isLoading ? (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-xl" />
                        ))}
                    </div>
                ) : lists.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center border border-border border-dashed rounded-xl bg-card/20">
                        <div className="p-4 bg-primary/10 text-primary rounded-full mb-4">
                            <Book className="w-8 h-8" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Henüz Tier Listeniz Yok</h2>
                        <p className="text-muted-foreground max-w-sm">
                            Hemen yeni bir liste oluşturup mangaları veya karakterleri birbirleriyle derecelendirerek yarıştırın.
                        </p>
                        <Button onClick={() => navigate('/tier-lists/create')} className="mt-6 gap-2">
                            <Plus className="w-4 h-4" /> İlk Listeni Yap
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {lists.map((list, index) => (
                            <div
                                key={list.id}
                                className="group animate-fade-up relative overflow-hidden rounded-xl border border-border bg-card p-6 opacity-0 transition-all hover:border-primary/50"
                                style={{ animationDelay: `${0.08 + Math.min(index, 10) * 0.03}s`, animationFillMode: 'forwards' }}
                            >
                                <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => navigate(`/tier-lists/${list.id}/edit`)}>
                                        <Edit2 className="w-4 h-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteConfirmId(list.id)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>

                                <div className="pr-12">
                                    <h3 className="font-bold text-xl line-clamp-1 group-hover:text-primary transition-colors">{list.title}</h3>
                                    <div className="flex items-center gap-2 mt-2">
                                        <Badge variant="outline" className="text-[10px] bg-background px-1.5 py-0">
                                           {list.is_public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1 text-red-500" />} {list.is_public ? 'Herkese Açık' : 'Yalnızca Ben'}
                                        </Badge>
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize border-primary/20 text-primary">
                                            {list.type === 'character' ? 'Karakter Sıralaması' : 'Manga Sıralaması'}
                                        </Badge>
                                    </div>
                                </div>

                                <div className="mt-8 pt-4 border-t border-border/50 flex justify-between items-center text-sm text-muted-foreground">
                                    <span>{new Date(list.created_at).toLocaleDateString('tr-TR')}</span>
                                    <Button asChild variant="ghost" size="sm" className="gap-1 px-2 text-primary hover:text-primary hover:bg-primary/10">
                                        <Link to={`/tier-lists/${list.id}`}>Görüntüle <ChevronRight className="w-3 h-3" /></Link>
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Tier Listesini silmek istediğinize emin misiniz?</AlertDialogTitle>
                        <AlertDialogDescription>Bu işlem geri alınamaz. Liste kalıcı olarak silinecektir.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Sil</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default TierLists;
