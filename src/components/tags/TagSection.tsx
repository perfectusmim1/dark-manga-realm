import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Plus, X, Hash, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import TagBadge from './TagBadge';
import { Tag, TagCategory } from '@/lib/types';
import {
  getAllTags,
  searchTags,
  createTag,
  getTagsForEntity,
  addTagToEntity,
  removeTagFromEntity,
  getTagVotes,
  getUserTagVotes,
  voteOnTag,
} from '@/lib/database';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const categoryLabels: Record<TagCategory, string> = {
  theme: 'Tema',
  mood: 'Atmosfer',
  trope: 'Kalıp',
  demographic: 'Demografik',
  content: 'İçerik',
  general: 'Genel',
};

const SMART_TAG_ACCEPT_UPVOTES = 8;
const SMART_TAG_HIDE_SCORE = -4;
const SMART_TAG_REMOVE_DOWNVOTES = 6;

const getTagModerationState = (
  votes?: { up: number; down: number },
  isOfficial: boolean = false
) => {
  const up = votes?.up ?? 0;
  const down = votes?.down ?? 0;
  const score = up - down;
  const isAccepted = isOfficial || up >= SMART_TAG_ACCEPT_UPVOTES;
  const isRejected = !isOfficial && down >= SMART_TAG_REMOVE_DOWNVOTES;
  const isHidden = !isOfficial && (isRejected || score <= SMART_TAG_HIDE_SCORE);

  return {
    up,
    down,
    score,
    isAccepted,
    isRejected,
    isHidden,
  };
};

interface TagSectionProps {
  entityType: 'manga' | 'character' | 'author' | 'artist';
  entityId: string;
  editable?: boolean;
}

