import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  Languages,
  Loader2,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import ProxyImage from '@/components/media/ProxyImage';
import { getCharacters, getMangaById, getMangaCharacters, getMangaSummaries, getTagsForEntity } from '@/lib/database';
import {
  createDefaultImportOptions,
  filterImportedPreviewByOptions,
  importPreviewIntoManga,
  ImportOptionKey,
  loadMetadataImportPreview,
  MetadataImportSource,
  searchMetadataImportCandidates,
  SOURCE_OPTION_SUPPORT,
  SOURCE_RUNTIME_WARNINGS,
  SourceSearchCandidate,
  type ImportedCharacterDraft,
  type ImportedMangaPayload,
  type ImportedPersonDraft,
  type ImportedRelatedSeriesDraft,
  type TagMatchResult,
} from '@/lib/metadataImport';
import type { Character, EntityGalleryImage, Manga } from '@/lib/types';
import { getCharacterListingRoleLabel } from '@/lib/characterRoles';
import { getMangaRelationTypeLabel } from '@/lib/mangaRelations';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';

const SOURCE_LABELS: Record<MetadataImportSource, string> = {
  anisearch: 'AniSearch',
  myanimelist: 'MyAnimeList',
  mangaupdates: 'MangaUpdates',
  animeplanet: 'Anime-Planet',
};

const OPTION_LABELS: Record<ImportOptionKey, { title: string; description: string }> = {
  manga_core: {
    title: 'Seri Ana Bilgileri',
    description: 'Kapak, açıklama, durum, type, skor ve temel seri metadatası',
  },
  alternative_titles: {
    title: 'Alternatif İsimler',
    description: 'English, native, synonym ve associated name alanları',
  },
  tags: {
    title: 'Türler ve Tagler',
    description: 'Kaynakta bulunan genre ve tag verilerini site etiketlerine ekler',
  },
  related_series: {
    title: 'İlgili Seriler',
    description: 'Local sitede eşleşen devam, öncül ve uyarlama ilişkilerini bağlar',
  },
  authors: {
    title: 'Yazarlar',
    description: 'Author kayıtlarını detaylı metadatalarıyla günceller veya oluşturur',
  },
  artists: {
    title: 'Çizerler',
    description: 'Artist kayıtlarını detaylı metadatalarıyla günceller veya oluşturur',
  },
  characters: {
    title: 'Karakterler',
    description: 'Karakter yaş, cinsiyet, ilişki, sınıf ve benzeri detayları import eder',
  },
  gallery: {
    title: 'Görsel Havuzu',
    description: 'Seri, karakter, author ve artist galerilerini çeker',
  },
};

const DISPLAYED_IMPORT_OPTIONS: ImportOptionKey[] = [
  'manga_core',
  'alternative_titles',
  'tags',
  'related_series',
  'authors',
  'artists',
  'characters',
  'gallery',
];

type PreviewDetailKey =
  | 'alternative_titles'
  | 'tags'
  | 'authors_artists'
  | 'characters'
  | 'related_series'
  | 'gallery';

const DETAIL_LABELS: Record<PreviewDetailKey, string> = {
  alternative_titles: 'Alternatif İsimler',
  tags: 'Tag / Genre',
  authors_artists: 'Yazar / Çizer',
  characters: 'Karakterler',
  related_series: 'İlgili Seriler',
  gallery: 'Galeri',
};

type PreviewSelectionCategory =
  | 'alternative_title'
  | 'tag'
  | 'author'
  | 'artist'
  | 'character'
  | 'related_series'
  | 'series_gallery'
  | 'character_gallery';

interface PreviewToggleItem<TItem> {
  key: string;
  label: string;
  subtitle?: string;
  badgeLabel?: string;
  checked: boolean;
  skipped: boolean;
  skipReason?: string;
  imageUrl?: string;
  item: TItem;
}

interface CharacterGalleryToggleItem extends PreviewToggleItem<EntityGalleryImage> {
  characterKey: string;
  characterName: string;
}

interface PreviewCollections {
  alternativeTitles: PreviewToggleItem<string>[];
  tags: PreviewToggleItem<TagMatchResult | string>[];
  authors: PreviewToggleItem<ImportedPersonDraft>[];
  artists: PreviewToggleItem<ImportedPersonDraft>[];
  characters: PreviewToggleItem<ImportedCharacterDraft>[];
  relatedSeries: PreviewToggleItem<ImportedRelatedSeriesDraft>[];
  seriesGallery: PreviewToggleItem<EntityGalleryImage>[];
  characterGallery: CharacterGalleryToggleItem[];
}

