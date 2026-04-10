import { invokeAuthenticatedFunction } from '@/lib/supabase';
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

interface MaterializeWorkerResponseItem {
  id: string;
  status: 'stored' | 'exists' | 'error' | 'blocked' | 'invalid';
  publicUrl?: string;
  objectKey?: string;
  error?: string;
}

const configuredMediaBucketUrl = import.meta.env.VITE_MEDIA_BUCKET_URL?.trim() || '';
const configuredOfflineImageProxyUrl = import.meta.env.VITE_OFFLINE_IMAGE_PROXY_URL?.trim() || '';
const configuredScraperProxyUrl = import.meta.env.VITE_SCRAPER_PROXY_URL?.trim() || '';
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
      configuredOfflineImageProxyUrl,
      configuredScraperProxyUrl,
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

export const canMaterializeRemoteMedia = () => Boolean(configuredMediaBucketUrl);

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

export const materializeRemoteImages = async (inputs: MaterializeRemoteImageInput[]) => {
  if (!canMaterializeRemoteMedia()) {
    return new Map<string, string>();
  }

  const items = inputs
    .map(toWorkerItem)
    .filter((item): item is MaterializeWorkerItem => Boolean(item));

  if (items.length === 0) {
    return new Map<string, string>();
  }
  const results = new Map<string, string>();

  for (let index = 0; index < items.length; index += MATERIALIZE_WORKER_BATCH_SIZE) {
    const batch = items.slice(index, index + MATERIALIZE_WORKER_BATCH_SIZE);
    const data = await invokeAuthenticatedFunction<{ items?: MaterializeWorkerResponseItem[] }>(
      'admin-media-ingest',
      { items: batch },
    ).catch((error) => {
      throw new Error(error instanceof Error ? error.message : 'Media ingest failed');
    });

    for (const item of data?.items || []) {
      if ((item.status === 'stored' || item.status === 'exists') && item.publicUrl) {
        results.set(item.id, item.publicUrl);
      }
    }
  }

  return results;
};

export const materializeRemoteImage = async (input: MaterializeRemoteImageInput) => {
  const results = await materializeRemoteImages([input]);
  return results.get(input.id);
};

const normalizeStoredMediaOutputUrl = (sourceUrl?: string | null) => {
  const normalized = unwrapManagedMediaUrl(sourceUrl);
  return isStoredMediaUrl(normalized) ? normalized : normalizeText(sourceUrl);
};

export const materializeChapterPages = async <TChapter extends Pick<Chapter, 'id' | 'pages'>>(
  mangaId: string,
  chapters: TChapter[],
) => {
  if (!canMaterializeRemoteMedia() || !mangaId || chapters.length === 0) {
    return chapters.map((chapter) => ({
      ...chapter,
      pages: chapter.pages.map((pageUrl) => normalizeStoredMediaOutputUrl(pageUrl)),
    }));
  }

  const results = await materializeRemoteImages(
    chapters.flatMap((chapter) => (
      chapter.pages.map((pageUrl, pageIndex) => ({
        id: `${chapter.id}:${pageIndex}`,
        sourceUrl: pageUrl,
        entityType: 'chapter' as const,
        entityId: chapter.id,
        variant: 'page' as const,
        objectKey: buildMaterializedChapterPageObjectKey(mangaId, chapter.id, pageIndex),
        transform: PRESETS['chapter:page'],
      }))
    )),
  );

  return chapters.map((chapter) => ({
    ...chapter,
    pages: chapter.pages.map((pageUrl, pageIndex) => (
      results.get(`${chapter.id}:${pageIndex}`)
      || normalizeStoredMediaOutputUrl(pageUrl)
    )),
  }));
};
