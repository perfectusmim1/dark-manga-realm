const warmedImageUrls = new Set<string>();

const isWarmableImageUrl = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const warmPersistentImageUrl = (url?: string | null) => {
  if (typeof window === 'undefined' || !isWarmableImageUrl(url) || warmedImageUrls.has(url)) {
    return;
  }

  warmedImageUrls.add(url);

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
    warmedImageUrls.delete(url);
    cleanup();
  };

  image.src = url;
};

export const warmPersistentImageUrls = (urls: Array<string | null | undefined>) => {
  urls.forEach((url) => {
    warmPersistentImageUrl(url);
  });
};
