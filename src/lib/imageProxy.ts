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

const SUPABASE_PROXY_OVERRIDE_HOSTS = [
  'cdn.anime-planet.com',
  'anime-planet.com',
  'www.anime-planet.com',
] as const;

const PROXY_ONLY_HOSTS = [
  'cdn.anime-planet.com',
  'anime-planet.com',
  'www.anime-planet.com',
] as const;

const matchesHostRule = (hostname: string, rule: string) => (
  hostname === rule || hostname.endsWith(`.${rule}`)
);

const getParsedSourceUrl = (sourceUrl?: string | null) => {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    return null;
  }

  try {
    return new URL(normalizedSourceUrl);
  } catch {
    return null;
  }
};

const getProxyBaseUrl = (sourceUrl?: string | null) => {
  const parsedSourceUrl = getParsedSourceUrl(sourceUrl);
  if (!parsedSourceUrl) {
    return null;
  }

  if (
    offlineProxyConfig.defaultUrl
    && SUPABASE_PROXY_OVERRIDE_HOSTS.some((host) => matchesHostRule(parsedSourceUrl.hostname, host))
  ) {
    return offlineProxyConfig.defaultUrl;
  }

  return offlineProxyConfig.url || null;
};

const shouldProxyImageUrl = (sourceUrl?: string | null) => {
  const parsedSourceUrl = getParsedSourceUrl(sourceUrl);
  if (!parsedSourceUrl || !getProxyBaseUrl(sourceUrl)) {
    return false;
  }

  return PROXY_SUPPORTED_HOSTS.some((host) => matchesHostRule(parsedSourceUrl.hostname, host));
};

export const supportsImageProxyTransform = () => Boolean(offlineProxyConfig.url);

export const shouldAvoidRawImageFallback = (sourceUrl?: string | null) => {
  const parsedSourceUrl = getParsedSourceUrl(sourceUrl);
  if (!parsedSourceUrl) {
    return false;
  }

  return PROXY_ONLY_HOSTS.some((host) => matchesHostRule(parsedSourceUrl.hostname, host));
};

export const buildImageProxyUrl = (
  sourceUrl: string,
  transform: ImageProxyTransformOptions = {},
) => {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  if (!normalizedSourceUrl || !shouldProxyImageUrl(normalizedSourceUrl)) {
    return null;
  }

  try {
    const proxyBaseUrl = getProxyBaseUrl(normalizedSourceUrl);
    if (!proxyBaseUrl) {
      return null;
    }

    const proxyUrl = new URL(proxyBaseUrl);
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
