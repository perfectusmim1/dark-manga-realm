import React, { useState, useEffect } from 'react';
import { Hash, Plus, Trash2, Edit2, Shield, Search, Loader2, Save, X, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import TagBadge from '@/components/tags/TagBadge';
import { Tag, TagCategory } from '@/lib/types';
import {
  getAllTags,
  createTag,
  updateTag,
  deleteTag,
} from '@/lib/database';

const categoryLabels: Record<TagCategory, string> = {
  theme: 'Tema',
  mood: 'Atmosfer',
  trope: 'Kalıp',
  demographic: 'Demografik',
  content: 'İçerik',
  general: 'Genel',
};

const AdminTags: React.FC = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<TagCategory | 'all'>('all');
  const [filterSource, setFilterSource] = useState<'all' | 'official' | 'community'>('all');
  const [filterApproval, setFilterApproval] = useState<'all' | 'approved' | 'pending'>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [newTag, setNewTag] = useState({ name: '', category: 'general' as TagCategory, description: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    setLoading(true);
    const data = await getAllTags({ includePending: true });
    setTags(data);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!newTag.name.trim()) return;
    setSaving(true);
    try {
      const created = await createTag(newTag.name.trim(), newTag.category, newTag.description || undefined);
      if (created) {
        await loadTags();
        setNewTag({ name: '', category: 'general', description: '' });
        setShowCreateForm(false);
        toast.success(`"${created.name}" etiketi oluşturuldu`);
      }
    } catch {
      toast.error('Etiket oluşturulamadı');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingTag) return;
    setSaving(true);
    try {
      await updateTag(editingTag.id, {
        name: editingTag.name,
        category: editingTag.category,
        description: editingTag.description,
        isOfficial: editingTag.isOfficial,
      });
      await loadTags();
      setEditingTag(null);
      toast.success('Etiket güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const targetTag = tagToDelete;
    if (!targetTag) return;
    setTagToDelete(null);
    try {
      await deleteTag(targetTag.id);
      await loadTags();
      toast.success(`"${targetTag.name}" silindi`);
    } catch {
      toast.error('Silinemedi');
    }
  };

  const toggleOfficial = async (tag: Tag) => {
    try {
      await updateTag(tag.id, { isOfficial: !tag.isOfficial });
      await loadTags();
      toast.success(tag.isOfficial ? 'Resmi işareti kaldırıldı' : 'Resmi olarak işaretlendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const isTagApproved = (tag: Tag) => tag.isOfficial || !!tag.communityApproved;

  const getFilterChipClassName = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
      active
        ? 'bg-primary/20 border-primary/40 text-primary'
        : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
    }`;

  const filteredTags = tags.filter(t => {
    const normalizedQuery = searchQuery.toLowerCase();
    const matchesSearch =
      t.name.toLowerCase().includes(normalizedQuery) ||
      (t.description?.toLowerCase().includes(normalizedQuery) ?? false);
    const matchesCategory = filterCategory === 'all' || t.category === filterCategory;
    const matchesSource =
      filterSource === 'all' ||
      (filterSource === 'official' ? t.isOfficial : !t.isOfficial);
    const matchesApproval =
      filterApproval === 'all' ||
      (filterApproval === 'approved' ? isTagApproved(t) : !isTagApproved(t));

    return matchesSearch && matchesCategory && matchesSource && matchesApproval;
  });

  const tagStats = {
    total: tags.length,
    official: tags.filter(t => t.isOfficial).length,
    community: tags.filter(t => !t.isOfficial).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Hash className="h-6 w-6 text-primary" />
            Etiket Yönetimi
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Etiketleri, kategorileri ve resmi durumlarını yönetin
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)} className="w-full gap-1.5 sm:w-auto">
          <Plus className="h-4 w-4" />
          Yeni Etiket
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4 text-center">
          <p className="text-3xl font-bold text-primary">{tagStats.total}</p>
          <p className="text-xs text-muted-foreground mt-1">Toplam Etiket</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4 text-center">
          <p className="text-3xl font-bold text-green-500">{tagStats.official}</p>
          <p className="text-xs text-muted-foreground mt-1">Resmi</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4 text-center">
          <p className="text-3xl font-bold text-blue-500">{tagStats.community}</p>
          <p className="text-xs text-muted-foreground mt-1">Topluluk</p>
        </div>
      </div>

      {showCreateForm && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h3 className="font-semibold flex items-center gap-2">
            <Plus className="h-4 w-4" /> Yeni Etiket Oluştur
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              placeholder="Etiket adı..."
              value={newTag.name}
              onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
            />
            <Input
              placeholder="Açıklama (isteğe bağlı)..."
              value={newTag.description}
              onChange={(e) => setNewTag({ ...newTag, description: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(categoryLabels) as [TagCategory, string][]).map(([key, label]) => (
              <button
                key={key}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  newTag.category === key
                    ? 'bg-primary/20 border-primary/40 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30'
                }`}
                onClick={() => setNewTag({ ...newTag, category: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={handleCreate} disabled={!newTag.name.trim() || saving} className="gap-1.5 sm:w-auto">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Oluştur
            </Button>
            <Button variant="outline" onClick={() => setShowCreateForm(false)}>
              İptal
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Etiket ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              className={getFilterChipClassName(filterCategory === 'all')}
              onClick={() => setFilterCategory('all')}
            >
              Tümü
            </button>
            {(Object.entries(categoryLabels) as [TagCategory, string][]).map(([key, label]) => (
              <button
                key={key}
                className={getFilterChipClassName(filterCategory === key)}
                onClick={() => setFilterCategory(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-card/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Kaynak
            </span>
            <button
              className={getFilterChipClassName(filterSource === 'all')}
              onClick={() => setFilterSource('all')}
            >
              Tümü
            </button>
            <button
              className={getFilterChipClassName(filterSource === 'official')}
              onClick={() => setFilterSource('official')}
            >
              Resmi
            </button>
            <button
              className={getFilterChipClassName(filterSource === 'community')}
              onClick={() => setFilterSource('community')}
            >
              Topluluk
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Onay
            </span>
            <button
              className={getFilterChipClassName(filterApproval === 'all')}
              onClick={() => setFilterApproval('all')}
            >
              Tümü
            </button>
            <button
              className={getFilterChipClassName(filterApproval === 'approved')}
              onClick={() => setFilterApproval('approved')}
            >
              Onaylı
            </button>
            <button
              className={getFilterChipClassName(filterApproval === 'pending')}
              onClick={() => setFilterApproval('pending')}
            >
              Onaysız
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-14 rounded-lg bg-secondary/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border md:hidden">
            {filteredTags.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Hiç etiket bulunamadı</div>
            ) : (
              filteredTags.map((tag) => (
                <div key={tag.id} className="space-y-4 p-4">
                  <div className="space-y-2">
                    {editingTag?.id === tag.id ? (
                      <Input
                        value={editingTag.name}
                        onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                        className="h-9 text-sm"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <TagBadge tag={tag} size="sm" />
                      </div>
                    )}
                    {tag.description && editingTag?.id !== tag.id && (
                      <p className="text-xs text-muted-foreground">{tag.description}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Kategori</p>
                      <Badge variant="outline" className="text-[10px]">
                        {categoryLabels[tag.category]}
                      </Badge>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Kullanım</p>
                      <p className="font-mono">{tag.usageCount}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Kaynak</p>
                      <button onClick={() => toggleOfficial(tag)} className="text-left">
                        {tag.isOfficial ? (
                          <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px] gap-1">
                            <Shield className="h-3 w-3" /> Resmi
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] opacity-70">
                            Topluluk
                          </Badge>
                        )}
                      </button>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Onay</p>
                      {isTagApproved(tag) ? (
                        <Badge className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-400">
                          Onaylı
                        </Badge>
                      ) : (
                        <Badge className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-300">
                          Onaysız
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {editingTag?.id === tag.id ? (
                      <>
                        <Button size="sm" variant="outline" className="flex-1" onClick={handleUpdate} disabled={saving}>
                          <CheckCircle className="mr-2 h-3.5 w-3.5 text-green-500" />
                          Kaydet
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingTag(null)}>
                          <X className="mr-2 h-3.5 w-3.5" />
                          Vazgeç
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingTag({ ...tag })}>
                          <Edit2 className="mr-2 h-3.5 w-3.5" />
                          Düzenle
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 text-destructive" onClick={() => setTagToDelete(tag)}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Sil
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] gap-4 border-b border-border bg-secondary/20 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Etiket</span>
            <span className="text-center w-20">Kategori</span>
            <span className="text-center w-16">Kullanım</span>
            <span className="text-center w-20">Kaynak</span>
            <span className="text-center w-20">Onay</span>
            <span className="text-center w-24">İşlemler</span>
          </div>
          <div className="hidden divide-y divide-border md:block">
            {filteredTags.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Hiç etiket bulunamadı</div>
            ) : (
              filteredTags.map(tag => (
                <div key={tag.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] gap-4 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
                  {editingTag?.id === tag.id ? (
                    <Input
                      value={editingTag.name}
                      onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <TagBadge tag={tag} size="sm" />
                      {tag.description && (
                        <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">{tag.description}</span>
                      )}
                    </div>
                  )}
                  <div className="w-20 text-center">
                    <Badge variant="outline" className="text-[10px]">
                      {categoryLabels[tag.category]}
                    </Badge>
                  </div>
                  <div className="w-16 text-center text-sm font-mono">{tag.usageCount}</div>
                  <div className="w-20 text-center">
                    <button onClick={() => toggleOfficial(tag)}>
                      {tag.isOfficial ? (
                        <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px] gap-1">
                          <Shield className="h-3 w-3" /> Resmi
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] opacity-50 hover:opacity-100 transition-opacity">
                          Topluluk
                        </Badge>
                      )}
                    </button>
                  </div>
                  <div className="w-20 text-center">
                    {isTagApproved(tag) ? (
                      <Badge className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-400">
                        Onaylı
                      </Badge>
                    ) : (
                      <Badge className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-300">
                        Onaysız
                      </Badge>
                    )}
                  </div>
                  <div className="w-24 flex items-center justify-center gap-1">
                    {editingTag?.id === tag.id ? (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleUpdate} disabled={saving}>
                          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingTag(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingTag({ ...tag })}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => setTagToDelete(tag)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(tagToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setTagToDelete(null);
          }
        }}
        title="Etiket silinsin mi?"
        description={
          tagToDelete
            ? `"${tagToDelete.name}" etiketi kalıcı olarak silinecek.`
            : ''
        }
        confirmLabel="Etiketi Sil"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          void handleDelete();
        }}
        destructive
      />
    </div>
  );
};

export default AdminTags;
