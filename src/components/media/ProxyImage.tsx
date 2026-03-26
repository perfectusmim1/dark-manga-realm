import React from 'react';
import { buildImageProxyUrl, type ImageProxyTransformOptions } from '@/lib/imageProxy';

interface ProxyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  src: string;
  alt: string;
  transform?: ImageProxyTransformOptions;
}

const getTransformKey = (transform?: ImageProxyTransformOptions) =>
  transform
    ? `${transform.width || ''}:${transform.quality || ''}:${transform.format || ''}:${transform.fit || ''}`
    : '';

const ProxyImage: React.FC<ProxyImageProps> = ({
  src,
  alt,
  transform,
  onError,
  fetchPriority: _fetchPriority,
  ...rest
}) => {
  const transformKey = React.useMemo(() => getTransformKey(transform), [transform]);
  const [shouldBypassProxy, setShouldBypassProxy] = React.useState(false);

  React.useEffect(() => {
    setShouldBypassProxy(false);
  }, [src, transformKey]);

  const proxiedSrc = React.useMemo(() => {
    if (shouldBypassProxy) {
      return src;
    }

    return buildImageProxyUrl(src, transform) || src;
  }, [shouldBypassProxy, src, transform]);

  const handleError = React.useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      if (!shouldBypassProxy && proxiedSrc !== src) {
        setShouldBypassProxy(true);
        return;
      }

      onError?.(event);
    },
    [onError, proxiedSrc, shouldBypassProxy, src],
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
