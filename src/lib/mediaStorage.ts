import type { Chapter, ExternalSourceName } from '@/lib/types';

export type MediaEntityType = 'manga' | 'character' | 'author' | 'artist' | 'chapter';
export type MediaVariant = 'cover' | 'banner' | 'profile' | 'gallery' | 'page';

export interface MediaTransformPreset {
  width?: number;
  quality?: number;
  fit?: 'scale-down' | 'contain' | 'cover';
  format: 'webp';
}

export interface MaterializeRemoteImageInput {
  id: string;
  sourceUrl?: string | null;
  entityType: MediaEntityType;
  entityId: string;
  variant: MediaVariant;
  sourceName?: ExternalSourceName | string;
  objectKey?: string;
  transform?: MediaTransformPreset;
}

interface MaterializeWorkerItem {
  id: string;
  sourceUrl: string;
  objectKey: string;
  entityType: MediaEntityType;
  variant: MediaVariant;
  sourceName?: ExternalSourceName | string;
  transform: MediaTransformPreset;
}


const configuredMediaBucketUrl = import.meta.env.VITE_MEDIA_BUCKET_URL?.trim() || '';
const configuredOfflineImageProxyUrls = (
  import.meta.env.VITE_OFFLINE_IMAGE_PROXY_URL?.trim() ||
  'https://toonparrot-offline-image-proxy.caganhuseyinerdil.workers.dev'
)
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const configuredScraperProxyUrls = (import.meta.env.VITE_SCRAPER_PROXY_URL?.trim() || '')
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const configuredOfflineImageProxyUrl = configuredOfflineImageProxyUrls[0] || '';
const configuredScraperProxyUrl = configuredScraperProxyUrls[0] || '';

let imageProxyRoundRobinIndex = 0;
export const getNextOfflineImageProxyUrl = (): string => {
  if (configuredOfflineImageProxyUrls.length === 0) return configuredOfflineImageProxyUrl;
  const url = configuredOfflineImageProxyUrls[imageProxyRoundRobinIndex % configuredOfflineImageProxyUrls.length];
  imageProxyRoundRobinIndex = (imageProxyRoundRobinIndex + 1) % configuredOfflineImageProxyUrls.length;
  return url;
};
const MATERIALIZE_WORKER_BATCH_SIZE = 40;

const MEDIA_HOST_PATTERNS = ['.r2.dev', 'toonparrot-media'];

const PRESETS: Partial<Record<`${MediaEntityType}:${MediaVariant}`, MediaTransformPreset>> = {
  'manga:cover': { width: 720, quality: 86, fit: 'cover', format: 'webp' },
  'manga:banner': { width: 1600, quality: 84, fit: 'cover', format: 'webp' },
  'manga:gallery': { width: 1600, quality: 84, fit: 'scale-down', format: 'webp' },
  'character:profile': { width: 640, quality: 84, fit: 'cover', format: 'webp' },
  'character:gallery': { width: 1200, quality: 84, fit: 'scale-down', format: 'webp' },
  'author:profile': { width: 560, quality: 84, fit: 'cover', format: 'webp' },
  'author:gallery': { width: 1200, quality: 84, fit: 'scale-down', format: 'webp' },
  'artist:profile': { width: 560, quality: 84, fit: 'cover', format: 'webp' },
  'artist:gallery': { width: 1200, quality: 84, fit: 'scale-down', format: 'webp' },
  'chapter:page': { quality: 90, format: 'webp' },
};

const normalizeText = (value?: string | null) => value?.trim() || '';

const toSafeEntityId = (value: string) => normalizeText(value).replace(/[^a-zA-Z0-9_-]/g, '-');

const hashText = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

