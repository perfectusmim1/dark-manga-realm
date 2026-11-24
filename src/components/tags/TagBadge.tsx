import React, { memo } from 'react';
import { ThumbsUp, ThumbsDown, Shield, CheckCircle2 } from 'lucide-react';
import { Tag, TagCategory } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getTagDisplayName } from '@/lib/tagTranslations';


const categoryConfig: Record<TagCategory, { bg: string; text: string; border: string; icon: string }> = {
  theme: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', icon: '🎭' },
  mood: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20', icon: '💫' },
  trope: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', icon: '⚡' },
  demographic: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', icon: '👥' },
  content: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', icon: '📖' },
  general: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', icon: '#' },
};

interface TagBadgeProps {
  tag: Tag;
  accepted?: boolean;
  selected?: boolean;
  excluded?: boolean;
  showVotes?: boolean;
  votes?: { up: number; down: number };
  userVote?: 'up' | 'down' | null;
  onClick?: () => void;
  onVoteUp?: () => void;
  onVoteDown?: () => void;
  size?: 'sm' | 'md';
  removable?: boolean;
  onRemove?: () => void;
}

const TagBadge: React.FC<TagBadgeProps> = ({
  tag,
  accepted = false,
  selected,
  excluded = false,
  showVotes,
  votes,
  userVote,
  onClick,
  onVoteUp,
  onVoteDown,
  size = 'md',
  removable,
  onRemove,
}) => {
  if (!tag) {
    return null;
  }

  const displayName = getTagDisplayName(tag.slug, tag.name);
  if (!displayName) {
    return null;
  }

  const config = categoryConfig[tag.category] || categoryConfig.general;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick && (selected !== undefined || excluded) ? Boolean(selected) : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'group inline-flex max-w-full min-w-0 select-none items-center gap-1.5 overflow-hidden rounded-full border transition-colors duration-150',
        size === 'sm' ? 'min-h-7 px-2.5 py-1 text-xs' : 'min-h-8 px-3 py-1 text-sm',
        selected
          ? 'border-primary/60 bg-primary/20 font-semibold text-primary hover:border-primary hover:bg-primary/25 hover:text-primary'
          : excluded
            ? 'border-destructive/55 bg-destructive/15 font-medium text-destructive hover:border-destructive hover:bg-destructive/20'
            : accepted && !tag.isOfficial
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
              : `${config.bg} ${config.border} ${config.text}`,
        onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        onClick && !selected && !excluded && 'hover:border-primary/50 hover:bg-secondary/70',
        tag.isOfficial && !selected && !excluded && 'ring-1 ring-inset ring-primary/15'
      )}
      onClick={onClick}
    >
      <span className="shrink-0 text-[10px] leading-none">{config.icon}</span>
      <span className="truncate font-medium">{displayName}</span>
      
      {tag.isOfficial && (
        <Shield className="h-3 w-3 shrink-0 opacity-60" />
      )}
      {!tag.isOfficial && accepted && (
        <CheckCircle2 className="h-3 w-3 shrink-0 opacity-75" />
      )}
      
      {showVotes && votes && (
        <div className="ml-1 flex shrink-0 items-center gap-1 border-l border-current/20 pl-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onVoteUp?.(); }}
            className={cn(
              'p-0.5 rounded transition-colors duration-150',
              userVote === 'up' ? 'text-green-400' : 'opacity-50 hover:opacity-100 hover:text-green-400'
            )}
          >
            <ThumbsUp className="h-3 w-3" />
          </button>
          <span className="text-[10px] font-mono min-w-[16px] text-center tabular-nums">
            {votes.up - votes.down}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onVoteDown?.(); }}
            className={cn(
              'p-0.5 rounded transition-colors duration-150',
              userVote === 'down' ? 'text-red-400' : 'opacity-50 hover:opacity-100 hover:text-red-400'
            )}
          >
            <ThumbsDown className="h-3 w-3" />
          </button>
        </div>
      )}

      {removable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          className="ml-0.5 shrink-0 text-current opacity-100 transition-opacity duration-150 hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default memo(TagBadge);
