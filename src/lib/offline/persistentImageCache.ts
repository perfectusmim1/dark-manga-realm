import { buildProxiedImageUrl, isStoredMediaUrl } from '@/lib/mediaStorage';
import { compressOfflineImage } from '@/lib/offline/imageCompression';
import { getOfflineImageProxyUrl, offlineProxyConfig } from '@/lib/offline/proxyConfig';
import { inferRefererForImageUrl } from '@/lib/offline/downloadManager';
const DATA_URL_IMAGE_PREFIX = 'data:image';
const IMAGE_FAILURE_CACHE_KEY = 'toonparrot_offline_image_failures_v1';
const IMAGE_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;

export const isPersistentImageDataUrl = (value?: string | null): value is string =>
  typeof value === 'string' && value.startsWith(DATA_URL_IMAGE_PREFIX);

class PersistentImageRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'PersistentImageRequestError';
    this.status = status;
  }
}

const getFailureCacheKey = (sourceUrl: string) => `url:${sourceUrl.trim()}`;

const readFailureCache = () => {
  if (typeof window === 'undefined') {
    return {} as Record<string, number>;
  }

  try {
    const rawValue = window.localStorage.getItem(IMAGE_FAILURE_CACHE_KEY);
    if (!rawValue) {
      return {} as Record<string, number>;
    }

    const parsedValue = JSON.parse(rawValue) as Record<string, unknown>;
    const now = Date.now();
    const nextValue = Object.fromEntries(
      Object.entries(parsedValue).filter(([, retryAt]) => (
        typeof retryAt === 'number'
        && Number.isFinite(retryAt)
        && retryAt > now
      )),
    ) as Record<string, number>;

    if (Object.keys(nextValue).length !== Object.keys(parsedValue).length) {
      window.localStorage.setItem(IMAGE_FAILURE_CACHE_KEY, JSON.stringify(nextValue));
    }

    return nextValue;
  } catch {
    return {} as Record<string, number>;
  }
};

const writeFailureCache = (nextValue: Record<string, number>) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (Object.keys(nextValue).length === 0) {
      window.localStorage.removeItem(IMAGE_FAILURE_CACHE_KEY);
      return;
    }

    window.localStorage.setItem(IMAGE_FAILURE_CACHE_KEY, JSON.stringify(nextValue));
  } catch {
    // Ignore storage failures. This cache only reduces noisy retries.
  }
};

const rememberImageFailure = (sourceUrl: string, cooldownMs: number) => {
  const key = getFailureCacheKey(sourceUrl);
  const failures = readFailureCache();
  failures[key] = Date.now() + cooldownMs;
  writeFailureCache(failures);
};

const clearImageFailure = (sourceUrl: string) => {
  const key = getFailureCacheKey(sourceUrl);
  const failures = readFailureCache();

  if (!(key in failures)) {
    return;
  }

  delete failures[key];
  writeFailureCache(failures);
};

const shouldUsePersistentRemoteFetch = () => typeof window !== 'undefined';

export const shouldAttemptPersistentImageCache = (sourceUrl?: string | null) => {
  const normalizedSourceUrl = sourceUrl?.trim();
  if (!normalizedSourceUrl || isStoredMediaUrl(normalizedSourceUrl)) {
    return false;
  }

  const retryAt = readFailureCache()[getFailureCacheKey(normalizedSourceUrl)];
  return typeof retryAt !== 'number' || retryAt <= Date.now();
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Image data URL conversion failed'));
    };

    reader.onerror = () => {
      reject(reader.error || new Error('Image data URL conversion failed'));
    };

    reader.readAsDataURL(blob);
  });

const fetchImageViaProxy = async (sourceUrl: string): Promise<Blob> => {
  const proxyUrl = getOfflineImageProxyUrl();
  const referer = inferRefererForImageUrl(sourceUrl);

  if (proxyUrl) {
    // 1. POST via Proxy
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (offlineProxyConfig.usesSupabaseAuth) {
        headers.apikey = offlineProxyConfig.supabaseAnonKey;
        headers.Authorization = `Bearer ${offlineProxyConfig.supabaseAnonKey}`;
      }

      const postResponse = await fetch(proxyUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: sourceUrl, referer }),
      });

      if (postResponse.ok) {
        return await postResponse.blob();
      }
    } catch {
      // Ignore and fallback to GET proxy
    }

    // 2. GET Proxy fallback
    try {
      const getUrl = buildProxiedImageUrl(sourceUrl, referer);
      if (getUrl && getUrl !== sourceUrl) {
        const getResponse = await fetch(getUrl);
        if (getResponse.ok) {
          return await getResponse.blob();
        }
      }
    } catch {
      // Ignore
    }
  }

  throw new PersistentImageRequestError('Proxy fetch failed');
};

const fetchImageWithFallback = async (sourceUrl: string): Promise<Blob> => {
  const isCrossOrigin =
    typeof window !== 'undefined' &&
    sourceUrl.startsWith('http') &&
    !sourceUrl.startsWith(window.location.origin);

  // 1. For cross-origin URLs, try Cloudflare Offline Image Proxy first to avoid noisy browser CORS errors
  if (isCrossOrigin && getOfflineImageProxyUrl()) {
    try {
      return await fetchImageViaProxy(sourceUrl);
    } catch {
      // Fallback to direct fetch if proxy fails
    }
  }

  // 2. Direct fetch
  try {
    const response = await fetch(sourceUrl, {
      mode: 'cors',
      credentials: 'omit',
    });

    if (response.ok) {
      return await response.blob();
    }
  } catch {
    // Direct fetch failed (likely CORS or network), fallback to proxy
  }

  // 3. Fallback to Cloudflare Offline Image Proxy
  return await fetchImageViaProxy(sourceUrl);
};

export const cachePersistentImageDataUrl = async (sourceUrl?: string | null) => {
  if (typeof window === 'undefined' || !sourceUrl?.trim()) {
    return undefined;
  }

  if (!shouldUsePersistentRemoteFetch()) {
    return undefined;
  }

  const normalizedSourceUrl = sourceUrl.trim();
  if (isPersistentImageDataUrl(normalizedSourceUrl)) {
    return normalizedSourceUrl;
  }

  if (!shouldAttemptPersistentImageCache(normalizedSourceUrl)) {
    return undefined;
  }

  let imageBlob: Blob;

  try {
    imageBlob = await fetchImageWithFallback(normalizedSourceUrl);
    clearImageFailure(normalizedSourceUrl);
  } catch (error) {
    rememberImageFailure(normalizedSourceUrl, IMAGE_FAILURE_COOLDOWN_MS);
    return undefined;
  }

  const normalizedBlob = imageBlob.type
    ? imageBlob
    : imageBlob.slice(0, imageBlob.size, 'image/jpeg');
  const { blob: optimizedBlob } = await compressOfflineImage(
    normalizedBlob,
    normalizedBlob.type || 'image/jpeg',
  );

  return blobToDataUrl(optimizedBlob);
};
