import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OptimizedImage from '@/components/media/OptimizedImage';

export interface LightboxImageItem {
  src: string;
  alt: string;
  caption?: string;
  fallbackSrc?: string;
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
  const [shouldUseFallbackSrc, setShouldUseFallbackSrc] = React.useState(false);
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setShouldUseFallbackSrc(false);
  }, [activeImage?.fallbackSrc, activeImage?.src]);

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    setPortalContainer(document.body);
  }, []);

  const handleNavigate = (direction: -1 | 1) => {
    if (!activeImage || !onNavigate || images.length === 0) {
      return;
    }

    const nextIndex = (currentIndex + direction + images.length) % images.length;
    onNavigate(nextIndex);
  };

  const resolvedLightboxSrc = React.useMemo(() => {
    if (!activeImage) {
      return null;
    }

    if (shouldUseFallbackSrc && activeImage.fallbackSrc) {
      return activeImage.fallbackSrc;
    }

    return activeImage.src;
  }, [activeImage, shouldUseFallbackSrc]);

  React.useEffect(() => {
    if (!activeImage || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const previousBodyStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      touchAction: body.style.touchAction,
    };
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    root.style.overscrollBehavior = 'none';

    return () => {
      body.style.position = previousBodyStyle.position;
      body.style.top = previousBodyStyle.top;
      body.style.left = previousBodyStyle.left;
      body.style.right = previousBodyStyle.right;
      body.style.width = previousBodyStyle.width;
      body.style.overflow = previousBodyStyle.overflow;
      body.style.touchAction = previousBodyStyle.touchAction;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    };
  }, [activeImage]);

  React.useEffect(() => {
    if (!activeImage) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (!hasMultipleImages) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleNavigate(-1);
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleNavigate(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeImage, hasMultipleImages, onClose, onNavigate, currentIndex, images.length]);

  if (!activeImage || !portalContainer) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-2 backdrop-blur-[2px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-lightbox-title"
      aria-describedby="image-lightbox-description"
      onClick={onClose}
    >
      <div
        className="relative max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/90 shadow-2xl animate-in fade-in-0 zoom-in-95 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(calc(100vw-2rem),72rem)] sm:max-w-[min(calc(100vw-2rem),72rem)] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="image-lightbox-title" className="sr-only">Görsel Büyütme</h2>
        <p id="image-lightbox-description" className="sr-only">Görselin tam boyutlu hali.</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 z-20 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>

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

        <div className="flex max-h-[calc(100dvh-8.5rem)] min-h-[min(50vh,22rem)] items-center justify-center overflow-hidden bg-black/90 px-3 py-5 sm:max-h-[75vh] sm:px-10 sm:py-6">
          <OptimizedImage
            src={resolvedLightboxSrc || activeImage.src}
            alt={activeImage.alt}
            priority
            containerClassName="w-full"
            placeholderClassName="rounded-none bg-black/50"
            className="max-h-[75vh] w-full object-contain"
            onError={() => {
              if (!shouldUseFallbackSrc && activeImage.fallbackSrc && activeImage.fallbackSrc !== activeImage.src) {
                setShouldUseFallbackSrc(true);
              }
            }}
          />
        </div>

        <div className="border-t border-white/10 bg-black/80 px-5 py-4 text-white">
          <p className="text-sm font-semibold">{activeImage.caption || activeImage.alt}</p>
          {hasMultipleImages ? (
            <p className="mt-1 text-xs text-white/60">
              {currentIndex + 1} / {images.length}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    portalContainer,
  );
};

export default ImageLightbox;
