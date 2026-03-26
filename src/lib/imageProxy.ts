export type ImageProxyFormat = 'webp' | 'avif' | 'jpeg' | 'png';
export type ImageProxyFit = 'scale-down' | 'contain' | 'cover';

export interface ImageProxyTransformOptions {
  width?: number;
  quality?: number;
  format?: ImageProxyFormat;
  fit?: ImageProxyFit;
}

const clampInteger = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

export const supportsImageProxyTransform = () => false;

export const buildImageProxyUrl = (
  sourceUrl: string,
  transform: ImageProxyTransformOptions = {},
) => {
  if (!supportsImageProxyTransform()) {
    return null;
  }

  try {
    const normalizedSourceUrl = new URL(sourceUrl);
    if (!['http:', 'https:'].includes(normalizedSourceUrl.protocol)) {
      return null;
    }
  } catch {
    return null;
  }

  void transform;
  void clampInteger;
  return null;
};
