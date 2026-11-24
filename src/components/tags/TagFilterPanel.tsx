import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, ChevronDown, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import TagBadge from './TagBadge';
import { Tag, TagCategory } from '@/lib/types';
import { getAllTags } from '@/lib/database';
import { cn } from '@/lib/utils';

let cachedCommunityTags: Tag[] | null = null;
let communityTagsPromise: Promise<Tag[]> | null = null;

const loadCommunityTags = async () => {
  if (cachedCommunityTags) {
    return cachedCommunityTags;
  }

  if (!communityTagsPromise) {
    communityTagsPromise = getAllTags()
      .then((tags) => {
        cachedCommunityTags = tags;
        return tags;
      })
      .finally(() => {
        communityTagsPromise = null;
      });
  }

  return communityTagsPromise;
};

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

interface TagFilterChipProps {
  tag: Tag;
  selected: boolean;
  onToggle: (slug: string) => void;
}

const TagFilterChip = memo<TagFilterChipProps>(({ tag, selected, onToggle }) => {
  const handleClick = useCallback(() => {
    onToggle(tag.slug);
  }, [onToggle, tag.slug]);

  return (
    <TagBadge
      tag={tag}
      selected={selected}
      size="sm"
      onClick={handleClick}
    />
  );
});

TagFilterChip.displayName = 'TagFilterChip';

interface TagCategoryGroupProps {
  category: string;
  label: string;
  tags: Tag[];
  isCategoryExpanded: boolean;
  selectedTagSet: ReadonlySet<string>;
  onToggleCategory: (category: string) => void;
  onToggleTag: (slug: string) => void;
}

const TagCategoryGroup = memo<TagCategoryGroupProps>(({
  category,
  label,
  tags,
  isCategoryExpanded,
  selectedTagSet,
  onToggleCategory,
  onToggleTag,
}) => {
  const handleToggleCategory = useCallback(() => {
    onToggleCategory(category);
  }, [category, onToggleCategory]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={isCategoryExpanded}
        className="flex min-h-8 w-full items-center gap-1.5 py-1 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={handleToggleCategory}
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
            isCategoryExpanded && 'rotate-180',
          )}
        />
        <span>{label}</span>
        <span className="ml-0.5 text-[10px] opacity-55 tabular-nums">({tags.length})</span>
      </button>

      {isCategoryExpanded && (
        <div className="mt-2 flex flex-wrap gap-1.5 sm:ml-4">
          {tags.map((tag) => (
            <TagFilterChip
              key={tag.id}
              tag={tag}
              selected={selectedTagSet.has(tag.slug)}
              onToggle={onToggleTag}
            />
          ))}
        </div>
      )}
    </div>
  );
});

TagCategoryGroup.displayName = 'TagCategoryGroup';

