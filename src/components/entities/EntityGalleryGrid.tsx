import React from 'react';
import { Camera, ZoomIn } from 'lucide-react';
import ImageLightbox, { type LightboxImageItem } from '@/components/media/ImageLightbox';
import OptimizedImage from '@/components/media/OptimizedImage';
import { EntityGalleryImage } from '@/lib/types';

interface EntityGalleryGridProps {
  images?: EntityGalleryImage[];
  title?: string;
  emptyText?: string;
}

const normalizeDisplayText = (value?: string | null) => {
  const normalized = value?.trim() || '';
  if (!normalized) {
    return '';
  }

  return ['import', 'imported'].includes(normalized.toLowerCase()) ? '' : normalized;
};

const EntityGalleryGrid: React.FC<EntityGalleryGridProps> = ({
  images,
  title = 'Galeri',
  emptyText,
}) => {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const visibleImages = (images || []).filter((image) => image?.url);
  const lightboxImages = React.useMemo<LightboxImageItem[]>(
    () => visibleImages.map((image, index) => ({
      src: image.url,
      fallbackSrc: image.thumbUrl || image.url,
      alt: image.label || `${title} ${index + 1}`,
      caption: normalizeDisplayText(image.label) || normalizeDisplayText(image.source),
    })),
    [title, visibleImages],
  );

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
        {visibleImages.map((image, index) => {
          const primaryLabel = normalizeDisplayText(image.label) || `${title} ${index + 1}`;
          const secondaryLabel = normalizeDisplayText(image.source);

          return (
            <button
              type="button"
              key={`${image.url}-${index}`}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors duration-200 hover:border-primary/40 [transform:translateZ(0)]"
              onClick={() => setOpenIndex(index)}
            >
              <div className="relative isolate aspect-[4/5] overflow-hidden bg-black/75">
                <div className="absolute inset-0 transform-gpu transition-transform duration-300 ease-out ">
                  <OptimizedImage
                    src={image.thumbUrl || image.url}
                    alt={primaryLabel}
                    rootMargin="520px 0px"
                    containerClassName="h-full w-full bg-black/40"
                    placeholderClassName="rounded-none bg-black/40"
                    className="h-full w-full object-cover"
                  />
                  {primaryLabel && (
                    <div className="absolute inset-x-0 bottom-0 top-1/2 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/25 to-transparent p-3 pb-3 text-white">
                      <p className="line-clamp-2 text-xs font-medium">
                        {primaryLabel}
                      </p>
                    </div>
                  )}
                </div>
                <div className="absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <ZoomIn className="h-4 w-4" />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-left text-xs text-muted-foreground">
                <span className="truncate">{secondaryLabel || primaryLabel || 'Görsel'}</span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
                  BÜYÜT
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <ImageLightbox
        images={lightboxImages}
        openIndex={openIndex}
        onClose={() => setOpenIndex(null)}
        onNavigate={(nextIndex) => setOpenIndex(nextIndex)}
      />
    </div>
  );
};

export default EntityGalleryGrid;
