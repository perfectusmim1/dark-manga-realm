import React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import OptimizedImage from '@/components/media/OptimizedImage';

export interface LightboxImageItem {
  src: string;
  alt: string;
  caption?: string;
}

interface ImageLightboxProps {
  images: LightboxImageItem[];
  openIndex: number | null;
  onClose: () => void;
  onNavigate?: (nextIndex: number) => void;
}

const ImageLightbox: React.FC<ImageLightboxProps> = ({
  images,
  openIndex,
  onClose,
  onNavigate,
}) => {
  const currentIndex = openIndex ?? 0;
  const activeImage = openIndex === null ? null : images[currentIndex];
  const hasMultipleImages = images.length > 1;

  const handleNavigate = (direction: -1 | 1) => {
    if (!activeImage || !onNavigate || images.length === 0) {
      return;
    }

    const nextIndex = (currentIndex + direction + images.length) % images.length;
    onNavigate(nextIndex);
  };

  return (
    <Dialog open={openIndex !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-6xl border-none bg-transparent p-0 shadow-none sm:rounded-2xl">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/90">
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-20 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>

          {hasMultipleImages ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white"
                onClick={() => handleNavigate(-1)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white"
                onClick={() => handleNavigate(1)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          ) : null}

          {activeImage ? (
            <div className="flex max-h-[85vh] min-h-[50vh] items-center justify-center bg-black/90 px-4 py-6 sm:px-10">
              <OptimizedImage
                src={activeImage.src}
                alt={activeImage.alt}
                priority
                containerClassName="w-full"
                placeholderClassName="rounded-none bg-black/50"
                className="max-h-[75vh] w-full object-contain"
              />
            </div>
          ) : null}

          {activeImage ? (
            <div className="border-t border-white/10 bg-black/80 px-5 py-4 text-white">
              <p className="text-sm font-semibold">{activeImage.caption || activeImage.alt}</p>
              {hasMultipleImages ? (
                <p className="mt-1 text-xs text-white/60">
                  {currentIndex + 1} / {images.length}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImageLightbox;
