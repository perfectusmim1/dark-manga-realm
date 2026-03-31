import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  UserPen,
  Trash2,
  Plus,
  Search,
  Image as ImageIcon,
  Loader2,
  Globe2,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Switch } from '@/components/ui/switch';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import {
  getCharacters,
  getAuthors,
  getArtists,
  saveCharacter,
  saveAuthor,
  saveArtist,
  deleteCharacter,
  deleteAuthor,
  deleteArtist,
} from '@/lib/database';
import { Character, Author, Artist, ExternalSourceLink } from '@/lib/types';
import {
  EntityMetadataFormState,
  createEmptyEntityMetadataFormState,
  entityMetadataToFormState,
  formStateToEntityMetadata,
  parseDelimitedList,
} from '@/lib/entityMetadata';
import { toast } from 'sonner';
import {
  getCharacterListingRoleFromMetadata,
  getCharacterListingRoleLabel,
  type CharacterListingRole,
} from '@/lib/characterRoles';

type EntityType = 'character' | 'author' | 'artist';
type EditableEntity = Character | Author | Artist;

interface EntityDialogFormState {
  name: string;
  imageUrl: string;
  description: string;
  isPublic: boolean;
  alternativeNames: string;
  galleryUrls: string;
  sourceLinksJson: string;
  characterRoleType: '' | CharacterListingRole;
  metadata: EntityMetadataFormState;
}

const createEmptyFormState = (): EntityDialogFormState => ({
  name: '',
  imageUrl: '',
  description: '',
  isPublic: true,
  alternativeNames: '',
  galleryUrls: '',
  sourceLinksJson: '',
  characterRoleType: '',
  metadata: createEmptyEntityMetadataFormState(),
});

const parseSourceLinks = (value: string): ExternalSourceLink[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error('SOURCE_LINKS_INVALID');
  }

  return parsed
    .filter((item) => item && typeof item === 'object' && typeof item.url === 'string')
    .map((item) => ({
      source: typeof item.source === 'string' ? item.source : 'manual',
      url: item.url,
      label: typeof item.label === 'string' ? item.label : undefined,
      kind: typeof item.kind === 'string' ? item.kind : undefined,
    }));
};

const ENTITY_LABELS: Record<EntityType, string> = {
  character: 'Karakter',
  author: 'Yazar',
  artist: 'Çizer',
};

