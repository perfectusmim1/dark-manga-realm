import React from 'react';
import { Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface EntityDetailRankBadgeProps {
  rank?: number;
  className?: string;
}

const rankToneByValue: Record<number, string> = {
  1: 'bg-yellow-500 text-black',
  2: 'bg-slate-200 text-slate-950',
  3: 'bg-amber-700 text-amber-50',
};

const EntityDetailRankBadge: React.FC<EntityDetailRankBadgeProps> = ({ rank, className }) => {
  if (!rank || rank > 3) {
    return null;
  }

  return (
    <Badge
      className={cn(
        'border-0 px-3 py-1 text-sm font-bold shadow-lg',
        rankToneByValue[rank] ?? 'bg-yellow-500 text-black',
        className,
      )}
    >
      <Trophy className="mr-2 h-4 w-4" />
      #{rank} RANK
    </Badge>
  );
};

export default EntityDetailRankBadge;
