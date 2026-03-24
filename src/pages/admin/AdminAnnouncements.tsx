import React, { useState, useEffect } from 'react';
import { 
    Megaphone, 
    Plus, 
    Trash2, 
    Calendar,
    Search,
    AlertCircle
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
import { toast } from 'sonner';
import { getAnnouncements, createAnnouncement, deleteAnnouncement, Announcement } from '@/lib/announcements';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

const AdminAnnouncements: React.FC = () => {
    const { user } = useAuth();
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    
    // Form state
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const { announcements: data, error } = await getAnnouncements();
            if (error) throw error;
            setAnnouncements(data);
        } catch (err: any) {
            toast.error('Duyurular yüklenemedi: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
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
        } catch (err: any) {
            toast.error('Duyuru oluşturulamadı: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Bu duyuruyu silmek istediğinize emin misiniz?')) return;

        try {
            const { error } = await deleteAnnouncement(id);
            if (error) throw error;
            toast.success('Duyuru silindi');
            loadData();
        } catch (err: any) {
            toast.error('Duyuru silinemedi: ' + err.message);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <Megaphone className="h-8 w-8 text-primary" />
                        Duyuru Yönetimi
                    </h1>
                    <p className="text-muted-foreground">Tüm kullanıcılara gönderilecek genel duyuruları yönetin</p>
                </div>
                
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" />
                            Yeni Duyuru
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
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
                            className="group relative rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-md"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1 pr-12">
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
                                    className="absolute top-4 right-4 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleDelete(announcement.id)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default AdminAnnouncements;
