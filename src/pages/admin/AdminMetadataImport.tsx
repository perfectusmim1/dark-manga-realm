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
import { getMangaSummaries } from '@/lib/database';
import {
  createDefaultImportOptions,
  importPreviewIntoManga,
  ImportOptionKey,
  loadMetadataImportPreview,
  MetadataImportSource,
  searchMetadataImportCandidates,
  SOURCE_OPTION_SUPPORT,
  SOURCE_RUNTIME_WARNINGS,
  SourceSearchCandidate,
  type ImportedMangaPayload,
  type TagMatchResult,
} from '@/lib/metadataImport';
import type { Manga } from '@/lib/types';

const SOURCE_LABELS: Record<MetadataImportSource, string> = {
  anilist: 'AniList',
  myanimelist: 'MyAnimeList',
  mangaupdates: 'MangaUpdates',
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
    description: 'Local sitede eşleşen devam, prequel ve adaptasyon ilişkilerini bağlar',
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
  voice_actors: {
    title: 'Seslendirenler',
    description: 'Manga import akışında kullanılmaz',
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

interface PreviewDetailDialogProps {
  detailKey: PreviewDetailKey | null;
  preview: ImportedMangaPayload;
  onClose: () => void;
}

const PreviewDetailDialog: React.FC<PreviewDetailDialogProps> = ({ detailKey, preview, onClose }) => {
  if (!detailKey) return null;

  const renderContent = () => {
    switch (detailKey) {
      case 'alternative_titles':
        return (
          <div className="space-y-1">
            {preview.alternativeTitles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              preview.alternativeTitles.map((title, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <Badge variant="secondary" className="shrink-0">{index + 1}</Badge>
                  <span>{title}</span>
                </div>
              ))
            )}
          </div>
        );

      case 'tags': {
        const genreMatches = preview.tagMatches?.filter((m) => m.isStandardGenre) || [];
        const normalMatches = preview.tagMatches?.filter((m) => m.isMatched && !m.isStandardGenre) || [];
        const unmatches = preview.tagMatches?.filter((m) => !m.isMatched) || [];

        return (
          <div className="space-y-4">
            {genreMatches.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80">Eşleşen Türler ({genreMatches.length})</p>
                <div className="flex flex-wrap gap-2">
                  {genreMatches.map((match, index) => (
                    <div key={index} className="group relative flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-sm ring-1 ring-primary/10 transition-all hover:bg-primary/20">
                      <div className="absolute -right-1 -top-1 flex h-4 items-center rounded-full bg-primary px-1.5 text-[9px] font-extrabold uppercase text-primary-foreground shadow-sm">Tür</div>
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                      <span className="text-primary-foreground/90">{match.sourceTag}</span>
                      <span className="text-primary/70">→</span>
                      <span className="font-bold text-primary">{match.genreMatchName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {normalMatches.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80">Eşleşen Etiketler ({normalMatches.length})</p>
                <div className="flex flex-wrap gap-2">
                  {normalMatches.map((match, index) => (
                    <div key={index} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-sm transition-colors hover:bg-emerald-500/20">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-100">{match.sourceTag}</span>
                      <span className="text-emerald-400/70">→</span>
                      <span className="font-medium text-emerald-300">{match.matchedTag?.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {unmatches.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">Yeni Etiketler ({unmatches.length}) — Kayıt oluşturulacak</p>
                <div className="flex flex-wrap gap-2">
                  {unmatches.map((match, index) => (
                    <div key={index} className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-sm transition-colors hover:bg-amber-500/20">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-amber-100">{match.sourceTag}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!preview.tagMatches || preview.tagMatches.length === 0) && preview.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {preview.tags.map((tag, index) => (
                  <Badge key={index} variant="default">{tag}</Badge>
                ))}
              </div>
            )}

            {(!preview.tagMatches || preview.tagMatches.length === 0) && preview.tags.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Gösterilecek etiket veya tür bulunamadı.</p>
            )}
          </div>
        );
      }

      case 'authors_artists': {
        const allPeople = [
          ...preview.authors.map((author) => ({ ...author, role: 'Author' as const })),
          ...preview.artists.map((artist) => ({ ...artist, role: 'Artist' as const })),
        ];
        return (
          <div className="space-y-2">
            {allPeople.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              allPeople.map((person, index) => (
                <div key={index} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  {person.imageUrl ? (
                    <img src={person.imageUrl} alt={person.name} className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {person.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{person.name}</p>
                    {person.description ? (
                      <p className="line-clamp-1 text-xs text-muted-foreground">{person.description}</p>
                    ) : null}
                  </div>
                  <Badge variant={person.role === 'Author' ? 'default' : 'secondary'}>{person.role === 'Author' ? 'Yazar' : 'Çizer'}</Badge>
                </div>
              ))
            )}
          </div>
        );
      }

      case 'characters':
        return (
          <div className="space-y-2">
            {preview.characters.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              preview.characters.map((character, index) => (
                <div key={index} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  {character.imageUrl ? (
                    <img src={character.imageUrl} alt={character.name} className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {character.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{character.name}</p>
                    {character.roleLabel ? (
                      <p className="text-xs text-muted-foreground">{character.roleLabel}</p>
                    ) : null}
                  </div>
                  {character.sourceUrl ? (
                    <a href={character.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        );

      case 'related_series':
        return (
          <div className="space-y-2">
            {preview.relatedSeries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              preview.relatedSeries.map((series, index) => (
                <div key={index} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{series.title}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 capitalize">{series.relationType.replace('_', ' ')}</Badge>
                  {series.sourceUrl ? (
                    <a href={series.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        );

      case 'gallery': {
        const totalGallery = [
          ...preview.gallery,
          ...preview.characters.flatMap((ch) => ch.gallery),
        ];
        return (
          <div className="space-y-2">
            {totalGallery.length === 0 ? (
              <p className="text-sm text-muted-foreground">Veri bulunamadı.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {totalGallery.map((image, index) => (
                  <a key={index} href={image.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border border-border">
                    <img
                      src={image.thumbUrl || image.url}
                      alt={image.label || `Gallery ${index + 1}`}
                      className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      }

      default:
        return null;
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
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [mangaFilter, setMangaFilter] = useState('');
  const [selectedMangaId, setSelectedMangaId] = useState('');
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

  useEffect(() => {
    void (async () => {
      const data = await getMangaSummaries();
      setMangas(data);
      if (data[0]) {
        setSelectedMangaId(data[0].id);
      }
    })();
  }, []);

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

  const handleSourceChange = (nextSource: MetadataImportSource) => {
    setSource(nextSource);
    setEnabledOptions(createDefaultImportOptions(nextSource));
    setCandidates([]);
    setSelectedCandidateId('');
    setPreview(null);
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
    if (!selectedMangaId || !preview) {
      toast.error('Import için manga ve önizleme seçilmeli');
      return;
    }

    setImporting(true);
    try {
      await importPreviewIntoManga(selectedMangaId, preview, {
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
              {!preview ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Önizleme henüz hazır değil.
                </div>
              ) : (
                <>
                  <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{preview.sourceTitle}</h2>
                      <Badge>{SOURCE_LABELS[preview.source]}</Badge>
                    </div>
                    <a
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      href={preview.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Kaynak sayfasını aç
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {preview.description ? (
                      <p className="line-clamp-5 text-sm text-muted-foreground">
                        {preview.description}
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
                        <p className="text-lg font-semibold">{preview.alternativeTitles.length}</p>
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
                        <p className="text-lg font-semibold">{preview.tags.length}</p>
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
                        <p className="text-lg font-semibold">{preview.authors.length} / {preview.artists.length}</p>
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
                        <p className="text-lg font-semibold">{preview.characters.length}</p>
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
                        <p className="text-lg font-semibold">{preview.relatedSeries.length}</p>
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
                          {preview.gallery.length + preview.characters.reduce((sum, item) => sum + item.gallery.length, 0)}
                        </p>
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                  </div>

                  {preview.warnings.length > 0 ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                      <p className="text-sm font-medium text-amber-100">Runtime Uyarıları</p>
                      <ul className="mt-2 space-y-1 text-xs text-amber-50">
                        {preview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <PreviewDetailDialog
                    detailKey={detailDialogKey}
                    preview={preview}
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

              <Button className="w-full" disabled={!preview || !selectedMangaId || importing} onClick={handleImport}>
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
