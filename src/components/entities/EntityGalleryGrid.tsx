import React from 'react';
import { Camera, ExternalLink } from 'lucide-react';
import OptimizedImage from '@/components/media/OptimizedImage';
import { EntityGalleryImage } from '@/lib/types';

interface EntityGalleryGridProps {
  images?: EntityGalleryImage[];
  title?: string;
  emptyText?: string;
}

const EntityGalleryGrid: React.FC<EntityGalleryGridProps> = ({
  images,
  title = 'Galeri',
  emptyText,
}) => {
  const visibleImages = (images || []).filter((image) => image?.url);

  if (visibleImages.length === 0) {
    return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-primary" />
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {visibleImages.map((image, index) => (
          <a
            key={`${image.url}-${index}`}
            href={image.sourceUrl || image.url}
            target="_blank"
            rel="noreferrer"
            className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-transform duration-200 hover:-translate-y-1"
          >
            <div className="relative aspect-[4/5] overflow-hidden">
              <OptimizedImage
                src={image.thumbUrl || image.url}
                alt={image.label || `${title} ${index + 1}`}
                rootMargin="520px 0px"
                containerClassName="h-full w-full"
                placeholderClassName="rounded-none"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {(image.label || image.source) && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent p-3 text-white">
                  <p className="line-clamp-2 text-xs font-medium">
                    {image.label || image.source}
                  </p>
                </div>
              )}
            </div>

            {image.sourceUrl && (
              <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <span className="truncate">{image.source || 'Kaynak'}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
};

export default EntityGalleryGrid;
