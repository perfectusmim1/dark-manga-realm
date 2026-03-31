import { invokeAuthenticatedFunction } from '@/lib/supabase';
import type { ExternalSourceName } from '@/lib/types';

export type MediaEntityType = 'manga' | 'character' | 'author' | 'artist';
export type MediaVariant = 'cover' | 'banner' | 'profile' | 'gallery';

export interface MediaTransformPreset {
  width: number;
  quality: number;
  fit: 'scale-down' | 'contain' | 'cover';
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

const MEDIA_HOST_PATTERNS = ['.r2.dev', 'toonparrot-media'];

const PRESETS: Record<`${MediaEntityType}:${MediaVariant}`, MediaTransformPreset> = {
  'manga:cover': { width: 720, quality: 80, fit: 'cover', format: 'webp' },
  'manga:banner': { width: 1600, quality: 78, fit: 'cover', format: 'webp' },
  'manga:gallery': { width: 1600, quality: 78, fit: 'scale-down', format: 'webp' },
  'character:profile': { width: 640, quality: 78, fit: 'cover', format: 'webp' },
  'character:gallery': { width: 1200, quality: 78, fit: 'scale-down', format: 'webp' },
  'author:profile': { width: 560, quality: 78, fit: 'cover', format: 'webp' },
  'author:gallery': { width: 1200, quality: 78, fit: 'scale-down', format: 'webp' },
  'artist:profile': { width: 560, quality: 78, fit: 'cover', format: 'webp' },
  'artist:gallery': { width: 1200, quality: 78, fit: 'scale-down', format: 'webp' },
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

  const data = await invokeAuthenticatedFunction<{ items?: MaterializeWorkerResponseItem[] }>(
    'admin-media-ingest',
    { items },
  ).catch((error) => {
    throw new Error(error instanceof Error ? error.message : 'Media ingest failed');
  });
  const results = new Map<string, string>();

  for (const item of data?.items || []) {
    if ((item.status === 'stored' || item.status === 'exists') && item.publicUrl) {
      results.set(item.id, item.publicUrl);
    }
  }

  return results;
};

export const materializeRemoteImage = async (input: MaterializeRemoteImageInput) => {
  const results = await materializeRemoteImages([input]);
  return results.get(input.id);
};