const toGalleryObjectSegment = (value: string | number) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${Math.max(0, Math.trunc(value)) + 1}`.padStart(3, '0');
  }

  const normalized = normalizeText(`${value || ''}`);
  return normalized ? hashText(normalized) : crypto.randomUUID().replace(/-/g, '');
};

const unwrapProxyUrl = (sourceUrl?: string | null) => {
  const normalized = normalizeText(sourceUrl);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    const knownProxyUrls = [
      ...configuredOfflineImageProxyUrls,
      ...configuredScraperProxyUrls,
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean);

    if (
      knownProxyUrls.some((proxyUrl) => {
        try {
          return new URL(proxyUrl).origin === parsed.origin && new URL(proxyUrl).pathname === parsed.pathname;
        } catch {
          return false;
        }
      })
    ) {
      return normalizeText(parsed.searchParams.get('url'));
    }
  } catch {
    return normalized;
  }

  return normalized;
};

export const unwrapManagedMediaUrl = (sourceUrl?: string | null) => unwrapProxyUrl(sourceUrl);

export const buildProxiedImageUrl = (sourceUrl?: string | null, referer?: string | null): string => {
  const normalized = normalizeText(sourceUrl);
  if (!normalized) {
    return '';
  }

  const unwrapped = unwrapProxyUrl(normalized) || normalized;
  const proxyBaseUrl = getNextOfflineImageProxyUrl();
  if (!proxyBaseUrl) {
    return unwrapped;
  }

  const urlParam = encodeURIComponent(unwrapped);
  const refererParam = referer?.trim() ? `&referer=${encodeURIComponent(referer.trim())}` : '';
  const separator = proxyBaseUrl.includes('?') ? '&' : '?';
  return `${proxyBaseUrl}${separator}url=${urlParam}${refererParam}`;
};

export const isStoredMediaUrl = (sourceUrl?: string | null) => {
  const normalized = normalizeText(sourceUrl);
  if (!normalized) {
    return false;
  }

  if (configuredMediaBucketUrl && normalized.startsWith(configuredMediaBucketUrl)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return MEDIA_HOST_PATTERNS.some((pattern) => parsed.hostname.includes(pattern));
  } catch {
    return false;
  }
};

export const canMaterializeRemoteMedia = () => false;

export const buildMaterializedObjectKey = (
  entityType: MediaEntityType,
  entityId: string,
  variant: MediaVariant,
) => `${entityType}/${toSafeEntityId(entityId)}/${variant}.webp`;

export const buildMaterializedGalleryObjectKey = (
  entityType: MediaEntityType,
  entityId: string,
  galleryIdentity: string | number,
) => `${entityType}/${toSafeEntityId(entityId)}/gallery/${toGalleryObjectSegment(galleryIdentity)}.webp`;

const toPageObjectSegment = (pageIndex: number) => `${Math.max(0, Math.trunc(pageIndex)) + 1}`.padStart(3, '0');

export const buildMaterializedChapterPageObjectKey = (
  mangaId: string,
  chapterId: string,
  pageIndex: number,
) => `manga/${toSafeEntityId(mangaId)}/chapters/${toSafeEntityId(chapterId)}/${toPageObjectSegment(pageIndex)}.webp`;

const toWorkerItem = (input: MaterializeRemoteImageInput): MaterializeWorkerItem | null => {
  const sourceUrl = unwrapProxyUrl(input.sourceUrl);
  if (!sourceUrl || isStoredMediaUrl(sourceUrl)) {
    return null;
  }

  const preset = input.transform || PRESETS[`${input.entityType}:${input.variant}`];
  if (!preset) {
    return null;
  }

  return {
    id: input.id,
    sourceUrl,
    objectKey: input.objectKey || buildMaterializedObjectKey(input.entityType, input.entityId, input.variant),
    entityType: input.entityType,
    variant: input.variant,
    sourceName: input.sourceName,
    transform: preset,
  };
};

export const materializeRemoteImages = async (_inputs: MaterializeRemoteImageInput[]) => {
  // Artık R2 storage'a dosya yüklenmiyor; dış görsel linkleri korunuyor.
  return new Map<string, string>();
};

export const materializeRemoteImage = async (input: MaterializeRemoteImageInput) => {
  return input.sourceUrl || undefined;
};

const normalizeStoredMediaOutputUrl = (sourceUrl?: string | null) => {
  const normalized = unwrapManagedMediaUrl(sourceUrl);
  return isStoredMediaUrl(normalized) ? normalized : normalizeText(sourceUrl);
};

const cleanRemotePageUrls = (pages: (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const page of pages) {
    if (!page) continue;
    const trimmed = normalizeText(page);
    if (!trimmed) continue;
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }

  return cleaned;
};

export interface ChapterPagesMaterializeResult {
  pages: string[];
  uploadedCount: number;
  skippedCount: number;
}

export interface MaterializeChapterPagesInput {
  pages?: (string | null | undefined)[];
  mangaId?: string;
  chapterId?: string;
  sourceName?: string;
  [key: string]: unknown;
}

export function materializeChapterPages(
  input: MaterializeChapterPagesInput,
): Promise<ChapterPagesMaterializeResult>;
export function materializeChapterPages<TChapter extends Pick<Chapter, 'id' | 'pages'>>(
  mangaId: string,
  chapters: TChapter[],
): Promise<TChapter[]>;
export async function materializeChapterPages<TChapter extends Pick<Chapter, 'id' | 'pages'>>(
  firstArg: string | MaterializeChapterPagesInput,
  secondArg?: TChapter[],
): Promise<ChapterPagesMaterializeResult | TChapter[]> {
  if (typeof firstArg === 'string' && Array.isArray(secondArg)) {
    return secondArg.map((chapter) => ({
      ...chapter,
      pages: cleanRemotePageUrls(chapter.pages),
    }));
  }

  const input = (firstArg && typeof firstArg === 'object' ? firstArg : {}) as MaterializeChapterPagesInput;
  const rawPages = Array.isArray(input.pages) ? input.pages : [];
  const cleanedPages = cleanRemotePageUrls(rawPages);

  return {
    pages: cleanedPages,
    uploadedCount: 0,
    skippedCount: cleanedPages.length,
  };
}

export interface MaterializeMangaMediaInput {
  coverUrl?: string | null;
  bannerUrl?: string | null;
  cover?: string | null;
  banner?: string | null;
  [key: string]: unknown;
}

export interface MaterializeMangaMediaResult {
  cover?: string;
  banner?: string;
  coverUrl?: string;
  bannerUrl?: string;
}

export const materializeMangaMedia = async (
  input: MaterializeMangaMediaInput,
): Promise<MaterializeMangaMediaResult> => {
  const cover = normalizeText(input.cover || input.coverUrl) || undefined;
  const banner = normalizeText(input.banner || input.bannerUrl) || undefined;
  return {
    cover,
    banner,
    coverUrl: cover,
    bannerUrl: banner,
  };
};

export interface MaterializeCharacterImageInput {
  image?: string | null;
  imageUrl?: string | null;
  [key: string]: unknown;
}

export interface MaterializeCharacterImageResult {
  image?: string;
  imageUrl?: string;
}

export const materializeCharacterImage = async (
  input: MaterializeCharacterImageInput,
): Promise<MaterializeCharacterImageResult> => {
  const image = normalizeText(input.image || input.imageUrl) || undefined;
  return {
    image,
    imageUrl: image,
  };
};
