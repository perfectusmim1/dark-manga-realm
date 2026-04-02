import React, { useState, useEffect, useCallback } from 'react';
import { 
    Megaphone, 
    Plus, 
    Trash2, 
    Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from '@/components/ui/dialog';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { getAnnouncements, createAnnouncement, deleteAnnouncement, Announcement } from '@/lib/announcements';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';

const AdminAnnouncements: React.FC = () => {
    const { user, isAllowed, isLoading: accessLoading } = useAdminPageGuard({ requiredRole: 'primary-admin' });
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [announcementToDelete, setAnnouncementToDelete] = useState<Announcement | null>(null);
    
    // Form state
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Bilinmeyen hata';

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const { announcements: data, error } = await getAnnouncements();
            if (error) throw error;
            setAnnouncements(data);
        } catch (err: unknown) {
            toast.error('Duyurular yüklenemedi: ' + getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (accessLoading || !user || !isAllowed) {
            return;
        }

        void loadData();
    }, [accessLoading, isAllowed, loadData, user]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !isAllowed) return;
        if (!title.trim() || !content.trim()) {
            toast.error('Lütfen tüm alanları doldurun');
            return;
        }

        setIsSubmitting(true);
        try {
            const { error } = await createAnnouncement(title, content);
            if (error) throw error;
            
            toast.success('Duyuru başarıyla yayınlandı');
            setTitle('');
            setContent('');
            setIsCreateOpen(false);
            loadData();
        } catch (err: unknown) {
            toast.error('Duyuru oluşturulamadı: ' + getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!user || !isAllowed) return;
        const targetAnnouncement = announcementToDelete;
        if (!targetAnnouncement) return;
        setAnnouncementToDelete(null);

        try {
            const { error } = await deleteAnnouncement(targetAnnouncement.id);
            if (error) throw error;
            toast.success('Duyuru silindi');
            loadData();
        } catch (err: unknown) {
            toast.error('Duyuru silinemedi: ' + getErrorMessage(err));
        }
    };

    if (accessLoading) {
        return null;
    }

    if (!user || !isAllowed) {
        return null;
    }

    return (
        <div className="space-y-6 lg:space-y-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3 sm:text-3xl">
                        <Megaphone className="h-8 w-8 text-primary" />
                        Duyuru Yönetimi
                    </h1>
                    <p className="text-muted-foreground">Tüm kullanıcılara gönderilecek genel duyuruları yönetin</p>
                </div>
                
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="w-full gap-2 sm:w-auto">
                            <Plus className="h-4 w-4" />
                            Yeni Duyuru
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>Yeni Duyuru Oluştur</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleCreate} className="space-y-4 py-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Başlık</label>
                                <Input 
                                    placeholder="Örn: Sitemiz Güncellendi!" 
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    maxLength={100}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">İçerik</label>
                                <Textarea 
                                    placeholder="Duyuru detaylarını buraya yazın..." 
                                    className="min-h-[150px]"
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                                    İptal
                                </Button>
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? 'Yayınlanıyor...' : 'Yayınla'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid gap-4">
                {isLoading ? (
                    <div className="py-12 text-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
                        <p className="mt-4 text-muted-foreground">Duyurular yükleniyor...</p>
                    </div>
                ) : announcements.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-12 text-center">
                        <Megaphone className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
                        <h3 className="text-lg font-medium">Henüz duyuru yok</h3>
                        <p className="text-muted-foreground">Yeni bir duyuru oluşturarak kullanıcılara bilgi verebilirsiniz.</p>
                    </div>
                ) : (
                    announcements.map((announcement) => (
                        <div 
                            key={announcement.id}
                            className="group relative rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md sm:p-6"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1 pr-8 sm:pr-12">
                                    <h3 className="text-lg font-bold">{announcement.title}</h3>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Calendar className="h-3 w-3" />
                                        {format(new Date(announcement.created_at), 'd MMMM yyyy HH:mm', { locale: tr })}
                                    </div>
                                    <div className="mt-4 text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                                        {announcement.content}
                                    </div>
                                </div>
                                
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="absolute top-3 right-3 text-destructive opacity-100 transition-opacity sm:top-4 sm:right-4 sm:opacity-0 sm:group-hover:opacity-100"
                                    onClick={() => setAnnouncementToDelete(announcement)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <ConfirmDialog
                open={Boolean(announcementToDelete)}
                onOpenChange={(open) => {
                    if (!open) {
                        setAnnouncementToDelete(null);
                    }
                }}
                title="Duyuru silinsin mi?"
                description={
                    announcementToDelete
                        ? `"${announcementToDelete.title}" başlıklı duyuru kalıcı olarak silinecek.`
                        : ''
                }
                confirmLabel="Duyuruyu Sil"
                cancelLabel="Vazgeç"
                onConfirm={() => {
                    void handleDelete();
                }}
                destructive
            />
        </div>
    );
};

export default AdminAnnouncements;
