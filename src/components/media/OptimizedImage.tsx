import React from 'react';
import { cn } from '@/lib/utils';
import { useNearViewport } from '@/hooks/use-near-viewport';
import {
  buildImageProxyUrl,
  shouldAvoidRawImageFallback,
  type ImageProxyTransformOptions,
} from '@/lib/imageProxy';

interface OptimizedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  src: string;
  alt: string;
  priority?: boolean;
  rootMargin?: string;
  containerClassName?: string;
  placeholderClassName?: string;
  transform?: ImageProxyTransformOptions;
  allowProxy?: boolean;
}

const getTransformKey = (transform?: ImageProxyTransformOptions) =>
  transform
    ? `${transform.width || ''}:${transform.quality || ''}:${transform.format || ''}:${transform.fit || ''}`
    : '';

const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  className,
  priority = false,
  rootMargin = '420px 0px',
  containerClassName,
  placeholderClassName,
  transform,
  allowProxy = false,
  onError,
  fetchPriority: _fetchPriority,
  ...rest
}) => {
  const { ref, isNearViewport } = useNearViewport<HTMLDivElement>({
    rootMargin,
    disabled: priority,
    initialVisible: priority,
  });
  const transformKey = React.useMemo(() => getTransformKey(transform), [transform]);
  const [shouldBypassProxy, setShouldBypassProxy] = React.useState(false);
  const avoidRawFallback = React.useMemo(() => shouldAvoidRawImageFallback(src), [src]);

  const shouldLoad = priority || isNearViewport;
  const resolvedSrc = React.useMemo(() => {
    if (!allowProxy || shouldBypassProxy) {
      return src;
    }

    return buildImageProxyUrl(src, transform, {
      purpose: 'render',
      surface: 'public_render',
    }) || src;
  }, [allowProxy, shouldBypassProxy, src, transform, transformKey]);

  React.useEffect(() => {
    setShouldBypassProxy(false);
  }, [src, transformKey]);

  const handleError = React.useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      if (allowProxy && !avoidRawFallback && !shouldBypassProxy && resolvedSrc !== src) {
        setShouldBypassProxy(true);
        return;
      }

      onError?.(event);
    },
    [allowProxy, avoidRawFallback, onError, resolvedSrc, shouldBypassProxy, src],
  );

  return (
    <div ref={ref} className={cn('h-full w-full', containerClassName)}>
      {shouldLoad ? (
        <img
          src={resolvedSrc}
          alt={alt}
          className={cn('image-downscale-quality', className)}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={handleError}
          {...rest}
        />
      ) : (
        <div
          aria-hidden
          className={cn('h-full w-full bg-muted/25', placeholderClassName)}
        />
      )}
    </div>
  );
};

export default OptimizedImage;
