import { offlineProxyConfig } from '@/lib/offline/proxyConfig';
import {
  buildProxiedImageUrl,
  isStoredMediaUrl,
  unwrapManagedMediaUrl,
} from '@/lib/mediaStorage';
import { isManagedArtworkUrl } from '@/lib/managedArtwork';

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
  'hattorimanga.net',
  'www.hattorimanga.net',
  'dxdfansub.com',
  'api.dxdfansub.com',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
  'hayalistic.com',
  'hayalistic.com.tr',
  'wikia.nocookie.net',
  'static.wikia.nocookie.net',
  'webtoon-oku.net',
  'cdn-1.webtoon-oku.net',
  'cdn-2.webtoon-oku.net',
  'kkplayer.wtf',
  'wowpic.org',
  'homeandheartshop.site',
  'brightglow12.site',
  's4.anilist.co',
  'anilist.co',
  'cdn.myanimelist.net',
  'myanimelist.net',
  'media.kitsu.io',
  'kitsu.io',
] as const;

const PROXY_SUPPORTED_HOSTS = [
  ...PROXY_ONLY_HOSTS,
  'webtoon-oku.net',
  'cdn-1.webtoon-oku.net',
  'cdn-2.webtoon-oku.net',
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

  return PROXY_ONLY_HOSTS.some((host) => matchesHostRule(parsedSourceUrl.hostname, host));
};

export const supportsImageProxyTransform = () => Boolean(offlineProxyConfig.url);

const RESIZE_WIDTH_BUCKETS = [72, 80, 96, 144, 192, 240, 320, 360, 420, 480, 640] as const;

const HOTLINK_OR_CUSTOM_REFERER_HOSTS = [
  'webtoonhatti.club',
  'webtoonhatti.com',
  'webtoonhatti.net',
  'uploads.mangadex.org',
  'mangadex.org',
  'anime-planet.com',
  'anisearch.com',
  'mangaupdates.com',
  'hattorimanga.net',
  'hayalistic.com',
  'hayalistic.com.tr',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
  'wikia.nocookie.net',
  'webtoon-oku.net',
  'cdn-1.webtoon-oku.net',
  'cdn-2.webtoon-oku.net',
  'kkplayer.wtf',
  'wowpic.org',
  'homeandheartshop.site',
  'brightglow12.site',
  'fastcontent12.site',
  'readlightnovel.site',
  'mangacix.net',
] as const;

const PHOTON_PREFERRED_HOSTS = [
  'cdn.hentaiturk.com',
  'cdn.okutoon.com',
  'om-cdn.okutoon.com',
  'madaradex.org',
] as const;

const SKIP_RESIZE_CDN_HOSTS = [
  'wsrv.nl',
  'images.weserv.nl',
  'i0.wp.com',
  'i1.wp.com',
  'i2.wp.com',
  'i3.wp.com',
  'api.dicebear.com',
  'lh3.googleusercontent.com',
] as const;

const quantizeResizeWidth = (width?: number): number | null => {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > 640) {
    return null;
  }

  for (const bucket of RESIZE_WIDTH_BUCKETS) {
    if (width <= bucket) {
      return bucket;
    }
  }

  return 640;
};

const isHotlinkOrCustomRefererHost = (hostname: string) => {
  const lower = hostname.toLowerCase();
  if (lower.includes('siyahmelek') || lower.includes('webtoonhatti') || lower.includes('readlightnovel')) {
    return true;
  }

  return HOTLINK_OR_CUSTOM_REFERER_HOSTS.some((host) => matchesHostRule(lower, host));
};

