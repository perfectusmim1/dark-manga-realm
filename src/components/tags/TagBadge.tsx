import React from 'react';
import { ThumbsUp, ThumbsDown, Shield, CheckCircle2 } from 'lucide-react';
import { Tag, TagCategory } from '@/lib/types';
import { cn } from '@/lib/utils';

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
  const config = categoryConfig[tag.category] || categoryConfig.general;

  return (
    <div
      className={cn(
        'group inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full border transition-all duration-200',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        selected
          ? 'bg-primary/20 border-primary/40 text-primary shadow-[0_0_8px_rgba(var(--primary),0.15)]'
          : accepted && !tag.isOfficial
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
            : `${config.bg} ${config.border} ${config.text}`,
        onClick && 'cursor-pointer hover:scale-105 active:scale-95',
        tag.isOfficial && 'ring-1 ring-primary/10'
      )}
      onClick={onClick}
    >
      <span className="shrink-0 text-[10px]">{config.icon}</span>
      <span className="truncate font-medium">{tag.name}</span>
      
      {tag.isOfficial && (
        <Shield className="h-3 w-3 shrink-0 opacity-50" />
      )}
      {!tag.isOfficial && accepted && (
        <CheckCircle2 className="h-3 w-3 shrink-0 opacity-70" />
      )}
      
      {showVotes && votes && (
        <div className="ml-1 flex shrink-0 items-center gap-1 border-l border-current/20 pl-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onVoteUp?.(); }}
            className={cn(
              'p-0.5 rounded transition-colors',
              userVote === 'up' ? 'text-green-400' : 'opacity-50 hover:opacity-100 hover:text-green-400'
            )}
          >
            <ThumbsUp className="h-3 w-3" />
          </button>
          <span className="text-[10px] font-mono min-w-[16px] text-center">
            {votes.up - votes.down}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onVoteDown?.(); }}
            className={cn(
              'p-0.5 rounded transition-colors',
              userVote === 'down' ? 'text-red-400' : 'opacity-50 hover:opacity-100 hover:text-red-400'
            )}
          >
            <ThumbsDown className="h-3 w-3" />
          </button>
        </div>
      )}

      {removable && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          className="ml-0.5 shrink-0 text-current opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default TagBadge;
