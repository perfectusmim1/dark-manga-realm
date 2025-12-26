import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, List, Lock, Globe, Check, Trash2 } from 'lucide-react';
import {
    getReadingLists,
    createReadingList,
    addMangaToReadingList,
    removeMangaFromReadingList,
    checkIfMangaInList
} from '@/lib/database';
import { ReadingList } from '@/lib/types';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface ReadingListModalProps {
    isOpen: boolean;
    onClose: () => void;
    mangaId: string;
    userId: string;
}

const ReadingListModal: React.FC<ReadingListModalProps> = ({ isOpen, onClose, mangaId, userId }) => {
    const [lists, setLists] = useState<ReadingList[]>([]);
    const [inLists, setInLists] = useState<Record<string, boolean>>({});
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // New list form
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [isPublic, setIsPublic] = useState(false);

    useEffect(() => {
        if (isOpen && userId) {
            loadLists();
        }
    }, [isOpen, userId, mangaId]);

    const loadLists = async () => {
        try {
            setIsLoading(true);
            const userLists = await getReadingLists(userId);
            setLists(userLists);

            // Check which lists contain this manga
            const inListStatus: Record<string, boolean> = {};
            await Promise.all(
                userLists.map(async (list) => {
                    inListStatus[list.id] = await checkIfMangaInList(list.id, mangaId);
                })
            );
            setInLists(inListStatus);
        } catch (err) {
            console.error('Liste yükleme hatası:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleMangaInList = async (listId: string) => {
        const isInList = inLists[listId];
        try {
            if (isInList) {
                await removeMangaFromReadingList(listId, mangaId);
                setInLists(prev => ({ ...prev, [listId]: false }));
                toast.success('Listeden kaldırıldı');
            } else {
                await addMangaToReadingList(listId, mangaId);
                setInLists(prev => ({ ...prev, [listId]: true }));
                toast.success('Listeye eklendi');
            }
        } catch (err) {
            toast.error('İşlem başarısız oldu');
        }
    };

    const handleCreateList = async () => {
        if (!newName.trim()) {
            toast.error('Lütfen bir liste adı girin');
            return;
        }

        try {
            const newList = await createReadingList({
                userId,
                name: newName,
                description: newDesc,
                isPublic
            });

            setLists(prev => [newList, ...prev]);
            setIsCreating(false);
            setNewName('');
            setNewDesc('');
            setIsPublic(false);

            // Automatically add manga to the new list
            await addMangaToReadingList(newList.id, mangaId);
            setInLists(prev => ({ ...prev, [newList.id]: true }));
            toast.success(`"${newList.name}" listesi oluşturuldu ve manga eklendi`);
        } catch (err) {
            toast.error('Liste oluşturulamadı');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <List className="h-5 w-5" />
                        Okuma Listelerim
                    </DialogTitle>
                    <DialogDescription>
                        Bu mangayı listelerinize ekleyin veya yeni bir liste oluşturun.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {!isCreating ? (
                        <>
                            <ScrollArea className="h-[300px] pr-4">
                                {isLoading ? (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                    </div>
                                ) : lists.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                                        <List className="mb-2 h-10 w-10 opacity-20" />
                                        <p>Henüz bir listeniz yok.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {lists.map((list) => (
                                            <button
                                                key={list.id}
                                                onClick={() => handleToggleMangaInList(list.id)}
                                                className={`flex w-full items-center justify-between rounded-lg border p-3 transition-colors ${inLists[list.id]
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-border hover:bg-secondary/50'
                                                    }`}
                                            >
                                                <div className="flex flex-col items-start text-left">
                                                    <span className="font-medium">{list.name}</span>
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        {list.isPublic ? (
                                                            <Globe className="h-3 w-3" />
                                                        ) : (
                                                            <Lock className="h-3 w-3" />
                                                        )}
                                                        {list.isPublic ? 'Herkese Açık' : 'Özel'}
                                                    </span>
                                                </div>
                                                {inLists[list.id] && (
                                                    <Check className="h-5 w-5 text-primary" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>

                            <Button
                                variant="outline"
                                className="mt-4 w-full gap-2"
                                onClick={() => setIsCreating(true)}
                            >
                                <Plus className="h-4 w-4" />
                                Yeni Liste Oluştur
                            </Button>
                        </>
                    ) : (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <div className="space-y-2">
                                <Label htmlFor="list-name">Liste Adı</Label>
                                <Input
                                    id="list-name"
                                    placeholder="Favorilerim, Okunacaklar vb."
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="list-desc">Açıklama (Opsiyonel)</Label>
                                <Textarea
                                    id="list-desc"
                                    placeholder="Bu liste hakkında kısa bir açıklama..."
                                    value={newDesc}
                                    onChange={(e) => setNewDesc(e.target.value)}
                                    className="resize-none"
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>Herkese Açık</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Bu listeyi herkes görebilir.
                                    </p>
                                </div>
                                <Switch
                                    checked={isPublic}
                                    onCheckedChange={setIsPublic}
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <Button
                                    variant="ghost"
                                    className="flex-1"
                                    onClick={() => setIsCreating(false)}
                                >
                                    İptal
                                </Button>
                                <Button className="flex-1" onClick={handleCreateList}>
                                    Oluştur ve Ekle
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {!isCreating && (
                    <DialogFooter>
                        <Button variant="ghost" className="w-full" onClick={onClose}>
                            Kapat
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default ReadingListModal;
