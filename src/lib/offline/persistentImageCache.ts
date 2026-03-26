import { compressOfflineImage } from '@/lib/offline/imageCompression';
import { offlineProxyConfig } from '@/lib/offline/proxyConfig';

const DATA_URL_IMAGE_PREFIX = 'data:image';

export const isPersistentImageDataUrl = (value?: string | null): value is string =>
  typeof value === 'string' && value.startsWith(DATA_URL_IMAGE_PREFIX);

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

const fetchImageViaProxy = async (sourceUrl: string) => {
  if (offlineProxyConfig.usesSupabaseAuth) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: offlineProxyConfig.supabaseAnonKey,
      Authorization: `Bearer ${offlineProxyConfig.supabaseAnonKey}`,
    };

    const response = await fetch(offlineProxyConfig.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: sourceUrl }),
    });

    if (!response.ok) {
      throw new Error(`Image proxy request failed (${response.status})`);
    }

    return response.blob();
  }

  const headers: Record<string, string> = {};
  if (offlineProxyConfig.token) {
    headers.Authorization = `Bearer ${offlineProxyConfig.token}`;
  }

  const response = await fetch(offlineProxyConfig.url, {
    method: 'POST',
    headers,
    body: sourceUrl,
  });

  if (!response.ok) {
    throw new Error(`Image proxy request failed (${response.status})`);
  }

  return response.blob();
};

const fetchImageDirectly = async (sourceUrl: string) => {
  const response = await fetch(sourceUrl, {
    mode: 'cors',
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new Error(`Image request failed (${response.status})`);
  }

  return response.blob();
};

export const cachePersistentImageDataUrl = async (sourceUrl?: string | null) => {
  if (typeof window === 'undefined' || !sourceUrl?.trim()) {
    return undefined;
  }

  const normalizedSourceUrl = sourceUrl.trim();
  if (isPersistentImageDataUrl(normalizedSourceUrl)) {
    return normalizedSourceUrl;
  }

  let imageBlob: Blob;

  try {
    imageBlob = await fetchImageViaProxy(normalizedSourceUrl);
  } catch {
    try {
      imageBlob = await fetchImageDirectly(normalizedSourceUrl);
    } catch {
      return undefined;
    }
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
