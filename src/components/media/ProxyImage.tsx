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

type ImageFallbackStage = 'primary' | 'raw' | 'worker_proxy' | 'failed';

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
  const [fallbackStage, setFallbackStage] = React.useState<ImageFallbackStage>('primary');
  const avoidRawFallback = React.useMemo(() => shouldAvoidRawImageFallback(src), [src]);
  const hasTransform = Boolean(transform && (transform.width || transform.quality));
  const effectiveAllowProxy = allowProxy || avoidRawFallback || hasTransform;
  const isExternalUrl = typeof src === 'string' && (src.startsWith('http://') || src.startsWith('https://'));

  React.useEffect(() => {
    setFallbackStage('primary');
  }, [src, transformKey, srcSet]);

  const primarySrc = React.useMemo(() => {
    if (!effectiveAllowProxy) {
      return src;
    }

    return buildImageProxyUrl(src, transform, {
      purpose: 'preview',
      surface: 'admin_preview',
    }) || (avoidRawFallback ? buildProxiedImageUrl(src) : '') || src;
  }, [avoidRawFallback, effectiveAllowProxy, src, transform, transformKey]);

  const proxiedSrc = React.useMemo(() => {
    if (fallbackStage === 'worker_proxy' && isExternalUrl) {
      return buildProxiedImageUrl(src) || src;
    }

    if (fallbackStage === 'raw') {
      return src;
    }

    return primarySrc;
  }, [fallbackStage, isExternalUrl, primarySrc, src]);

  const handleError = React.useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      if (fallbackStage === 'primary') {
        if (!avoidRawFallback && primarySrc !== src) {
          setFallbackStage('raw');
          return;
        }

        if (isExternalUrl) {
          const fallbackUrl = buildProxiedImageUrl(src);
          if (fallbackUrl && fallbackUrl !== primarySrc) {
            setFallbackStage('worker_proxy');
            return;
          }
        }
      } else if (fallbackStage === 'raw' && isExternalUrl) {
        const fallbackUrl = buildProxiedImageUrl(src);
        if (fallbackUrl && fallbackUrl !== primarySrc && fallbackUrl !== src) {
          setFallbackStage('worker_proxy');
          return;
        }
      }

      setFallbackStage('failed');
      onError?.(event);
    },
    [avoidRawFallback, fallbackStage, isExternalUrl, onError, primarySrc, src],
  );

  if (!proxiedSrc || fallbackStage === 'failed') {
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

  const activeSrcSet = fallbackStage !== 'primary' ? undefined : srcSet;
  const activeSizes = fallbackStage !== 'primary' ? undefined : sizes;

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
