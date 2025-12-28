import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Save,
    ArrowLeft,
    Plus,
    Trash2,
    Upload,
    Image as ImageIcon,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { getMangaById, saveManga, addChapterToManga, deleteChapter } from '@/lib/database';
import { Manga, Chapter } from '@/lib/types';
import { allGenres } from '@/lib/mockData';
import { createNotificationForFollowers } from '@/lib/storage';
import { toast } from 'sonner';

const AdminMangaEditor: React.FC = () => {
    const navigate = useNavigate();
    const { mangaId } = useParams<{ mangaId: string }>();
    const isEditing = mangaId && mangaId !== 'new';

    const [manga, setManga] = useState<Partial<Manga>>({
        title: '',
        alternativeTitles: [],
        cover: '',
        banner: '',
        author: '',
        artist: '',
        status: 'ongoing',
        type: 'manga',
        genres: [],
        description: '',
        ratings: [],
        views: 0,
        chapters: [],
        releaseYear: new Date().getFullYear(),
    });

    const [altTitleInput, setAltTitleInput] = useState('');
    const [showChapterDialog, setShowChapterDialog] = useState(false);
    const [newChapter, setNewChapter] = useState({
        number: 1,
        title: '',
        pages: [] as string[],
    });
    const [pageUrlInput, setPageUrlInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [editingChapterId, setEditingChapterId] = useState<string | null>(null);

    useEffect(() => {
        const loadManga = async () => {
            if (isEditing) {
                try {
                    setLoading(true);
                    const existingManga = await getMangaById(mangaId);
                    if (existingManga) {
                        setManga(existingManga);
                        setNewChapter(prev => ({
                            ...prev,
                            number: existingManga.chapters.length + 1,
                        }));
                    } else {
                        toast.error('Manga bulunamadı');
                        navigate('/admin/mangas');
                    }
                } catch (err) {
                    toast.error('Veri yüklenemedi');
                } finally {
                    setLoading(false);
                }
            }
        };
        loadManga();
    }, [mangaId, isEditing, navigate]);

    const handleChange = (field: keyof Manga, value: any) => {
        setManga(prev => ({ ...prev, [field]: value }));
    };

    const addAlternativeTitle = () => {
        if (altTitleInput.trim()) {
            handleChange('alternativeTitles', [...(manga.alternativeTitles || []), altTitleInput.trim()]);
            setAltTitleInput('');
        }
    };

    const removeAlternativeTitle = (index: number) => {
        handleChange('alternativeTitles', (manga.alternativeTitles || []).filter((_, i) => i !== index));
    };

    const toggleGenre = (genre: string) => {
        const genres = manga.genres || [];
        if (genres.includes(genre)) {
            handleChange('genres', genres.filter(g => g !== genre));
        } else {
            handleChange('genres', [...genres, genre]);
        }
    };

    const addPageUrl = () => {
        if (pageUrlInput.trim()) {
            setNewChapter(prev => ({
                ...prev,
                pages: [...prev.pages, pageUrlInput.trim()],
            }));
            setPageUrlInput('');
        }
    };

    const removePageUrl = (index: number) => {
        setNewChapter(prev => ({
            ...prev,
            pages: prev.pages.filter((_, i) => i !== index),
        }));
    };

    const handleSaveChapter = async () => {
        if (!newChapter.title.trim()) {
            toast.error('Bölüm başlığı gerekli');
            return;
        }
        if (newChapter.pages.length === 0) {
            toast.error('En az bir sayfa ekleyin');
            return;
        }

        const chapter: Chapter = {
            id: editingChapterId || `chapter-${Date.now()}`,
            number: newChapter.number,
            title: newChapter.title,
            pages: newChapter.pages,
            releaseDate: new Date().toISOString(),
            views: 0,
        };

        if (isEditing && manga.id) {
            setLoading(true);
            try {
                // If it's a new chapter, we use the specific add function
                // If it's editing, we use saveManga to sync everything
                if (!editingChapterId) {
                    await addChapterToManga(manga.id, chapter);
                } else {
                    const updatedChapters = (manga.chapters || []).map(c =>
                        c.id === editingChapterId ? chapter : c
                    );
                    const updatedManga = { ...manga, chapters: updatedChapters } as Manga;
                    await saveManga(updatedManga);
                }

                const refreshedManga = await getMangaById(manga.id);
                if (refreshedManga) {
                    setManga(refreshedManga);
                    if (!editingChapterId) {
                        // Only notify for NEW chapters
                        createNotificationForFollowers(
                            manga.id,
                            refreshedManga.title,
                            refreshedManga.cover,
                            chapter.id,
                            chapter.number
                        );
                    }
                }
                toast.success(editingChapterId ? 'Bölüm güncellendi' : 'Bölüm eklendi');
            } catch (err) {
                toast.error('Bölüm kaydedilemedi');
            } finally {
                setLoading(false);
            }
        } else {
            if (editingChapterId) {
                handleChange('chapters', (manga.chapters || []).map(c => c.id === editingChapterId ? chapter : c));
            } else {
                handleChange('chapters', [...(manga.chapters || []), chapter]);
            }
            toast.success('Bölüm listeye eklendi');
        }

        setNewChapter({
            number: (manga.chapters?.length || 0) + 2,
            title: '',
            pages: [],
        });
        setEditingChapterId(null);
        setShowChapterDialog(false);
    };

    const openEditChapterDialog = (chapter: Chapter) => {
        setNewChapter({
            number: chapter.number,
            title: chapter.title,
            pages: chapter.pages,
        });
        setEditingChapterId(chapter.id);
        setShowChapterDialog(true);
    };

    const handleDeleteChapter = async (chapterId: string) => {
        if (isEditing && manga.id) {
            setLoading(true);
            try {
                await deleteChapter(manga.id, chapterId);
                const updatedManga = await getMangaById(manga.id);
                if (updatedManga) {
                    setManga(updatedManga);
                }
                toast.success('Bölüm silindi');
            } catch (err) {
                toast.error('Bölüm silinemedi');
            } finally {
                setLoading(false);
            }
        } else {
            handleChange('chapters', (manga.chapters || []).filter(c => c.id !== chapterId));
            toast.success('Bölüm silindi');
        }
    };

    const handleSave = async () => {
        if (!manga.title?.trim()) {
            toast.error('Manga başlığı gerekli');
            return;
        }
        if (!manga.cover?.trim()) {
            toast.error('Kapak resmi URL\'si gerekli');
            return;
        }
        if (!manga.author?.trim()) {
            toast.error('Yazar adı gerekli');
            return;
        }

        setLoading(true);

        try {
            const mangaToSave: Manga = {
                id: manga.id || `manga-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                title: manga.title!,
                alternativeTitles: manga.alternativeTitles || [],
                cover: manga.cover!,
                banner: manga.banner || manga.cover!,
                author: manga.author!,
                artist: manga.artist || manga.author!,
                status: manga.status as 'ongoing' | 'completed' | 'hiatus',
                type: manga.type as 'manga' | 'manhwa' | 'manhua',
                genres: manga.genres || [],
                description: manga.description || '',
                ratings: manga.ratings || [],
                views: manga.views || 0,
                chapters: manga.chapters || [],
                lastUpdated: new Date().toISOString(),
                createdAt: manga.createdAt || new Date().toISOString(),
                releaseYear: manga.releaseYear,
            };

            await saveManga(mangaToSave);
            toast.success(isEditing ? 'Manga güncellendi' : 'Manga oluşturuldu');
            navigate('/admin/mangas');
        } catch (err) {
            toast.error('Kaydedilirken bir hata oluştu');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate('/admin/mangas')}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">
                        {isEditing ? 'Manga Düzenle' : 'Yeni Manga Ekle'}
                    </h1>
                    <p className="text-muted-foreground">
                        {isEditing ? 'Manga bilgilerini güncelleyin' : 'Yeni bir manga ekleyin'}
                    </p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Main Info */}
                <div className="space-y-6 lg:col-span-2">
                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <h2 className="text-lg font-semibold">Temel Bilgiler</h2>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Başlık *</label>
                            <Input
                                value={manga.title || ''}
                                onChange={(e) => handleChange('title', e.target.value)}
                                placeholder="Manga başlığı"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Alternatif Başlıklar</label>
                            <div className="flex gap-2">
                                <Input
                                    value={altTitleInput}
                                    onChange={(e) => setAltTitleInput(e.target.value)}
                                    placeholder="Alternatif başlık ekle"
                                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAlternativeTitle())}
                                />
                                <Button type="button" onClick={addAlternativeTitle}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                            {(manga.alternativeTitles?.length || 0) > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {manga.alternativeTitles?.map((title, i) => (
                                        <Badge key={i} variant="secondary" className="gap-1">
                                            {title}
                                            <button onClick={() => removeAlternativeTitle(i)}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Yazar *</label>
                                <Input
                                    value={manga.author || ''}
                                    onChange={(e) => handleChange('author', e.target.value)}
                                    placeholder="Yazar adı"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Çizer</label>
                                <Input
                                    value={manga.artist || ''}
                                    onChange={(e) => handleChange('artist', e.target.value)}
                                    placeholder="Çizer adı"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Açıklama</label>
                            <Textarea
                                value={manga.description || ''}
                                onChange={(e) => handleChange('description', e.target.value)}
                                placeholder="Manga açıklaması..."
                                className="min-h-[120px]"
                            />
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Tür</label>
                                <Select
                                    value={manga.type}
                                    onValueChange={(value) => handleChange('type', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="manga">Manga</SelectItem>
                                        <SelectItem value="manhwa">Manhwa</SelectItem>
                                        <SelectItem value="manhua">Manhua</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Durum</label>
                                <Select
                                    value={manga.status}
                                    onValueChange={(value) => handleChange('status', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ongoing">Devam Ediyor</SelectItem>
                                        <SelectItem value="completed">Tamamlandı</SelectItem>
                                        <SelectItem value="hiatus">Ara Verildi</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Yayın Yılı</label>
                                <Input
                                    type="number"
                                    value={manga.releaseYear || ''}
                                    onChange={(e) => handleChange('releaseYear', parseInt(e.target.value))}
                                    min={1900}
                                    max={new Date().getFullYear() + 1}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Türler</label>
                            <div className="flex flex-wrap gap-2">
                                {allGenres.map((genre) => (
                                    <Badge
                                        key={genre}
                                        variant={manga.genres?.includes(genre) ? 'default' : 'outline'}
                                        className="cursor-pointer"
                                        onClick={() => toggleGenre(genre)}
                                    >
                                        {genre}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Chapters Section */}
                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold">Bölümler ({manga.chapters?.length || 0})</h2>
                            <Button onClick={() => {
                                setEditingChapterId(null);
                                setNewChapter({
                                    number: (manga.chapters?.length || 0) + 1,
                                    title: '',
                                    pages: [],
                                });
                                setPageUrlInput('');
                                setShowChapterDialog(true);
                            }}>
                                <Plus className="mr-2 h-4 w-4" />
                                Bölüm Ekle
                            </Button>
                        </div>

                        {(manga.chapters?.length || 0) > 0 ? (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {manga.chapters?.slice().reverse().map((chapter) => (
                                    <div
                                        key={chapter.id}
                                        className="flex items-center justify-between rounded-lg border border-border p-3"
                                    >
                                        <div>
                                            <p className="font-medium">Bölüm {chapter.number}: {chapter.title}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {chapter.pages.length} sayfa • {new Date(chapter.releaseDate).toLocaleDateString('tr-TR')}
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => openEditChapterDialog(chapter)}
                                            >
                                                <Upload className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive"
                                                onClick={() => handleDeleteChapter(chapter.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="py-8 text-center text-muted-foreground">
                                Henüz bölüm eklenmemiş
                            </p>
                        )}
                    </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <h2 className="text-lg font-semibold">Görseller</h2>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Kapak Resmi URL *</label>
                            <Input
                                value={manga.cover || ''}
                                onChange={(e) => handleChange('cover', e.target.value)}
                                placeholder="https://example.com/cover.jpg"
                            />
                            {manga.cover && (
                                <img
                                    src={manga.cover}
                                    alt="Cover"
                                    className="mt-2 w-full rounded-lg object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x400?text=No+Image';
                                    }}
                                />
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Banner URL</label>
                            <Input
                                value={manga.banner || ''}
                                onChange={(e) => handleChange('banner', e.target.value)}
                                placeholder="https://example.com/banner.jpg"
                            />
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <h2 className="text-lg font-semibold">İstatistikler</h2>
                        <p className="text-sm text-muted-foreground">
                            Görüntülenme ve puanlama otomatik olarak hesaplanır.
                        </p>
                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div className="rounded-lg bg-secondary p-3">
                                <p className="text-2xl font-bold">{manga.views || 0}</p>
                                <p className="text-xs text-muted-foreground">Görüntülenme</p>
                            </div>
                            <div className="rounded-lg bg-secondary p-3">
                                <p className="text-2xl font-bold">{manga.ratings?.length || 0}</p>
                                <p className="text-xs text-muted-foreground">Değerlendirme</p>
                            </div>
                        </div>
                    </div>

                    <Button className="w-full" size="lg" onClick={handleSave} disabled={loading}>
                        <Save className="mr-2 h-4 w-4" />
                        {loading ? 'Kaydediliyor...' : 'Kaydet'}
                    </Button>
                </div>
            </div>

            {/* Add Chapter Dialog */}
            <Dialog open={showChapterDialog} onOpenChange={setShowChapterDialog}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingChapterId ? 'Bölüm Düzenle' : 'Yeni Bölüm Ekle'}</DialogTitle>
                        <DialogDescription>
                            {editingChapterId ? 'Bölüm detaylarını ve sayfalarını güncelleyin.' : 'Manga için yeni bir bölüm ve içindeki sayfaları ekleyin.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Bölüm Numarası</label>
                                <Input
                                    type="number"
                                    value={newChapter.number}
                                    onChange={(e) => setNewChapter(prev => ({ ...prev, number: parseInt(e.target.value) }))}
                                    min={1}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Bölüm Başlığı</label>
                                <Input
                                    value={newChapter.title || ''}
                                    onChange={(e) => setNewChapter(prev => ({ ...prev, title: e.target.value }))}
                                    placeholder="Bölüm başlığı"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Sayfa URL'leri ({newChapter.pages.length})</label>
                            <div className="flex gap-2">
                                <Input
                                    value={pageUrlInput}
                                    onChange={(e) => setPageUrlInput(e.target.value)}
                                    placeholder="https://example.com/page1.jpg"
                                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPageUrl())}
                                />
                                <Button type="button" onClick={addPageUrl}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>

                            {newChapter.pages.length > 0 && (
                                <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                                    {newChapter.pages.map((page, i) => (
                                        <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
                                            <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="flex-1 truncate text-sm">{page}</span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => removePageUrl(i)}
                                            >
                                                <X className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            setShowChapterDialog(false);
                            setEditingChapterId(null);
                            setNewChapter({
                                number: (manga.chapters?.length || 0) + 1,
                                title: '',
                                pages: [],
                            });
                            setPageUrlInput('');
                        }}>
                            İptal
                        </Button>
                        <Button onClick={handleSaveChapter}>
                            {editingChapterId ? 'Güncelle' : 'Bölüm Ekle'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminMangaEditor;
