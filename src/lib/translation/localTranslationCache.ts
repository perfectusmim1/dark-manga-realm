import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { TRANSLATION_BLOCK_VERSION } from './bubbleInpainter';
import { TranslationBlock } from './types';

const TRANSLATION_DB_NAME = 'toonparrot-translations';
const TRANSLATION_DB_VERSION = 1;
const TRANSLATION_CACHE_EVENT = 'toonparrot:translation-cache-updated';
const CLEARED_MARKERS_STORAGE_KEY = 'toonparrot_translation_cleared_v1';

export interface StoredPageTranslationRecord {
  key: string;
  chapterId: string;
  lang: string;
  pageIndex: number;
  blocks: TranslationBlock[];
  byteSize: number;
  updatedAt: string;
}

export interface TranslationCacheStats {
  totalChapters: number;
  totalPages: number;
  totalBytes: number;
  currentChapterPages: number;
  currentChapterBytes: number;
}

interface TranslationDbSchema extends DBSchema {
  pages: {
    key: string;
    value: StoredPageTranslationRecord;
    indexes: {
      'by-chapterId': string;
      'by-chapter-lang': [string, string];
    };
  };
}

const memoryFallbackStore = new Map<string, StoredPageTranslationRecord>();
let dbPromise: Promise<IDBPDatabase<TranslationDbSchema> | null> | null = null;

const getDb = (): Promise<IDBPDatabase<TranslationDbSchema> | null> => {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = openDB<TranslationDbSchema>(TRANSLATION_DB_NAME, TRANSLATION_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pages')) {
          const store = db.createObjectStore('pages', { keyPath: 'key' });
          store.createIndex('by-chapterId', 'chapterId');
          store.createIndex('by-chapter-lang', ['chapterId', 'lang']);
        }
      },
    }).catch(() => null);
  }
  return dbPromise;
};

const makeRecordKey = (chapterId: string, lang: string, pageIndex: number) =>
  `${chapterId}:${lang}:${pageIndex}`;

const makeChapterLangKey = (chapterId: string, lang: string) => `${chapterId}:${lang}`;

const estimateByteSize = (blocks: TranslationBlock[]): number => {
  try {
    const serialized = JSON.stringify(blocks);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(serialized).byteLength;
    }
    return serialized.length * 2;
  } catch {
    return 0;
  }
};

const emitCacheUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TRANSLATION_CACHE_EVENT));
  }
};

const readClearedMarkers = (): Record<string, string> => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CLEARED_MARKERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const writeClearedMarkers = (markers: Record<string, string>) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CLEARED_MARKERS_STORAGE_KEY, JSON.stringify(markers));
  } catch {
    // Depolama kotası dolduysa sessizce geç
  }
};

export const isValidCachedBlockList = (rawBlocks: unknown): rawBlocks is TranslationBlock[] => {
  if (!Array.isArray(rawBlocks)) return false;
  if (rawBlocks.length === 0) return true;
  return rawBlocks.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const b = entry as Partial<TranslationBlock>;
    return (
      b.v === TRANSLATION_BLOCK_VERSION &&
      Array.isArray(b.box) &&
      b.box.length === 4 &&
      Array.isArray(b.patchBox) &&
      b.patchBox.length === 4 &&
      typeof b.patchDataUrl === 'string' &&
      b.patchDataUrl.startsWith('data:image/')
    );
  });
};

// Kullanıcı önbelleği elle temizlediyse temizleme anından eski uzak kayıtların F5'te geri gelmesini engeller.
export const shouldAcceptRemoteTranslation = (
  chapterId: string,
  lang: string,
  remoteUpdatedAt?: string | null,
): boolean => {
  const markers = readClearedMarkers();
  const chapterClearedAt = markers[makeChapterLangKey(chapterId, lang)];
  const globalClearedAt = markers['*'];
  const effectiveClearedIso =
    chapterClearedAt && globalClearedAt
      ? chapterClearedAt > globalClearedAt
        ? chapterClearedAt
        : globalClearedAt
      : chapterClearedAt || globalClearedAt;

  if (!effectiveClearedIso) return true;
  if (!remoteUpdatedAt) return false;

  const clearedMs = Date.parse(effectiveClearedIso);
  const remoteMs = Date.parse(remoteUpdatedAt);
  if (!Number.isFinite(clearedMs) || !Number.isFinite(remoteMs)) return false;
  return remoteMs > clearedMs;
};

export const getLocalChapterTranslations = async (
  chapterId: string,
  lang: string,
): Promise<Map<number, TranslationBlock[]>> => {
  const result = new Map<number, TranslationBlock[]>();
  if (!chapterId || !lang) return result;

  const db = await getDb();
  if (db) {
    const records = await db.getAllFromIndex('pages', 'by-chapter-lang', [chapterId, lang]);
    for (const record of records) {
      if (typeof record.pageIndex === 'number' && isValidCachedBlockList(record.blocks)) {
        result.set(record.pageIndex, record.blocks);
      }
    }
    return result;
  }

  for (const record of memoryFallbackStore.values()) {
    if (
      record.chapterId === chapterId &&
      record.lang === lang &&
      isValidCachedBlockList(record.blocks)
    ) {
      result.set(record.pageIndex, record.blocks);
    }
  }
  return result;
};

