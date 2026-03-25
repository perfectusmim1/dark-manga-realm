import React, { useState, useEffect } from 'react';
import { Hash, ChevronDown, ChevronUp, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import TagBadge from './TagBadge';
import { Tag, TagCategory } from '@/lib/types';
import { getAllTags } from '@/lib/database';
import { cn } from '@/lib/utils';

const categoryLabels: Record<TagCategory, string> = {
  theme: 'Tema',
  mood: 'Atmosfer',
  trope: 'Kalıp',
  demographic: 'Demografik',
  content: 'İçerik',
  general: 'Genel',
};

interface TagFilterPanelProps {
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
}

const TagFilterPanel: React.FC<TagFilterPanelProps> = ({
  selectedTags,
  onSelectedTagsChange,
}) => {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const tags = await getAllTags();
      setAllTags(tags);
      setIsLoading(false);
    };
    load();
  }, []);

  const toggleTag = (slug: string) => {
    if (selectedTags.includes(slug)) {
      onSelectedTagsChange(selectedTags.filter(t => t !== slug));
    } else {
      onSelectedTagsChange([...selectedTags, slug]);
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const groupedTags = allTags.reduce((acc, tag) => {
    if (!acc[tag.category]) acc[tag.category] = [];
    acc[tag.category].push(tag);
    return acc;
  }, {} as Record<string, Tag[]>);

  const trendingTags = [...allTags]
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 12);

  if (isLoading) return null;

  return (
    <div className="space-y-3">
      <Button
        variant={isExpanded || selectedTags.length > 0 ? 'default' : 'outline'}
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full justify-between gap-1.5 sm:w-auto sm:justify-center"
      >
        <Hash className="h-4 w-4" />
        Etiketler
        {selectedTags.length > 0 && (
          <Badge variant="secondary" className="ml-1 bg-white/20 text-inherit border-none h-5 px-1.5 text-[10px]">
            {selectedTags.length}
          </Badge>
        )}
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>

      {selectedTags.length > 0 && !isExpanded && (
        <div className="flex flex-wrap items-center gap-2">
          {selectedTags.map(slug => {
            const tag = allTags.find(t => t.slug === slug);
            if (!tag) return null;
            return (
              <TagBadge
                key={tag.id}
                tag={tag}
                selected
                size="sm"
                onClick={() => toggleTag(slug)}
              />
            );
          })}
          <button
            onClick={() => onSelectedTagsChange([])}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Temizle
          </button>
        </div>
      )}

      {isExpanded && (
        <div className="rounded-xl border border-border bg-card/50 p-3 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 sm:p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              Popüler Etiketler
            </div>
            <div className="flex flex-wrap gap-1.5">
              {trendingTags.map(tag => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  selected={selectedTags.includes(tag.slug)}
                  size="sm"
                  onClick={() => toggleTag(tag.slug)}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            {Object.entries(groupedTags).map(([category, categoryTags]) => (
              <div key={category}>
                <button
                  className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground transition-colors w-full text-left py-1"
                  onClick={() => toggleCategory(category)}
                >
                  {expandedCategories.has(category) ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {categoryLabels[category as TagCategory] || category}
                  <span className="text-[10px] opacity-50 ml-1">({categoryTags.length})</span>
                </button>

                {expandedCategories.has(category) && (
                  <div className="mt-2 flex flex-wrap gap-1.5 animate-in fade-in duration-200 sm:ml-4">
                    {categoryTags.map(tag => (
                      <TagBadge
                        key={tag.id}
                        tag={tag}
                        selected={selectedTags.includes(tag.slug)}
                        size="sm"
                        onClick={() => toggleTag(tag.slug)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {selectedTags.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {selectedTags.map(slug => {
                  const tag = allTags.find(t => t.slug === slug);
                  if (!tag) return null;
                  return (
                    <TagBadge
                      key={tag.id}
                      tag={tag}
                      selected
                      size="sm"
                      onClick={() => toggleTag(slug)}
                    />
                  );
                })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full shrink-0 text-xs sm:w-auto"
                onClick={() => onSelectedTagsChange([])}
              >
                <X className="h-3 w-3 mr-1" />
                Temizle
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TagFilterPanel;
