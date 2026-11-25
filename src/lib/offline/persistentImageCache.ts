import { isStoredMediaUrl } from '@/lib/mediaStorage';
import { compressOfflineImage } from '@/lib/offline/imageCompression';
import {
  getCandidateOfflineProxyUrls,
  isOfflineProxyPostUnsupported,
  isSupabaseFunctionsProxyUrl,
  markOfflineProxyPostUnsupported,
  markOfflineProxyRejectedForHost,
  offlineProxyConfig,
  shouldPreferCorsRelayForUrl,
} from '@/lib/offline/proxyConfig';
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

const fetchImageViaCorsRelay = async (sourceUrl: string): Promise<Blob> => {
  const candidates: string[] = [
    `https://wsrv.nl/?url=${encodeURIComponent(sourceUrl)}&output=webp`,
  ];

  try {
    const parsed = new URL(sourceUrl);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.search) {
      candidates.push(`https://i0.wp.com/${parsed.hostname}${parsed.pathname}`);
    }
  } catch {
    // ignore
  }

  for (const relayUrl of candidates) {
    try {
      const response = await fetch(relayUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
      });
      if (response.ok) {
        return await response.blob();
      }
    } catch {
      // try next relay
    }
  }

  throw new PersistentImageRequestError('CORS relay fetch failed');
};

const fetchImageViaProxy = async (sourceUrl: string): Promise<Blob> => {
  const referer = inferRefererForImageUrl(sourceUrl);
  const candidateProxies = getCandidateOfflineProxyUrls(sourceUrl);

  for (const proxyBaseUrl of candidateProxies) {
    // 1. GET Proxy (Cloudflare CDN Edge Cache enabled, avoids 405 on GET-only workers)
    try {
      const getUrl = new URL(proxyBaseUrl);
      getUrl.searchParams.set('url', sourceUrl);
      if (referer) {
        getUrl.searchParams.set('referer', referer);
      }

      const headers: Record<string, string> = {};
      if (isSupabaseFunctionsProxyUrl(proxyBaseUrl)) {
        headers.apikey = offlineProxyConfig.supabaseAnonKey;
        headers.Authorization = `Bearer ${offlineProxyConfig.supabaseAnonKey}`;
      }

      const getResponse = await fetch(getUrl.toString(), { method: 'GET', headers });
      if (getResponse.ok) {
        return await getResponse.blob();
      }

      if (getResponse.status === 401 || getResponse.status === 403) {
        markOfflineProxyRejectedForHost(proxyBaseUrl, sourceUrl);
        continue;
      }
    } catch {
      // Fall through to POST fallback if supported
    }

    // 2. POST Proxy fallback only if worker supports POST and did not reject the host
    if (!isOfflineProxyPostUnsupported(proxyBaseUrl)) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (isSupabaseFunctionsProxyUrl(proxyBaseUrl)) {
          headers.apikey = offlineProxyConfig.supabaseAnonKey;
          headers.Authorization = `Bearer ${offlineProxyConfig.supabaseAnonKey}`;
        }

        const postResponse = await fetch(proxyBaseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: sourceUrl, referer }),
        });

        if (postResponse.ok) {
          return await postResponse.blob();
        }

        if (postResponse.status === 405) {
          markOfflineProxyPostUnsupported(proxyBaseUrl);
        } else if (postResponse.status === 401 || postResponse.status === 403) {
          markOfflineProxyRejectedForHost(proxyBaseUrl, sourceUrl);
        }
      } catch {
        // Try next proxy candidate
      }
    }
  }

  throw new PersistentImageRequestError('Proxy fetch failed');
};

const fetchImageWithFallback = async (sourceUrl: string): Promise<Blob> => {
  const isCrossOrigin =
    typeof window !== 'undefined' &&
    sourceUrl.startsWith('http') &&
    !sourceUrl.startsWith(window.location.origin);

  const canUseCorsRelay = isCrossOrigin && !isStoredMediaUrl(sourceUrl);
  const preferCorsRelay = canUseCorsRelay && shouldPreferCorsRelayForUrl(sourceUrl);

  // 0. Prefer CORS relay first for public CDNs without ACAO that mirror workers may not allowlist yet
  if (preferCorsRelay) {
    try {
      return await fetchImageViaCorsRelay(sourceUrl);
    } catch {
      // Fall through to worker proxy
    }
  }

  // 1. For cross-origin URLs, try Cloudflare Offline Image Proxy pool first
  if (isCrossOrigin) {
    try {
      return await fetchImageViaProxy(sourceUrl);
    } catch {
      // Fall through to CORS relay / direct fetch
    }
  }

  // 2. CORS relay fallback before raw cross-origin fetch (prevents browser CORS & SW opaque errors)
  if (canUseCorsRelay && !preferCorsRelay) {
    try {
      return await fetchImageViaCorsRelay(sourceUrl);
    } catch {
      // Fall through to direct fetch
    }
  }

  // 3. Direct fetch (same-origin, R2, or final fallback)
  const response = await fetch(sourceUrl, {
    mode: 'cors',
    credentials: 'omit',
  });

  if (response.ok) {
    return await response.blob();
  }

  throw new PersistentImageRequestError(`Direct fetch failed (${response.status})`, response.status);
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
