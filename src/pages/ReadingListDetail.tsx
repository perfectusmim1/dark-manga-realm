import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
    List,
    ChevronLeft,
    Trash2,
    Globe,
    Lock,
    Clock,
    BookOpen,
    Edit2,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getReadingListById, removeMangaFromReadingList } from '@/lib/database';
import { ReadingList, Manga } from '@/lib/types';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import CreateReadingListModal from '@/components/manga/CreateReadingListModal';

const ReadingListDetail: React.FC = () => {
    const { listId } = useParams<{ listId: string }>();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [list, setList] = useState<ReadingList | undefined>();
    const [isLoading, setIsLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    useEffect(() => {
        if (listId) {
            fetchList();
        }
    }, [listId]);

    const fetchList = async () => {
        if (!listId) return;
        try {
            setIsLoading(true);
            const data = await getReadingListById(listId);
            if (!data) {
                toast.error('Liste bulunamadı');
                navigate('/reading-lists');
                return;
            }
            setList(data);
        } catch (err) {
            console.error('Liste detay hatası:', err);
            toast.error('Liste yüklenemedi');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveManga = async (mangaId: string) => {
        if (!listId || !user || user.id !== list?.userId) return;
        try {
            await removeMangaFromReadingList(listId, mangaId);
            setList(prev => prev ? {
                ...prev,
                items: prev.items?.filter(m => m.id !== mangaId)
            } : undefined);
            toast.success('Manga listeden kaldırıldı');
        } catch (err) {
            toast.error('Manga kaldırılamadı');
        }
    };

    const handleEditSuccess = (updatedList: ReadingList) => {
        setList(prev => prev ? {
            ...prev,
            name: updatedList.name,
            description: updatedList.description,
            isPublic: updatedList.isPublic
        } : undefined);
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container pt-20">
                    <Skeleton className="h-8 w-48 mb-4" />
                    <Skeleton className="h-4 w-96 mb-8" />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
                    </div>
                </main>
            </div>
        );
    }

    if (!list) return null;

    const isOwner = user?.id === list.userId;

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <Link
                    to="/reading-lists"
                    className="mb-6 flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Listelerime Dön
                </Link>

                <div className="mb-8 p-6 rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex-1">
                            <div className="flex items-center flex-wrap gap-3 mb-2">
                                <h1 className="text-3xl font-bold">{list.name}</h1>
                                <Badge variant="secondary" className="gap-1">
                                    {list.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                                    {list.isPublic ? 'Herkese Açık' : 'Özel'}
                                </Badge>
                                {isOwner && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-full"
                                        onClick={() => setIsEditModalOpen(true)}
                                    >
                                        <Edit2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                            <p className="text-muted-foreground max-w-2xl">{list.description || 'Açıklama belirtilmemiş.'}</p>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-muted-foreground bg-secondary/30 px-4 py-2 rounded-lg">
                            <div className="flex items-center gap-1">
                                <BookOpen className="h-4 w-4" />
                                <span>{list.items?.length || 0} Seri</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                <span>{new Date(list.createdAt).toLocaleDateString('tr-TR')}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <CreateReadingListModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    userId={user?.id || ''}
                    onSuccess={handleEditSuccess}
                    editList={list}
                />

                {list.items && list.items.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {list.items.map((manga) => (
                            <div
                                key={manga.id}
                                className="group flex gap-4 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-lg"
                            >
                                <Link to={`/manga/${manga.id}`} className="shrink-0">
                                    <img
                                        src={manga.cover}
                                        alt={manga.title}
                                        className="h-24 w-16 rounded-lg object-cover shadow-sm"
                                    />
                                </Link>

                                <div className="flex flex-1 flex-col justify-center min-w-0">
                                    <Link to={`/manga/${manga.id}`}>
                                        <h3 className="line-clamp-1 font-semibold hover:text-primary transition-colors">
                                            {manga.title}
                                        </h3>
                                    </Link>
                                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                        {manga.author}
                                    </p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 uppercase">
                                            {manga.type}
                                        </Badge>
                                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                                            {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam Ediyor' : 'Ara Verildi'}
                                        </Badge>
                                    </div>
                                </div>

                                {isOwner && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 self-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => handleRemoveManga(manga.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
                        <p className="text-muted-foreground">Bu liste henüz boş.</p>
                        <Button asChild variant="outline" className="mt-4">
                            <Link to="/browse">Manga Ekle</Link>
                        </Button>
                    </div>
                )}
            </main>
        </div>
    );
};

export default ReadingListDetail;