const normalizePreviewKey = (value?: string | null) => value?.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR') || '';

const buildPreviewItemKey = (category: PreviewSelectionCategory, value: string) => (
  `${category}:${normalizePreviewKey(value) || value}`
);

const getPreviewItemChecked = (
  overrides: Record<string, boolean>,
  key: string,
  defaultChecked: boolean,
) => (
  Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : defaultChecked
);

const getInitial = (value?: string | null) => (value?.trim().charAt(0) || '?').toLocaleUpperCase('tr-TR');

interface PreviewDetailDialogProps {
  detailKey: PreviewDetailKey | null;
  preview: ImportedMangaPayload;
  collections: PreviewCollections | null;
  onToggleItem: (key: string, checked: boolean) => void;
  onClose: () => void;
}

const PreviewSelectionRow = ({
  item,
  onToggle,
}: {
  item: PreviewToggleItem<unknown>;
  onToggle: (key: string, checked: boolean) => void;
}) => (
  <label className="flex gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:border-primary/30">
    <Checkbox
      checked={item.checked}
      onCheckedChange={(checked) => onToggle(item.key, Boolean(checked))}
      className="mt-1"
    />
    {item.imageUrl ? (
      <ProxyImage
        src={item.imageUrl}
        alt={item.label}
        className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
      />
    ) : (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-sm font-bold text-muted-foreground">
        {getInitial(item.label)}
      </div>
    )}
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate text-sm font-medium">{item.label}</p>
        {item.badgeLabel ? <Badge variant="secondary">{item.badgeLabel}</Badge> : null}
        <Badge variant={item.checked ? 'default' : 'secondary'}>
          {item.checked ? 'İçe Aktar' : 'Atla'}
        </Badge>
      </div>
      {item.subtitle ? (
        <p className="text-xs text-muted-foreground">{item.subtitle}</p>
      ) : null}
      {item.skipped && item.skipReason ? (
        <p className="text-xs text-amber-300">{item.skipReason}</p>
      ) : null}
    </div>
  </label>
);

