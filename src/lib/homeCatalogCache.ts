import type { Manga } from '@/lib/types';

const HOME_CATALOG_STORAGE_KEY = 'toonparrot-home-catalog-v1';
const HOME_CATALOG_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const HOME_CATALOG_MEMORY_MAX_AGE_MS = 4 * 60 * 1000;

export interface HomeCatalogCacheEntry {
  items: Manga[];
  totalCount: number;
  totalPages: number;
  pageSize: number;
  updatedAt: number;
}

const homeCatalogMemoryPages = new Map<string, HomeCatalogCacheEntry>();

const buildHomeCatalogMemoryKey = (
  includeAdult: boolean,
  sort: string,
  pageSize: number,
  page: number,
) => `${includeAdult ? 'adult' : 'safe'}:${sort}:${pageSize}:${page}`;

interface HomeCatalogStoragePayload {
  version: 1;
  byAudience: Partial<Record<'safe' | 'adult', HomeCatalogCacheEntry>>;
}

const getAudienceSlot = (includeAdult: boolean): 'safe' | 'adult' => (
  includeAdult ? 'adult' : 'safe'
);

const deduplicateMangaList = (items: Manga[]): Manga[] => {
  const seen = new Set<string>();
  const unique: Manga[] = [];

  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push({
      ...item,
      chapters: Array.isArray(item.chapters) ? item.chapters.slice(0, 2) : [],
      ratings: [],
    });
  }

  return unique;
};

const readStoragePayload = (): HomeCatalogStoragePayload => {
  if (typeof window === 'undefined') {
    return { version: 1, byAudience: {} };
  }

  try {
    const raw = window.localStorage.getItem(HOME_CATALOG_STORAGE_KEY);
    if (!raw) {
      return { version: 1, byAudience: {} };
    }

    const parsed = JSON.parse(raw) as HomeCatalogStoragePayload;
    if (!parsed || parsed.version !== 1 || typeof parsed.byAudience !== 'object' || !parsed.byAudience) {
      return { version: 1, byAudience: {} };
    }

    return {
      version: 1,
      byAudience: parsed.byAudience,
    };
  } catch {
    return { version: 1, byAudience: {} };
  }
};

const writeStoragePayload = (payload: HomeCatalogStoragePayload) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(HOME_CATALOG_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Kota / gizli pencere hatalarında bellek önbelleği çalışmaya devam eder.
  }
};

export const readHomeCatalogSeed = (includeAdult: boolean): HomeCatalogCacheEntry | null => {
  const slot = getAudienceSlot(includeAdult);
  const payload = readStoragePayload();
  const entry = payload.byAudience[slot];

  if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) {
    return null;
  }

  if (typeof entry.updatedAt !== 'number' || Date.now() - entry.updatedAt > HOME_CATALOG_MAX_AGE_MS) {
    return null;
  }

  const dedupedItems = deduplicateMangaList(entry.items);
  if (dedupedItems.length === 0) {
    return null;
  }

  const pageSize = Math.max(1, Number(entry.pageSize) || 28);
  const totalCount = Math.max(dedupedItems.length, Number(entry.totalCount) || 0);
  const totalPages = Math.max(1, Number(entry.totalPages) || Math.ceil(totalCount / pageSize));

  return {
    items: dedupedItems,
    totalCount,
    totalPages,
    pageSize,
    updatedAt: entry.updatedAt,
  };
};

export const writeHomeCatalogCache = (
  includeAdult: boolean,
  entry: {
    items: Manga[];
    totalCount: number;
    totalPages: number;
    pageSize: number;
  },
) => {
  const slot = getAudienceSlot(includeAdult);
  const payload = readStoragePayload();
  const dedupedItems = deduplicateMangaList(entry.items);
  const pageSize = Math.max(1, Number(entry.pageSize) || 28);
  const totalCount = Math.max(dedupedItems.length, Number(entry.totalCount) || 0);
  const totalPages = Math.max(1, Number(entry.totalPages) || Math.ceil(totalCount / pageSize));

  payload.byAudience[slot] = {
    items: dedupedItems,
    totalCount,
    totalPages,
    pageSize,
    updatedAt: Date.now(),
  };

  writeStoragePayload(payload);
};

export const updateHomeCatalogCachedTotals = (
  includeAdult: boolean,
  totalCount: number,
  pageSize: number = 28,
) => {
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return;
  }

  const slot = getAudienceSlot(includeAdult);
  const payload = readStoragePayload();
  const existing = payload.byAudience[slot];
  if (!existing) {
    return;
  }

  const normalizedPageSize = Math.max(1, pageSize || existing.pageSize || 28);
  const nextTotalPages = Math.max(1, Math.ceil(totalCount / normalizedPageSize));

  if (existing.totalCount === totalCount && existing.totalPages === nextTotalPages) {
    return;
  }

  payload.byAudience[slot] = {
    ...existing,
    totalCount,
    totalPages: nextTotalPages,
    pageSize: normalizedPageSize,
    updatedAt: Date.now(),
  };

  writeStoragePayload(payload);
};

export const readHomeCatalogMemoryPage = (
  includeAdult: boolean,
  page: number,
  pageSize: number = 28,
  sort: string = 'updated',
): HomeCatalogCacheEntry | null => {
  const key = buildHomeCatalogMemoryKey(includeAdult, sort, pageSize, page);
  const entry = homeCatalogMemoryPages.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.updatedAt > HOME_CATALOG_MEMORY_MAX_AGE_MS) {
    homeCatalogMemoryPages.delete(key);
    return null;
  }

  return entry;
};

export const writeHomeCatalogMemoryPage = (
  includeAdult: boolean,
  page: number,
  entry: {
    items: Manga[];
    totalCount: number;
    totalPages: number;
    pageSize: number;
  },
  sort: string = 'updated',
) => {
  const dedupedItems = deduplicateMangaList(entry.items);
  const pageSize = Math.max(1, Number(entry.pageSize) || 28);
  const totalCount = Math.max(dedupedItems.length, Number(entry.totalCount) || 0);
  const totalPages = Math.max(1, Number(entry.totalPages) || Math.ceil(totalCount / pageSize));
  const key = buildHomeCatalogMemoryKey(includeAdult, sort, pageSize, page);

  homeCatalogMemoryPages.set(key, {
    items: dedupedItems,
    totalCount,
    totalPages,
    pageSize,
    updatedAt: Date.now(),
  });
};

export const clearHomeCatalogCache = () => {
  homeCatalogMemoryPages.clear();

  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(HOME_CATALOG_STORAGE_KEY);
  } catch {
    // Yoksay
  }
};
