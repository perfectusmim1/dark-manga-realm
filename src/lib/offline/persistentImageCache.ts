import { compressOfflineImage } from '@/lib/offline/imageCompression';
const DATA_URL_IMAGE_PREFIX = 'data:image';
const IMAGE_FAILURE_CACHE_KEY = 'toonparrot_offline_image_failures_v1';
const IMAGE_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

const getFailureCacheKey = (sourceUrl: string) => {
  try {
    return `host:${new URL(sourceUrl).hostname.toLowerCase()}`;
  } catch {
    return `url:${sourceUrl}`;
  }
};

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

const shouldUsePersistentRemoteFetch = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const { hostname, protocol } = window.location;
  return !(
    protocol === 'file:'
    || hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
  );
};

export const shouldAttemptPersistentImageCache = (sourceUrl?: string | null) => {
  if (!sourceUrl?.trim()) {
    return false;
  }

  const retryAt = readFailureCache()[getFailureCacheKey(sourceUrl.trim())];
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

const fetchImageDirectly = async (sourceUrl: string) => {
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      mode: 'cors',
      credentials: 'omit',
    });
  } catch {
    throw new PersistentImageRequestError('Image request failed before a response was received');
  }

  if (!response.ok) {
    throw new PersistentImageRequestError(
      `Image request failed (${response.status})`,
      response.status,
    );
  }

  return response.blob();
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
    imageBlob = await fetchImageDirectly(normalizedSourceUrl);
    clearImageFailure(normalizedSourceUrl);
  } catch (directError) {
    const directStatus = directError instanceof PersistentImageRequestError ? directError.status : undefined;
    rememberImageFailure(normalizedSourceUrl, IMAGE_FAILURE_COOLDOWN_MS);
    if (directStatus) {
      void directStatus;
    }
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
