import { offlineProxyConfig } from '@/lib/offline/proxyConfig';

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

const PROXY_SUPPORTED_HOSTS = [
  'cdn.anime-planet.com',
  'anime-planet.com',
  'www.anime-planet.com',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
] as const;

const shouldProxyImageUrl = (sourceUrl?: string | null) => {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  if (!normalizedSourceUrl || !offlineProxyConfig.url) {
    return false;
  }

  try {
    const parsedUrl = new URL(normalizedSourceUrl);
    return PROXY_SUPPORTED_HOSTS.some((host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
};

export const supportsImageProxyTransform = () => Boolean(offlineProxyConfig.url);

export const buildImageProxyUrl = (
  sourceUrl: string,
  transform: ImageProxyTransformOptions = {},
) => {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  if (!normalizedSourceUrl || !shouldProxyImageUrl(normalizedSourceUrl)) {
    return null;
  }

  try {
    const proxyUrl = new URL(offlineProxyConfig.url);
    proxyUrl.searchParams.set('url', normalizedSourceUrl);

    if (transform.width) {
      proxyUrl.searchParams.set('width', `${transform.width}`);
    }

    if (transform.quality) {
      proxyUrl.searchParams.set('quality', `${transform.quality}`);
    }

    if (transform.format) {
      proxyUrl.searchParams.set('format', transform.format);
    }

    if (transform.fit) {
      proxyUrl.searchParams.set('fit', transform.fit);
    }

    return proxyUrl.toString();
  } catch {
    return null;
  }
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
