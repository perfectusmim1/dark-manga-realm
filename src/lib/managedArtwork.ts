import { supabase } from '@/lib/supabase';

export type ManagedArtworkKind = 'cover' | 'banner';

const MANAGED_ARTWORK_BUCKET = 'manga-artwork';
const MANAGED_ARTWORK_WIDTHS: Record<ManagedArtworkKind, number[]> = {
  cover: [240, 420, 640],
  banner: [960, 1200, 1600],
};
const MANAGED_ARTWORK_DEFAULT_WIDTH: Record<ManagedArtworkKind, number> = {
  cover: 420,
  banner: 1200,
};
const MANAGED_ARTWORK_QUALITY: Record<ManagedArtworkKind, number> = {
  cover: 0.76,
  banner: 0.8,
};

interface ParsedManagedArtworkUrl {
  kind: ManagedArtworkKind;
  prefix: string;
  widths: number[];
}

interface ManagedArtworkUploadResult {
  defaultUrl: string;
  srcSet: string;
}

interface PrepareManagedArtworkParams {
  mangaId: string;
  coverUrl: string;
  bannerUrl?: string;
}

interface PrepareManagedArtworkResult {
  coverUrl: string;
  bannerUrl: string;
  warnings: string[];
}

interface DecodedImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

const normalizeUrl = (value?: string | null) => value?.trim() || '';

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const byteArrayToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');

const hashBlob = async (blob: Blob) => {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return byteArrayToHex(new Uint8Array(digest)).slice(0, 16);
};

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas export failed'));
          return;
        }

        resolve(blob);
      },
      'image/webp',
      quality,
    );
  });

