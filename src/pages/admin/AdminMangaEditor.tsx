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
import {
    getMangaById,
    saveManga,
    addChapterToManga,
    deleteChapter,
    getCharacters,
    getAuthors,
    getArtists,
    linkMangaToCharacter,
    unlinkMangaFromCharacter,
    linkMangaToAuthor,
    linkMangaToArtist,
    saveCharacter,
    saveAuthor,
    saveArtist,
    getMangaCharacters,
    ensureAuthorByName,
    ensureArtistByName,
} from '@/lib/database';
import { formatChapterDisplayTitle } from '@/lib/chapterTitle';
import { Manga, Chapter, Character, Author, Artist } from '@/lib/types';
import { allGenres, normalizeGenres } from '@/lib/mockData';
import { createNotificationForFollowers } from '@/lib/storage';
import { toast } from 'sonner';
import { Search } from 'lucide-react';

const normalizeNamedEntityValue = (value?: string | null) =>
    value?.split(/[,，]/)[0]?.trim().replace(/\s+/g, ' ') || '';

const normalizeNamedEntityKey = (value?: string | null) =>
    normalizeNamedEntityValue(value).toLocaleLowerCase('tr-TR');

const upsertNamedEntity = <T extends { id: string }>(items: T[], entity: T) => {
    const existingIndex = items.findIndex((item) => item.id === entity.id);
    if (existingIndex === -1) {
        return [...items, entity];
    }

    return items.map((item) => (item.id === entity.id ? entity : item));
};

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

    // Entity States
    const [allCharacters, setAllCharacters] = useState<Character[]>([]);
    const [allAuthors, setAllAuthors] = useState<Author[]>([]);
    const [allArtists, setAllArtists] = useState<Artist[]>([]);
    const [mangaCharacters, setMangaCharacters] = useState<Character[]>([]);
    const [selectedAuthor, setSelectedAuthor] = useState<Author | null>(null);
    const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
    const [deletedCharacterIds, setDeletedCharacterIds] = useState<string[]>([]);

    // Dialog States for creating new entities
    const [showEntityDialog, setShowEntityDialog] = useState<{ type: 'character' | 'author' | 'artist' | null }>({ type: null });
    const [newEntity, setNewEntity] = useState({ name: '', imageUrl: '', description: '' });

    useEffect(() => {
        const loadInitialData = async () => {
            const [chars, auths, arts] = await Promise.all([
                getCharacters(),
                getAuthors(),
                getArtists()
            ]);
            setAllCharacters(chars);
            setAllAuthors(auths);
            setAllArtists(arts);
        };
        loadInitialData();
    }, []);

    useEffect(() => {
        const loadManga = async () => {
            if (isEditing) {
                try {
                    setLoading(true);
                    const existingManga = await getMangaById(mangaId);
                    if (existingManga) {
                        setManga({
                            ...existingManga,
                            genres: normalizeGenres(existingManga.genres || []),
                        });
                        setNewChapter(prev => ({
                            ...prev,
                            number: existingManga.chapters.length + 1,
                        }));

                        // Load related entities
                        const chars = await getMangaCharacters(mangaId);
                        setMangaCharacters(chars);

                        // Find matching author/artist from all lists
                        // Note: If they aren't in the DB as objects yet, we might need to handle strings
                        // But we want to encourage using the objects
                    }
                    else {
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

    useEffect(() => {
        const authorKey = normalizeNamedEntityKey(manga.author);
        const matchedAuthor = authorKey
            ? allAuthors.find((author) => normalizeNamedEntityKey(author.name) === authorKey) || null
            : null;

        if ((matchedAuthor?.id || null) !== (selectedAuthor?.id || null)) {
            setSelectedAuthor(matchedAuthor);
        }
    }, [allAuthors, manga.author, selectedAuthor?.id]);

    useEffect(() => {
        const artistKey = normalizeNamedEntityKey(manga.artist);
        const matchedArtist = artistKey
            ? allArtists.find((artist) => normalizeNamedEntityKey(artist.name) === artistKey) || null
            : null;

        if ((matchedArtist?.id || null) !== (selectedArtist?.id || null)) {
            setSelectedArtist(matchedArtist);
        }
    }, [allArtists, manga.artist, selectedArtist?.id]);

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
            handleChange('genres', normalizeGenres([...genres, genre]));
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
        const normalizedTitle = manga.title?.trim();
        const normalizedCover = manga.cover?.trim();
        const normalizedAuthorName = normalizeNamedEntityValue(manga.author);
        const normalizedArtistName = normalizeNamedEntityValue(manga.artist) || normalizedAuthorName;

        if (!normalizedTitle) {
            toast.error('Manga başlığı gerekli');
            return;
        }
        if (!normalizedCover) {
            toast.error('Kapak resmi URL\'si gerekli');
            return;
        }
        if (!normalizedAuthorName) {
            toast.error('Yazar adı gerekli');
            return;
        }

        setLoading(true);

        try {
            let resolvedAuthor = selectedAuthor;
            if (!resolvedAuthor || normalizeNamedEntityKey(resolvedAuthor.name) !== normalizeNamedEntityKey(normalizedAuthorName)) {
                resolvedAuthor = await ensureAuthorByName(normalizedAuthorName);
                if (resolvedAuthor) {
                    setAllAuthors((prev) => upsertNamedEntity(prev, resolvedAuthor!));
                    setSelectedAuthor(resolvedAuthor);
                }
            }

            let resolvedArtist = selectedArtist;
            if (!resolvedArtist || normalizeNamedEntityKey(resolvedArtist.name) !== normalizeNamedEntityKey(normalizedArtistName)) {
                resolvedArtist = await ensureArtistByName(normalizedArtistName);
                if (resolvedArtist) {
                    setAllArtists((prev) => upsertNamedEntity(prev, resolvedArtist!));
                    setSelectedArtist(resolvedArtist);
                }
            }

            const mangaToSave: Manga = {
                id: manga.id || `manga-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                title: normalizedTitle,
                alternativeTitles: manga.alternativeTitles || [],
                cover: normalizedCover,
                banner: manga.banner?.trim() || normalizedCover,
                author: resolvedAuthor?.name || normalizedAuthorName,
                artist: resolvedArtist?.name || normalizedArtistName,
                status: manga.status as 'ongoing' | 'completed' | 'hiatus',
                type: manga.type as 'manga' | 'manhwa' | 'manhua' | 'webtoon',
                genres: normalizeGenres(manga.genres || []),
                description: manga.description || '',
                ratings: manga.ratings || [],
                views: manga.views || 0,
                chapters: manga.chapters || [],
                lastUpdated: new Date().toISOString(),
                createdAt: manga.createdAt || new Date().toISOString(),
                averageRating: manga.averageRating ?? 0,
                reviewCount: manga.reviewCount ?? 0,
                releaseYear: manga.releaseYear,
            };

            await saveManga(mangaToSave);

            if (isEditing && manga.id) {
                for (const charId of deletedCharacterIds) {
                    await unlinkMangaFromCharacter(manga.id, charId);
                }
            }

            for (const char of mangaCharacters) {
                await linkMangaToCharacter(mangaToSave.id, char.id);
            }

            if (resolvedAuthor) {
                await linkMangaToAuthor(mangaToSave.id, resolvedAuthor.id);
            }

            if (resolvedArtist) {
                await linkMangaToArtist(mangaToSave.id, resolvedArtist.id);
            }

            setDeletedCharacterIds([]);
            toast.success(isEditing ? 'Manga güncellendi' : 'Manga oluşturuldu');
            navigate('/admin/mangas');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Kaydedilirken bir hata oluştu';
            toast.error(message);
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateEntity = async () => {
        if (!newEntity.name.trim()) return;
        try {
            let id = '';
            const entity = { name: newEntity.name, imageUrl: newEntity.imageUrl, description: newEntity.description };
            if (showEntityDialog.type === 'character') {
                id = await saveCharacter(entity as any);
                const chars = await getCharacters();
                setAllCharacters(chars);
                const created = chars.find(c => c.id === id);
                if (created) setMangaCharacters(prev => [...prev, created]);
            } else if (showEntityDialog.type === 'author') {
                id = await saveAuthor(entity as any);
                const auths = await getAuthors();
                setAllAuthors(auths as any);
                const created = auths.find(a => a.id === id);
                if (created) {
                    setSelectedAuthor(created as any);
                    handleChange('author', created.name);
                }
            } else if (showEntityDialog.type === 'artist') {
                id = await saveArtist(entity as any);
                const arts = await getArtists();
                setAllArtists(arts as any);
                const created = arts.find(a => a.id === id);
                if (created) {
                    setSelectedArtist(created as any);
                    handleChange('artist', created.name);
                }
            }
            setShowEntityDialog({ type: null });
            setNewEntity({ name: '', imageUrl: '', description: '' });
            toast.success('Başarıyla oluşturuldu');
        } catch (err) {
            toast.error('Oluşturulamadı');
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
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Yazar *</label>
                                    <div className="flex gap-2">
                                        <Select
                                            value={selectedAuthor?.id}
                                            onValueChange={(val) => {
                                                const a = allAuthors.find(x => x.id === val);
                                                if (a) {
                                                    setSelectedAuthor(a);
                                                    handleChange('author', a.name);
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="flex-1">
                                                <SelectValue placeholder="Yazar seçin..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {allAuthors.map(a => (
                                                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button variant="outline" size="icon" onClick={() => setShowEntityDialog({ type: 'author' })}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <Input
                                        value={manga.author || ''}
                                        onChange={(e) => handleChange('author', e.target.value)}
                                        placeholder="Veya yazar adı girin"
                                        className="mt-2"
                                    />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Çizer</label>
                                    <div className="flex gap-2">
                                        <Select
                                            value={selectedArtist?.id}
                                            onValueChange={(val) => {
                                                const a = allArtists.find(x => x.id === val);
                                                if (a) {
                                                    setSelectedArtist(a);
                                                    handleChange('artist', a.name);
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="flex-1">
                                                <SelectValue placeholder="Çizer seçin..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {allArtists.map(a => (
                                                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button variant="outline" size="icon" onClick={() => setShowEntityDialog({ type: 'artist' })}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <Input
                                        value={manga.artist || ''}
                                        onChange={(e) => handleChange('artist', e.target.value)}
                                        placeholder="Veya çizer adı girin"
                                        className="mt-2"
                                    />
                                </div>
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
                                        <SelectItem value="webtoon">Webtoon</SelectItem>
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

                        {/* Character Selection */}
                        <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-semibold">Karakterler</h2>
                                <Button size="sm" variant="outline" onClick={() => setShowEntityDialog({ type: 'character' })}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Yeni Karakter
                                </Button>
                            </div>
                            <div className="grid gap-2">
                                <div className="flex gap-2">
                                    <Select onValueChange={(val) => {
                                        const char = allCharacters.find(c => c.id === val);
                                        if (char && !mangaCharacters.find(mc => mc.id === char.id)) {
                                            setMangaCharacters([...mangaCharacters, char]);
                                        }
                                    }}>
                                        <SelectTrigger className="flex-1">
                                            <SelectValue placeholder="Karakter seçin..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {allCharacters.filter(c => !mangaCharacters.find(mc => mc.id === c.id)).map(c => (
                                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {mangaCharacters.map(char => (
                                        <Badge key={char.id} variant="secondary" className="px-3 py-1 gap-2 border-primary/20 hover:border-primary/40 transition-colors">
                                            <div className="w-5 h-5 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0 border border-white/10">
                                                {char.imageUrl ? (
                                                    <img
                                                        src={char.imageUrl}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src = 'https://via.placeholder.com/40?text=?';
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground">?</span>
                                                )}
                                            </div>
                                            <span className="max-w-[150px] truncate">{char.name}</span>
                                            <button
                                                type="button"
                                                className="hover:text-destructive transition-colors ml-1"
                                                onClick={() => {
                                                    setMangaCharacters(mangaCharacters.filter(c => c.id !== char.id));
                                                    if (!deletedCharacterIds.includes(char.id)) {
                                                        setDeletedCharacterIds([...deletedCharacterIds, char.id]);
                                                    }
                                                }}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
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
                                            <p className="font-medium">{formatChapterDisplayTitle(chapter.number, chapter.title)}</p>
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
                            {manga.banner && (
                                <img
                                    src={manga.banner}
                                    alt="Banner"
                                    className="mt-2 w-full rounded-lg aspect-video object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/1200x400?text=No+Banner+Image';
                                    }}
                                />
                            )}
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

            {/* Entity Add Dialog (Character/Author/Artist) */}
            <Dialog open={showEntityDialog.type !== null} onOpenChange={() => setShowEntityDialog({ type: null })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Yeni {showEntityDialog.type === 'character' ? 'Karakter' : showEntityDialog.type === 'author' ? 'Yazar' : 'Çizer'} Ekle
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">İsim</label>
                            <Input
                                value={newEntity.name}
                                onChange={(e) => setNewEntity({ ...newEntity, name: e.target.value })}
                                placeholder="İsim..."
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Resim URL</label>
                            <Input
                                value={newEntity.imageUrl}
                                onChange={(e) => setNewEntity({ ...newEntity, imageUrl: e.target.value })}
                                placeholder="https://..."
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Açıklama / Hikaye</label>
                            <Textarea
                                value={newEntity.description}
                                onChange={(e) => setNewEntity({ ...newEntity, description: e.target.value })}
                                placeholder="Açıklama..."
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowEntityDialog({ type: null })}>İptal</Button>
                        <Button onClick={handleCreateEntity}>Oluştur</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminMangaEditor;
