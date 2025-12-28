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
import { List, Lock, Globe } from 'lucide-react';
import { createReadingList, updateReadingList } from '@/lib/database';
import { ReadingList } from '@/lib/types';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface CreateReadingListModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    onSuccess: (list: ReadingList) => void;
    editList?: ReadingList | null;
}

const CreateReadingListModal: React.FC<CreateReadingListModalProps> = ({
    isOpen,
    onClose,
    userId,
    onSuccess,
    editList = null
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (editList) {
            setName(editList.name);
            setDescription(editList.description || '');
            setIsPublic(editList.isPublic);
        } else {
            setName('');
            setDescription('');
            setIsPublic(false);
        }
    }, [editList, isOpen]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            toast.error('Lütfen bir liste adı girin');
            return;
        }

        try {
            setIsSubmitting(true);
            if (editList) {
                await updateReadingList(editList.id, {
                    name,
                    description,
                    isPublic
                });
                onSuccess({
                    ...editList,
                    name,
                    description,
                    isPublic
                });
                toast.success('Liste güncellendi');
            } else {
                const newList = await createReadingList({
                    userId,
                    name,
                    description,
                    isPublic
                });
                onSuccess(newList);
                toast.success(`"${name}" listesi oluşturuldu`);
            }
            onClose();
        } catch (err) {
            toast.error(editList ? 'Liste güncellenemedi' : 'Liste oluşturulamadı');
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <List className="h-5 w-5" />
                        {editList ? 'Listeyi Düzenle' : 'Yeni Liste Oluştur'}
                    </DialogTitle>
                    <DialogDescription>
                        {editList
                            ? 'Listenizin bilgilerini buradan güncelleyebilirsiniz.'
                            : 'Manga koleksiyonlarınızı organize etmek için yeni bir liste oluşturun.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="list-name">Liste Adı</Label>
                        <Input
                            id="list-name"
                            placeholder="Favorilerim, Okunacaklar vb."
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="list-desc">Açıklama (Opsiyonel)</Label>
                        <Textarea
                            id="list-desc"
                            placeholder="Bu liste hakkında kısa bir açıklama..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="resize-none"
                            disabled={isSubmitting}
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
                            disabled={isSubmitting}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        İptal
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? 'Kaydediliyor...' : editList ? 'Güncelle' : 'Oluştur'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default CreateReadingListModal;