const decodeImageBlob = async (blob: Blob): Promise<DecodedImageSource> => {
  if (typeof window !== 'undefined' && 'createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  if (typeof window === 'undefined') {
    throw new Error('Image decoding is only available in the browser');
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  await image.decode();

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
};

const getTargetWidths = (kind: ManagedArtworkKind, sourceWidth: number) => {
  const requested = MANAGED_ARTWORK_WIDTHS[kind];
  const filtered = requested.filter((width) => width < sourceWidth);

  if (!filtered.includes(sourceWidth)) {
    filtered.push(sourceWidth);
  }

  return Array.from(new Set(filtered)).sort((left, right) => left - right);
};

const buildStoragePath = (mangaId: string, kind: ManagedArtworkKind, version: string, width: number) =>
  `mangas/${mangaId}/${kind}/${version}/w${width}.webp`;

const buildPublicUrl = (path: string) => {
  const { data } = supabase.storage.from(MANAGED_ARTWORK_BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

const appendWidthsQuery = (url: string, widths: number[]) => {
  const nextUrl = new URL(url);
  nextUrl.searchParams.set('vw', widths.join(','));
  return nextUrl.toString();
};

const parseManagedArtworkUrl = (url: string): ParsedManagedArtworkUrl | null => {
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${MANAGED_ARTWORK_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return null;
    }

    const relativePath = parsed.pathname.slice(markerIndex + marker.length);
    const match = relativePath.match(/^(mangas\/[^/]+\/(cover|banner)\/[^/]+\/)w(\d+)\.webp$/);
    if (!match) {
      return null;
    }

    const widthsParam = parsed.searchParams.get('vw') || '';
    const widths = widthsParam
      .split(',')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);

    const fallbackWidth = Number.parseInt(match[3], 10);
    if (!widths.includes(fallbackWidth)) {
      widths.push(fallbackWidth);
      widths.sort((left, right) => left - right);
    }

    return {
      kind: match[2] as ManagedArtworkKind,
      prefix: `${parsed.origin}${marker}${match[1]}`,
      widths,
    };
  } catch {
    return null;
  }
};

export const isManagedArtworkUrl = (url?: string | null) => Boolean(url && parseManagedArtworkUrl(url));

export const getManagedArtworkSrcSet = (url?: string | null) => {
  if (!url) {
    return undefined;
  }

  const parsed = parseManagedArtworkUrl(url);
  if (!parsed) {
    return undefined;
  }

  return parsed.widths
    .map((width) => `${parsed.prefix}w${width}.webp ${width}w`)
    .join(', ');
};

const uploadManagedArtworkVariant = async (
  mangaId: string,
  kind: ManagedArtworkKind,
  version: string,
  width: number,
  decodedImage: DecodedImageSource,
) => {
  if (typeof document === 'undefined') {
    throw new Error('Canvas rendering is only available in the browser');
  }

  const targetHeight = Math.max(1, Math.round((decodedImage.height / decodedImage.width) * width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Canvas context unavailable');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(decodedImage.source, 0, 0, width, targetHeight);

  const outputBlob = await canvasToBlob(canvas, MANAGED_ARTWORK_QUALITY[kind]);
  const storagePath = buildStoragePath(mangaId, kind, version, width);
  const { error } = await supabase.storage.from(MANAGED_ARTWORK_BUCKET).upload(storagePath, outputBlob, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: '31536000',
  });

  if (error) {
    throw error;
  }

  return buildPublicUrl(storagePath);
};

const ingestManagedArtworkSource = async (
  mangaId: string,
  kind: ManagedArtworkKind,
  sourceUrl: string,
): Promise<ManagedArtworkUploadResult> => {
  const response = await fetch(sourceUrl, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Artwork fetch failed (${response.status})`);
  }

  const sourceBlob = await response.blob();
  if (!sourceBlob.type.startsWith('image/')) {
    throw new Error('Artwork source is not an image');
  }

  const decodedImage = await decodeImageBlob(sourceBlob);

  try {
    const version = await hashBlob(sourceBlob);
    const widths = getTargetWidths(kind, decodedImage.width);
    const uploads = await Promise.all(
      widths.map(async (width) => ({
        width,
        url: await uploadManagedArtworkVariant(mangaId, kind, version, width, decodedImage),
      })),
    );

    const preferredWidth = MANAGED_ARTWORK_DEFAULT_WIDTH[kind];
    const defaultVariant =
      uploads.find((variant) => variant.width === preferredWidth)
      || uploads[uploads.length - 1];

    const defaultUrl = appendWidthsQuery(
      defaultVariant.url,
      uploads.map((variant) => variant.width),
    );

    return {
      defaultUrl,
      srcSet: uploads.map((variant) => `${variant.url} ${variant.width}w`).join(', '),
    };
  } finally {
    decodedImage.cleanup();
  }
};

export const prepareManagedArtworkForSave = async ({
  mangaId,
  coverUrl,
  bannerUrl,
}: PrepareManagedArtworkParams): Promise<PrepareManagedArtworkResult> => {
  const normalizedCoverUrl = normalizeUrl(coverUrl);
  const normalizedBannerUrl = normalizeUrl(bannerUrl) || normalizedCoverUrl;
  const warnings: string[] = [];

  const resolveManagedUrl = async (kind: ManagedArtworkKind, sourceUrl: string) => {
    if (!isHttpUrl(sourceUrl)) {
      return sourceUrl;
    }

    if (isManagedArtworkUrl(sourceUrl)) {
      return sourceUrl;
    }

    try {
      const result = await ingestManagedArtworkSource(mangaId, kind, sourceUrl);
      return result.defaultUrl;
    } catch (error) {
      console.warn(`Managed artwork ingest failed for ${kind}:`, error);
      warnings.push(
        kind === 'cover'
          ? 'Kapak görseli optimize edilemedi, orijinal URL korundu.'
          : 'Banner görseli optimize edilemedi, orijinal URL korundu.',
      );
      return sourceUrl;
    }
  };

  const [managedCoverUrl, managedBannerUrl] = await Promise.all([
    resolveManagedUrl('cover', normalizedCoverUrl),
    resolveManagedUrl('banner', normalizedBannerUrl),
  ]);

  return {
    coverUrl: managedCoverUrl,
    bannerUrl: managedBannerUrl,
    warnings,
  };
};
