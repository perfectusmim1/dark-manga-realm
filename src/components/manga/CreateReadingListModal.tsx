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
import { List, Image as ImageIcon } from 'lucide-react';
import { createReadingList, updateReadingList } from '@/lib/database';
import { ReadingList } from '@/lib/types';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import ReadingListCover from './ReadingListCover';

interface CreateReadingListModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    onSuccess: (list: ReadingList) => void;
    editList?: ReadingList | null;
}

const isValidImageUrl = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

const CreateReadingListModal: React.FC<CreateReadingListModalProps> = ({
    isOpen,
    onClose,
    userId,
    onSuccess,
    editList = null
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (editList) {
            setName(editList.name);
            setDescription(editList.description || '');
            setImageUrl(editList.imageUrl || '');
            setIsPublic(editList.isPublic);
        } else {
            setName('');
            setDescription('');
            setImageUrl('');
            setIsPublic(false);
        }
    }, [editList, isOpen]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            toast.error('Lütfen bir liste adı girin');
            return;
        }

        const normalizedImageUrl = imageUrl.trim();
        if (normalizedImageUrl && !isValidImageUrl(normalizedImageUrl)) {
            toast.error('Gorsel linki gecersiz. Lutfen tam bir http/https adresi girin');
            return;
        }

        try {
            setIsSubmitting(true);
            if (editList) {
                await updateReadingList(editList.id, {
                    name,
                    description,
                    imageUrl: normalizedImageUrl || undefined,
                    isPublic
                });
                onSuccess({
                    ...editList,
                    name,
                    description,
                    imageUrl: normalizedImageUrl || undefined,
                    isPublic
                });
                toast.success('Liste güncellendi');
            } else {
                const newList = await createReadingList({
                    userId,
                    name,
                    description,
                    imageUrl: normalizedImageUrl || undefined,
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
            <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-[425px] flex-col overflow-hidden p-0 sm:max-w-[425px]">
                <DialogHeader className="px-6 pt-6">
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

                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
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
                    <div className="space-y-2">
                        <Label htmlFor="list-image">Gorsel Linki (Opsiyonel)</Label>
                        <Input
                            id="list-image"
                            placeholder="https://..."
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                            disabled={isSubmitting}
                        />
                        <p className="text-xs text-muted-foreground">
                            Liste kapagi icin dogrudan bir gorsel baglantisi ekleyebilirsiniz.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <ImageIcon className="h-4 w-4 text-primary" />
                            Onizleme
                        </div>
                        {imageUrl.trim() && !isValidImageUrl(imageUrl.trim()) ? (
                            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                                Gecersiz gorsel baglantisi. Onizleme gosterilemiyor.
                            </div>
                        ) : (
                            <ReadingListCover
                                imageUrl={imageUrl.trim()}
                                alt={name || 'Okuma listesi kapagi'}
                                className="h-40 w-full rounded-xl border border-border"
                                iconClassName="h-8 w-8"
                                showLabel
                            />
                        )}
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

                <DialogFooter className="border-t border-border px-6 py-4">
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