const PreviewDetailDialog: React.FC<PreviewDetailDialogProps> = ({
  detailKey,
  preview,
  collections,
  onToggleItem,
  onClose,
}) => {
  if (!detailKey) return null;

  const renderContent = () => {
    if (!collections) {
      return <p className="text-sm text-muted-foreground">Detay verisi hazırlanıyor.</p>;
    }

    switch (detailKey) {
      case 'alternative_titles':
        return (
          <div className="space-y-1">
            {collections.alternativeTitles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              collections.alternativeTitles.map((item) => (
                <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
              ))
            )}
          </div>
        );

      case 'tags': {
        return (
          <div className="space-y-2">
            {collections.tags.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Gösterilecek etiket veya tür bulunamadı.</p>
            ) : (
              collections.tags.map((item) => (
                <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
              ))
            )}
          </div>
        );
      }

      case 'authors_artists':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Yazarlar</p>
              {collections.authors.length === 0 ? (
                <p className="text-sm text-muted-foreground">Yazar verisi bulunamadı.</p>
              ) : (
                collections.authors.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Çizerler</p>
              {collections.artists.length === 0 ? (
                <p className="text-sm text-muted-foreground">Çizer verisi bulunamadı.</p>
              ) : (
                collections.artists.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>
          </div>
        );

      case 'characters':
        return (
          <div className="space-y-2">
            {collections.characters.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              collections.characters.map((item) => (
                <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
              ))
            )}
          </div>
        );

      case 'related_series':
        return (
          <div className="space-y-2">
            {collections.relatedSeries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              collections.relatedSeries.map((item) => (
                <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
              ))
            )}
          </div>
        );

      case 'gallery':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Seri Galerisi</p>
              {collections.seriesGallery.length === 0 ? (
                <p className="text-sm text-muted-foreground">Seriye ait galeri bulunamadı.</p>
              ) : (
                collections.seriesGallery.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Karakter Galerileri</p>
              {collections.characterGallery.length === 0 ? (
                <p className="text-sm text-muted-foreground">Karakter galerisi bulunamadı.</p>
              ) : (
                collections.characterGallery.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-2">
            {preview.gallery.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Gösterim desteklenmiyor.</p>
            )}
          </div>
        );
    }
  };

  return (
    <Dialog open={!!detailKey} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{detailKey ? DETAIL_LABELS[detailKey] : ''}</DialogTitle>
          <DialogDescription>
            Import edilecek verilerin detaylı listesi
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          {renderContent()}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

const AdminMetadataImport: React.FC = () => {
  const { isAllowed, isLoading: accessLoading } = useAdminPageGuard({ requiredRole: 'admin' });
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [allLocalCharacters, setAllLocalCharacters] = useState<Character[]>([]);
  const [mangaFilter, setMangaFilter] = useState('');
  const [selectedMangaId, setSelectedMangaId] = useState('');
  const [selectedLocalManga, setSelectedLocalManga] = useState<Manga | null>(null);
  const [selectedLocalCharacters, setSelectedLocalCharacters] = useState<Character[]>([]);
  const [selectedLocalTags, setSelectedLocalTags] = useState<string[]>([]);
  const [source, setSource] = useState<MetadataImportSource>('myanimelist');
  const [query, setQuery] = useState('');
  const [enabledOptions, setEnabledOptions] = useState(createDefaultImportOptions('myanimelist'));
  const [importAsPublic, setImportAsPublic] = useState(true);
  const [translateToTurkish, setTranslateToTurkish] = useState(true);
  const [searching, setSearching] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState<SourceSearchCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [preview, setPreview] = useState<ImportedMangaPayload | null>(null);
  const [detailDialogKey, setDetailDialogKey] = useState<PreviewDetailKey | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAllowed) {
      return;
    }

    void (async () => {
      const [mangaData, characterData] = await Promise.all([
        getMangaSummaries(),
        getCharacters({ includePrivate: true }),
      ]);
      setMangas(mangaData);
      setAllLocalCharacters(characterData);
      if (mangaData[0]) {
        setSelectedMangaId(mangaData[0].id);
      }
    })();
  }, [isAllowed]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedMangaId) {
      setSelectedLocalManga(null);
      setSelectedLocalCharacters([]);
      setSelectedLocalTags([]);
      return;
    }

    void (async () => {
      try {
        const [mangaDetail, characters, tags] = await Promise.all([
          getMangaById(selectedMangaId, { includePrivate: true, includePages: true }),
          getMangaCharacters(selectedMangaId, { includePrivate: true }),
          getTagsForEntity('manga', selectedMangaId),
        ]);

        if (cancelled) {
          return;
        }

        setSelectedLocalManga(mangaDetail || null);
        setSelectedLocalCharacters(characters);
        setSelectedLocalTags(tags.map((tag) => tag.name));
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setSelectedLocalManga(null);
          setSelectedLocalCharacters([]);
          setSelectedLocalTags([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMangaId]);

  const filteredMangas = useMemo(() => {
    const filterKey = mangaFilter.trim().toLocaleLowerCase('tr-TR');
    if (!filterKey) {
      return mangas;
    }

    return mangas.filter((manga) =>
      [manga.title, ...(manga.alternativeTitles || [])]
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(filterKey),
    );
  }, [mangaFilter, mangas]);

  const selectedCandidate = useMemo(
    () => candidates.find((item) => item.id === selectedCandidateId),
    [candidates, selectedCandidateId],
  );

  const effectivePreview = useMemo(
    () => (preview ? filterImportedPreviewByOptions(preview, enabledOptions) : null),
    [enabledOptions, preview],
  );

  const previewCollections = useMemo<PreviewCollections | null>(() => {
    if (!effectivePreview) {
      return null;
    }

    const existingTitleKeys = new Set(
      [selectedLocalManga?.title, ...(selectedLocalManga?.alternativeTitles || [])]
        .map((value) => normalizePreviewKey(value))
        .filter(Boolean),
    );
    const existingGenreKeys = new Set((selectedLocalManga?.genres || []).map((value) => normalizePreviewKey(value)).filter(Boolean));
    const existingTagKeys = new Set(selectedLocalTags.map((value) => normalizePreviewKey(value)).filter(Boolean));
    const existingAuthorKeys = new Set(
      [
        ...(selectedLocalManga?.authorsDetails || []).map((author) => author.name),
        ...(selectedLocalManga?.author?.split(',') || []),
      ].map((value) => normalizePreviewKey(value)).filter(Boolean),
    );
    const existingArtistKeys = new Set(
      [
        ...(selectedLocalManga?.artistsDetails || []).map((artist) => artist.name),
        ...(selectedLocalManga?.artist?.split(',') || []),
      ].map((value) => normalizePreviewKey(value)).filter(Boolean),
    );
    const existingCharacterKeys = new Set(selectedLocalCharacters.map((character) => normalizePreviewKey(character.name)).filter(Boolean));
    const existingGlobalCharacterMap = new Map(
      allLocalCharacters
        .map((character) => [normalizePreviewKey(character.name), character] as const)
        .filter(([key]) => Boolean(key)),
    );
    const existingRelatedKeys = new Set(
      (selectedLocalManga?.relatedSeries || [])
        .flatMap((relation) => [
          relation.relatedManga?.title,
          relation.relatedMangaId,
        ])
        .map((value) => normalizePreviewKey(value))
        .filter(Boolean),
    );
    const existingSeriesGalleryKeys = new Set(
      (Array.isArray(selectedLocalManga?.details?.extra?.seriesGallery) ? selectedLocalManga?.details?.extra?.seriesGallery : [])
        .map((value) => normalizePreviewKey(typeof value === 'string' ? value : ''))
        .filter(Boolean),
    );

    const alternativeTitles = effectivePreview.alternativeTitles.map((title) => {
      const key = buildPreviewItemKey('alternative_title', title);
      const skipped = existingTitleKeys.has(normalizePreviewKey(title));
      return {
        key,
        label: title,
        checked: getPreviewItemChecked(previewOverrides, key, !skipped),
        skipped,
        skipReason: skipped ? 'Bu alternatif isim zaten mangada var' : undefined,
        item: title,
      } satisfies PreviewToggleItem<string>;
    });

    const tags = (effectivePreview.tagMatches?.length ? effectivePreview.tagMatches : effectivePreview.tags).map((tagEntry) => {
      const isObjectEntry = typeof tagEntry !== 'string';
      const sourceTag = isObjectEntry ? tagEntry.sourceTag : tagEntry;
      const matchedName = isObjectEntry ? (tagEntry.genreMatchName || tagEntry.matchedTag?.name || tagEntry.sourceTag) : sourceTag;
      const isGenre = isObjectEntry ? Boolean(tagEntry.isStandardGenre) : existingGenreKeys.has(normalizePreviewKey(sourceTag));
      const skipped = isGenre
        ? existingGenreKeys.has(normalizePreviewKey(matchedName))
        : existingTagKeys.has(normalizePreviewKey(matchedName));
      const key = buildPreviewItemKey('tag', sourceTag);

      return {
        key,
        label: sourceTag,
        subtitle: isObjectEntry
          ? (
              tagEntry.isStandardGenre
                ? `Tür eşleşmesi: ${matchedName}`
                : tagEntry.isMatched
                  ? `Eşleşen etiket: ${matchedName}`
                  : 'Yeni etiket oluşturulacak'
            )
          : undefined,
        badgeLabel: isGenre ? 'Tür' : isObjectEntry && !tagEntry.isMatched ? 'Yeni' : 'Etiket',
        checked: getPreviewItemChecked(previewOverrides, key, !skipped),
        skipped,
        skipReason: skipped
          ? (isGenre ? 'Bu tür zaten mangada var' : 'Bu etiket zaten mangaya bağlı')
          : undefined,
        item: tagEntry,
      } satisfies PreviewToggleItem<TagMatchResult | string>;
    });

    const authors = effectivePreview.authors.map((author) => {
      const key = buildPreviewItemKey('author', author.name);
      const alreadyLinked = existingAuthorKeys.has(normalizePreviewKey(author.name));
      return {
        key,
        label: author.name,
        subtitle: alreadyLinked
          ? 'Zaten bağlı, seçili kalırsa metadata güncellenecek'
          : (author.description || author.details?.nativeName),
        badgeLabel: 'Yazar',
        imageUrl: author.imageUrl,
        checked: getPreviewItemChecked(previewOverrides, key, true),
        skipped: false,
        skipReason: undefined,
        item: author,
      } satisfies PreviewToggleItem<ImportedPersonDraft>;
    });

    const artists = effectivePreview.artists.map((artist) => {
      const key = buildPreviewItemKey('artist', artist.name);
      const alreadyLinked = existingArtistKeys.has(normalizePreviewKey(artist.name));
      return {
        key,
        label: artist.name,
        subtitle: alreadyLinked
          ? 'Zaten bağlı, seçili kalırsa metadata güncellenecek'
          : (artist.description || artist.details?.nativeName),
        badgeLabel: 'Çizer',
        imageUrl: artist.imageUrl,
        checked: getPreviewItemChecked(previewOverrides, key, true),
        skipped: false,
        skipReason: undefined,
        item: artist,
      } satisfies PreviewToggleItem<ImportedPersonDraft>;
    });

    const characters = effectivePreview.characters.map((character) => {
      const key = buildPreviewItemKey('character', character.name);
      const alreadyLinked = existingCharacterKeys.has(normalizePreviewKey(character.name));
      const existingGlobalCharacter = existingGlobalCharacterMap.get(normalizePreviewKey(character.name));
      return {
        key,
        label: character.name,
        subtitle: alreadyLinked
          ? 'Zaten bağlı, seçili kalırsa rol ve metadata güncellenecek'
          : existingGlobalCharacter
            ? 'Sistemde mevcut, seçili kalırsa bu mangaya bağlanıp rol ve metadata güncellenecek'
          : (character.description || character.details?.nativeName),
        badgeLabel: character.roleType ? getCharacterListingRoleLabel(character.roleType) : (character.roleLabel || 'Karakter'),
        imageUrl: character.imageUrl,
        checked: getPreviewItemChecked(previewOverrides, key, true),
        skipped: false,
        skipReason: undefined,
        item: character,
      } satisfies PreviewToggleItem<ImportedCharacterDraft>;
    });

    const characterCheckedMap = new Map(characters.map((character) => [character.key, character.checked]));

    const relatedSeries = effectivePreview.relatedSeries.map((series) => {
      const key = buildPreviewItemKey('related_series', series.title);
      const skipped = existingRelatedKeys.has(normalizePreviewKey(series.title));
      return {
        key,
        label: series.title,
        subtitle: series.sourceUrl || undefined,
        badgeLabel: getMangaRelationTypeLabel(series.relationType),
        checked: getPreviewItemChecked(previewOverrides, key, !skipped),
        skipped,
        skipReason: skipped ? 'Bu ilişki zaten mangada var' : undefined,
        item: series,
      } satisfies PreviewToggleItem<ImportedRelatedSeriesDraft>;
    });

    const seriesGallery = effectivePreview.gallery.map((image, index) => {
      const key = buildPreviewItemKey('series_gallery', image.url);
      const skipped = existingSeriesGalleryKeys.has(normalizePreviewKey(image.url));
      return {
        key,
        label: image.label || `Seri Görseli ${index + 1}`,
        subtitle: image.url,
        badgeLabel: 'Seri',
        imageUrl: image.thumbUrl || image.url,
        checked: getPreviewItemChecked(previewOverrides, key, !skipped),
        skipped,
        skipReason: skipped ? 'Bu görsel seri galerisinde zaten var' : undefined,
        item: image,
      } satisfies PreviewToggleItem<EntityGalleryImage>;
    });

    const characterGallery = effectivePreview.characters.flatMap((character) => {
      const characterKey = buildPreviewItemKey('character', character.name);
      const parentChecked = characterCheckedMap.get(characterKey) ?? true;

      return character.gallery.map((image, index) => {
        const key = buildPreviewItemKey('character_gallery', `${character.name}:${image.url}`);
        return {
          key,
          label: image.label || `${character.name} Görseli ${index + 1}`,
          subtitle: character.name,
          badgeLabel: character.roleType ? getCharacterListingRoleLabel(character.roleType) : (character.roleLabel || 'Karakter'),
          imageUrl: image.thumbUrl || image.url,
          checked: getPreviewItemChecked(previewOverrides, key, parentChecked),
          skipped: !parentChecked,
          skipReason: !parentChecked ? 'Karakter importtan çıkarıldığı için bu galeri de atlanacak' : undefined,
          item: image,
          characterKey,
          characterName: character.name,
        } satisfies CharacterGalleryToggleItem;
      });
    });

    return {
      alternativeTitles,
      tags,
      authors,
      artists,
      characters,
      relatedSeries,
      seriesGallery,
      characterGallery,
    };
  }, [allLocalCharacters, effectivePreview, previewOverrides, selectedLocalCharacters, selectedLocalManga, selectedLocalTags]);

  const filteredPreview = useMemo<ImportedMangaPayload | null>(() => {
    if (!effectivePreview || !previewCollections) {
      return null;
    }

    const selectedCharacterGalleryMap = new Map<string, EntityGalleryImage[]>();
    previewCollections.characterGallery
      .filter((item) => item.checked)
      .forEach((item) => {
        const existing = selectedCharacterGalleryMap.get(item.characterKey) || [];
        existing.push(item.item);
        selectedCharacterGalleryMap.set(item.characterKey, existing);
      });

    return {
      ...effectivePreview,
      alternativeTitles: previewCollections.alternativeTitles.filter((item) => item.checked).map((item) => item.item),
      tags: previewCollections.tags.filter((item) => item.checked).map((item) => typeof item.item === 'string' ? item.item : item.item.sourceTag),
      tagMatches: effectivePreview.tagMatches
        ? previewCollections.tags
          .filter((item): item is PreviewToggleItem<TagMatchResult> => item.checked && typeof item.item !== 'string')
          .map((item) => item.item)
        : undefined,
      authors: previewCollections.authors.filter((item) => item.checked).map((item) => item.item),
      artists: previewCollections.artists.filter((item) => item.checked).map((item) => item.item),
      characters: previewCollections.characters
        .filter((item) => item.checked)
        .map((item) => ({
          ...item.item,
          gallery: selectedCharacterGalleryMap.get(item.key) || [],
        })),
      relatedSeries: previewCollections.relatedSeries.filter((item) => item.checked).map((item) => item.item),
      gallery: previewCollections.seriesGallery.filter((item) => item.checked).map((item) => item.item),
    };
  }, [effectivePreview, previewCollections]);

  const previewCounts = useMemo(() => {
    if (!previewCollections) {
      return null;
    }

    return {
      alternativeTitles: {
        selected: previewCollections.alternativeTitles.filter((item) => item.checked).length,
        total: previewCollections.alternativeTitles.length,
      },
      tags: {
        selected: previewCollections.tags.filter((item) => item.checked).length,
        total: previewCollections.tags.length,
      },
      authors: {
        selected: previewCollections.authors.filter((item) => item.checked).length,
        total: previewCollections.authors.length,
      },
      artists: {
        selected: previewCollections.artists.filter((item) => item.checked).length,
        total: previewCollections.artists.length,
      },
      characters: {
        selected: previewCollections.characters.filter((item) => item.checked).length,
        total: previewCollections.characters.length,
      },
      relatedSeries: {
        selected: previewCollections.relatedSeries.filter((item) => item.checked).length,
        total: previewCollections.relatedSeries.length,
      },
      gallery: {
        selected: [
          ...previewCollections.seriesGallery,
          ...previewCollections.characterGallery,
        ].filter((item) => item.checked).length,
        total: previewCollections.seriesGallery.length + previewCollections.characterGallery.length,
      },
    };
  }, [previewCollections]);

  const handleSourceChange = (nextSource: MetadataImportSource) => {
    setSource(nextSource);
    setEnabledOptions(createDefaultImportOptions(nextSource));
    setCandidates([]);
    setSelectedCandidateId('');
    setPreview(null);
    setPreviewOverrides({});
  };

  const handleTogglePreviewItem = (key: string, checked: boolean) => {
    setPreviewOverrides((current) => ({
      ...current,
      [key]: checked,
    }));
  };

  const handleOptionChange = (option: ImportOptionKey, checked: boolean) => {
    const support = SOURCE_OPTION_SUPPORT[source][option];
    if (!support) {
      return;
    }

    setEnabledOptions((current) => ({
      ...current,
      [option]: checked,
    }));
  };

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();

    if (!query.trim()) {
      toast.error('Kaynak site için isim veya direkt link gir');
      return;
    }

    setSearching(true);
    setPreview(null);
    setPreviewOverrides({});
    setCandidates([]);
    setSelectedCandidateId('');

    try {
      const results = await searchMetadataImportCandidates(source, query);
      setCandidates(results);

      if (results[0]) {
        setSelectedCandidateId(results[0].id);
      }

      if (results.length === 0) {
        toast.error('Sonuç bulunamadı');
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Kaynak araması başarısız oldu');
    } finally {
      setSearching(false);
    }
  };

  const handlePreviewLoad = async () => {
    if (!selectedCandidate) {
      toast.error('Önce bir kaynak kaydı seç');
      return;
    }

    setPreviewLoading(true);
    setPreview(null);
    setPreviewOverrides({});

    try {
      const data = await loadMetadataImportPreview(selectedCandidate, enabledOptions, { translateToTurkish });
      setPreview(data);
      toast.success('Önizleme hazırlandı');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Önizleme yüklenemedi');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedMangaId || !filteredPreview) {
      toast.error('Import için manga ve önizleme seçilmeli');
      return;
    }

    setImporting(true);
    try {
      await importPreviewIntoManga(selectedMangaId, filteredPreview, {
        enabledOptions,
        importAsPublic,
        translateToTurkish,
      });
      toast.success('Veriler seçilen manga içine aktarıldı');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Import sırasında hata oluştu');
    } finally {
      setImporting(false);
    }
  };

  if (accessLoading || !isAllowed) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Harici Metadata Import</h1>
        <p className="text-sm text-muted-foreground">
          Manga kaydını seç, kaynak siteyi belirle, hangi veri tiplerinin çekileceğini işaretle ve önizleme ile import et.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Import Ayarları</CardTitle>
              <CardDescription>
                Seri seçimi, kaynak seçimi ve veri tipleri burada kontrol edilir.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="manga-filter">Local Manga Filtrele</Label>
                  <Input
                    id="manga-filter"
                    value={mangaFilter}
                    onChange={(event) => setMangaFilter(event.target.value)}
                    placeholder="Site içindeki manga adında ara"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manga-select">Seçilen Manga</Label>
                  <Select value={selectedMangaId} onValueChange={setSelectedMangaId}>
                    <SelectTrigger id="manga-select">
                      <SelectValue placeholder="Manga seç" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredMangas.slice(0, 200).map((manga) => (
                        <SelectItem key={manga.id} value={manga.id}>
                          {manga.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="source-select">Kaynak Site</Label>
                  <Select value={source} onValueChange={(value) => handleSourceChange(value as MetadataImportSource)}>
                    <SelectTrigger id="source-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Görünürlük</p>
                    <p className="text-xs text-muted-foreground">
                      Import edilen character, author ve artist kayıtları public mi olsun?
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={importAsPublic ? 'default' : 'secondary'}>
                      {importAsPublic ? 'Public' : 'Private'}
                    </Badge>
                    <Switch checked={importAsPublic} onCheckedChange={setImportAsPublic} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Languages className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Türkçeye Çevir</p>
                    <p className="text-xs text-muted-foreground">
                      Açıklamaları ve biyografileri otomatik olarak Türkçeye çevirir (Google Translate)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={translateToTurkish ? 'default' : 'secondary'}>
                    {translateToTurkish ? 'Açık' : 'Kapalı'}
                  </Badge>
                  <Switch checked={translateToTurkish} onCheckedChange={setTranslateToTurkish} />
                </div>
              </div>

              {SOURCE_RUNTIME_WARNINGS[source] ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <p>{SOURCE_RUNTIME_WARNINGS[source]}</p>
                </div>
              ) : null}

              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Çekilecek Veri Tipleri</h2>
                  <p className="text-xs text-muted-foreground">
                    Seçilen kaynağa göre desteklenen alanlar değişir.
                  </p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {DISPLAYED_IMPORT_OPTIONS.map((option) => {
                    const support = SOURCE_OPTION_SUPPORT[source][option];
                    const isChecked = Boolean(enabledOptions[option] && support);

                    return (
                      <label
                        key={option}
                        className={`flex gap-3 rounded-xl border px-4 py-3 transition-colors ${
                          support ? 'border-border bg-card hover:border-primary/30' : 'border-dashed border-border/70 bg-muted/20 opacity-70'
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          disabled={!support}
                          onCheckedChange={(checked) => handleOptionChange(option, Boolean(checked))}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{OPTION_LABELS[option].title}</span>
                            <Badge variant={support ? 'default' : 'secondary'}>
                              {support ? 'Destekleniyor' : 'Desteklenmiyor'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {OPTION_LABELS[option].description}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <form className="space-y-3" onSubmit={handleSearch}>
                <Label htmlFor="source-query">Kaynak Arama / Direkt Link</Label>
                <div className="flex flex-col gap-3 md:flex-row">
                  <Input
                    id="source-query"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Solo Leveling veya direkt kaynak URL yapıştır"
                  />
                  <Button type="submit" disabled={searching}>
                    {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Kaynağı Tara
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kaynak Sonuçları</CardTitle>
              <CardDescription>
                Eşleşen seri kaydını seç ve önizlemesini hazırla.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {candidates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Henüz arama sonucu yok.
                </div>
              ) : (
                candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={`flex flex-col gap-3 rounded-xl border px-4 py-4 lg:flex-row lg:items-center lg:justify-between ${
                      selectedCandidateId === candidate.id ? 'border-primary bg-primary/5' : 'border-border bg-card'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="text-left text-sm font-semibold hover:text-primary"
                          onClick={() => setSelectedCandidateId(candidate.id)}
                        >
                          {candidate.title}
                        </button>
                        <Badge variant="secondary">{SOURCE_LABELS[candidate.source]}</Badge>
                      </div>
                      {candidate.subtitle ? (
                        <p className="text-xs text-muted-foreground">{candidate.subtitle}</p>
                      ) : null}
                      <a
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                        href={candidate.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Kaynak linki
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setSelectedCandidateId(candidate.id)}>
                        Seç
                      </Button>
                    </div>
                  </div>
                ))
              )}

              <div className="flex justify-end">
                <Button onClick={handlePreviewLoad} disabled={!selectedCandidate || previewLoading}>
                  {previewLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Önizleme Yükle
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Önizleme</CardTitle>
              <CardDescription>
                Import öncesi çekilecek veri yoğunluğunu burada kontrol et.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!effectivePreview ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Önizleme henüz hazır değil.
                </div>
              ) : (
                <>
                  <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{effectivePreview.sourceTitle}</h2>
                      <Badge>{SOURCE_LABELS[effectivePreview.source]}</Badge>
                    </div>
                    <a
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      href={effectivePreview.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Kaynak sayfasını aç
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {effectivePreview.description ? (
                      <p className="line-clamp-5 text-sm text-muted-foreground">
                        {effectivePreview.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      className="group rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      onClick={() => setDetailDialogKey('alternative_titles')}
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Alternatif İsim</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-lg font-semibold">
                          {previewCounts ? `${previewCounts.alternativeTitles.selected} / ${previewCounts.alternativeTitles.total}` : effectivePreview.alternativeTitles.length}
                        </p>
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                    <button
                      type="button"
                      className="group rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      onClick={() => setDetailDialogKey('tags')}
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Tag / Genre</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-lg font-semibold">
                          {previewCounts ? `${previewCounts.tags.selected} / ${previewCounts.tags.total}` : effectivePreview.tags.length}
                        </p>
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                    <button
                      type="button"
                      className="group rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      onClick={() => setDetailDialogKey('authors_artists')}
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Yazar / Çizer</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-lg font-semibold">
                          {previewCounts
                            ? `${previewCounts.authors.selected}/${previewCounts.authors.total} • ${previewCounts.artists.selected}/${previewCounts.artists.total}`
                            : `${effectivePreview.authors.length} / ${effectivePreview.artists.length}`}
                        </p>
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                    <button
                      type="button"
                      className="group rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      onClick={() => setDetailDialogKey('characters')}
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Karakter</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-lg font-semibold">
                          {previewCounts ? `${previewCounts.characters.selected} / ${previewCounts.characters.total}` : effectivePreview.characters.length}
                        </p>
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                    <button
                      type="button"
                      className="group rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      onClick={() => setDetailDialogKey('related_series')}
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">İlgili Seri</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-lg font-semibold">
                          {previewCounts ? `${previewCounts.relatedSeries.selected} / ${previewCounts.relatedSeries.total}` : effectivePreview.relatedSeries.length}
                        </p>
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                    <button
                      type="button"
                      className="group rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      onClick={() => setDetailDialogKey('gallery')}
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Galeri</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-lg font-semibold">
                          {previewCounts
                            ? `${previewCounts.gallery.selected} / ${previewCounts.gallery.total}`
                            : effectivePreview.gallery.length + effectivePreview.characters.reduce((sum, item) => sum + item.gallery.length, 0)}
                        </p>
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                  </div>

                  {previewCounts ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
                      Önizleme detaylarına girip işaretleri değiştirebilirsin. Varsayılan olarak sitede zaten bulunan veriler `Atla` durumuna çekilir.
                    </div>
                  ) : null}

                  {effectivePreview.warnings.length > 0 ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                      <p className="text-sm font-medium text-amber-100">Runtime Uyarıları</p>
                      <ul className="mt-2 space-y-1 text-xs text-amber-50">
                        {effectivePreview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <PreviewDetailDialog
                    detailKey={detailDialogKey}
                    preview={effectivePreview}
                    collections={previewCollections}
                    onToggleItem={handleTogglePreviewItem}
                    onClose={() => setDetailDialogKey(null)}
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Import Et</CardTitle>
              <CardDescription>
                Önizleme doğruysa seçilen local manga kaydına verileri merge et.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border px-4 py-3 text-sm">
                <p className="font-medium">Seçilen Local Manga</p>
                <p className="mt-1 text-muted-foreground">
                  {mangas.find((item) => item.id === selectedMangaId)?.title || 'Manga seçilmedi'}
                </p>
              </div>

              <Button className="w-full" disabled={!filteredPreview || !selectedMangaId || importing} onClick={handleImport}>
                {importing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Import Başlat
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminMetadataImport;
