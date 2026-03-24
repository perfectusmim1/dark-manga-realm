import React, { useState, useEffect } from 'react';
import { Hash, Plus, Trash2, Edit2, Shield, Search, Loader2, Save, X, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [newTag, setNewTag] = useState({ name: '', category: 'general' as TagCategory, description: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    setLoading(true);
    const data = await getAllTags();
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

  const handleDelete = async (tag: Tag) => {
    if (!confirm(`"${tag.name}" etiketini silmek istediğinize emin misiniz?`)) return;
    try {
      await deleteTag(tag.id);
      await loadTags();
      toast.success(`"${tag.name}" silindi`);
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

  const filteredTags = tags.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === 'all' || t.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const tagStats = {
    total: tags.length,
    official: tags.filter(t => t.isOfficial).length,
    community: tags.filter(t => !t.isOfficial).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Hash className="h-6 w-6 text-primary" />
            Tag Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage tags, categories, and official status
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Tag
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4 text-center">
          <p className="text-3xl font-bold text-primary">{tagStats.total}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Tags</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4 text-center">
          <p className="text-3xl font-bold text-green-500">{tagStats.official}</p>
          <p className="text-xs text-muted-foreground mt-1">Official</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4 text-center">
          <p className="text-3xl font-bold text-blue-500">{tagStats.community}</p>
          <p className="text-xs text-muted-foreground mt-1">Community</p>
        </div>
      </div>

      {showCreateForm && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h3 className="font-semibold flex items-center gap-2">
            <Plus className="h-4 w-4" /> Create New Tag
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="Tag name..."
              value={newTag.name}
              onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
            />
            <Input
              placeholder="Description (optional)..."
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
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={!newTag.name.trim() || saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Create
            </Button>
            <Button variant="outline" onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              filterCategory === 'all' ? 'bg-primary/20 border-primary/40 text-primary' : 'border-border text-muted-foreground'
            }`}
            onClick={() => setFilterCategory('all')}
          >
            All
          </button>
          {(Object.entries(categoryLabels) as [TagCategory, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                filterCategory === key ? 'bg-primary/20 border-primary/40 text-primary' : 'border-border text-muted-foreground'
              }`}
              onClick={() => setFilterCategory(key)}
            >
              {label}
            </button>
          ))}
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
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-3 border-b border-border bg-secondary/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Tag</span>
            <span className="text-center w-20">Category</span>
            <span className="text-center w-16">Usage</span>
            <span className="text-center w-16">Status</span>
            <span className="text-center w-24">Actions</span>
          </div>
          <div className="divide-y divide-border">
            {filteredTags.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No tags found</div>
            ) : (
              filteredTags.map(tag => (
                <div key={tag.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
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
                  <div className="w-16 text-center">
                    <button onClick={() => toggleOfficial(tag)}>
                      {tag.isOfficial ? (
                        <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px] gap-1">
                          <Shield className="h-3 w-3" /> Official
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] opacity-50 hover:opacity-100 transition-opacity">
                          Community
                        </Badge>
                      )}
                    </button>
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
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(tag)}>
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
    </div>
  );
};

export default AdminTags;
