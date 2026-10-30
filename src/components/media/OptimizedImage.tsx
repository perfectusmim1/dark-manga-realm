import React from 'react';
import { cn } from '@/lib/utils';
import { useNearViewport } from '@/hooks/use-near-viewport';
import {
  buildImageProxyUrl,
  shouldAvoidRawImageFallback,
  type ImageProxyTransformOptions,
} from '@/lib/imageProxy';
import { buildProxiedImageUrl } from '@/lib/mediaStorage';

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
  const [useProxyFallback, setUseProxyFallback] = React.useState(false);
  const avoidRawFallback = React.useMemo(() => shouldAvoidRawImageFallback(src), [src]);
  const isExternalUrl = React.useMemo(
    () => typeof src === 'string' && (src.startsWith('http://') || src.startsWith('https://')),
    [src],
  );

  const shouldLoad = priority || isNearViewport;
  const effectiveAllowProxy = allowProxy || avoidRawFallback;
  const resolvedSrc = React.useMemo(() => {
    if (useProxyFallback && isExternalUrl) {
      const proxied = buildProxiedImageUrl(src);
      if (proxied && proxied !== src) {
        return proxied;
      }
    }

    if (!effectiveAllowProxy || shouldBypassProxy) {
      return src;
    }

    return buildImageProxyUrl(src, transform, {
      purpose: 'render',
      surface: 'public_render',
    }) || (avoidRawFallback ? buildProxiedImageUrl(src) : '') || src;
  }, [avoidRawFallback, effectiveAllowProxy, isExternalUrl, shouldBypassProxy, src, transform, transformKey, useProxyFallback]);

  React.useEffect(() => {
    setShouldBypassProxy(false);
    setUseProxyFallback(false);
  }, [src, transformKey]);

  const handleError = React.useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      if (effectiveAllowProxy && !avoidRawFallback && !shouldBypassProxy && resolvedSrc !== src && !useProxyFallback) {
        setShouldBypassProxy(true);
        return;
      }

      if (isExternalUrl && !useProxyFallback) {
        const proxied = buildProxiedImageUrl(src);
        if (proxied && proxied !== resolvedSrc) {
          setUseProxyFallback(true);
          return;
        }
      }

      onError?.(event);
    },
    [avoidRawFallback, effectiveAllowProxy, isExternalUrl, onError, resolvedSrc, shouldBypassProxy, src, useProxyFallback],
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
          referrerPolicy="no-referrer"
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