const TagSection: React.FC<TagSectionProps> = ({ entityType, entityId, editable = true }) => {
  const { user } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [votes, setVotes] = useState<Record<string, { up: number; down: number }>>({});
  const [userVotes, setUserVotes] = useState<Record<string, 'up' | 'down'>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Tag[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagCategory, setNewTagCategory] = useState<TagCategory>('general');
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, [entityId, entityType]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [entityTags, tagVotes, all] = await Promise.all([
        getTagsForEntity(entityType, entityId),
        getTagVotes(entityType, entityId),
        getAllTags(),
      ]);

      setTags(entityTags);
      setVotes(tagVotes);
      setAllTags(all);

      if (user) {
        const uVotes = await getUserTagVotes(entityType, entityId, user.id);
        setUserVotes(uVotes);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    const results = await searchTags(query);
    const existingTagIds = new Set(tags.map(t => t.id));
    setSearchResults(results.filter(r => !existingTagIds.has(r.id)));
  };

  const handleAddTag = async (tag: Tag) => {
    if (!user) {
      toast.error('Etiket eklemek için giriş yapmalısınız');
      return;
    }

    setIsAdding(true);
    try {
      const success = await addTagToEntity(entityType, entityId, tag.id, user.id);
      if (success) {
        setTags(prev => [...prev, tag]);
        setSearchQuery('');
        setSearchResults([]);
        setIsSearchOpen(false);
        toast.success(`"${tag.name}" etiketi eklendi`);
      }
    } catch {
      toast.error('Etiket eklenemedi');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    if (!user) return;

    const tagName = tags.find(t => t.id === tagId)?.name;
    const success = await removeTagFromEntity(entityType, entityId, tagId);
    if (success) {
      setTags(prev => prev.filter(t => t.id !== tagId));
      toast.success(`"${tagName}" etiketi kaldırıldı`);
    }
  };

  const handleVote = async (tagId: string, voteType: 'up' | 'down') => {
    if (!user) {
      toast.error('Oy vermek için giriş yapmalısınız');
      return;
    }

    const targetTag = tags.find((tag) => tag.id === tagId);
    const previousState = targetTag ? getTagModerationState(votes[tagId], targetTag.isOfficial) : null;

    await voteOnTag(tagId, entityType, entityId, user.id, voteType);
    const [newVotes, newUserVotes] = await Promise.all([
      getTagVotes(entityType, entityId),
      getUserTagVotes(entityType, entityId, user.id),
    ]);
    setVotes(newVotes);
    setUserVotes(newUserVotes);

    if (!targetTag) {
      return;
    }

    const nextState = getTagModerationState(newVotes[tagId], targetTag.isOfficial);

    if (!previousState?.isAccepted && nextState.isAccepted && !targetTag.isOfficial) {
      toast.success(`"${targetTag.name}" etiketi topluluk tarafından kabul edildi`);
    }

    if (!previousState?.isHidden && nextState.isHidden) {
      if (nextState.isRejected) {
        toast.error(`"${targetTag.name}" etiketi topluluk oyuyla kaldırıldı`);
      } else {
        toast.message(`"${targetTag.name}" etiketi düşük puan nedeniyle gizlendi`);
      }
    }

    if (nextState.isRejected) {
      setTags((previous) => previous.filter((tag) => tag.id !== tagId));
    }
  };

  const handleCreateTag = async () => {
    if (!user || !newTagName.trim()) return;

    setIsAdding(true);
    try {
      const created = await createTag(newTagName.trim(), newTagCategory, undefined, user.id);
      if (created) {
        await handleAddTag(created);
        setNewTagName('');
        setShowNewTagForm(false);
      }
    } catch {
      toast.error('Etiket oluşturulamadı');
    } finally {
      setIsAdding(false);
    }
  };

  const visibleTags = useMemo(() => {
    return [...tags]
      .filter((tag) => !getTagModerationState(votes[tag.id], tag.isOfficial).isHidden)
      .sort((left, right) => {
        const leftState = getTagModerationState(votes[left.id], left.isOfficial);
        const rightState = getTagModerationState(votes[right.id], right.isOfficial);

        if (leftState.isAccepted !== rightState.isAccepted) {
          return Number(rightState.isAccepted) - Number(leftState.isAccepted);
        }

        if (leftState.score !== rightState.score) {
          return rightState.score - leftState.score;
        }

        return left.name.localeCompare(right.name, 'tr');
      });
  }, [tags, votes]);

  const groupedTags = useMemo(() => {
    return visibleTags.reduce((acc, tag) => {
      if (!acc[tag.category]) acc[tag.category] = [];
      acc[tag.category].push(tag);
      return acc;
    }, {} as Record<string, Tag[]>);
  }, [visibleTags]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-primary animate-pulse" />
          <div className="h-4 w-24 bg-secondary/50 rounded animate-pulse" />
        </div>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-7 rounded-full bg-secondary/30 animate-pulse" style={{ width: `${60 + i * 20}px` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-bold">Akıllı Etiketler</h3>
          {visibleTags.length > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary border-none px-2 h-5 text-[10px]">
              {visibleTags.length}
            </Badge>
          )}
        </div>

        {editable && user && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewTagForm(!showNewTagForm)}
              className="text-xs h-7"
            >
              <Plus className="h-3 w-3 mr-1" />
              Yeni Etiket
            </Button>
          </div>
        )}
      </div>

      {visibleTags.length > 0 ? (
        <div className="space-y-3">
          {Object.entries(groupedTags).map(([category, categoryTags]) => (
            <div key={category} className="space-y-1.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                {categoryLabels[category as TagCategory] || category}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {categoryTags.map((tag) => {
                  const moderationState = getTagModerationState(votes[tag.id], tag.isOfficial);

                  return (
                  <TagBadge
                    key={tag.id}
                    tag={tag}
                    accepted={!tag.isOfficial && moderationState.isAccepted}
                    size="sm"
                    showVotes={!!user}
                    votes={votes[tag.id] || { up: 0, down: 0 }}
                    userVote={userVotes[tag.id]}
                    onVoteUp={() => handleVote(tag.id, 'up')}
                    onVoteDown={() => handleVote(tag.id, 'down')}
                    removable={editable && !!user}
                    onRemove={() => handleRemoveTag(tag.id)}
                  />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-center">
          {tags.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                Etiketler topluluk puanı nedeniyle şu anda gizli
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Yeterli olumlu oy alırlarsa yeniden görünür olurlar
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Henüz etiket eklenmemiş
              </p>
              {editable && user && (
                <p className="text-xs text-muted-foreground mt-1">
                  İlk etiketi ekleyen sen ol!
                </p>
              )}
            </>
          )}
        </div>
      )}

      {editable && user && (
        <div ref={searchRef} className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Etiket ara ve ekle..."
              className="pl-9 h-9 text-sm"
              value={searchQuery}
              onChange={(e) => {
                handleSearch(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
            />
          </div>

          {isSearchOpen && searchResults.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="max-h-48 overflow-y-auto p-1">
                {searchResults.map(tag => (
                  <button
                    key={tag.id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary/50 transition-colors text-left"
                    onClick={() => handleAddTag(tag)}
                    disabled={isAdding}
                  >
                    <TagBadge tag={tag} size="sm" />
                    {tag.usageCount > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {tag.usageCount}x
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isSearchOpen && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-xl p-3 text-center animate-in fade-in slide-in-from-top-2 duration-200">
              <p className="text-sm text-muted-foreground">Sonuç bulunamadı</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 text-xs text-primary"
                onClick={() => {
                  setNewTagName(searchQuery);
                  setShowNewTagForm(true);
                  setIsSearchOpen(false);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                "{searchQuery}" olarak oluştur
              </Button>
            </div>
          )}
        </div>
      )}

      {showNewTagForm && user && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Yeni Etiket Oluştur</h4>
            <button onClick={() => setShowNewTagForm(false)}>
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
            </button>
          </div>

          <Input
            placeholder="Etiket adı..."
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            className="h-8 text-sm"
          />

          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(categoryLabels) as [TagCategory, string][]).map(([key, label]) => (
              <button
                key={key}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                  newTagCategory === key
                    ? 'bg-primary/20 border-primary/40 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                )}
                onClick={() => setNewTagCategory(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            className="w-full h-8 text-sm"
            onClick={handleCreateTag}
            disabled={!newTagName.trim() || isAdding}
          >
            {isAdding ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Plus className="h-3 w-3 mr-1" />
            )}
            Oluştur ve Ekle
          </Button>
        </div>
      )}
    </div>
  );
};

export default TagSection;
