import React from 'react';
import {
  buildImageProxyUrl,
  shouldAvoidRawImageFallback,
  type ImageProxyTransformOptions,
} from '@/lib/imageProxy';
import { buildProxiedImageUrl } from '@/lib/mediaStorage';
import { cn } from '@/lib/utils';

interface ProxyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  src: string;
  alt: string;
  transform?: ImageProxyTransformOptions;
  allowProxy?: boolean;
}

const getTransformKey = (transform?: ImageProxyTransformOptions) =>
  transform
    ? `${transform.width || ''}:${transform.quality || ''}:${transform.format || ''}:${transform.fit || ''}`
    : '';

const ProxyImage: React.FC<ProxyImageProps> = ({
  src,
  alt,
  className,
  transform,
  allowProxy = false,
  onError,
  fetchPriority: _fetchPriority,
  loading = 'lazy',
  decoding = 'async',
  srcSet,
  sizes,
  ...rest
}) => {
  const transformKey = React.useMemo(() => getTransformKey(transform), [transform]);
  const [shouldBypassProxy, setShouldBypassProxy] = React.useState(false);
  const [useProxyFallback, setUseProxyFallback] = React.useState(false);
  const [hasFinalError, setHasFinalError] = React.useState(false);
  const avoidRawFallback = React.useMemo(() => shouldAvoidRawImageFallback(src), [src]);
  const hasTransform = Boolean(transform && (transform.width || transform.quality));
  const effectiveAllowProxy = allowProxy || avoidRawFallback || hasTransform;
  const isExternalUrl = typeof src === 'string' && (src.startsWith('http://') || src.startsWith('https://'));

  React.useEffect(() => {
    setShouldBypassProxy(false);
    setUseProxyFallback(false);
    setHasFinalError(false);
  }, [src, transformKey, srcSet]);

  const proxiedSrc = React.useMemo(() => {
    if (useProxyFallback && isExternalUrl) {
      return buildProxiedImageUrl(src) || src;
    }

    if (!effectiveAllowProxy || shouldBypassProxy) {
      return src;
    }

    return buildImageProxyUrl(src, transform, {
      purpose: 'preview',
      surface: 'admin_preview',
    }) || (avoidRawFallback ? buildProxiedImageUrl(src) : '') || src;
  }, [avoidRawFallback, effectiveAllowProxy, isExternalUrl, shouldBypassProxy, src, transform, useProxyFallback]);

  const handleError = React.useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      if (effectiveAllowProxy && !avoidRawFallback && !shouldBypassProxy && proxiedSrc !== src && !useProxyFallback) {
        setShouldBypassProxy(true);
        return;
      }

      if (isExternalUrl && !useProxyFallback) {
        const fallbackUrl = buildProxiedImageUrl(src);
        if (fallbackUrl && fallbackUrl !== proxiedSrc) {
          setUseProxyFallback(true);
          return;
        }
      }

      setHasFinalError(true);
      onError?.(event);
    },
    [avoidRawFallback, effectiveAllowProxy, isExternalUrl, onError, proxiedSrc, shouldBypassProxy, src, useProxyFallback],
  );

  if (!proxiedSrc || hasFinalError) {
    return (
      <div
        role="img"
        aria-label={alt || 'Görsel yüklenemedi'}
        className={cn(
          'flex items-center justify-center bg-gradient-to-br from-muted/65 via-card to-background/95 p-2 text-center text-[10px] font-medium leading-snug text-muted-foreground/85',
          className,
        )}
      >
        <span className="line-clamp-3 break-words">{alt || 'Görsel yüklenemedi'}</span>
      </div>
    );
  }

  const activeSrcSet = shouldBypassProxy || useProxyFallback ? undefined : srcSet;
  const activeSizes = shouldBypassProxy || useProxyFallback ? undefined : sizes;

  return (
    <img
      referrerPolicy="no-referrer"
      loading={loading}
      decoding={decoding}
      {...rest}
      className={cn('image-downscale-quality', className)}
      src={proxiedSrc}
      srcSet={activeSrcSet}
      sizes={activeSizes}
      alt={alt}
      onError={handleError}
    />
  );
};

export default ProxyImage;
