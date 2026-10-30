import { shouldAvoidRawImageFallback } from '@/lib/imageProxy';
import { buildProxiedImageUrl } from '@/lib/mediaStorage';

const warmedImageUrls = new Set<string>();

const isWarmableImageUrl = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const warmPersistentImageUrl = (url?: string | null) => {
  if (typeof window === 'undefined' || !isWarmableImageUrl(url)) {
    return;
  }

  const trimmed = url.trim();
  const resolvedUrl = shouldAvoidRawImageFallback(trimmed)
    ? (buildProxiedImageUrl(trimmed) || trimmed)
    : trimmed;

  if (warmedImageUrls.has(resolvedUrl)) {
    return;
  }

  warmedImageUrls.add(resolvedUrl);

  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.referrerPolicy = 'no-referrer';

  const cleanup = () => {
    image.onload = null;
    image.onerror = null;
  };

  image.onload = cleanup;
  image.onerror = () => {
    warmedImageUrls.delete(resolvedUrl);
    cleanup();
  };

  image.src = resolvedUrl;
};

export const warmPersistentImageUrls = (urls: Array<string | null | undefined>) => {
  urls.forEach((url) => {
    warmPersistentImageUrl(url);
  });
};