const TagFilterPanel: React.FC<TagFilterPanelProps> = ({
  selectedTags,
  onSelectedTagsChange,
}) => {
  const [allTags, setAllTags] = useState<Tag[]>(() => cachedCommunityTags ?? []);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPanelRendered, setIsPanelRendered] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(() => !cachedCommunityTags);

  const selectedTagsRef = useRef(selectedTags);
  selectedTagsRef.current = selectedTags;
  const onSelectedTagsChangeRef = useRef(onSelectedTagsChange);
  onSelectedTagsChangeRef.current = onSelectedTagsChange;

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (cachedCommunityTags) {
        setAllTags(cachedCommunityTags);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const tags = await loadCommunityTags();
      if (!active) {
        return;
      }

      setAllTags(tags);
      setIsLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isExpanded) {
      setIsPanelRendered(true);
      const frameId = window.requestAnimationFrame(() => {
        setIsPanelOpen(true);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    setIsPanelOpen(false);
    if (!isPanelRendered) {
      return;
    }

    const prefersReduced =
      typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timerId = window.setTimeout(() => {
      setIsPanelRendered(false);
    }, prefersReduced ? 0 : 210);

    return () => window.clearTimeout(timerId);
  }, [isExpanded, isPanelRendered]);

  const handleToggleTagSlug = useCallback((slug: string) => {
    const current = selectedTagsRef.current;
    if (current.includes(slug)) {
      onSelectedTagsChangeRef.current(current.filter((t) => t !== slug));
    } else {
      onSelectedTagsChangeRef.current([...current, slug]);
    }
  }, []);

  const handleClearTags = useCallback(() => {
    onSelectedTagsChangeRef.current([]);
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  const tagBySlug = useMemo(
    () => new Map(allTags.map((tag) => [tag.slug, tag])),
    [allTags],
  );

  const groupedEntries = useMemo(() => {
    if (!isPanelRendered) {
      return [] as Array<[string, Tag[]]>;
    }
    const grouped = allTags.reduce((acc, tag) => {
      if (!acc[tag.category]) acc[tag.category] = [];
      acc[tag.category].push(tag);
      return acc;
    }, {} as Record<string, Tag[]>);
    return Object.entries(grouped);
  }, [allTags, isPanelRendered]);

  const trendingTags = useMemo(
    () => (isPanelRendered ? [...allTags].sort((a, b) => b.usageCount - a.usageCount).slice(0, 12) : []),
    [allTags, isPanelRendered],
  );

  return (
    <div>
      <Button
        type="button"
        variant={isExpanded || selectedTags.length > 0 ? 'default' : 'outline'}
        size="sm"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((prev) => !prev)}
        className="h-9 w-full justify-between gap-1.5 active:scale-100 sm:w-auto sm:justify-center"
      >
        <span className="inline-flex items-center gap-1.5">
          <Hash className="h-4 w-4 shrink-0" />
          <span>Etiketler</span>
          {selectedTags.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-5 border-none bg-white/20 px-1.5 text-[10px] text-inherit tabular-nums">
              {selectedTags.length}
            </Badge>
          )}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
            isExpanded && 'rotate-180',
          )}
        />
      </Button>

      {selectedTags.length > 0 && !isLoading && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {selectedTags.map((slug) => {
            const tag = tagBySlug.get(slug);
            if (!tag) return null;
            return (
              <TagFilterChip
                key={tag.id}
                tag={tag}
                selected
                onToggle={handleToggleTagSlug}
              />
            );
          })}
          <button
            type="button"
            onClick={handleClearTags}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:border-border hover:bg-secondary/70 hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Temizle
          </button>
        </div>
      )}

      <div
        aria-hidden={!isExpanded}
        className={cn(
          'grid transition-[grid-template-rows,opacity,visibility,margin] duration-200 ease-out motion-reduce:transition-none',
          isPanelOpen
            ? 'visible mt-3 grid-rows-[1fr] opacity-100'
            : 'pointer-events-none invisible mt-0 grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          {isPanelRendered ? (
            <div className="space-y-4 rounded-xl border border-border bg-card/50 p-3 sm:p-4">
              {isLoading ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Etiketler yükleniyor
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <div
                        key={`tag-filter-loading-${index}`}
                        className="h-7 rounded-full border border-border/70 bg-muted/40 animate-pulse motion-reduce:animate-none"
                        style={{ width: `${72 + (index % 3) * 18}px` }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Popüler Etiketler
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {trendingTags.map((tag) => (
                        <TagFilterChip
                          key={tag.id}
                          tag={tag}
                          selected={selectedTagSet.has(tag.slug)}
                          onToggle={handleToggleTagSlug}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 border-t border-border pt-3">
                    {groupedEntries.map(([category, categoryTags]) => (
                      <TagCategoryGroup
                        key={category}
                        category={category}
                        label={categoryLabels[category as TagCategory] || category}
                        tags={categoryTags}
                        isCategoryExpanded={expandedCategories.has(category)}
                        selectedTagSet={selectedTagSet}
                        onToggleCategory={toggleCategory}
                        onToggleTag={handleToggleTagSlug}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default memo(TagFilterPanel);
