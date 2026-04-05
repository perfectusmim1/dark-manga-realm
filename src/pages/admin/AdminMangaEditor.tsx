import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Save,
    ArrowLeft,
    Plus,
    Trash2,
    Upload,
    Image as ImageIcon,
    X,
    ChevronsUpDown,
    Globe2,
    Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/components/ui/command';
import {
    getMangaById,
    saveManga,
    getMangaSummaries,
    addChapterToManga,
    deleteChapter,
    getCharacters,
    getAuthors,
    getArtists,
    saveCharacter,
    saveAuthor,
    saveArtist,
    getMangaCharacters,
    ensureAuthorByName,
    ensureArtistByName,
    replaceMangaCharacters,
    replaceMangaAuthors,
    replaceMangaArtists,
    replaceMangaRelatedSeries,
} from '@/lib/database';
import { formatChapterDisplayTitle } from '@/lib/chapterTitle';
import { Manga, Chapter, Character, Author, Artist, MangaRelation } from '@/lib/types';
import { allGenres, normalizeGenres } from '@/lib/mockData';
import { getMangaRelationTypeLabel } from '@/lib/mangaRelations';
import { createNotificationForFollowers } from '@/lib/storage';
import { getCharacterListingRoleLabel, type CharacterListingRole } from '@/lib/characterRoles';
import {
    getExternalSourceLink,
    normalizeExternalSourceLinkInput,
    upsertExternalSourceLink,
} from '@/lib/externalSync';
import { toast } from 'sonner';

const normalizeNamedEntityValue = (value?: string | null) =>
    value?.trim().replace(/\s+/g, ' ') || '';

const normalizeNamedEntityKey = (value?: string | null) =>
    normalizeNamedEntityValue(value).toLocaleLowerCase('tr-TR');

const splitManualEntityNames = (value?: string | null) => {
    const normalized = value || '';
    const hasStructuredSeparator = /[\n;,|/]/.test(normalized);
    const values = hasStructuredSeparator
        ? normalized.split(/[\n;,|/]+/g)
        : [normalized];

    return Array.from(
        new Set(
            values
                .map((item) => normalizeNamedEntityValue(item))
                .filter(Boolean),
        ),
    );
};

const getSeriesGalleryUrls = (details?: Manga['details']) => {
    const rawGallery = details?.extra?.seriesGallery;
    if (!Array.isArray(rawGallery)) {
        return [];
    }

    return Array.from(
        new Set(
            rawGallery
                .map((value) => (typeof value === 'string' ? value.trim() : ''))
                .filter(Boolean),
        ),
    );
};

