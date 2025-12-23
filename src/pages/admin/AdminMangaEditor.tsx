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
    DialogFooter,
} from '@/components/ui/dialog';
import { getMangaById, saveManga, addChapterToManga, deleteChapter } from '@/lib/database';
import { Manga, Chapter } from '@/lib/types';
import { allGenres } from '@/lib/mockData';
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
        rating: 0,
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

    useEffect(() => {
        if (isEditing) {
            const existingManga = getMangaById(mangaId);
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
        }
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

    const handleAddChapter = () => {
        if (!newChapter.title.trim()) {
            toast.error('Bölüm başlığı gerekli');
            return;
        }
        if (newChapter.pages.length === 0) {
            toast.error('En az bir sayfa ekleyin');
            return;
        }

        const chapter: Chapter = {
            id: `chapter-${Date.now()}`,
            number: newChapter.number,
            title: newChapter.title,
            pages: newChapter.pages,
            releaseDate: new Date().toISOString(),
            views: 0,
        };

        if (isEditing && manga.id) {
            addChapterToManga(manga.id, chapter);
            const updatedManga = getMangaById(manga.id);
            if (updatedManga) {
                setManga(updatedManga);
            }
            toast.success('Bölüm eklendi');
        } else {
            handleChange('chapters', [...(manga.chapters || []), chapter]);
            toast.success('Bölüm listeye eklendi');
        }

        setNewChapter({
            number: (manga.chapters?.length || 0) + 2,
            title: '',
            pages: [],
        });
        setShowChapterDialog(false);
    };

    const handleDeleteChapter = (chapterId: string) => {
        if (isEditing && manga.id) {
            deleteChapter(manga.id, chapterId);
            const updatedManga = getMangaById(manga.id);
            if (updatedManga) {
                setManga(updatedManga);
            }
        } else {
            handleChange('chapters', (manga.chapters || []).filter(c => c.id !== chapterId));
        }
        toast.success('Bölüm silindi');
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
            rating: manga.rating || 0,
            views: manga.views || 0,
            chapters: manga.chapters || [],
            lastUpdated: new Date().toISOString(),
            createdAt: manga.createdAt || new Date().toISOString(),
            releaseYear: manga.releaseYear,
        };

        saveManga(mangaToSave);

        await new Promise(resolve => setTimeout(resolve, 500));

        setLoading(false);
        toast.success(isEditing ? 'Manga güncellendi' : 'Manga oluşturuldu');
        navigate('/admin/mangas');
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
                                value={manga.title}
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
                                    value={manga.author}
                                    onChange={(e) => handleChange('author', e.target.value)}
                                    placeholder="Yazar adı"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Çizer</label>
                                <Input
                                    value={manga.artist}
                                    onChange={(e) => handleChange('artist', e.target.value)}
                                    placeholder="Çizer adı"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Açıklama</label>
                            <Textarea
                                value={manga.description}
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
                                    value={manga.releaseYear}
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
                            <Button onClick={() => setShowChapterDialog(true)}>
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
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive"
                                            onClick={() => handleDeleteChapter(chapter.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
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
                                value={manga.cover}
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
                                value={manga.banner}
                                onChange={(e) => handleChange('banner', e.target.value)}
                                placeholder="https://example.com/banner.jpg"
                            />
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <h2 className="text-lg font-semibold">İstatistikler</h2>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-sm text-muted-foreground">Rating</label>
                                <Input
                                    type="number"
                                    value={manga.rating}
                                    onChange={(e) => handleChange('rating', parseFloat(e.target.value))}
                                    min={0}
                                    max={5}
                                    step={0.1}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm text-muted-foreground">Görüntülenme</label>
                                <Input
                                    type="number"
                                    value={manga.views}
                                    onChange={(e) => handleChange('views', parseInt(e.target.value))}
                                    min={0}
                                />
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
                        <DialogTitle>Yeni Bölüm Ekle</DialogTitle>
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
                                    value={newChapter.title}
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
                        <Button variant="outline" onClick={() => setShowChapterDialog(false)}>
                            İptal
                        </Button>
                        <Button onClick={handleAddChapter}>
                            Bölüm Ekle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminMangaEditor;
