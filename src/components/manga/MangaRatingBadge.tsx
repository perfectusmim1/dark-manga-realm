import React from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MangaRatingBadgeProps {
  value: number;
  className?: string;
  iconClassName?: string;
}

const MangaRatingBadge: React.FC<MangaRatingBadgeProps> = ({
  value,
  className,
  iconClassName,
}) => {
  const safeValue = Number.isFinite(value) ? value : 0;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/35 px-2 py-1 font-semibold leading-none text-amber-300 shadow-[0_6px_18px_rgba(0,0,0,0.28)] ring-1 ring-white/10 backdrop-blur-[2px]',
        className,
      )}
    >
      <Star className={cn('h-3.5 w-3.5 fill-current text-amber-400', iconClassName)} />
      {safeValue.toFixed(1)}
    </span>
  );
};

export default MangaRatingBadge;