export const putLocalPageTranslation = async (
  chapterId: string,
  pageIndex: number,
  lang: string,
  blocks: TranslationBlock[],
  options?: { preserveClearMarker?: boolean; silent?: boolean },
): Promise<void> => {
  if (!chapterId || !lang || pageIndex < 0) return;

  const record: StoredPageTranslationRecord = {
    key: makeRecordKey(chapterId, lang, pageIndex),
    chapterId,
    lang,
    pageIndex,
    blocks,
    byteSize: estimateByteSize(blocks),
    updatedAt: new Date().toISOString(),
  };

  if (!options?.preserveClearMarker) {
    const markers = readClearedMarkers();
    const markerKey = makeChapterLangKey(chapterId, lang);
    if (markers[markerKey]) {
      delete markers[markerKey];
      writeClearedMarkers(markers);
    }
  }

  const db = await getDb();
  if (db) {
    await db.put('pages', record);
  } else {
    memoryFallbackStore.set(record.key, record);
  }

  if (!options?.silent) {
    emitCacheUpdated();
  }
};

export const putLocalChapterTranslationsBatch = async (
  chapterId: string,
  lang: string,
  entries: Array<{ pageIndex: number; blocks: TranslationBlock[] }>,
): Promise<void> => {
  if (!chapterId || !lang || entries.length === 0) return;

  const now = new Date().toISOString();
  const db = await getDb();
  if (db) {
    const tx = db.transaction('pages', 'readwrite');
    for (const entry of entries) {
      if (entry.pageIndex < 0) continue;
      await tx.store.put({
        key: makeRecordKey(chapterId, lang, entry.pageIndex),
        chapterId,
        lang,
        pageIndex: entry.pageIndex,
        blocks: entry.blocks,
        byteSize: estimateByteSize(entry.blocks),
        updatedAt: now,
      });
    }
    await tx.done;
  } else {
    for (const entry of entries) {
      if (entry.pageIndex < 0) continue;
      const key = makeRecordKey(chapterId, lang, entry.pageIndex);
      memoryFallbackStore.set(key, {
        key,
        chapterId,
        lang,
        pageIndex: entry.pageIndex,
        blocks: entry.blocks,
        byteSize: estimateByteSize(entry.blocks),
        updatedAt: now,
      });
    }
  }

  emitCacheUpdated();
};

export const clearChapterTranslationCache = async (
  chapterId: string,
  lang?: string,
): Promise<void> => {
  if (!chapterId) return;

  const nowIso = new Date().toISOString();
  const markers = readClearedMarkers();
  if (lang) {
    markers[makeChapterLangKey(chapterId, lang)] = nowIso;
  }
  writeClearedMarkers(markers);

  const db = await getDb();
  if (db) {
    const records = lang
      ? await db.getAllFromIndex('pages', 'by-chapter-lang', [chapterId, lang])
      : await db.getAllFromIndex('pages', 'by-chapterId', chapterId);

    if (records.length > 0) {
      const tx = db.transaction('pages', 'readwrite');
      for (const record of records) {
        if (!lang) {
          markers[makeChapterLangKey(record.chapterId, record.lang)] = nowIso;
        }
        await tx.store.delete(record.key);
      }
      await tx.done;
      if (!lang) writeClearedMarkers(markers);
    }
  } else {
    for (const [key, record] of memoryFallbackStore.entries()) {
      if (record.chapterId === chapterId && (!lang || record.lang === lang)) {
        memoryFallbackStore.delete(key);
      }
    }
  }

  emitCacheUpdated();
};

export const clearAllTranslationCache = async (): Promise<void> => {
  writeClearedMarkers({ '*': new Date().toISOString() });

  const db = await getDb();
  if (db) {
    await db.clear('pages');
  } else {
    memoryFallbackStore.clear();
  }

  emitCacheUpdated();
};

export const getTranslationCacheStats = async (
  currentChapterId?: string,
  currentLang?: string,
): Promise<TranslationCacheStats> => {
  const db = await getDb();
  const records = db ? await db.getAll('pages') : Array.from(memoryFallbackStore.values());

  const chapterSet = new Set<string>();
  let totalPages = 0;
  let totalBytes = 0;
  let currentChapterPages = 0;
  let currentChapterBytes = 0;

  for (const record of records) {
    if (!isValidCachedBlockList(record.blocks)) continue;
    chapterSet.add(record.chapterId);
    totalPages += 1;
    const size = record.byteSize || 0;
    totalBytes += size;

    if (
      currentChapterId &&
      record.chapterId === currentChapterId &&
      (!currentLang || record.lang === currentLang)
    ) {
      currentChapterPages += 1;
      currentChapterBytes += size;
    }
  }

  return {
    totalChapters: chapterSet.size,
    totalPages,
    totalBytes,
    currentChapterPages,
    currentChapterBytes,
  };
};

export const subscribeTranslationCache = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(TRANSLATION_CACHE_EVENT, listener);
  return () => window.removeEventListener(TRANSLATION_CACHE_EVENT, listener);
};
