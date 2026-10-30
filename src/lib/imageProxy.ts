import { offlineProxyConfig } from '@/lib/offline/proxyConfig';
import { isStoredMediaUrl } from '@/lib/mediaStorage';

export type ImageProxyFormat = 'webp' | 'avif' | 'jpeg' | 'png';
export type ImageProxyFit = 'scale-down' | 'contain' | 'cover';

export interface ImageProxyTransformOptions {
  width?: number;
  quality?: number;
  format?: ImageProxyFormat;
  fit?: ImageProxyFit;
}

export interface ImageProxyRequestMetadata {
  purpose?: string;
  entityType?: string;
  surface?: string;
}

const normalizeSourceUrl = (sourceUrl?: string | null) => {
  const normalized = sourceUrl?.trim();
  if (!normalized) {
    return null;
  }

  return normalized;
};

const PROXY_ONLY_HOSTS = [
  'webtoonhatti.club',
  'webtoonhatti.com',
  'webtoonhatti.net',
  'uploads.mangadex.org',
  'mangadex.org',
  'cdn.anime-planet.com',
  'anime-planet.com',
  'www.anime-planet.com',
  'anisearch.com',
  'www.anisearch.com',
  'cdn.anisearch.com',
  'mangaupdates.com',
  'www.mangaupdates.com',
  'cdn.mangaupdates.com',
  'siyahmelek.my',
  'www.siyahmelek.my',
  'siyahmelek.mom',
  'hattorimanga.net',
  'www.hattorimanga.net',
  'okutoon.com',
  'om-cdn.okutoon.com',
  'golgebahcesi.com',
  'api.golgebahcesi.com',
  'skycdn.online',
  'c2.skycdn.online',
  'dxdfansub.com',
  'api.dxdfansub.com',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
  'hayalistic.com',
  'hayalistic.com.tr',
  's4.anilist.co',
  'anilist.co',
  'myanimelist.net',
  'cdn.myanimelist.net',
  'wikia.nocookie.net',
  'static.wikia.nocookie.net',
] as const;

const PROXY_SUPPORTED_HOSTS = [
  ...PROXY_ONLY_HOSTS,
  'webtoon-oku.net',
  'cdn-1.webtoon-oku.net',
  'cdn-2.webtoon-oku.net',
  'hentaiturk.com',
  'www.hentaiturk.com',
  'cdn.hentaiturk.com',
  'mangacix.net',
  'cdn.mangacix.net',
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

  return offlineProxyConfig.url || null;
};

const shouldProxyImageUrl = (sourceUrl?: string | null) => {
  const parsedSourceUrl = getParsedSourceUrl(sourceUrl);
  if (!parsedSourceUrl || isStoredMediaUrl(sourceUrl) || !getProxyBaseUrl(sourceUrl)) {
    return false;
  }

  return PROXY_SUPPORTED_HOSTS.some((host) => matchesHostRule(parsedSourceUrl.hostname, host));
};

export const supportsImageProxyTransform = () => Boolean(offlineProxyConfig.url);

export const shouldAvoidRawImageFallback = (sourceUrl?: string | null) => {
  const parsedSourceUrl = getParsedSourceUrl(sourceUrl);
  if (!parsedSourceUrl || isStoredMediaUrl(sourceUrl)) {
    return false;
  }

  return PROXY_ONLY_HOSTS.some((host) => matchesHostRule(parsedSourceUrl.hostname, host));
};

export const buildImageProxyUrl = (
  sourceUrl: string,
  transform: ImageProxyTransformOptions = {},
  metadata: ImageProxyRequestMetadata = {},
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

    if (metadata.purpose) {
      proxyUrl.searchParams.set('purpose', metadata.purpose);
    }

    if (metadata.entityType) {
      proxyUrl.searchParams.set('entityType', metadata.entityType);
    }

    if (metadata.surface) {
      proxyUrl.searchParams.set('surface', metadata.surface);
    }

    return proxyUrl.toString();
  } catch {
    return null;
  }
};

export const resolveDisplayImageUrl = (
  sourceUrl?: string | null,
  transform: ImageProxyTransformOptions = {},
  metadata: ImageProxyRequestMetadata = {},
) => {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    return undefined;
  }

  return buildImageProxyUrl(normalizedSourceUrl, transform, metadata) || normalizedSourceUrl;
};