const AdminEntities: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<EntityType>('character');
  const [searchQuery, setSearchQuery] = useState('');

  const [characters, setCharacters] = useState<Character[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);

  const [showDialog, setShowDialog] = useState(false);
  const [editingEntity, setEditingEntity] = useState<EditableEntity | null>(null);
  const [entityToDelete, setEntityToDelete] = useState<{ id: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [formData, setFormData] = useState<EntityDialogFormState>(createEmptyFormState());

  const loadData = async () => {
    setLoading(true);
    try {
      const [chars, auths, arts] = await Promise.all([
        getCharacters({ includePrivate: true }),
        getAuthors({ includePrivate: true }),
        getArtists({ includePrivate: true }),
      ]);

      setCharacters(chars);
      setAuthors(auths);
      setArtists(arts);
    } catch (error) {
      console.error(error);
      toast.error('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setSelectedIds([]);
  }, [activeTab]);

  const handleOpenDialog = (entity?: EditableEntity) => {
    if (entity) {
      setEditingEntity(entity);
      setFormData({
        name: entity.name,
        imageUrl: entity.imageUrl || '',
        description: entity.description || '',
        isPublic: entity.isPublic ?? true,
        alternativeNames: (entity.alternativeNames || []).join('\n'),
        galleryUrls: (entity.gallery || []).map((image) => image.url).join('\n'),
        sourceLinksJson: entity.sourceLinks?.length ? JSON.stringify(entity.sourceLinks, null, 2) : '',
        characterRoleType: activeTab === 'character'
          ? (getCharacterListingRoleFromMetadata(entity.details) || '')
          : '',
        metadata: entityMetadataToFormState(entity.details),
      });
      setShowDialog(true);
      return;
    }

    setEditingEntity(null);
    setFormData(createEmptyFormState());
    setShowDialog(true);
  };

  const openCreateDialog = () => {
    setEditingEntity(null);
    setFormData(createEmptyFormState());
    setShowDialog(true);
  };

  const handleMetadataChange = (field: keyof EntityMetadataFormState, value: string) => {
    setFormData((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('İsim alanı boş bırakılamaz');
      return;
    }

    let sourceLinks: ExternalSourceLink[] = [];
    try {
      sourceLinks = parseSourceLinks(formData.sourceLinksJson);
    } catch {
      toast.error('Kaynak linkleri geçerli JSON array formatında olmalı');
      return;
    }

    const payload: Partial<EditableEntity> = {
      ...(editingEntity || {}),
      name: formData.name.trim(),
      imageUrl: formData.imageUrl.trim() || undefined,
      description: formData.description.trim() || undefined,
      isPublic: formData.isPublic,
      alternativeNames: parseDelimitedList(formData.alternativeNames),
      gallery: parseDelimitedList(formData.galleryUrls).map((url) => ({ url })),
      sourceLinks,
      details: (() => {
        const metadata = formStateToEntityMetadata(formData.metadata);

        if (activeTab !== 'character') {
          return metadata;
        }

        const nextExtra = { ...(metadata.extra || {}) };
        if (formData.characterRoleType) {
          nextExtra.characterRoleType = formData.characterRoleType;
        } else {
          delete nextExtra.characterRoleType;
        }

        return {
          ...metadata,
          role: metadata.role || (formData.characterRoleType ? getCharacterListingRoleLabel(formData.characterRoleType) : undefined),
          extra: Object.keys(nextExtra).length > 0 ? nextExtra : undefined,
        };
      })(),
    };

    try {
      if (activeTab === 'character') {
        await saveCharacter(payload as Partial<Character>);
      } else if (activeTab === 'author') {
        await saveAuthor(payload as Partial<Author>);
      } else {
        await saveArtist(payload as Partial<Artist>);
      }

      toast.success('Başarıyla kaydedildi');
      setShowDialog(false);
      void loadData();
    } catch (error) {
      console.error(error);
      toast.error('Kaydedilirken hata oluştu');
    }
  };

  const handleDelete = async () => {
    const target = entityToDelete;
    if (!target) return;

    setEntityToDelete(null);

    try {
      if (activeTab === 'character') {
        await deleteCharacter(target.id);
      } else if (activeTab === 'author') {
        await deleteAuthor(target.id);
      } else {
        await deleteArtist(target.id);
      }

      toast.success('Başarıyla silindi');
      void loadData();
    } catch (error) {
      console.error(error);
      toast.error('Silinirken hata oluştu. Muhtemelen başka kayıtlarla bağlantısı var.');
    }
  };

  const toggleItemSelection = (id: string, checked: boolean) => {
    setSelectedIds((current) => (
      checked
        ? (current.includes(id) ? current : [...current, id])
        : current.filter((itemId) => itemId !== id)
    ));
  };

  const currentItems = useMemo(() => {
    switch (activeTab) {
      case 'character':
        return characters;
      case 'author':
        return authors;
      case 'artist':
        return artists;
      default:
        return [];
    }
  }, [activeTab, authors, artists, characters]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('tr-TR');

    if (!normalizedQuery) {
      return currentItems;
    }

    return currentItems.filter((item) => (
      item.name.toLocaleLowerCase('tr-TR').includes(normalizedQuery)
      || (item.alternativeNames || []).some((name) => name.toLocaleLowerCase('tr-TR').includes(normalizedQuery))
    ));
  }, [currentItems, searchQuery]);

  const visibleSelectedIds = useMemo(
    () => filteredItems.map((item) => item.id).filter((id) => selectedIds.includes(id)),
    [filteredItems, selectedIds],
  );

  const allFilteredSelected = filteredItems.length > 0 && visibleSelectedIds.length === filteredItems.length;

  const toggleSelectAllFiltered = (checked: boolean) => {
    const filteredIds = filteredItems.map((item) => item.id);
    setSelectedIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...filteredIds]));
      }

      return current.filter((id) => !filteredIds.includes(id));
    });
  };

  const handleBulkDelete = async () => {
    const idsToDelete = [...selectedIds];
    if (idsToDelete.length === 0) {
      setShowBulkDeleteConfirm(false);
      return;
    }

    setShowBulkDeleteConfirm(false);

    const deleteFn = activeTab === 'character'
      ? deleteCharacter
      : activeTab === 'author'
        ? deleteAuthor
        : deleteArtist;

    const results = await Promise.allSettled(idsToDelete.map((id) => deleteFn(id)));
    const successCount = results.filter((result) => result.status === 'fulfilled').length;
    const failureCount = results.length - successCount;

    if (successCount > 0) {
      toast.success(`${successCount} kayıt silindi`);
    }

    if (failureCount > 0) {
      toast.error(`${failureCount} kayıt silinemedi. Bağlantılı veriler olabilir.`);
    }

    setSelectedIds((current) => current.filter((id) => !idsToDelete.includes(id)));
    void loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Kişi & Karakter Yönetimi</h1>
          <p className="text-muted-foreground">
            Karakter, yazar ve çizer kayıtlarını; görünürlük, metadata, galeri ve kaynak linkleriyle birlikte yönetin.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          Yeni {ENTITY_LABELS[activeTab]}
        </Button>
      </div>

      <Card className="border-border/40 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle>{ENTITY_LABELS[activeTab]} Kayıtları</CardTitle>
          <CardDescription>
            `Gizli` kayıtlar yalnızca admin panelinden görünür. Public sayfalarda ve direkt linkte açılmaz.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EntityType)} className="w-full">
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

              <div className="relative w-full lg:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="İsim veya alternatif isim ara..."
                  className="pl-9 bg-background/50"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            </div>
          </Tabs>

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                id="select-all-entities"
                checked={allFilteredSelected}
                onCheckedChange={(checked) => toggleSelectAllFiltered(checked === true)}
                disabled={filteredItems.length === 0}
              />
              <label htmlFor="select-all-entities" className="text-sm text-muted-foreground">
                {filteredItems.length > 0
                  ? `${filteredItems.length} sonuç içinden tümünü seç`
                  : 'Seçilecek kayıt yok'}
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{selectedIds.length} seçili</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds([])}
                disabled={selectedIds.length === 0}
              >
                Temizle
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={selectedIds.length === 0}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Seçilileri Sil
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="rounded-md border border-border">
              <div className="divide-y divide-border md:hidden">
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => (
                    <div key={item.id} className="space-y-4 p-4">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={selectedIds.includes(item.id)}
                          onCheckedChange={(checked) => toggleItemSelection(item.id, checked === true)}
                          aria-label={`${item.name} seç`}
                          className="mt-4"
                        />
                        <div className="h-14 w-14 overflow-hidden rounded-2xl border border-border bg-muted">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="h-full w-full object-cover"
                              onError={(event) => (event.currentTarget.src = 'https://via.placeholder.com/56')}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{item.name}</p>
                            <Badge variant={item.isPublic === false ? 'destructive' : 'secondary'}>
                              {item.isPublic === false ? 'Gizli' : 'Açık'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.description || 'Açıklama yok'}
                          </p>
                          {(item.alternativeNames || []).length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {(item.alternativeNames || []).slice(0, 3).join(', ')}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => handleOpenDialog(item)}>
                          <UserPen className="mr-2 h-4 w-4" />
                          Düzenle
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 text-destructive hover:text-destructive"
                          onClick={() => setEntityToDelete({ id: item.id, name: item.name })}
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
                      <TableHead className="w-12">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={(checked) => toggleSelectAllFiltered(checked === true)}
                          disabled={filteredItems.length === 0}
                          aria-label="Tümünü seç"
                        />
                      </TableHead>
                      <TableHead className="w-16">Resim</TableHead>
                      <TableHead>İsim</TableHead>
                      <TableHead>Görünürlük</TableHead>
                      <TableHead>Ek Bilgiler</TableHead>
                      <TableHead className="hidden xl:table-cell">Açıklama</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length > 0 ? (
                      filteredItems.map((item) => (
                        <TableRow key={item.id} className="border-border hover:bg-white/5 transition-colors">
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(item.id)}
                              onCheckedChange={(checked) => toggleItemSelection(item.id, checked === true)}
                              aria-label={`${item.name} seç`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="h-11 w-11 overflow-hidden rounded-2xl border border-border bg-muted">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                  onError={(event) => (event.currentTarget.src = 'https://via.placeholder.com/44')}
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>
                            <Badge variant={item.isPublic === false ? 'destructive' : 'secondary'} className="gap-1">
                              {item.isPublic === false ? <Lock className="h-3 w-3" /> : <Globe2 className="h-3 w-3" />}
                              {item.isPublic === false ? 'Gizli' : 'Açık'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            <div className="space-y-1">
                              {(item.alternativeNames || []).length > 0 && (
                                <p>{item.alternativeNames?.length} alternatif isim</p>
                              )}
                              {(item.gallery || []).length > 0 && (
                                <p>{item.gallery?.length} galeri görseli</p>
                              )}
                              {item.details?.age && <p>Yaş: {item.details.age}</p>}
                              {item.details?.gender && <p>Cinsiyet: {item.details.gender}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="hidden xl:table-cell max-w-md">
                            <p className="truncate text-sm text-muted-foreground">
                              {item.description || 'Açıklama yok'}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(item)}>
                                <UserPen className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setEntityToDelete({ id: item.id, name: item.name })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
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
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingEntity ? 'Düzenle' : 'Yeni Oluştur'}: {ENTITY_LABELS[activeTab]}
            </DialogTitle>
            <DialogDescription>
              Temel bilgi, görünürlük, alternatif isimler, metadata, galeri ve kaynak linklerini düzenleyin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">İsim *</label>
                <Input
                  value={formData.name}
                  onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                  placeholder={`Örn: ${activeTab === 'character' ? 'Jin-Woo Sung' : activeTab === 'artist' ? 'Jang Seong-rak' : 'Chugong'}`}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Resim URL</label>
                <Input
                  value={formData.imageUrl}
                  onChange={(event) => setFormData((current) => ({ ...current, imageUrl: event.target.value }))}
                  placeholder="https://..."
                />
              </div>
            </div>

            {activeTab === 'character' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Varsayılan Karakter Konumu</label>
                <Select
                  value={formData.characterRoleType || 'auto'}
                  onValueChange={(value) => setFormData((current) => ({
                    ...current,
                    characterRoleType: value === 'auto' ? '' : value as CharacterListingRole,
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seçilmezse diğer karakterler grubuna düşer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Otomatik / Seçilmedi</SelectItem>
                    <SelectItem value="main">Ana Karakter</SelectItem>
                    <SelectItem value="supporting">Yan Karakter</SelectItem>
                    <SelectItem value="minor">Diğer Karakter</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Bu alan yalnızca varsayılan profil bilgisidir. Seri bazlı ana/yan/diğer rolü manga düzenleme ekranından veya import sırasında ayrı ayarlanır.
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-[1fr,auto] md:items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium">Açıklama</label>
                <Textarea
                  value={formData.description}
                  onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Hakkında bilgi yazın..."
                  className="min-h-[120px]"
                />
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-border bg-secondary/20 px-4 py-3 md:min-w-[220px]">
                <div>
                  <p className="text-sm font-medium">Public görünürlük</p>
                  <p className="text-xs text-muted-foreground">
                    Kapalıysa sadece admin panelinde görünür.
                  </p>
                </div>
                <Switch
                  checked={formData.isPublic}
                  onCheckedChange={(checked) => setFormData((current) => ({ ...current, isPublic: checked }))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Alternatif İsimler</label>
                <Textarea
                  value={formData.alternativeNames}
                  onChange={(event) => setFormData((current) => ({ ...current, alternativeNames: event.target.value }))}
                  placeholder="Her satıra bir isim yazın"
                  className="min-h-[120px]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Galeri URL'leri</label>
                <Textarea
                  value={formData.galleryUrls}
                  onChange={(event) => setFormData((current) => ({ ...current, galleryUrls: event.target.value }))}
                  placeholder="Her satıra bir görsel URL'si yazın"
                  className="min-h-[120px]"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[
                ['nativeName', 'Native İsim'],
                ['englishName', 'English İsim'],
                ['romajiName', 'Romaji'],
                ['status', 'Durum'],
                ['age', 'Yaş'],
                ['gender', 'Cinsiyet'],
                ['birthday', 'Doğum Günü'],
                ['birthPlace', 'Doğum Yeri'],
                ['bloodType', 'Kan Grubu'],
                ['zodiac', 'Burç'],
                ['nationality', 'Uyruk'],
                ['occupation', 'Meslek'],
                ['role', 'Rol'],
                ['className', 'Sınıf'],
                ['rankTitle', 'Unvan'],
                ['website', 'Website'],
                ['twitter', 'Twitter'],
              ].map(([field, label]) => (
                <div key={field} className="space-y-2">
                  <label className="text-sm font-medium">{label}</label>
                  <Input
                    value={formData.metadata[field as keyof EntityMetadataFormState]}
                    onChange={(event) => handleMetadataChange(field as keyof EntityMetadataFormState, event.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Bağlılıklar</label>
                <Textarea
                  value={formData.metadata.affiliation}
                  onChange={(event) => handleMetadataChange('affiliation', event.target.value)}
                  placeholder="Her satıra bir bağlılık yazın"
                  className="min-h-[110px]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Yakınlar / İlişkiler</label>
                <Textarea
                  value={formData.metadata.relatives}
                  onChange={(event) => handleMetadataChange('relatives', event.target.value)}
                  placeholder="Her satıra bir yakın bilgisi yazın"
                  className="min-h-[110px]"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Türler</label>
                <Textarea
                  value={formData.metadata.genres}
                  onChange={(event) => handleMetadataChange('genres', event.target.value)}
                  placeholder="Her satıra bir tür yazın"
                  className="min-h-[110px]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Etiketler</label>
                <Textarea
                  value={formData.metadata.tags}
                  onChange={(event) => handleMetadataChange('tags', event.target.value)}
                  placeholder="Her satıra bir etiket yazın"
                  className="min-h-[110px]"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Ek Notlar</label>
                <Textarea
                  value={formData.metadata.comments}
                  onChange={(event) => handleMetadataChange('comments', event.target.value)}
                  placeholder="Ek açıklamalar"
                  className="min-h-[110px]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Ek JSON Alanları</label>
                <Textarea
                  value={formData.metadata.extraJson}
                  onChange={(event) => handleMetadataChange('extraJson', event.target.value)}
                  placeholder='{"height":"178 cm","guild":"Ahjin"}'
                  className="min-h-[110px] font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Kaynak Linkleri JSON</label>
              <Textarea
                value={formData.sourceLinksJson}
                onChange={(event) => setFormData((current) => ({ ...current, sourceLinksJson: event.target.value }))}
                placeholder='[{"source":"myanimelist","url":"https://myanimelist.net/character/174185/Jin-Woo_Sung","label":"MAL"}]'
                className="min-h-[140px] font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>İptal</Button>
            <Button onClick={handleSave}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(entityToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setEntityToDelete(null);
          }
        }}
        title="Kayıt silinsin mi?"
        description={
          entityToDelete
            ? `"${entityToDelete.name}" kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.`
            : ''
        }
        confirmLabel="Sil"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          void handleDelete();
        }}
      />

      <ConfirmDialog
        open={showBulkDeleteConfirm}
        onOpenChange={setShowBulkDeleteConfirm}
        title="Seçili kayıtlar silinsin mi?"
        description={
          selectedIds.length > 0
            ? `${selectedIds.length} ${ENTITY_LABELS[activeTab].toLocaleLowerCase('tr-TR')} kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.`
            : ''
        }
        confirmLabel="Seçilileri Sil"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          void handleBulkDelete();
        }}
      />
    </div>
  );
};

export default AdminEntities;