const parseSeriesGalleryInput = (value: string) => (
    Array.from(
        new Set(
            value
                .split(/\r?\n/g)
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    )
);

const joinEntityNames = (values: Array<string | null | undefined>) => (
    Array.from(
        new Set(
            values
                .map((value) => normalizeNamedEntityValue(value))
                .filter(Boolean),
        ),
    ).join(', ')
);

const removeEntityNameFromManualValue = (
    currentValue: string | null | undefined,
    removedName: string,
) => (
    joinEntityNames(
        splitManualEntityNames(currentValue).filter(
            (value) => normalizeNamedEntityKey(value) !== normalizeNamedEntityKey(removedName),
        ),
    )
);

const upsertNamedEntity = <T extends { id: string }>(items: T[], entity: T) => {
    const existingIndex = items.findIndex((item) => item.id === entity.id);
    if (existingIndex === -1) {
        return [...items, entity];
    }

    return items.map((item) => (item.id === entity.id ? entity : item));
};

const DEFAULT_CHARACTER_LISTING_ROLE: CharacterListingRole = 'minor';
const DEFAULT_ENTITY_PICKER_LIMIT = 10;

const createEmptyMangaDraft = (): Partial<Manga> => ({
    title: '',
    alternativeTitles: [],
    cover: '',
    banner: '',
    isPublic: true,
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
    averageRating: 0,
    reviewCount: 0,
    details: {},
    sourceLinks: [],
});

const createEmptyChapterDraft = (number: number = 1) => ({
    number,
    title: '',
    pages: [] as string[],
});

const createEmptyEntityDraft = () => ({
    name: '',
    imageUrl: '',
    description: '',
});

const normalizeSearchValue = (value: string) => value.trim().toLocaleLowerCase('tr-TR');

interface SearchableOptionPickerProps<T extends { id: string }> {
    options: T[];
    onSelect: (item: T) => void;
    placeholder: string;
    searchPlaceholder: string;
    emptyMessage: string;
    limit?: number;
    getLabel: (item: T) => string;
    getSearchValues?: (item: T) => string[];
    getSecondaryText?: (item: T) => string | undefined;
}

function SearchableOptionPicker<T extends { id: string }>({
    options,
    onSelect,
    placeholder,
    searchPlaceholder,
    emptyMessage,
    limit = DEFAULT_ENTITY_PICKER_LIMIT,
    getLabel,
    getSearchValues,
    getSecondaryText,
}: SearchableOptionPickerProps<T>) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [showAll, setShowAll] = useState(false);
    const deferredQuery = useDeferredValue(query);
    const normalizedQuery = useMemo(() => normalizeSearchValue(deferredQuery), [deferredQuery]);

    const filteredOptions = useMemo(() => {
        if (!normalizedQuery) {
            return options;
        }

        return options.filter((option) => {
            const searchableValues = [
                getLabel(option),
                ...(getSearchValues?.(option) || []),
            ]
                .map((value) => value?.trim() || '')
                .filter(Boolean);

            return searchableValues.some((value) => value.toLocaleLowerCase('tr-TR').includes(normalizedQuery));
        });
    }, [getLabel, getSearchValues, normalizedQuery, options]);

    const visibleOptions = useMemo(() => {
        if (normalizedQuery || showAll) {
            return filteredOptions;
        }

        return filteredOptions.slice(0, limit);
    }, [filteredOptions, limit, normalizedQuery, showAll]);

    useEffect(() => {
        if (!open) {
            setQuery('');
            setShowAll(false);
        }
    }, [open]);

    return (
        <div className="flex-1 space-y-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal"
                    >
                        <span className="truncate text-sm text-muted-foreground">{placeholder}</span>
                        <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 opacity-60" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(92vw,420px)] p-0" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            value={query}
                            onValueChange={setQuery}
                            placeholder={searchPlaceholder}
                        />
                        <CommandList>
                            <CommandEmpty>{emptyMessage}</CommandEmpty>
                            {visibleOptions.length > 0 ? (
                                <CommandGroup>
                                    {visibleOptions.map((option) => {
                                        const secondaryText = getSecondaryText?.(option);
                                        return (
                                            <CommandItem
                                                key={option.id}
                                                value={`${getLabel(option)} ${(getSearchValues?.(option) || []).join(' ')}`}
                                                className="items-start py-3"
                                                onSelect={() => {
                                                    onSelect(option);
                                                    setOpen(false);
                                                }}
                                            >
                                                <div className="min-w-0 space-y-1">
                                                    <p className="truncate text-sm font-medium">{getLabel(option)}</p>
                                                    {secondaryText ? (
                                                        <p className="line-clamp-2 text-xs text-muted-foreground">
                                                            {secondaryText}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            ) : null}
                            {!normalizedQuery && !showAll && filteredOptions.length > visibleOptions.length ? (
                                <>
                                    <CommandSeparator />
                                    <div className="p-2">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="w-full justify-center"
                                            onClick={() => setShowAll(true)}
                                        >
                                            Tümünü Göster ({filteredOptions.length})
                                        </Button>
                                    </div>
                                </>
                            ) : null}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {!normalizedQuery && filteredOptions.length > limit ? (
                <p className="text-xs text-muted-foreground">
                    Varsayılan olarak ilk {limit} kayıt gösterilir. Diğerlerini arama veya tümünü göster ile açabilirsin.
                </p>
            ) : null}
        </div>
    );
}

const AdminMangaEditor: React.FC = () => {
    const navigate = useNavigate();
    const { mangaId } = useParams<{ mangaId: string }>();
    const isEditing = mangaId && mangaId !== 'new';

    const [manga, setManga] = useState<Partial<Manga>>(() => createEmptyMangaDraft());

    const [altTitleInput, setAltTitleInput] = useState('');
    const [showChapterDialog, setShowChapterDialog] = useState(false);
    const [newChapter, setNewChapter] = useState(() => createEmptyChapterDraft());
    const [pageUrlInput, setPageUrlInput] = useState('');
    const [seriesGalleryInput, setSeriesGalleryInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [editingChapterId, setEditingChapterId] = useState<string | null>(null);

    // Entity States
    const [allCharacters, setAllCharacters] = useState<Character[]>([]);
    const [allAuthors, setAllAuthors] = useState<Author[]>([]);
    const [allArtists, setAllArtists] = useState<Artist[]>([]);
    const [allMangaOptions, setAllMangaOptions] = useState<Manga[]>([]);
    const [mangaCharacters, setMangaCharacters] = useState<Character[]>([]);
    const [selectedAuthors, setSelectedAuthors] = useState<Author[]>([]);
    const [selectedArtists, setSelectedArtists] = useState<Artist[]>([]);
    const [relatedSeries, setRelatedSeries] = useState<MangaRelation[]>([]);
    const [selectedRelatedMangaId, setSelectedRelatedMangaId] = useState<string>('');
    const [selectedRelationType, setSelectedRelationType] = useState<string>('related');
    const [selectedCharacterQuery, setSelectedCharacterQuery] = useState('');
    const [showAllSelectedCharacters, setShowAllSelectedCharacters] = useState(false);

    // Dialog States for creating new entities
    const [showEntityDialog, setShowEntityDialog] = useState<{ type: 'character' | 'author' | 'artist' | null }>({ type: null });
    const [newEntity, setNewEntity] = useState(() => createEmptyEntityDraft());

    useEffect(() => {
        const loadInitialData = async () => {
            const [chars, auths, arts, mangas] = await Promise.all([
                getCharacters({ includePrivate: true }),
                getAuthors({ includePrivate: true }),
                getArtists({ includePrivate: true }),
                getMangaSummaries({ includePrivate: true }),
            ]);
            setAllCharacters(chars);
            setAllAuthors(auths);
            setAllArtists(arts);
            setAllMangaOptions(mangas);
        };
        loadInitialData();
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadManga = async () => {
            if (!isEditing) {
                setManga(createEmptyMangaDraft());
                setAltTitleInput('');
                setShowChapterDialog(false);
                setNewChapter(createEmptyChapterDraft());
                setPageUrlInput('');
                setSeriesGalleryInput('');
                setLoading(false);
                setEditingChapterId(null);
                setMangaCharacters([]);
                setSelectedAuthors([]);
                setSelectedArtists([]);
                setRelatedSeries([]);
                setSelectedRelatedMangaId('');
                setSelectedRelationType('related');
                setSelectedCharacterQuery('');
                setShowAllSelectedCharacters(false);
                setShowEntityDialog({ type: null });
                setNewEntity(createEmptyEntityDraft());
                return;
            }

            try {
                setLoading(true);
                const existingManga = await getMangaById(mangaId, { includePrivate: true, includePages: true });
                if (!existingManga) {
                    if (!cancelled) {
                        toast.error('Manga bulunamadı');
                        navigate('/admin/mangas');
                    }
                    return;
                }

                const linkedAuthorNames = existingManga.authorsDetails?.map((author) => author.name) || [];
                const linkedArtistNames = existingManga.artistsDetails?.map((artist) => artist.name) || [];
                const manualAuthorNames = splitManualEntityNames(existingManga.author).filter(
                    (name) => !linkedAuthorNames.some((linkedName) => normalizeNamedEntityKey(linkedName) === normalizeNamedEntityKey(name)),
                );
                const manualArtistNames = splitManualEntityNames(existingManga.artist).filter(
                    (name) => !linkedArtistNames.some((linkedName) => normalizeNamedEntityKey(linkedName) === normalizeNamedEntityKey(name)),
                );
                const chars = await getMangaCharacters(mangaId, { includePrivate: true });

                if (cancelled) {
                    return;
                }

                setManga({
                    ...existingManga,
                    author: joinEntityNames(manualAuthorNames),
                    artist: joinEntityNames(manualArtistNames),
                    genres: normalizeGenres(existingManga.genres || []),
                });
                setNewChapter(createEmptyChapterDraft(existingManga.chapters.length + 1));
                setPageUrlInput('');
                setSeriesGalleryInput(getSeriesGalleryUrls(existingManga.details).join('\n'));
                setEditingChapterId(null);
                setSelectedCharacterQuery('');
                setShowAllSelectedCharacters(false);
                setMangaCharacters(chars.map((character) => ({
                    ...character,
                    listingRole: character.listingRole || DEFAULT_CHARACTER_LISTING_ROLE,
                })));
                setRelatedSeries(existingManga.relatedSeries || []);
                setSelectedAuthors(existingManga.authorsDetails || []);
                setSelectedArtists(existingManga.artistsDetails || []);
            } catch (err) {
                if (!cancelled) {
                    toast.error('Veri yüklenemedi');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };
        void loadManga();

        return () => {
            cancelled = true;
        };
    }, [mangaId, isEditing, navigate]);

    const handleChange = <K extends keyof Manga>(field: K, value: Partial<Manga>[K]) => {
        setManga(prev => ({ ...prev, [field]: value }));
    };

    const updateSeriesGalleryUrls = (value: string) => {
        const urls = parseSeriesGalleryInput(value);
        setSeriesGalleryInput(value);
        setManga((prev) => ({
            ...prev,
            details: {
                ...(prev.details || {}),
                extra: {
                    ...(prev.details?.extra || {}),
                    seriesGallery: urls,
                },
            },
        }));
    };

    const handleExternalSourceLinkChange = (provider: 'myanimelist' | 'anilist', value: string) => {
        const nextLink = normalizeExternalSourceLinkInput(provider, value);
        const baseLinks = (manga.sourceLinks || []).filter((link) => link.source !== provider);
        handleChange('sourceLinks', nextLink ? upsertExternalSourceLink(baseLinks, nextLink) : baseLinks);
    };

    const addSelectedAuthor = (author: Author) => {
        setSelectedAuthors((current) => {
            if (current.some((item) => item.id === author.id)) {
                return current;
            }

            return [...current, author];
        });
        handleChange('author', removeEntityNameFromManualValue(manga.author, author.name));
    };

    const addSelectedArtist = (artist: Artist) => {
        setSelectedArtists((current) => {
            if (current.some((item) => item.id === artist.id)) {
                return current;
            }

            return [...current, artist];
        });
        handleChange('artist', removeEntityNameFromManualValue(manga.artist, artist.name));
    };

    const removeSelectedAuthor = (authorId: string) => {
        const authorToRemove = selectedAuthors.find((item) => item.id === authorId);
        setSelectedAuthors((current) => current.filter((item) => item.id !== authorId));
        if (authorToRemove) {
            handleChange('author', removeEntityNameFromManualValue(manga.author, authorToRemove.name));
        }
    };

    const removeSelectedArtist = (artistId: string) => {
        const artistToRemove = selectedArtists.find((item) => item.id === artistId);
        setSelectedArtists((current) => current.filter((item) => item.id !== artistId));
        if (artistToRemove) {
            handleChange('artist', removeEntityNameFromManualValue(manga.artist, artistToRemove.name));
        }
    };

    const addSelectedCharacter = (character: Character) => {
        setMangaCharacters((current) => {
            if (current.some((item) => item.id === character.id)) {
                return current;
            }

            return [
                ...current,
                {
                    ...character,
                    listingRole: character.listingRole || DEFAULT_CHARACTER_LISTING_ROLE,
                },
            ];
        });
        setSelectedCharacterQuery('');
        setShowAllSelectedCharacters(false);
    };

    const updateCharacterListingRole = (characterId: string, listingRole: CharacterListingRole) => {
        setMangaCharacters((current) => current.map((character) => (
            character.id === characterId
                ? { ...character, listingRole }
                : character
        )));
    };

    const selectedAuthorIds = useMemo(() => new Set(selectedAuthors.map((author) => author.id)), [selectedAuthors]);
    const selectedArtistIds = useMemo(() => new Set(selectedArtists.map((artist) => artist.id)), [selectedArtists]);
    const selectedCharacterIds = useMemo(() => new Set(mangaCharacters.map((character) => character.id)), [mangaCharacters]);
    const deferredSelectedCharacterQuery = useDeferredValue(selectedCharacterQuery);
    const normalizedSelectedCharacterQuery = useMemo(
        () => normalizeSearchValue(deferredSelectedCharacterQuery),
        [deferredSelectedCharacterQuery],
    );

    const availableAuthors = useMemo(
        () => allAuthors.filter((author) => !selectedAuthorIds.has(author.id)),
        [allAuthors, selectedAuthorIds],
    );
    const availableArtists = useMemo(
        () => allArtists.filter((artist) => !selectedArtistIds.has(artist.id)),
        [allArtists, selectedArtistIds],
    );
    const availableCharacters = useMemo(
        () => allCharacters.filter((character) => !selectedCharacterIds.has(character.id)),
        [allCharacters, selectedCharacterIds],
    );
    const filteredSelectedCharacters = useMemo(() => {
        if (!normalizedSelectedCharacterQuery) {
            return mangaCharacters;
        }

        return mangaCharacters.filter((character) => {
            const searchableValues = [
                character.name,
                ...(character.alternativeNames || []),
            ]
                .map((value) => value?.trim() || '')
                .filter(Boolean);

            return searchableValues.some((value) => value.toLocaleLowerCase('tr-TR').includes(normalizedSelectedCharacterQuery));
        });
    }, [mangaCharacters, normalizedSelectedCharacterQuery]);
    const visibleSelectedCharacters = useMemo(() => {
        if (normalizedSelectedCharacterQuery || showAllSelectedCharacters) {
            return filteredSelectedCharacters;
        }

        return filteredSelectedCharacters.slice(0, DEFAULT_ENTITY_PICKER_LIMIT);
    }, [filteredSelectedCharacters, normalizedSelectedCharacterQuery, showAllSelectedCharacters]);

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

    const addRelatedSeries = () => {
        if (!selectedRelatedMangaId) {
            return;
        }

        const selectedManga = allMangaOptions.find((item) => item.id === selectedRelatedMangaId);
        if (!selectedManga || selectedManga.id === manga.id) {
            return;
        }

        if (relatedSeries.some((item) => item.relatedMangaId === selectedManga.id)) {
            toast.error('Bu seri zaten ilişkiler listesinde');
            return;
        }

        setRelatedSeries((current) => [
            ...current,
            {
                id: `tmp-${selectedManga.id}`,
                mangaId: manga.id || '',
                relatedMangaId: selectedManga.id,
                relationType: selectedRelationType,
                sortOrder: current.length,
                relatedManga: selectedManga,
            },
        ]);
        setSelectedRelatedMangaId('');
    };

    const removeRelatedSeries = (relatedMangaId: string) => {
        setRelatedSeries((current) => current.filter((item) => item.relatedMangaId !== relatedMangaId));
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

                const refreshedManga = await getMangaById(manga.id, { includePrivate: true, includePages: true });
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
                const updatedManga = await getMangaById(manga.id, { includePrivate: true, includePages: true });
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
        const authorNames = Array.from(
            new Set([
                ...selectedAuthors.map((author) => normalizeNamedEntityValue(author.name)),
                ...splitManualEntityNames(manga.author),
            ].filter(Boolean)),
        );
        const artistNames = Array.from(
            new Set([
                ...selectedArtists.map((artist) => normalizeNamedEntityValue(artist.name)),
                ...splitManualEntityNames(manga.artist),
            ].filter(Boolean)),
        );

        if (!normalizedTitle) {
            toast.error('Manga başlığı gerekli');
            return;
        }
        if (!normalizedCover) {
            toast.error('Kapak resmi URL\'si gerekli');
            return;
        }
        setLoading(true);

        try {
            const resolvedAuthors: Author[] = [];
            for (const authorName of authorNames) {
                const selectedMatch = selectedAuthors.find((author) => normalizeNamedEntityKey(author.name) === normalizeNamedEntityKey(authorName));
                const resolvedAuthor = selectedMatch || await ensureAuthorByName(authorName);

                if (resolvedAuthor) {
                    resolvedAuthors.push(resolvedAuthor);
                    setAllAuthors((prev) => upsertNamedEntity(prev, resolvedAuthor));
                }
            }

            const resolvedArtists: Artist[] = [];
            for (const artistName of artistNames) {
                const selectedMatch = selectedArtists.find((artist) => normalizeNamedEntityKey(artist.name) === normalizeNamedEntityKey(artistName));
                const resolvedArtist = selectedMatch || await ensureArtistByName(artistName);

                if (resolvedArtist) {
                    resolvedArtists.push(resolvedArtist);
                    setAllArtists((prev) => upsertNamedEntity(prev, resolvedArtist));
                }
            }

            const normalizedAuthorLabel = joinEntityNames(resolvedAuthors.map((author) => author.name));
            const normalizedArtistLabel = joinEntityNames(resolvedArtists.map((artist) => artist.name));
            setSelectedAuthors(resolvedAuthors);
            setSelectedArtists(resolvedArtists);

            const mangaToSave: Manga = {
                id: manga.id || `manga-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                title: normalizedTitle,
                alternativeTitles: manga.alternativeTitles || [],
                cover: normalizedCover,
                banner: manga.banner?.trim() || normalizedCover,
                isPublic: manga.isPublic ?? true,
                author: normalizedAuthorLabel,
                artist: normalizedArtistLabel || undefined,
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
                details: manga.details || {},
                sourceLinks: manga.sourceLinks || [],
            };

            await saveManga(mangaToSave);

            await replaceMangaCharacters(
                mangaToSave.id,
                mangaCharacters.map((character) => ({
                    characterId: character.id,
                    listingRole: character.listingRole || DEFAULT_CHARACTER_LISTING_ROLE,
                })),
            );

            await replaceMangaAuthors(mangaToSave.id, resolvedAuthors.map((author) => author.id));
            await replaceMangaArtists(mangaToSave.id, resolvedArtists.map((artist) => artist.id));

            await replaceMangaRelatedSeries(
                mangaToSave.id,
                relatedSeries.map((relation, index) => ({
                    relatedMangaId: relation.relatedMangaId,
                    relationType: relation.relationType,
                    sortOrder: index,
                })),
            );

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
            const entity = {
                name: newEntity.name.trim(),
                imageUrl: newEntity.imageUrl.trim() || undefined,
                description: newEntity.description.trim() || undefined,
            };
            if (showEntityDialog.type === 'character') {
                id = await saveCharacter(entity);
                const chars = await getCharacters({ includePrivate: true });
                setAllCharacters(chars);
                const created = chars.find(c => c.id === id);
                if (created) {
                    addSelectedCharacter(created);
                }
            } else if (showEntityDialog.type === 'author') {
                id = await saveAuthor(entity);
                const auths = await getAuthors({ includePrivate: true });
                setAllAuthors(auths);
                const created = auths.find(a => a.id === id);
                if (created) {
                    addSelectedAuthor(created);
                }
            } else if (showEntityDialog.type === 'artist') {
                id = await saveArtist(entity);
                const arts = await getArtists({ includePrivate: true });
                setAllArtists(arts);
                const created = arts.find(a => a.id === id);
                if (created) {
                    addSelectedArtist(created);
                }
            }
            setShowEntityDialog({ type: null });
            setNewEntity({ name: '', imageUrl: '', description: '' });
            toast.success('Başarıyla oluşturuldu');
        } catch (err) {
            toast.error('Oluşturulamadı');
        }
    };

    const seriesGalleryUrls = getSeriesGalleryUrls(manga.details);
    const malSourceLink = getExternalSourceLink(manga.sourceLinks, 'myanimelist');
    const aniListSourceLink = getExternalSourceLink(manga.sourceLinks, 'anilist');

    return (
        <div className="space-y-6">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <Button variant="ghost" size="icon" onClick={() => navigate('/admin/mangas')} className="shrink-0">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold sm:text-3xl">
                        {isEditing ? 'Manga Düzenle' : 'Yeni Manga Ekle'}
                    </h1>
                    <p className="text-muted-foreground">
                        {isEditing ? 'Manga bilgilerini güncelleyin' : 'Yeni bir manga ekleyin'}
                    </p>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
                {/* Main Info */}
                <div className="space-y-6 lg:col-span-2">
                    <div className="rounded-xl border border-border bg-card p-4 space-y-4 sm:p-6">
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
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                    value={altTitleInput}
                                    onChange={(e) => setAltTitleInput(e.target.value)}
                                    placeholder="Alternatif başlık ekle"
                                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAlternativeTitle())}
                                />
                                    <Button type="button" onClick={addAlternativeTitle} className="sm:w-auto">
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
                                    <label className="text-sm font-medium">Yazar</label>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <SearchableOptionPicker
                                            options={availableAuthors}
                                            onSelect={addSelectedAuthor}
                                            placeholder="Yazar ara ve ekle..."
                                            searchPlaceholder="Yazar adı yaz..."
                                            emptyMessage="Eşleşen yazar bulunamadı."
                                            getLabel={(author) => author.name}
                                            getSearchValues={(author) => author.alternativeNames || []}
                                            getSecondaryText={(author) => author.alternativeNames?.slice(0, 2).join(' • ')}
                                        />
                                        <Button variant="outline" size="icon" onClick={() => setShowEntityDialog({ type: 'author' })} className="sm:w-10">
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    {selectedAuthors.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {selectedAuthors.map((author) => (
                                                <Badge key={author.id} variant="secondary" className="gap-2 px-3 py-1">
                                                    <span>{author.name}</span>
                                                    <button type="button" onClick={() => removeSelectedAuthor(author.id)}>
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                    <Input
                                        value={manga.author || ''}
                                        onChange={(e) => handleChange('author', e.target.value)}
                                        placeholder="Ek yazar adlari icin yeni satir veya ; kullanin"
                                        className="mt-2"
                                    />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Çizer</label>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <SearchableOptionPicker
                                            options={availableArtists}
                                            onSelect={addSelectedArtist}
                                            placeholder="Çizer ara ve ekle..."
                                            searchPlaceholder="Çizer adı yaz..."
                                            emptyMessage="Eşleşen çizer bulunamadı."
                                            getLabel={(artist) => artist.name}
                                            getSearchValues={(artist) => artist.alternativeNames || []}
                                            getSecondaryText={(artist) => artist.alternativeNames?.slice(0, 2).join(' • ')}
                                        />
                                        <Button variant="outline" size="icon" onClick={() => setShowEntityDialog({ type: 'artist' })} className="sm:w-10">
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    {selectedArtists.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {selectedArtists.map((artist) => (
                                                <Badge key={artist.id} variant="secondary" className="gap-2 px-3 py-1">
                                                    <span>{artist.name}</span>
                                                    <button type="button" onClick={() => removeSelectedArtist(artist.id)}>
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                    <Input
                                        value={manga.artist || ''}
                                        onChange={(e) => handleChange('artist', e.target.value)}
                                        placeholder="Ek çizer adlari icin yeni satir veya ; kullanin"
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

                        <div className="rounded-xl border border-border/70 bg-background/40 p-4 sm:p-5">
                            <div className="space-y-1">
                                <h3 className="text-base font-semibold">Harici Eşleştirme</h3>
                                <p className="text-sm text-muted-foreground">
                                    Senkron ve puan gösterimi için seri bağlantılarını buradan kaydedin. URL veya sadece ID girebilirsiniz.
                                </p>
                            </div>

                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">MyAnimeList URL / ID</label>
                                    <Input
                                        value={malSourceLink?.url || malSourceLink?.externalId || ''}
                                        onChange={(e) => handleExternalSourceLinkChange('myanimelist', e.target.value)}
                                        placeholder="https://myanimelist.net/manga/12345"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {malSourceLink?.externalId
                                            ? `Çözümlenen MAL ID: ${malSourceLink.externalId}`
                                            : 'Kaydedildiğinde otomatik olarak MAL ID ayrıştırılır.'}
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">AniList URL / ID</label>
                                    <Input
                                        value={aniListSourceLink?.url || aniListSourceLink?.externalId || ''}
                                        onChange={(e) => handleExternalSourceLinkChange('anilist', e.target.value)}
                                        placeholder="https://anilist.co/manga/12345"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {aniListSourceLink?.externalId
                                            ? `Çözümlenen AniList ID: ${aniListSourceLink.externalId}`
                                            : 'Kaydedildiğinde otomatik olarak AniList ID ayrıştırılır.'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Tür</label>
                                <Select
                                    value={manga.type}
                                    onValueChange={(value: Manga['type']) => handleChange('type', value)}
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
                                    onValueChange={(value: Manga['status']) => handleChange('status', value)}
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
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <h2 className="text-lg font-semibold">Karakterler</h2>
                                <Button size="sm" variant="outline" onClick={() => setShowEntityDialog({ type: 'character' })} className="w-full sm:w-auto">
                                    <Plus className="mr-2 h-4 w-4" />
                                    Yeni Karakter
                                </Button>
                            </div>
                            <div className="grid gap-2">
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <SearchableOptionPicker
                                        options={availableCharacters}
                                        onSelect={addSelectedCharacter}
                                        placeholder="Karakter ara ve ekle..."
                                        searchPlaceholder="Karakter adı yaz..."
                                        emptyMessage="Eşleşen karakter bulunamadı."
                                        getLabel={(character) => character.name}
                                        getSearchValues={(character) => character.alternativeNames || []}
                                        getSecondaryText={(character) => character.alternativeNames?.slice(0, 2).join(' • ')}
                                    />
                                </div>
                                {mangaCharacters.length > 0 ? (
                                    <div className="grid gap-2">
                                        <Input
                                            value={selectedCharacterQuery}
                                            onChange={(e) => {
                                                setSelectedCharacterQuery(e.target.value);
                                                if (!e.target.value.trim()) {
                                                    setShowAllSelectedCharacters(false);
                                                }
                                            }}
                                            placeholder="Eklenmiş karakterlerde ara..."
                                        />
                                        {!normalizedSelectedCharacterQuery && mangaCharacters.length > DEFAULT_ENTITY_PICKER_LIMIT ? (
                                            <p className="text-xs text-muted-foreground">
                                                Eklenmiş karakterler varsayılan olarak ilk {DEFAULT_ENTITY_PICKER_LIMIT} kayıtla gösterilir.
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}
                                <div className="grid gap-3">
                                    {visibleSelectedCharacters.map(char => (
                                        <div
                                            key={char.id}
                                            className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/20 p-3 sm:flex-row sm:items-center"
                                        >
                                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-muted">
                                                    {char.imageUrl ? (
                                                        <img
                                                            src={char.imageUrl}
                                                            className="h-full w-full object-cover"
                                                            onError={(e) => {
                                                                (e.target as HTMLImageElement).src = 'https://via.placeholder.com/40?text=?';
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">?</span>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate font-medium">{char.name}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Bu serideki rolünü ayrı ayarlayabilirsin
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 sm:justify-end">
                                                <Select
                                                    value={char.listingRole || DEFAULT_CHARACTER_LISTING_ROLE}
                                                    onValueChange={(value) => updateCharacterListingRole(char.id, value as CharacterListingRole)}
                                                >
                                                    <SelectTrigger className="w-full sm:w-[170px]">
                                                        <SelectValue placeholder="Rol seçin" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="main">{getCharacterListingRoleLabel('main')}</SelectItem>
                                                        <SelectItem value="supporting">{getCharacterListingRoleLabel('supporting')}</SelectItem>
                                                        <SelectItem value="minor">{getCharacterListingRoleLabel('minor')}</SelectItem>
                                                    </SelectContent>
                                                </Select>

                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="shrink-0 hover:text-destructive"
                                                    onClick={() => {
                                                        setMangaCharacters((current) => current.filter((item) => item.id !== char.id));
                                                    }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                    {normalizedSelectedCharacterQuery && visibleSelectedCharacters.length === 0 ? (
                                        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                                            Aramaya uyan eklenmiş karakter bulunamadı.
                                        </p>
                                    ) : null}
                                </div>
                                {!normalizedSelectedCharacterQuery && !showAllSelectedCharacters && filteredSelectedCharacters.length > visibleSelectedCharacters.length ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => setShowAllSelectedCharacters(true)}
                                    >
                                        Tüm Karakterleri Göster ({filteredSelectedCharacters.length})
                                    </Button>
                                ) : null}
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex flex-col gap-1">
                                <h2 className="text-lg font-semibold">İlgili Seriler / Devam Serileri</h2>
                                <p className="text-sm text-muted-foreground">
                                    Bu özellik kaynak siteden bağımsızdır. Yalnızca ToonParrot içinde mevcut mangalar bağlanabilir.
                                </p>
                            </div>

                            <div className="grid gap-2 lg:grid-cols-[1fr,220px,auto]">
                                <Select value={selectedRelatedMangaId} onValueChange={setSelectedRelatedMangaId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Bağlanacak manga seçin..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allMangaOptions
                                            .filter((item) => item.id !== manga.id && !relatedSeries.some((relation) => relation.relatedMangaId === item.id))
                                            .map((item) => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.title}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>

                                <Select value={selectedRelationType} onValueChange={setSelectedRelationType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="related">İlgili Seri</SelectItem>
                                        <SelectItem value="sequel">Devam Serisi</SelectItem>
                                        <SelectItem value="prequel">Öncesi</SelectItem>
                                        <SelectItem value="spinoff">Spin-off</SelectItem>
                                        <SelectItem value="side_story">Yan Hikaye</SelectItem>
                                        <SelectItem value="adaptation">Adaptasyon</SelectItem>
                                        <SelectItem value="adapted_from">Uyarlama Kaynağı</SelectItem>
                                        <SelectItem value="alternative_version">Alternatif Versiyon</SelectItem>
                                    </SelectContent>
                                </Select>

                                <Button type="button" variant="outline" onClick={addRelatedSeries}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Ekle
                                </Button>
                            </div>

                            {relatedSeries.length > 0 ? (
                                <div className="space-y-2">
                                    {relatedSeries.map((relation) => (
                                        <div
                                            key={`${relation.relatedMangaId}-${relation.relationType}`}
                                            className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div>
                                                <p className="font-medium">{relation.relatedManga?.title || relation.relatedMangaId}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {getMangaRelationTypeLabel(relation.relationType)}
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive"
                                                onClick={() => removeRelatedSeries(relation.relatedMangaId)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    Henüz bir ilişki eklenmedi.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Chapters Section */}
                    <div className="rounded-xl border border-border bg-card p-4 space-y-4 sm:p-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <h2 className="text-lg font-semibold">Bölümler ({manga.chapters?.length || 0})</h2>
                            <Button className="w-full sm:w-auto" onClick={() => {
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
                                        className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
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
                    <div className="rounded-xl border border-border bg-card p-4 space-y-4 sm:p-6">
                        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        {manga.isPublic !== false ? (
                                            <Globe2 className="h-4 w-4 text-emerald-500" />
                                        ) : (
                                            <Lock className="h-4 w-4 text-amber-500" />
                                        )}
                                        <h2 className="text-sm font-semibold">Görünürlük</h2>
                                        <Badge variant="outline" className={manga.isPublic !== false
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                                            : 'border-amber-500/30 bg-amber-500/10 text-amber-600'}>
                                            {manga.isPublic !== false ? 'Public' : 'Private'}
                                        </Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        Private seriler admin panelde kalır, ziyaretçilerde ve listelemelerde gizlenir.
                                    </p>
                                </div>
                                <Switch
                                    checked={manga.isPublic !== false}
                                    onCheckedChange={(checked) => handleChange('isPublic', checked)}
                                    aria-label="Seri görünürlüğünü değiştir"
                                />
                            </div>
                        </div>

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

                        <div className="space-y-3 border-t border-border pt-4">
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Seri Galerisi</label>
                                <p className="text-xs text-muted-foreground">
                                    Her satıra bir görsel URL'si yazın. Bu görseller manga sayfasında `Galeri` sekmesinde gösterilir.
                                </p>
                            </div>
                            <Textarea
                                value={seriesGalleryInput}
                                onChange={(e) => updateSeriesGalleryUrls(e.target.value)}
                                placeholder={'https://example.com/gallery-1.jpg\nhttps://example.com/gallery-2.jpg'}
                                className="min-h-[120px]"
                            />
                            <p className="text-xs text-muted-foreground">
                                {seriesGalleryUrls.length} seri görseli kayıtlı
                            </p>
                            {seriesGalleryUrls.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2">
                                    {seriesGalleryUrls.map((url, index) => (
                                        <div key={`${url}-${index}`} className="space-y-2 rounded-lg border border-border p-2">
                                            <img
                                                src={url}
                                                alt={`Seri galeri ${index + 1}`}
                                                className="aspect-[3/4] w-full rounded-md object-cover"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x400?text=No+Image';
                                                }}
                                            />
                                            <p className="truncate text-[11px] text-muted-foreground">{url}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4 space-y-4 sm:p-6">
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
                <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-2xl">
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
                            <div className="flex flex-col gap-2 sm:flex-row">
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

                    <DialogFooter className="flex-col gap-2 sm:flex-row">
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
                <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] sm:max-w-lg">
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
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button variant="outline" onClick={() => setShowEntityDialog({ type: null })}>İptal</Button>
                        <Button onClick={handleCreateEntity}>Oluştur</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminMangaEditor;
