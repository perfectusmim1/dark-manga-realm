import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
    ChevronLeft,
    Trash2,
    Globe,
    Lock,
    Clock,
    BookOpen,
    Edit2,
    Heart,
    CheckSquare,
    Square,
    X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getReadingListById, removeMangaFromReadingList } from '@/lib/database';
import { ReadingList } from '@/lib/types';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import CreateReadingListModal from '@/components/manga/CreateReadingListModal';
import ReadingListCover from '@/components/manga/ReadingListCover';
import MangaCard from '@/components/manga/MangaCard';
import { cn } from '@/lib/utils';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import OfflineNotice from '@/components/offline/OfflineNotice';
import VirtualCardGrid from '@/components/performance/VirtualCardGrid';

const getSixColumnDesktopCount = (width: number) => {
    if (width >= 1024) return 6;
    if (width >= 768) return 5;
    if (width >= 640) return 4;
    if (width >= 430) return 3;
    return 2;
};

const ReadingListDetail: React.FC = () => {
    const { listId } = useParams<{ listId: string }>();
    const { user, isLoading: authLoading } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const navigate = useNavigate();
    const [list, setList] = useState<ReadingList | undefined>();
    const [isLoading, setIsLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedMangaIds, setSelectedMangaIds] = useState<string[]>([]);
    const [isRemovingSelected, setIsRemovingSelected] = useState(false);
    
    // Likes State
    const [likesCount, setLikesCount] = useState(0);
    const [isLiked, setIsLiked] = useState(false);
    const [isLiking, setIsLiking] = useState(false);

    useEffect(() => {
        if (!listId) return;

        let isCancelled = false;

        const fetchList = async () => {
            try {
                setIsLoading(true);
                const data = await getReadingListById(listId, user?.id);
                if (isCancelled) return;

                if (!data) {
                    if (isOnline) {
                        toast.error('Liste bulunamadı');
                        navigate('/reading-lists');
                    } else {
                        setList(undefined);
                    }
                    return;
                }
                setList(data);

                if (isOnline) {
                    const { count: totalLikes } = await supabase
                        .from('reading_list_likes')
                        .select('*', { count: 'exact', head: true })
                        .eq('list_id', listId);

                    if (isCancelled) return;
                    setLikesCount(totalLikes || 0);
                } else {
                    setLikesCount(0);
                }
            } catch (err) {
                if (isCancelled) return;

                console.error('Liste detay hatası:', err);
                toast.error('Liste yüklenemedi');
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        void fetchList();

        return () => {
            isCancelled = true;
        };
    }, [isOnline, listId, navigate, user?.id]);

    useEffect(() => {
        if (!listId || authLoading) {
            return;
        }

        let isCancelled = false;

        const fetchLikeState = async () => {
            if (!user?.id) {
                setIsLiked(false);
                return;
            }

            if (!isOnline) {
                setIsLiked(false);
                return;
            }

            try {
                const { data: likeData, error: likeError } = await supabase
                    .from('reading_list_likes')
                    .select('id')
                    .eq('list_id', listId)
                    .eq('user_id', user.id)
                    .limit(1);

                if (isCancelled) return;

                if (likeError) {
                    console.error('Reading list like fetch error:', likeError);
                    setIsLiked(false);
                    return;
                }

                setIsLiked((likeData?.length || 0) > 0);
            } catch (err) {
                if (!isCancelled) {
                    console.error('Reading list like state error:', err);
                    setIsLiked(false);
                }
            }
        };

        void fetchLikeState();

        return () => {
            isCancelled = true;
        };
    }, [authLoading, isOnline, listId, user?.id]);

    const handleToggleLike = async () => {
        if (!user) {
            toast.error('Listeyi beğenmek için giriş yapmalısınız');
            navigate('/auth');
            return;
        }
        if (!listId || isLiking) return;
        if (!isOnline) {
            toast.error('Liste beğenileri için internete bağlanın');
            return;
        }

        setIsLiking(true);
        try {
            if (isLiked) {
                await supabase
                    .from('reading_list_likes')
                    .delete()
                    .eq('list_id', listId)
                    .eq('user_id', user.id);
                setLikesCount(prev => Math.max(0, prev - 1));
                setIsLiked(false);
                toast.success('Beğenmekten vazgeçildi');
            } else {
                const { data: existingLikes, error: existingLikesError } = await supabase
                    .from('reading_list_likes')
                    .select('id')
                    .eq('list_id', listId)
                    .eq('user_id', user.id)
                    .limit(1);

                if (existingLikesError) {
                    throw existingLikesError;
                }

                if ((existingLikes?.length || 0) > 0) {
                    setIsLiked(true);
                    const { count } = await supabase
                        .from('reading_list_likes')
                        .select('*', { count: 'exact', head: true })
                        .eq('list_id', listId);
                    setLikesCount(count || 0);
                    return;
                }

                const { error: insertError } = await supabase
                    .from('reading_list_likes')
                    .insert([{ list_id: listId, user_id: user.id }]);

                if (insertError) {
                    throw insertError;
                }

                setLikesCount(prev => prev + 1);
                setIsLiked(true);
                toast.success('Liste beğenildi');
            }
        } catch (err) {
            console.error(err);
            toast.error('İşlem sırasında bir hata oluştu');
        } finally {
            setIsLiking(false);
        }
    };

    useEffect(() => {
        const availableIds = new Set((list?.items || []).map((item) => item.id));
        setSelectedMangaIds((current) => current.filter((id) => availableIds.has(id)));

        if ((list?.items?.length || 0) === 0) {
            setIsSelectionMode(false);
        }
    }, [list?.items]);

    const toggleSelectionMode = () => {
        setIsSelectionMode((current) => {
            if (current) {
                setSelectedMangaIds([]);
            }

            return !current;
        });
    };

    const toggleMangaSelection = (mangaId: string) => {
        setSelectedMangaIds((current) => (
            current.includes(mangaId)
                ? current.filter((id) => id !== mangaId)
                : [...current, mangaId]
        ));
    };

    const handleToggleSelectAll = () => {
        const itemIds = (list?.items || []).map((item) => item.id);

        setSelectedMangaIds((current) => (
            current.length === itemIds.length ? [] : itemIds
        ));
    };

    const handleRemoveSelected = async () => {
        if (!listId || !user || user.id !== list?.userId || selectedMangaIds.length === 0) {
            return;
        }

        try {
            setIsRemovingSelected(true);
            const idsToRemove = [...selectedMangaIds];
            await Promise.all(idsToRemove.map((mangaId) => removeMangaFromReadingList(listId, mangaId)));

            setList((previous) => previous ? {
                ...previous,
                items: previous.items?.filter((item) => !idsToRemove.includes(item.id)),
            } : undefined);

            setSelectedMangaIds([]);
            setIsSelectionMode(false);
            toast.success(
                isOnline
                    ? `${idsToRemove.length} seri listeden kaldırıldı`
                    : `${idsToRemove.length} seri kaldırıldı, tekrar çevrimiçi olduğunda eşitlenecek`
            );
        } catch (err) {
            console.error(err);
            toast.error('Seçilen seriler kaldırılamadı');
        } finally {
            setIsRemovingSelected(false);
        }
    };

    const handleEditSuccess = (updatedList: ReadingList) => {
        setList(prev => prev ? {
            ...prev,
            name: updatedList.name,
            description: updatedList.description,
            imageUrl: updatedList.imageUrl,
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
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-32 w-full" />)}
                    </div>
                </main>
            </div>
        );
    }

    if (!list) {
        return isOnline ? null : (
            <OfflineRequiredScreen
                description="Bu okuma listesi çevrimdışı önbellekte bulunamadı veya sadece internetle açılabilir."
                actionHref="/reading-lists"
                actionLabel="Okuma Listelerine Dön"
            />
        );
    }

    const isOwner = user?.id === list.userId;
    const listItems = list.items || [];
    const allItemsSelected = listItems.length > 0 && selectedMangaIds.length === listItems.length;

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <Link
                    to="/reading-lists"
                    className="mb-6 flex w-fit animate-fade-up items-center gap-2 text-sm text-muted-foreground opacity-0 transition-colors hover:text-foreground"
                    style={{ animationDelay: '40ms', animationFillMode: 'forwards' }}
                >
                    <ChevronLeft className="h-4 w-4" />
                    Listelerime Dön
                </Link>

                {!isOnline && (
                    <OfflineNotice
                        compact
                        className="mb-6 text-left"
                        description="Bu liste çevrimdışında yerel önbellekten açıldı. Yaptığınız seri kaldırma veya liste düzenleme işlemleri bağlantı geri geldiğinde otomatik eşitlenir."
                    />
                )}

                <div
                    className="mb-8 animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/50 opacity-0 backdrop-blur-sm"
                    style={{ animationDelay: '90ms', animationFillMode: 'forwards' }}
                >
                    <ReadingListCover
                        imageUrl={list.imageUrl}
                        alt={list.name}
                        className="h-56 w-full"
                        iconClassName="h-14 w-14"
                    />
                    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                        <div className="flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-3">
                                <h1 className="text-2xl font-bold sm:text-3xl">{list.name}</h1>
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
                            <p className="max-w-2xl text-muted-foreground">{list.description || 'Açıklama belirtilmemiş.'}</p>
                        </div>
                        
                        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-secondary/30 px-4 py-3 text-sm text-muted-foreground sm:w-auto sm:flex-nowrap sm:py-2">
                            <div className="flex cursor-pointer items-center gap-1 transition-colors hover:text-red-500" onClick={handleToggleLike}>
                                <Heart className={`h-4 w-4 ${isLiked ? 'fill-red-500 text-red-500' : ''}`} />
                                <span>{likesCount} Beğeni</span>
                            </div>
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

                {listItems.length > 0 ? (
                    <>
                        {isOwner && (
                            <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/40 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant={isSelectionMode ? 'default' : 'outline'}
                                        size="sm"
                                        className="gap-2"
                                        onClick={toggleSelectionMode}
                                    >
                                        <CheckSquare className="h-4 w-4" />
                                        {isSelectionMode ? 'Seçim Modunu Kapat' : 'Seri Seç'}
                                    </Button>

                                    {isSelectionMode && (
                                        <>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleToggleSelectAll}
                                            >
                                                {allItemsSelected ? 'Seçimi Temizle' : 'Tümünü Seç'}
                                            </Button>
                                            <Badge variant="secondary">
                                                {selectedMangaIds.length} seçili
                                            </Badge>
                                        </>
                                    )}
                                </div>

                                {isSelectionMode && (
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="gap-2"
                                            onClick={toggleSelectionMode}
                                        >
                                            <X className="h-4 w-4" />
                                            İptal
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            className="gap-2"
                                            onClick={handleRemoveSelected}
                                            disabled={selectedMangaIds.length === 0 || isRemovingSelected}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            {isRemovingSelected ? 'Kaldırılıyor...' : `Seçilenleri Kaldır${selectedMangaIds.length > 0 ? ` (${selectedMangaIds.length})` : ''}`}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        <VirtualCardGrid
                            items={listItems}
                            getItemKey={(manga) => manga.id}
                            gridClassName="grid gap-3"
                            getColumnCount={getSixColumnDesktopCount}
                            gapPx={12}
                            estimatedItemHeight={320}
                            overscanRows={4}
                            minRowsBeforeVirtualize={5}
                            renderItem={(manga, index) => {
                                const isSelected = selectedMangaIds.includes(manga.id);

                                return (
                                    <div
                                        className="relative w-full"
                                    >
                                        <div className={cn(isSelectionMode && 'pointer-events-none')}>
                                            <MangaCard manga={manga} index={index} />
                                        </div>

                                        {isSelectionMode && (
                                            <button
                                                type="button"
                                                onClick={() => toggleMangaSelection(manga.id)}
                                                className={cn(
                                                    'absolute inset-0 z-20 rounded-xl border-2 transition-all',
                                                    isSelected
                                                        ? 'border-primary bg-primary/15 shadow-[0_0_0_1px_rgba(59,130,246,0.4)]'
                                                        : 'border-border/70 bg-background/5 hover:bg-background/10'
                                                )}
                                                aria-pressed={isSelected}
                                                aria-label={`${manga.title} seç`}
                                            >
                                                <div className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white backdrop-blur-md">
                                                    {isSelected ? (
                                                        <CheckSquare className="h-4 w-4 text-primary" />
                                                    ) : (
                                                        <Square className="h-4 w-4 text-white/80" />
                                                    )}
                                                </div>
                                            </button>
                                        )}
                                    </div>
                                );
                            }}
                        />
                    </>
                ) : (
                    <div
                        className="flex animate-fade-up flex-col items-center justify-center py-20 text-center opacity-0"
                        style={{ animationDelay: '140ms', animationFillMode: 'forwards' }}
                    >
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
