import React, { useState, useEffect } from 'react';
import {
    Users,
    UserPen,
    Trash2,
    Plus,
    Search,
    Image as ImageIcon,
    ChevronRight,
    Loader2,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
    getCharacters,
    getAuthors,
    getArtists,
    saveCharacter,
    saveAuthor,
    saveArtist,
    deleteCharacter,
    deleteAuthor,
    deleteArtist
} from '@/lib/database';
import { Character, Author, Artist } from '@/lib/types';
import { toast } from 'sonner';

type EntityType = 'character' | 'author' | 'artist';

const AdminEntities: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<EntityType>('character');
    const [searchQuery, setSearchQuery] = useState('');

    // Data states
    const [characters, setCharacters] = useState<Character[]>([]);
    const [authors, setAuthors] = useState<Author[]>([]);
    const [artists, setArtists] = useState<Artist[]>([]);

    // Edit/Create state
    const [showDialog, setShowDialog] = useState(false);
    const [editingEntity, setEditingEntity] = useState<any | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        imageUrl: '',
        description: ''
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [chars, auths, arts] = await Promise.all([
                getCharacters(),
                getAuthors(),
                getArtists()
            ]);
            setCharacters(chars);
            setAuthors(auths as any);
            setArtists(arts as any);
        } catch (error) {
            toast.error('Veriler yüklenemedi');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenDialog = (entity?: any) => {
        if (entity) {
            setEditingEntity(entity);
            setFormData({
                name: entity.name,
                imageUrl: entity.imageUrl || '',
                description: entity.description || ''
            });
        } else {
            setEditingEntity(null);
            setFormData({ name: '', imageUrl: '', description: '' });
        }
        setShowDialog(true);
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast.error('İsim alanı boş bırakılamaz');
            return;
        }

        try {
            const payload = {
                ...editingEntity,
                ...formData
            };

            if (activeTab === 'character') {
                await saveCharacter(payload);
            } else if (activeTab === 'author') {
                await saveAuthor(payload);
            } else if (activeTab === 'artist') {
                await saveArtist(payload);
            }

            toast.success('Başarıyla kaydedildi');
            setShowDialog(false);
            loadData();
        } catch (error) {
            toast.error('Kaydedilirken hata oluştu');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Bu ögeyi silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) return;

        try {
            if (activeTab === 'character') {
                await deleteCharacter(id);
            } else if (activeTab === 'author') {
                await deleteAuthor(id);
            } else if (activeTab === 'artist') {
                await deleteArtist(id);
            }

            toast.success('Başarıyla silindi');
            loadData();
        } catch (error) {
            toast.error('Silinirken hata oluştu. Muhtemelen bir manga ile bağlantısı var.');
        }
    };

    const filteredData = () => {
        const query = searchQuery.toLowerCase();
        if (activeTab === 'character') {
            return characters.filter(c => c.name.toLowerCase().includes(query));
        } else if (activeTab === 'author') {
            return authors.filter(a => a.name.toLowerCase().includes(query));
        } else {
            return artists.filter(a => a.name.toLowerCase().includes(query));
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold sm:text-3xl">Karakter & Sanatçı Yönetimi</h1>
                    <p className="text-muted-foreground">Sitedeki tüm karakter, yazar ve çizerleri buradan yönetebilirsiniz.</p>
                </div>
                <Button onClick={() => handleOpenDialog()} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" />
                    Yeni {activeTab === 'character' ? 'Karakter' : activeTab === 'author' ? 'Yazar' : 'Çizer'}
                </Button>
            </div>

            <Card className="border-border/40 bg-card/60 backdrop-blur-sm">
                <CardHeader className="pb-3 text-white">
                    <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as EntityType)} className="w-full">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <TabsList className="h-auto flex-wrap justify-start gap-2 bg-background/50 border border-border">
                                <TabsTrigger value="character" className="gap-2">
                                    <Users className="h-4 w-4" /> Karakterler
                                </TabsTrigger>
                                <TabsTrigger value="author" className="gap-2">
                                    <UserPen className="h-4 w-4" /> Yazarlar
                                </TabsTrigger>
                                <TabsTrigger value="artist" className="gap-2">
                                    <UserPen className="h-4 w-4" /> Çizerler
                                </TabsTrigger>
                            </TabsList>
                            <div className="relative w-full lg:w-72">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Ara..."
                                    className="pl-9 bg-background/50"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        <CardContent className="px-0 pt-6">
                            {loading ? (
                                <div className="flex h-64 items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            ) : (
                                <div className="rounded-md border border-border">
                                    <div className="divide-y divide-border md:hidden">
                                        {filteredData().length > 0 ? (
                                            filteredData().map((item) => (
                                                <div key={item.id} className="space-y-4 p-4">
                                                    <div className="flex items-start gap-3">
                                                        <div className="h-12 w-12 overflow-hidden rounded-full border border-border bg-muted">
                                                            {item.imageUrl ? (
                                                                <img
                                                                    src={item.imageUrl}
                                                                    alt={item.name}
                                                                    className="h-full w-full object-cover"
                                                                    onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/40')}
                                                                />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center">
                                                                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1 space-y-1">
                                                            <p className="font-medium">{item.name}</p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {item.description || 'Açıklama yok'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <Button
                                                            variant="outline"
                                                            className="flex-1"
                                                            onClick={() => handleOpenDialog(item)}
                                                        >
                                                            <UserPen className="mr-2 h-4 w-4" />
                                                            Düzenle
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            className="flex-1 text-destructive hover:text-destructive"
                                                            onClick={() => handleDelete(item.id)}
                                                        >
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Sil
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="p-6 text-center text-muted-foreground">
                                                Sonuç bulunamadı
                                            </div>
                                        )}
                                    </div>

                                    <div className="hidden md:block">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="hover:bg-transparent border-border">
                                                <TableHead className="w-16">Resim</TableHead>
                                                <TableHead>İsim</TableHead>
                                                <TableHead className="hidden md:table-cell">Açıklama</TableHead>
                                                <TableHead className="text-right">İşlemler</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="text-white">
                                            {filteredData().length > 0 ? (
                                                filteredData().map((item) => (
                                                    <TableRow key={item.id} className="border-border hover:bg-white/5 transition-colors">
                                                        <TableCell>
                                                            <div className="h-10 w-10 overflow-hidden rounded-full border border-border bg-muted">
                                                                {item.imageUrl ? (
                                                                    <img
                                                                        src={item.imageUrl}
                                                                        alt={item.name}
                                                                        className="h-full w-full object-cover"
                                                                        onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/40')}
                                                                    />
                                                                ) : (
                                                                    <div className="flex h-full w-full items-center justify-center">
                                                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="font-medium">{item.name}</TableCell>
                                                        <TableCell className="hidden md:table-cell max-w-md">
                                                            <p className="truncate text-sm text-muted-foreground">
                                                                {item.description || 'Açıklama yok'}
                                                            </p>
                                                        </TableCell>
                                                        <TableCell className="text-right gap-2">
                                                            <div className="flex justify-end gap-2">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleOpenDialog(item)}
                                                                >
                                                                    <UserPen className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                                    onClick={() => handleDelete(item.id)}
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            ) : (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                                        Sonuç bulunamadı
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Tabs>
                </CardHeader>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-[525px]">
                    <DialogHeader>
                        <DialogTitle>
                            {editingEntity ? 'Düzenle' : 'Yeni Oluştur'}: {activeTab === 'character' ? 'Karakter' : activeTab === 'author' ? 'Yazar' : 'Çizer'}
                        </DialogTitle>
                        <DialogDescription>
                            Lütfen bilgileri eksiksiz doldurun. Değişiklikler sitede anında güncellenir.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">İsim *</label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Örn: Baek Woon-hwi"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Resim URL</label>
                            <Input
                                value={formData.imageUrl}
                                onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                                placeholder="https://..."
                            />
                            {formData.imageUrl && (
                                <div className="mt-2 flex justify-center">
                                    <div className="h-32 w-32 overflow-hidden rounded-full border border-border">
                                        <img
                                            src={formData.imageUrl}
                                            className="h-full w-full object-cover"
                                            onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/128')}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Açıklama</label>
                            <Textarea
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Hakkında bilgi yazın..."
                                className="min-h-[100px]"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDialog(false)}>İptal</Button>
                        <Button onClick={handleSave}>Kaydet</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminEntities;