const shouldSkipResizeTransform = (parsed: URL, fullUrl: string) => {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const lowerHost = parsed.hostname.toLowerCase();
  if (
    lowerHost === 'localhost'
    || lowerHost === '127.0.0.1'
    || lowerHost.endsWith('.local')
    || SKIP_RESIZE_CDN_HOSTS.some((host) => matchesHostRule(lowerHost, host))
  ) {
    return true;
  }

  if (lowerHost.includes('tenor.com') || lowerHost.includes('giphy.com')) {
    return true;
  }

  if (/\.(?:gif|svg|ico)(?:$|\?)/i.test(parsed.pathname)) {
    return true;
  }

  if (isManagedArtworkUrl(fullUrl)) {
    return true;
  }

  return false;
};

const buildResizedDisplayImageUrl = (
  sourceUrl: string,
  transform: ImageProxyTransformOptions,
): string | null => {
  const targetWidth = quantizeResizeWidth(transform.width);
  if (!targetWidth) {
    return null;
  }

  const unwrappedUrl = unwrapManagedMediaUrl(sourceUrl) || sourceUrl;
  const parsed = getParsedSourceUrl(unwrappedUrl);
  if (!parsed || shouldSkipResizeTransform(parsed, unwrappedUrl)) {
    return null;
  }

  const quality = Math.min(92, Math.max(60, Math.round(transform.quality || 84)));
  const wsrvFormat = transform.format === 'jpeg'
    ? 'jpg'
    : (transform.format === 'avif' || transform.format === 'png' || transform.format === 'webp' ? transform.format : 'webp');
  const lowerHost = parsed.hostname.toLowerCase();

  if (matchesHostRule(lowerHost, 's4.anilist.co')) {
    if (targetWidth <= 120 && !parsed.search) {
      return `https://i0.wp.com/s4.anilist.co${parsed.pathname}?w=${targetWidth}&quality=${quality}&strip=all`;
    }

    if (
      targetWidth <= 240
      && /^\/file\/anilistcdn\/media\/(?:manga|anime)\/cover\/large\//i.test(parsed.pathname)
    ) {
      return `https://s4.anilist.co${parsed.pathname.replace(/\/large\//i, '/medium/')}${parsed.search}`;
    }

    if (targetWidth <= 240 && !parsed.search) {
      return `https://i0.wp.com/s4.anilist.co${parsed.pathname}?w=${targetWidth}&quality=${quality}&strip=all`;
    }

    return null;
  }

  if (isHotlinkOrCustomRefererHost(lowerHost)) {
    if (targetWidth <= 240) {
      const workerProxyUrl = buildProxiedImageUrl(unwrappedUrl);
      if (workerProxyUrl && workerProxyUrl !== unwrappedUrl) {
        return `https://wsrv.nl/?url=${encodeURIComponent(workerProxyUrl)}&w=${targetWidth}&q=${quality}&output=${wsrvFormat}&we`;
      }
    }

    return null;
  }

  if (PHOTON_PREFERRED_HOSTS.some((host) => matchesHostRule(lowerHost, host))) {
    if (targetWidth <= 480 && !parsed.search) {
      return `https://i0.wp.com/${parsed.hostname}${parsed.pathname}?w=${targetWidth}&quality=${quality}&strip=all`;
    }

    return null;
  }

  if (targetWidth <= 480) {
    return `https://wsrv.nl/?url=${encodeURIComponent(unwrappedUrl)}&w=${targetWidth}&q=${quality}&output=${wsrvFormat}&we`;
  }

  return null;
};

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
  if (!normalizedSourceUrl) {
    return null;
  }

  // Zaten data/blob veya göreli yerel yol ise doğrudan döndür
  if (
    normalizedSourceUrl.startsWith('data:') ||
    normalizedSourceUrl.startsWith('blob:') ||
    normalizedSourceUrl.startsWith('/')
  ) {
    return normalizedSourceUrl;
  }

  const resizedDisplayUrl = buildResizedDisplayImageUrl(normalizedSourceUrl, transform);
  if (resizedDisplayUrl) {
    return resizedDisplayUrl;
  }

  if (!shouldProxyImageUrl(normalizedSourceUrl)) {
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
