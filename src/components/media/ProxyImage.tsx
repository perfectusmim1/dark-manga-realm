import React from 'react';
import {
  buildImageProxyUrl,
  shouldAvoidRawImageFallback,
  type ImageProxyTransformOptions,
} from '@/lib/imageProxy';

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
  const avoidRawFallback = React.useMemo(() => shouldAvoidRawImageFallback(src), [src]);

  React.useEffect(() => {
    setShouldBypassProxy(false);
  }, [src, transformKey]);

  const proxiedSrc = React.useMemo(() => {
    if (!allowProxy || shouldBypassProxy) {
      return src;
    }

    return buildImageProxyUrl(src, transform, {
      purpose: 'preview',
      surface: 'admin_preview',
    }) || src;
  }, [allowProxy, shouldBypassProxy, src, transform]);

  const handleError = React.useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      if (allowProxy && !avoidRawFallback && !shouldBypassProxy && proxiedSrc !== src) {
        setShouldBypassProxy(true);
        return;
      }

      onError?.(event);
    },
    [allowProxy, avoidRawFallback, onError, proxiedSrc, shouldBypassProxy, src],
  );

  return (
    <img
      {...rest}
      src={proxiedSrc}
      alt={alt}
      onError={handleError}
    />
  );
};

export default ProxyImage;
