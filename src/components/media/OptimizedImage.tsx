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

type ImageFallbackStage = 'primary' | 'raw' | 'worker_proxy' | 'failed';

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
  srcSet,
  sizes,
  ...rest
}) => {
  const { ref, isNearViewport } = useNearViewport<HTMLDivElement>({
    rootMargin,
    disabled: priority,
    initialVisible: priority,
  });
  const [measuredWidth, setMeasuredWidth] = React.useState<number | null>(null);
  const [fallbackStage, setFallbackStage] = React.useState<ImageFallbackStage>('primary');
  const avoidRawFallback = React.useMemo(() => shouldAvoidRawImageFallback(src), [src]);
  const isExternalUrl = React.useMemo(
    () => typeof src === 'string' && (src.startsWith('http://') || src.startsWith('https://')),
    [src],
  );

  React.useLayoutEffect(() => {
    if (priority || transform?.width || !ref.current) {
      return;
    }

    const clientWidth = ref.current.clientWidth;
    if (clientWidth > 0 && clientWidth <= 240) {
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const nextWidth = Math.min(480, Math.max(72, Math.round(clientWidth * dpr)));
      setMeasuredWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    }
  }, [priority, ref, transform?.width]);

  const effectiveTransform = React.useMemo<ImageProxyTransformOptions | undefined>(() => {
    if (transform?.width) {
      return transform;
    }

    if (!priority && measuredWidth) {
      return {
        ...transform,
        width: measuredWidth,
        quality: transform?.quality ?? 85,
        format: transform?.format ?? 'webp',
        fit: transform?.fit ?? 'cover',
      };
    }

    return transform;
  }, [measuredWidth, priority, transform]);

  const transformKey = React.useMemo(() => getTransformKey(effectiveTransform), [effectiveTransform]);
  const shouldLoad = priority || isNearViewport;
  const hasTransform = Boolean(effectiveTransform && (effectiveTransform.width || effectiveTransform.quality));
  const effectiveAllowProxy = allowProxy || avoidRawFallback || hasTransform;

  const primarySrc = React.useMemo(() => {
    if (!effectiveAllowProxy) {
      return src;
    }

    return buildImageProxyUrl(src, effectiveTransform, {
      purpose: 'render',
      surface: 'public_render',
    }) || (avoidRawFallback ? buildProxiedImageUrl(src) : '') || src;
  }, [avoidRawFallback, effectiveAllowProxy, effectiveTransform, src, transformKey]);

  const resolvedSrc = React.useMemo(() => {
    if (fallbackStage === 'worker_proxy' && isExternalUrl) {
      return buildProxiedImageUrl(src) || src;
    }

    if (fallbackStage === 'raw') {
      return src;
    }

    return primarySrc;
  }, [fallbackStage, isExternalUrl, primarySrc, src]);

  React.useEffect(() => {
    setFallbackStage('primary');
  }, [src, transformKey, srcSet]);

  const handleError = React.useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      if (fallbackStage === 'primary') {
        if (!avoidRawFallback && primarySrc !== src) {
          setFallbackStage('raw');
          return;
        }

        if (isExternalUrl) {
          const proxied = buildProxiedImageUrl(src);
          if (proxied && proxied !== primarySrc) {
            setFallbackStage('worker_proxy');
            return;
          }
        }
      } else if (fallbackStage === 'raw' && isExternalUrl) {
        const proxied = buildProxiedImageUrl(src);
        if (proxied && proxied !== primarySrc && proxied !== src) {
          setFallbackStage('worker_proxy');
          return;
        }
      }

      setFallbackStage('failed');
      onError?.(event);
    },
    [avoidRawFallback, fallbackStage, isExternalUrl, onError, primarySrc, src],
  );

  const showFallbackPlaceholder = !resolvedSrc || fallbackStage === 'failed';
  const activeSrcSet = fallbackStage !== 'primary' ? undefined : srcSet;
  const activeSizes = fallbackStage !== 'primary' ? undefined : sizes;

  return (
    <div ref={ref} className={cn('h-full w-full', containerClassName)}>
      {showFallbackPlaceholder ? (
        <div
          role="img"
          aria-label={alt || 'Görsel yüklenemedi'}
          className={cn(
            'flex h-full w-full items-center justify-center bg-gradient-to-br from-muted/65 via-card to-background/95 p-2.5 text-center text-[10px] font-medium leading-snug text-muted-foreground/85 sm:p-3 sm:text-[11px]',
            placeholderClassName,
          )}
        >
          <span className="line-clamp-3 break-words">{alt || 'Görsel yüklenemedi'}</span>
        </div>
      ) : shouldLoad ? (
        <img
          src={resolvedSrc}
          srcSet={activeSrcSet}
          sizes={activeSizes}
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
