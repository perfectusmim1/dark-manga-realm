import React, { useState } from 'react';
import OptimizedImage from '@/components/media/OptimizedImage';
import { cn } from '@/lib/utils';

export interface TierItemCardProps {
  item: any;
  sourceTierId: string;
  isSelected: boolean;
  isDragging: boolean;
  isTouchDragging: boolean;
  widthClass: string;
  idleClassName: string;
  seriesTitle?: string;
  onDragStart?: (e: React.DragEvent, sourceTierId: string, itemId: string | number) => void;
  onDragEnd?: () => void;
  onTouchStart?: (event: React.TouchEvent, sourceTierId: string, item: any) => void;
  onClick?: (e: React.MouseEvent, id: string, sourceTierId: string) => void;
}

export const TierItemCard: React.FC<TierItemCardProps> = React.memo(({
  item,
  sourceTierId,
  isSelected,
  isDragging,
  isTouchDragging,
  widthClass,
  idleClassName,
  seriesTitle,
  onDragStart,
  onDragEnd,
  onTouchStart,
  onClick,
}) => {
  const [imageError, setImageError] = useState(false);
  const itemId = item.id?.toString() || '';
  const itemLabel = item.name || item.title || 'İsimsiz';
  const itemImage = item.cover || item.imageUrl || item.image_url;

  const tooltipText = seriesTitle
    ? `${itemLabel} • ${seriesTitle}`
    : itemLabel;

  return (
    <div
      tabIndex={0}
      role="button"
      aria-label={tooltipText}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart ? (e) => onDragStart(e, sourceTierId, item.id) : undefined}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart ? (e) => onTouchStart(e, sourceTierId, item) : undefined}
      onClick={onClick ? (e) => onClick(e, item.id, sourceTierId) : undefined}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick(e as any, item.id, sourceTierId);
        }
      }}
      className={cn(
        widthClass,
        'group relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border-2 bg-secondary/80 transition-all touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isDragging && 'opacity-30',
        isSelected
          ? 'z-20 scale-110 border-primary shadow-lg ring-4 ring-primary/20'
          : idleClassName,
        isTouchDragging && 'scale-105 border-primary shadow-xl ring-2 ring-primary/30',
      )}
      title={tooltipText}
    >
      {/* Visual Content: Image or Fallback */}
      {itemImage && !imageError ? (
        <OptimizedImage
          src={itemImage}
          alt={itemLabel}
          allowProxy
          transform={{ width: 320, quality: 75, fit: 'cover' }}
          className="h-full w-full object-cover pointer-events-none"
          containerClassName="h-full w-full"
          rootMargin="400px 0px"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-secondary via-secondary/70 to-background/50 p-1 text-center select-none">
          <div className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-primary/20 text-[10px] sm:text-xs font-bold text-primary mb-1">
            {itemLabel.charAt(0).toUpperCase()}
          </div>
          <span className="line-clamp-2 text-[8px] sm:text-[9px] font-medium leading-tight text-muted-foreground/80">
            {itemLabel}
          </span>
        </div>
      )}

      {/* Focus & Hover & Selected Overlay */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/60 to-transparent p-1.5 transition-opacity duration-150 z-10',
          isSelected
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus:opacity-100 group-active:opacity-100',
        )}
      >
        <span className="block line-clamp-2 text-[9px] sm:text-[10px] font-bold leading-tight text-white drop-shadow-md">
          {itemLabel}
        </span>
        {seriesTitle && (
          <span className="mt-0.5 block line-clamp-1 text-[8px] font-semibold leading-tight text-primary drop-shadow">
            {seriesTitle}
          </span>
        )}
      </div>
    </div>
  );
});

TierItemCard.displayName = 'TierItemCard';
export default TierItemCard;
