import React from 'react';
import {
  buildImageProxyUrl,
  shouldAvoidRawImageFallback,
  type ImageProxyTransformOptions,
} from '@/lib/imageProxy';
import { buildProxiedImageUrl } from '@/lib/mediaStorage';

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
  transform,
  allowProxy = false,
  onError,
  fetchPriority: _fetchPriority,
  ...rest
}) => {
  const transformKey = React.useMemo(() => getTransformKey(transform), [transform]);
  const [shouldBypassProxy, setShouldBypassProxy] = React.useState(false);
  const [useProxyFallback, setUseProxyFallback] = React.useState(false);
  const avoidRawFallback = React.useMemo(() => shouldAvoidRawImageFallback(src), [src]);
  const effectiveAllowProxy = allowProxy || avoidRawFallback;
  const isExternalUrl = typeof src === 'string' && (src.startsWith('http://') || src.startsWith('https://'));

  React.useEffect(() => {
    setShouldBypassProxy(false);
    setUseProxyFallback(false);
  }, [src, transformKey]);

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

      onError?.(event);
    },
    [avoidRawFallback, effectiveAllowProxy, isExternalUrl, onError, proxiedSrc, shouldBypassProxy, src, useProxyFallback],
  );

  return (
    <img
      referrerPolicy="no-referrer"
      {...rest}
      src={proxiedSrc}
      alt={alt}
      onError={handleError}
    />
  );
};

export default ProxyImage;
