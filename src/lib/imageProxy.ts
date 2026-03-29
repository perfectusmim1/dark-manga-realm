export type ImageProxyFormat = 'webp' | 'avif' | 'jpeg' | 'png';
export type ImageProxyFit = 'scale-down' | 'contain' | 'cover';

export interface ImageProxyTransformOptions {
  width?: number;
  quality?: number;
  format?: ImageProxyFormat;
  fit?: ImageProxyFit;
}

const normalizeSourceUrl = (sourceUrl?: string | null) => {
  const normalized = sourceUrl?.trim();
  if (!normalized) {
    return null;
  }

  return normalized;
};

export const supportsImageProxyTransform = () => false;

export const buildImageProxyUrl = (
  sourceUrl: string,
  transform: ImageProxyTransformOptions = {},
) => {
  void sourceUrl;
  void transform;
  return null;
};

export const resolveDisplayImageUrl = (
  sourceUrl?: string | null,
  transform: ImageProxyTransformOptions = {},
) => {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    return undefined;
  }

  return buildImageProxyUrl(normalizedSourceUrl, transform) || normalizedSourceUrl;
};
