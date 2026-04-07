import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
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
import { getAllTags, getArtists, getAuthors, getCharacters, getMangaById, getMangaCharacters, getMangaSummaries, getTagsForEntity } from '@/lib/database';
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
import type { Artist, Author, Character, EntityGalleryImage, Manga, Tag } from '@/lib/types';
import { getCharacterListingRoleLabel } from '@/lib/characterRoles';
import { getMangaRelationTypeLabel } from '@/lib/mangaRelations';
import { normalizeComparableText } from '@/lib/textMatching';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';

const SOURCE_LABELS: Record<MetadataImportSource, string> = {
  anisearch: 'AniSearch',
  myanimelist: 'MyAnimeList',
  mangaupdates: 'MangaUpdates',
  animeplanet: 'Anime-Planet',
  fandom: 'Wiki / Fandom',
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
  matchState: 'matched' | 'new';
  matchableType?: MatchableEntityType;
  matchedEntity?: ManualEntityMatchSelection;
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

type MatchableEntityType = 'author' | 'artist' | 'character' | 'tag';

interface ManualEntityMatchSelection {
  id: string;
  name: string;
  type: MatchableEntityType;
}

interface LocalMatchableEntityOption {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  alternativeNames?: string[];
}

interface MatchDialogState {
  itemKey: string;
  itemLabel: string;
  entityType: MatchableEntityType;
}

type PreviewMatchFilter = 'all' | 'matched' | 'new';

const toPreviewText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${value}`;
  }

  if (value && typeof value === 'object') {
    if ('name' in value && typeof value.name === 'string') {
      return value.name;
    }

    if ('sourceTag' in value && typeof value.sourceTag === 'string') {
      return value.sourceTag;
    }

    if ('title' in value && typeof value.title === 'string') {
      return value.title;
    }

    if ('url' in value && typeof value.url === 'string') {
      return value.url;
    }
  }

  return '';
};

const normalizePreviewKey = (value?: unknown) => (
  normalizeComparableText(toPreviewText(value))
);

const buildPreviewItemKey = (
  category: PreviewSelectionCategory,
  value: unknown,
  disambiguator?: unknown,
) => {
  const normalizedValue = normalizePreviewKey(value) || toPreviewText(value) || 'item';
  const normalizedDisambiguator = normalizePreviewKey(disambiguator) || toPreviewText(disambiguator);

  return normalizedDisambiguator
    ? `${category}:${normalizedValue}:${normalizedDisambiguator}`
    : `${category}:${normalizedValue}`;
};

const getPreviewItemChecked = (
  overrides: Record<string, boolean>,
  key: string,
  defaultChecked: boolean,
) => (
  Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : defaultChecked
);

const getInitial = (value?: string | null) => (value?.trim().charAt(0) || '?').toLocaleUpperCase('tr-TR');

const buildEntityMatchLookup = <
  T extends {
    id: string;
    name?: string;
    title?: string;
    alternativeNames?: string[];
    alternativeTitles?: string[];
  },
>(items: T[]) => {
  const lookup = new Map<string, T>();

  items.forEach((item) => {
    [
      item.name || item.title || '',
      ...(item.alternativeNames || []),
      ...(item.alternativeTitles || []),
    ].forEach((value) => {
      const key = normalizePreviewKey(value);
      if (key && !lookup.has(key)) {
        lookup.set(key, item);
      }
    });
  });

  return lookup;
};

const getPreviewMatchCounts = (items: PreviewToggleItem<unknown>[]) => ({
  matched: items.filter((item) => item.matchState === 'matched').length,
  new: items.filter((item) => item.matchState === 'new').length,
});

const applyPreviewMatchFilter = <TItem,>(items: PreviewToggleItem<TItem>[], filter: PreviewMatchFilter) => (
  filter === 'all'
    ? items
    : items.filter((item) => item.matchState === filter)
);

interface PreviewDetailDialogProps {
  detailKey: PreviewDetailKey | null;
  preview: ImportedMangaPayload;
  collections: PreviewCollections | null;
  onToggleItem: (key: string, checked: boolean) => void;
  onToggleItems: (keys: string[], checked: boolean) => void;
  onOpenMatchDialog: (item: PreviewToggleItem<unknown>) => void;
  onClearMatch: (key: string) => void;
  onClose: () => void;
}

const PreviewSelectionRow = ({
  item,
  onToggle,
  onOpenMatch,
  onClearMatch,
}: {
  item: PreviewToggleItem<unknown>;
  onToggle: (key: string, checked: boolean) => void;
  onOpenMatch?: (item: PreviewToggleItem<unknown>) => void;
  onClearMatch?: (key: string) => void;
}) => (
  <div className="flex gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:border-primary/30">
    <Checkbox
      checked={item.checked}
      onCheckedChange={(checked) => onToggle(item.key, Boolean(checked))}
      className="mt-1"
    />
    {item.imageUrl ? (
      <ProxyImage
        src={item.imageUrl}
        alt={item.label}
        allowProxy
        className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
      />
    ) : (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-sm font-bold text-muted-foreground">
        {getInitial(item.label)}
      </div>
    )}
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{item.label}</p>
          {item.badgeLabel ? <Badge variant="secondary">{item.badgeLabel}</Badge> : null}
          <Badge variant={item.matchState === 'matched' ? 'secondary' : 'outline'}>
            {item.matchState === 'matched' ? 'Eşleşen' : 'Yeni'}
          </Badge>
          <Badge variant={item.checked ? 'default' : 'secondary'}>
            {item.checked ? 'İçe Aktar' : 'Atla'}
          </Badge>
          {item.matchedEntity ? <Badge variant="secondary">Eşleşti</Badge> : null}
        </div>
        {item.matchableType ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" variant={item.matchedEntity ? 'secondary' : 'outline'} onClick={() => onOpenMatch?.(item)}>
              {item.matchedEntity ? 'Eşleşmeyi Değiştir' : 'Eşleştir'}
            </Button>
            {item.matchedEntity ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => onClearMatch?.(item.key)}>
                Kaldır
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {item.subtitle ? (
        <p className="text-xs text-muted-foreground">{item.subtitle}</p>
      ) : null}
      {item.skipped && item.skipReason ? (
        <p className="text-xs text-amber-300">{item.skipReason}</p>
      ) : null}
    </div>
  </div>
);

const PreviewSelectionToolbar = ({
  items,
  visibleItems,
  onToggleItems,
  filter,
  onFilterChange,
}: {
  items: PreviewToggleItem<unknown>[];
  visibleItems: PreviewToggleItem<unknown>[];
  onToggleItems: (keys: string[], checked: boolean) => void;
  filter: PreviewMatchFilter;
  onFilterChange: (filter: PreviewMatchFilter) => void;
}) => {
  if (items.length === 0) {
    return null;
  }

  const targetItems = visibleItems.length > 0 ? visibleItems : items;
  const keys = targetItems.map((item) => item.key);
  const allSelected = targetItems.every((item) => item.checked);
  const noneSelected = targetItems.every((item) => !item.checked);
  const counts = getPreviewMatchCounts(items);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Eşleşen {counts.matched}</Badge>
        <Badge variant="outline">Yeni {counts.new}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <Button type="button" size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => onFilterChange('all')}>
            Tümü
          </Button>
          <Button type="button" size="sm" variant={filter === 'matched' ? 'secondary' : 'ghost'} onClick={() => onFilterChange('matched')}>
            Eşleşen
          </Button>
          <Button type="button" size="sm" variant={filter === 'new' ? 'secondary' : 'ghost'} onClick={() => onFilterChange('new')}>
            Yeni
          </Button>
        </div>

        <Button type="button" size="sm" variant="outline" disabled={allSelected || keys.length === 0} onClick={() => onToggleItems(keys, true)}>
          Tümünü Seç
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={noneSelected || keys.length === 0} onClick={() => onToggleItems(keys, false)}>
          Tümünü Kaldır
        </Button>
      </div>
    </div>
  );
};

const ManualEntityMatchDialog = ({
  state,
  candidates,
  linkedEntityIds,
  currentMatchId,
  onClose,
  onSelect,
}: {
  state: MatchDialogState | null;
  candidates: LocalMatchableEntityOption[];
  linkedEntityIds: Set<string>;
  currentMatchId?: string;
  onClose: () => void;
  onSelect: (selection: ManualEntityMatchSelection) => void;
}) => {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (state) {
      setSearch(state.itemLabel);
    } else {
      setSearch('');
    }
  }, [state]);

  const filteredCandidates = useMemo(() => {
    const queryKey = normalizeComparableText(deferredSearch);
    const items = !queryKey
      ? candidates
      : candidates.filter((candidate) => normalizeComparableText([
        candidate.name,
        ...(candidate.alternativeNames || []),
        candidate.description || '',
      ].join(' ')).includes(queryKey));

    return items.slice(0, 80);
  }, [candidates, deferredSearch]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kaydı Eşleştir</DialogTitle>
          <DialogDescription>
            {state ? `“${state.itemLabel}” için mevcut site kaydını seç. Yeni kayıt açılmadan o kayıt güncellenecek.` : 'Kayıt seç.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="İsim, alternatif isim veya açıklama içinde ara"
          />

          <ScrollArea className="h-[420px] rounded-xl border border-border">
            <div className="space-y-2 p-3">
              {filteredCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Eşleşecek kayıt bulunamadı.</p>
              ) : filteredCandidates.map((candidate) => {
                const isCurrent = currentMatchId === candidate.id;
                const isLinked = linkedEntityIds.has(candidate.id);

                return (
                  <div key={candidate.id} className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-3">
                    {candidate.imageUrl ? (
                      <ProxyImage
                        src={candidate.imageUrl}
                        alt={candidate.name}
                        allowProxy
                        className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-sm font-bold text-muted-foreground">
                        {getInitial(candidate.name)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{candidate.name}</p>
                        {isLinked ? <Badge variant="secondary">Zaten Bağlı</Badge> : null}
                        {isCurrent ? <Badge>Seçili</Badge> : null}
                      </div>
                      {candidate.alternativeNames?.length ? (
                        <p className="text-xs text-muted-foreground">
                          Alternatif: {candidate.alternativeNames.slice(0, 3).join(', ')}
                        </p>
                      ) : null}
                      {candidate.description ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{candidate.description}</p>
                      ) : null}
                    </div>

                    {state ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={isCurrent ? 'secondary' : 'outline'}
                        onClick={() => onSelect({ id: candidate.id, name: candidate.name, type: state.entityType })}
                      >
                        {isCurrent ? 'Seçili' : 'Seç'}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const PreviewDetailDialog: React.FC<PreviewDetailDialogProps> = ({
  detailKey,
  preview,
  collections,
  onToggleItem,
  onToggleItems,
  onOpenMatchDialog,
  onClearMatch,
  onClose,
}) => {
  const [filter, setFilter] = useState<PreviewMatchFilter>('all');

  useEffect(() => {
    setFilter('all');
  }, [detailKey]);

  if (!detailKey) return null;

  const getFilteredItems = <TItem,>(items: PreviewToggleItem<TItem>[]) => applyPreviewMatchFilter(items, filter);

  const renderContent = () => {
    if (!collections) {
      return <p className="text-sm text-muted-foreground">Detay verisi hazırlanıyor.</p>;
    }

    switch (detailKey) {
      case 'alternative_titles':
        {
          const visibleItems = getFilteredItems(collections.alternativeTitles);
        return (
          <div className="space-y-3">
            <PreviewSelectionToolbar items={collections.alternativeTitles} visibleItems={visibleItems} onToggleItems={onToggleItems} filter={filter} onFilterChange={setFilter} />
            <div className="space-y-1">
              {visibleItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
              ) : (
                visibleItems.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>
          </div>
        );
        }

      case 'tags': {
        const visibleItems = getFilteredItems(collections.tags);
        return (
          <div className="space-y-3">
            <PreviewSelectionToolbar items={collections.tags} visibleItems={visibleItems} onToggleItems={onToggleItems} filter={filter} onFilterChange={setFilter} />
            <div className="space-y-2">
              {visibleItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Gösterilecek etiket veya tür bulunamadı.</p>
              ) : (
                visibleItems.map((item) => (
                  <PreviewSelectionRow
                    key={item.key}
                    item={item}
                    onToggle={onToggleItem}
                    onOpenMatch={onOpenMatchDialog}
                    onClearMatch={onClearMatch}
                  />
                ))
              )}
            </div>
          </div>
        );
      }

      case 'authors_artists':
        {
          const visibleAuthors = getFilteredItems(collections.authors);
          const visibleArtists = getFilteredItems(collections.artists);
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Yazarlar</p>
                <PreviewSelectionToolbar items={collections.authors} visibleItems={visibleAuthors} onToggleItems={onToggleItems} filter={filter} onFilterChange={setFilter} />
              </div>
              {visibleAuthors.length === 0 ? (
                <p className="text-sm text-muted-foreground">Yazar verisi bulunamadı.</p>
              ) : (
                visibleAuthors.map((item) => (
                  <PreviewSelectionRow
                    key={item.key}
                    item={item}
                    onToggle={onToggleItem}
                    onOpenMatch={onOpenMatchDialog}
                    onClearMatch={onClearMatch}
                  />
                ))
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Çizerler</p>
                <PreviewSelectionToolbar items={collections.artists} visibleItems={visibleArtists} onToggleItems={onToggleItems} filter={filter} onFilterChange={setFilter} />
              </div>
              {visibleArtists.length === 0 ? (
                <p className="text-sm text-muted-foreground">Çizer verisi bulunamadı.</p>
              ) : (
                visibleArtists.map((item) => (
                  <PreviewSelectionRow
                    key={item.key}
                    item={item}
                    onToggle={onToggleItem}
                    onOpenMatch={onOpenMatchDialog}
                    onClearMatch={onClearMatch}
                  />
                ))
              )}
            </div>
          </div>
        );
        }

      case 'characters':
        {
          const visibleItems = getFilteredItems(collections.characters);
        return (
          <div className="space-y-3">
            <PreviewSelectionToolbar items={collections.characters} visibleItems={visibleItems} onToggleItems={onToggleItems} filter={filter} onFilterChange={setFilter} />
            <div className="space-y-2">
              {visibleItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
              ) : (
                visibleItems.map((item) => (
                  <PreviewSelectionRow
                    key={item.key}
                    item={item}
                    onToggle={onToggleItem}
                    onOpenMatch={onOpenMatchDialog}
                    onClearMatch={onClearMatch}
                  />
                ))
              )}
            </div>
          </div>
        );
        }

      case 'related_series':
        {
          const visibleItems = getFilteredItems(collections.relatedSeries);
        return (
          <div className="space-y-3">
            <PreviewSelectionToolbar items={collections.relatedSeries} visibleItems={visibleItems} onToggleItems={onToggleItems} filter={filter} onFilterChange={setFilter} />
            <div className="space-y-2">
              {visibleItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
              ) : (
                visibleItems.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>
          </div>
        );
        }

      case 'gallery':
        {
          const visibleSeriesGallery = getFilteredItems(collections.seriesGallery);
          const visibleCharacterGallery = getFilteredItems(collections.characterGallery);
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Seri Galerisi</p>
                <PreviewSelectionToolbar items={collections.seriesGallery} visibleItems={visibleSeriesGallery} onToggleItems={onToggleItems} filter={filter} onFilterChange={setFilter} />
              </div>
              {visibleSeriesGallery.length === 0 ? (
                <p className="text-sm text-muted-foreground">Seriye ait galeri bulunamadı.</p>
              ) : (
                visibleSeriesGallery.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Karakter Galerileri</p>
                <PreviewSelectionToolbar
                  items={collections.characterGallery.map((item) => item as PreviewToggleItem<unknown>)}
                  visibleItems={visibleCharacterGallery.map((item) => item as PreviewToggleItem<unknown>)}
                  onToggleItems={onToggleItems}
                  filter={filter}
                  onFilterChange={setFilter}
                />
              </div>
              {visibleCharacterGallery.length === 0 ? (
                <p className="text-sm text-muted-foreground">Karakter galerisi bulunamadı.</p>
              ) : (
                visibleCharacterGallery.map((item) => (
                  <PreviewSelectionRow key={item.key} item={item} onToggle={onToggleItem} />
                ))
              )}
            </div>
          </div>
        );
        }

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
  const [allLocalAuthors, setAllLocalAuthors] = useState<Author[]>([]);
  const [allLocalArtists, setAllLocalArtists] = useState<Artist[]>([]);
  const [allLocalCharacters, setAllLocalCharacters] = useState<Character[]>([]);
  const [allLocalTags, setAllLocalTags] = useState<Tag[]>([]);
  const [mangaFilter, setMangaFilter] = useState('');
  const [selectedMangaId, setSelectedMangaId] = useState('');
  const [selectedLocalManga, setSelectedLocalManga] = useState<Manga | null>(null);
  const [selectedLocalCharacters, setSelectedLocalCharacters] = useState<Character[]>([]);
  const [selectedLocalTags, setSelectedLocalTags] = useState<string[]>([]);
  const [selectedLocalTagIds, setSelectedLocalTagIds] = useState<string[]>([]);
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
  const [manualEntityMatches, setManualEntityMatches] = useState<Record<string, ManualEntityMatchSelection>>({});
  const [matchDialogState, setMatchDialogState] = useState<MatchDialogState | null>(null);

  useEffect(() => {
    if (!isAllowed) {
      return;
    }

    void (async () => {
      const [mangaData, authorData, artistData, characterData, tagData] = await Promise.all([
        getMangaSummaries({ includePrivate: true }),
        getAuthors({ includePrivate: true }),
        getArtists({ includePrivate: true }),
        getCharacters({ includePrivate: true }),
        getAllTags({ includePending: true }),
      ]);
      setMangas(mangaData);
      setAllLocalAuthors(authorData);
      setAllLocalArtists(artistData);
      setAllLocalCharacters(characterData);
      setAllLocalTags(tagData);
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
      setSelectedLocalTagIds([]);
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
        setSelectedLocalTagIds(tags.map((tag) => tag.id));
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setSelectedLocalManga(null);
          setSelectedLocalCharacters([]);
          setSelectedLocalTags([]);
          setSelectedLocalTagIds([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMangaId]);

  const filteredMangas = useMemo(() => {
    const filterKey = normalizeComparableText(mangaFilter);
    if (!filterKey) {
      return mangas;
    }

    return mangas.filter((manga) =>
      normalizeComparableText([manga.title, ...(manga.alternativeTitles || [])].join(' '))
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
    const existingAuthorIds = new Set((selectedLocalManga?.authorsDetails || []).map((author) => author.id).filter(Boolean));
    const existingArtistKeys = new Set(
      [
        ...(selectedLocalManga?.artistsDetails || []).map((artist) => artist.name),
        ...(selectedLocalManga?.artist?.split(',') || []),
      ].map((value) => normalizePreviewKey(value)).filter(Boolean),
    );
    const existingArtistIds = new Set((selectedLocalManga?.artistsDetails || []).map((artist) => artist.id).filter(Boolean));
    const existingCharacterKeys = new Set(selectedLocalCharacters.map((character) => normalizePreviewKey(character.name)).filter(Boolean));
    const existingCharacterIds = new Set(selectedLocalCharacters.map((character) => character.id).filter(Boolean));
    const existingTagIds = new Set(selectedLocalTagIds.filter(Boolean));
    const allLocalAuthorMap = new Map(allLocalAuthors.map((author) => [author.id, author] as const));
    const allLocalArtistMap = new Map(allLocalArtists.map((artist) => [artist.id, artist] as const));
    const allLocalTagMap = new Map(allLocalTags.map((tag) => [tag.id, tag] as const));
    const existingGlobalAuthorMap = buildEntityMatchLookup(allLocalAuthors);
    const existingGlobalArtistMap = buildEntityMatchLookup(allLocalArtists);
    const selectedLocalCharacterMap = buildEntityMatchLookup(selectedLocalCharacters);
    const existingGlobalCharacterMap = buildEntityMatchLookup(allLocalCharacters);
    const allLocalCharacterMap = new Map(allLocalCharacters.map((character) => [character.id, character] as const));
    const existingCharacterGalleryMap = new Map<string, Set<string>>();
    allLocalCharacters.forEach((character) => {
      const galleryKeys = new Set(
        (character.gallery || [])
          .flatMap((image) => [image.sourceUrl, image.url])
          .map((value) => normalizePreviewKey(value))
          .filter(Boolean),
      );

      if (galleryKeys.size === 0) {
        return;
      }

      [character.name, ...(character.alternativeNames || [])].forEach((value) => {
        const key = normalizePreviewKey(value);
        if (key && !existingCharacterGalleryMap.has(key)) {
          existingCharacterGalleryMap.set(key, galleryKeys);
        }
      });
    });
    const relatedSeriesMatchMap = buildEntityMatchLookup(mangas);
    const existingRelatedKeys = new Set(
      (selectedLocalManga?.relatedSeries || [])
        .flatMap((relation) => [
          relation.relatedManga?.title,
          relation.relatedMangaId,
        ])
        .map((value) => normalizePreviewKey(value))
        .filter(Boolean),
    );
    const selectedSeriesGalleryRaw = selectedLocalManga?.details?.extra?.seriesGallery;
    const selectedSeriesGallery = Array.isArray(selectedSeriesGalleryRaw)
      ? selectedSeriesGalleryRaw
      : [];
    const existingSeriesGalleryKeys = new Set(
      selectedSeriesGallery
        .map((value) => normalizePreviewKey(typeof value === 'string' ? value : ''))
        .filter(Boolean),
    );

    const alternativeTitles = effectivePreview.alternativeTitles.map((title, index) => {
      const key = buildPreviewItemKey('alternative_title', title, index);
      const skipped = existingTitleKeys.has(normalizePreviewKey(title));
      return {
        key,
        label: title,
        checked: getPreviewItemChecked(previewOverrides, key, !skipped),
        skipped,
        skipReason: skipped ? 'Bu alternatif isim zaten mangada var' : undefined,
        matchState: skipped ? 'matched' : 'new',
        item: title,
      } satisfies PreviewToggleItem<string>;
    });

    const tags = (effectivePreview.tagMatches?.length ? effectivePreview.tagMatches : effectivePreview.tags).map((tagEntry, index) => {
      const isObjectEntry = typeof tagEntry !== 'string';
      const sourceTag = isObjectEntry ? tagEntry.sourceTag : tagEntry;
      const key = buildPreviewItemKey(
        'tag',
        sourceTag,
        isObjectEntry ? (tagEntry.matchedTag?.id || tagEntry.genreMatchName || index) : index,
      );
      const matchedEntity = manualEntityMatches[key];
      const matchedTag = matchedEntity?.type === 'tag' ? allLocalTagMap.get(matchedEntity.id) : undefined;
      const matchedName = matchedTag?.name || (isObjectEntry ? (tagEntry.genreMatchName || tagEntry.matchedTag?.name || tagEntry.sourceTag) : sourceTag);
      const isGenre = isObjectEntry ? Boolean(tagEntry.isStandardGenre) : existingGenreKeys.has(normalizePreviewKey(sourceTag));
      const alreadyLinked = matchedTag
        ? existingTagIds.has(matchedTag.id)
        : (
            isGenre
              ? existingGenreKeys.has(normalizePreviewKey(matchedName))
              : existingTagKeys.has(normalizePreviewKey(matchedName))
          );
      const manualMatchSummary = matchedTag
        ? `Elle eşleşti: ${matchedTag.name}${alreadyLinked ? ' • zaten bağlı' : ''}`
        : undefined;

      return {
        key,
        label: sourceTag,
        subtitle: manualMatchSummary || (isObjectEntry
          ? (
              tagEntry.isStandardGenre
                ? `Tür eşleşmesi: ${matchedName}`
                : tagEntry.isMatched
                  ? `Eşleşen etiket: ${matchedName}`
                  : 'Yeni etiket oluşturulacak'
            )
          : undefined),
        badgeLabel: isGenre ? 'Tür' : isObjectEntry && !tagEntry.isMatched ? 'Yeni' : 'Etiket',
        checked: getPreviewItemChecked(previewOverrides, key, !alreadyLinked),
        skipped: alreadyLinked,
        skipReason: alreadyLinked
          ? (isGenre ? 'Bu tür zaten mangada var' : 'Bu etiket zaten mangaya bağlı')
          : undefined,
        matchState: matchedTag || (isObjectEntry && (tagEntry.isMatched || tagEntry.isStandardGenre)) ? 'matched' : 'new',
        matchableType: 'tag',
        matchedEntity,
        item: tagEntry,
      } satisfies PreviewToggleItem<TagMatchResult | string>;
    });

    const authors = effectivePreview.authors.map((author, index) => {
      const key = buildPreviewItemKey('author', author.name, author.sourceUrl || author.imageUrl || index);
      const matchedEntity = manualEntityMatches[key];
      const matchedAuthor = matchedEntity?.type === 'author' ? allLocalAuthorMap.get(matchedEntity.id) : undefined;
      const existingGlobalAuthor = matchedAuthor || existingGlobalAuthorMap.get(normalizePreviewKey(author.name));
      const alreadyLinked = existingGlobalAuthor
        ? existingAuthorIds.has(existingGlobalAuthor.id)
        : existingAuthorKeys.has(normalizePreviewKey(author.name));
      const manualMatchSummary = matchedAuthor
        ? `Elle eşleşti: ${matchedAuthor.name}${alreadyLinked ? ' • zaten bağlı' : ''}`
        : undefined;
      return {
        key,
        label: author.name,
        subtitle: manualMatchSummary || (alreadyLinked
          ? 'Zaten bağlı, seçili kalırsa metadata güncellenecek'
          : existingGlobalAuthor
            ? 'Sistemde mevcut, seçili kalırsa bu yazar güncellenecek'
            : (author.description || author.details?.nativeName)),
        badgeLabel: 'Yazar',
        imageUrl: author.imageUrl,
        checked: getPreviewItemChecked(previewOverrides, key, true),
        skipped: false,
        skipReason: undefined,
        matchState: existingGlobalAuthor ? 'matched' : 'new',
        matchableType: 'author' as const,
        matchedEntity,
        item: author,
      } satisfies PreviewToggleItem<ImportedPersonDraft>;
    });

    const artists = effectivePreview.artists.map((artist, index) => {
      const key = buildPreviewItemKey('artist', artist.name, artist.sourceUrl || artist.imageUrl || index);
      const matchedEntity = manualEntityMatches[key];
      const matchedArtist = matchedEntity?.type === 'artist' ? allLocalArtistMap.get(matchedEntity.id) : undefined;
      const existingGlobalArtist = matchedArtist || existingGlobalArtistMap.get(normalizePreviewKey(artist.name));
      const alreadyLinked = existingGlobalArtist
        ? existingArtistIds.has(existingGlobalArtist.id)
        : existingArtistKeys.has(normalizePreviewKey(artist.name));
      const manualMatchSummary = matchedArtist
        ? `Elle eşleşti: ${matchedArtist.name}${alreadyLinked ? ' • zaten bağlı' : ''}`
        : undefined;
      return {
        key,
        label: artist.name,
        subtitle: manualMatchSummary || (alreadyLinked
          ? 'Zaten bağlı, seçili kalırsa metadata güncellenecek'
          : existingGlobalArtist
            ? 'Sistemde mevcut, seçili kalırsa bu çizer güncellenecek'
            : (artist.description || artist.details?.nativeName)),
        badgeLabel: 'Çizer',
        imageUrl: artist.imageUrl,
        checked: getPreviewItemChecked(previewOverrides, key, true),
        skipped: false,
        skipReason: undefined,
        matchState: existingGlobalArtist ? 'matched' : 'new',
        matchableType: 'artist' as const,
        matchedEntity,
        item: artist,
      } satisfies PreviewToggleItem<ImportedPersonDraft>;
    });

    const characterExistingMatchMap = new Map<string, Character | undefined>();
    const characters = effectivePreview.characters.map((character, index) => {
      const key = buildPreviewItemKey(
        'character',
        character.name,
        character.sourceUrl || character.imageUrl || character.roleType || character.roleLabel || index,
      );
      const matchedEntity = manualEntityMatches[key];
      const matchedCharacter = matchedEntity?.type === 'character' ? allLocalCharacterMap.get(matchedEntity.id) : undefined;
      const autoMatchedCharacter = matchedCharacter || selectedLocalCharacterMap.get(normalizePreviewKey(character.name));
      const conflictingGlobalCharacter = !autoMatchedCharacter
        ? existingGlobalCharacterMap.get(normalizePreviewKey(character.name))
        : undefined;
      const alreadyLinked = matchedCharacter
        ? existingCharacterIds.has(matchedCharacter.id)
        : autoMatchedCharacter
          ? existingCharacterIds.has(autoMatchedCharacter.id)
          : existingCharacterKeys.has(normalizePreviewKey(character.name));
      characterExistingMatchMap.set(key, autoMatchedCharacter);
      const manualMatchSummary = matchedCharacter
        ? `Elle eşleşti: ${matchedCharacter.name}${alreadyLinked ? ' • zaten bağlı' : ''}`
        : undefined;
      return {
        key,
        label: character.name,
        subtitle: manualMatchSummary || (alreadyLinked
          ? 'Zaten bağlı, seçili kalırsa rol ve metadata güncellenecek'
          : autoMatchedCharacter
            ? 'Sistemde mevcut, seçili kalırsa bu mangaya bağlanıp rol ve metadata güncellenecek'
            : conflictingGlobalCharacter
              ? 'Aynı isimli karakter başka bir seride bulundu; otomatik eşleştirme yapılmadı.'
            : (character.description || character.details?.nativeName)),
        badgeLabel: character.roleType ? getCharacterListingRoleLabel(character.roleType) : (character.roleLabel || 'Karakter'),
        imageUrl: character.imageUrl,
        checked: getPreviewItemChecked(previewOverrides, key, true),
        skipped: false,
        skipReason: undefined,
        matchState: autoMatchedCharacter ? 'matched' : 'new',
        matchableType: 'character' as const,
        matchedEntity,
        item: character,
      } satisfies PreviewToggleItem<ImportedCharacterDraft>;
    });

    const characterCheckedMap = new Map(characters.map((character) => [character.key, character.checked]));

    const relatedSeries = effectivePreview.relatedSeries.map((series, index) => {
      const key = buildPreviewItemKey('related_series', series.title, series.sourceUrl || series.relationType || index);
      const matchedSeries = relatedSeriesMatchMap.get(normalizePreviewKey(series.title));
      const skipped = existingRelatedKeys.has(normalizePreviewKey(series.title));
      return {
        key,
        label: series.title,
        subtitle: skipped
          ? 'Bu ilişki zaten mangada var'
          : matchedSeries
            ? 'Sistemde mevcut, seçili kalırsa ilişki bağlanacak'
            : (series.sourceUrl || undefined),
        badgeLabel: getMangaRelationTypeLabel(series.relationType),
        checked: getPreviewItemChecked(previewOverrides, key, !skipped),
        skipped,
        skipReason: skipped ? 'Bu ilişki zaten mangada var' : undefined,
        matchState: skipped || matchedSeries ? 'matched' : 'new',
        item: series,
      } satisfies PreviewToggleItem<ImportedRelatedSeriesDraft>;
    });

    const seriesGallery = effectivePreview.gallery.map((image, index) => {
      const key = buildPreviewItemKey('series_gallery', image.url, image.sourceUrl || index);
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
        matchState: skipped ? 'matched' : 'new',
        item: image,
      } satisfies PreviewToggleItem<EntityGalleryImage>;
    });

    const characterGallery = effectivePreview.characters.flatMap((character, characterIndex) => {
      const characterKey = buildPreviewItemKey(
        'character',
        character.name,
        character.sourceUrl || character.imageUrl || character.roleType || character.roleLabel || characterIndex,
      );
      const parentChecked = characterCheckedMap.get(characterKey) ?? true;

      return character.gallery.map((image, index) => {
        const key = buildPreviewItemKey(
          'character_gallery',
          `${character.name}:${image.url}`,
          `${characterKey}:${image.sourceUrl || image.url || index}`,
        );
        const existingCharacter = characterExistingMatchMap.get(characterKey);
        const existingGalleryKeys = existingCharacter
          ? existingCharacterGalleryMap.get(normalizePreviewKey(existingCharacter.name))
          : undefined;
        const alreadyExists = Boolean(
          existingGalleryKeys?.has(normalizePreviewKey(image.sourceUrl || image.url)),
        );
        return {
          key,
          label: image.label || `${character.name} Görseli ${index + 1}`,
          subtitle: character.name,
          badgeLabel: character.roleType ? getCharacterListingRoleLabel(character.roleType) : (character.roleLabel || 'Karakter'),
          imageUrl: image.thumbUrl || image.url,
          checked: getPreviewItemChecked(previewOverrides, key, parentChecked && !alreadyExists),
          skipped: alreadyExists || !parentChecked,
          skipReason: alreadyExists
            ? 'Bu görsel karakter galerisinde zaten var'
            : (!parentChecked ? 'Karakter importtan çıkarıldığı için bu galeri de atlanacak' : undefined),
          matchState: alreadyExists ? 'matched' : 'new',
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
  }, [
    allLocalArtists,
    allLocalAuthors,
    allLocalCharacters,
    allLocalTags,
    effectivePreview,
    manualEntityMatches,
    previewOverrides,
    selectedLocalCharacters,
    selectedLocalManga,
    selectedLocalTagIds,
    selectedLocalTags,
    mangas,
  ]);

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
      tagMatches: previewCollections.tags
        .filter((item) => item.checked)
        .map((item) => {
          const matchedTag = item.matchedEntity?.type === 'tag'
            ? { id: item.matchedEntity.id, name: item.matchedEntity.name }
            : undefined;

          if (typeof item.item === 'string') {
            return {
              sourceTag: item.item,
              matchedTag,
              isMatched: Boolean(matchedTag),
            } satisfies TagMatchResult;
          }

          return {
            ...item.item,
            matchedTag: matchedTag || item.item.matchedTag,
            isMatched: Boolean(matchedTag || item.item.matchedTag),
          } satisfies TagMatchResult;
        }),
      authors: previewCollections.authors.filter((item) => item.checked).map((item) => ({
        ...item.item,
        matchedEntityId: item.matchedEntity?.id,
        matchedEntityName: item.matchedEntity?.name,
        matchedEntityType: item.matchedEntity?.type,
      })),
      artists: previewCollections.artists.filter((item) => item.checked).map((item) => ({
        ...item.item,
        matchedEntityId: item.matchedEntity?.id,
        matchedEntityName: item.matchedEntity?.name,
        matchedEntityType: item.matchedEntity?.type,
      })),
      characters: previewCollections.characters
        .filter((item) => item.checked)
        .map((item) => ({
          ...item.item,
          matchedEntityId: item.matchedEntity?.id,
          matchedEntityName: item.matchedEntity?.name,
          matchedEntityType: item.matchedEntity?.type,
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

  const matchDialogCandidates = useMemo<LocalMatchableEntityOption[]>(() => {
    if (!matchDialogState) {
      return [];
    }

    switch (matchDialogState.entityType) {
      case 'author':
        return allLocalAuthors;
      case 'artist':
        return allLocalArtists;
      case 'character':
        return allLocalCharacters;
      case 'tag':
        return allLocalTags;
      default:
        return [];
    }
  }, [allLocalArtists, allLocalAuthors, allLocalCharacters, allLocalTags, matchDialogState]);

  const matchDialogLinkedIds = useMemo(() => {
    switch (matchDialogState?.entityType) {
      case 'author':
        return new Set((selectedLocalManga?.authorsDetails || []).map((author) => author.id).filter(Boolean));
      case 'artist':
        return new Set((selectedLocalManga?.artistsDetails || []).map((artist) => artist.id).filter(Boolean));
      case 'character':
        return new Set(selectedLocalCharacters.map((character) => character.id).filter(Boolean));
      case 'tag':
        return new Set(selectedLocalTagIds.filter(Boolean));
      default:
        return new Set<string>();
    }
  }, [matchDialogState?.entityType, selectedLocalCharacters, selectedLocalManga, selectedLocalTagIds]);

  const currentMatchId = matchDialogState ? manualEntityMatches[matchDialogState.itemKey]?.id : undefined;

  const handleSourceChange = (nextSource: MetadataImportSource) => {
    setSource(nextSource);
    setEnabledOptions(createDefaultImportOptions(nextSource));
    setCandidates([]);
    setSelectedCandidateId('');
    setPreview(null);
    setPreviewOverrides({});
    setManualEntityMatches({});
    setMatchDialogState(null);
  };

  const handleTogglePreviewItem = (key: string, checked: boolean) => {
    setPreviewOverrides((current) => ({
      ...current,
      [key]: checked,
    }));
  };

  const handleTogglePreviewItems = (keys: string[], checked: boolean) => {
    setPreviewOverrides((current) => {
      const next = { ...current };
      keys.forEach((key) => {
        next[key] = checked;
      });
      return next;
    });
  };

  const handleOpenMatchDialog = (item: PreviewToggleItem<unknown>) => {
    if (!item.matchableType) {
      return;
    }

    setMatchDialogState({
      itemKey: item.key,
      itemLabel: item.label,
      entityType: item.matchableType,
    });
  };

  const handleClearManualMatch = (key: string) => {
    setManualEntityMatches((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleSelectManualMatch = (selection: ManualEntityMatchSelection) => {
    if (!matchDialogState) {
      return;
    }

    setManualEntityMatches((current) => ({
      ...current,
      [matchDialogState.itemKey]: selection,
    }));
    setPreviewOverrides((current) => ({
      ...current,
      [matchDialogState.itemKey]: true,
    }));
    setMatchDialogState(null);
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
    setManualEntityMatches({});
    setMatchDialogState(null);
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
    setManualEntityMatches({});
    setMatchDialogState(null);

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
                    placeholder={
                      source === 'fandom'
                        ? 'https://wiki.fandom.com/wiki/... şeklinde direkt wiki linki yapıştır'
                        : 'Solo Leveling veya direkt kaynak URL yapıştır'
                    }
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
                    onToggleItems={handleTogglePreviewItems}
                    onOpenMatchDialog={handleOpenMatchDialog}
                    onClearMatch={handleClearManualMatch}
                    onClose={() => setDetailDialogKey(null)}
                  />
                  <ManualEntityMatchDialog
                    state={matchDialogState}
                    candidates={matchDialogCandidates}
                    linkedEntityIds={matchDialogLinkedIds}
                    currentMatchId={currentMatchId}
                    onClose={() => setMatchDialogState(null)}
                    onSelect={handleSelectManualMatch}
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
