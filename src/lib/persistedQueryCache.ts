import { openDB, type IDBPDatabase } from 'idb';

/**
 * Kalıcı (IndexedDB) sorgu önbelleği.
 *
 * Amaç: sayfa yenilendiğinde veya yeni sekmede Supabase'den aynı büyük katalog
 * verisini (manga özetleri ~birkaç MB) tekrar indirmemek. Veri yaşı TTL içindeyse
 * doğrudan IDB'den döner; böylece Keşfet/ana sayfa/açılış ilk boyası ağ beklemeden
 * gerçekleşir. Yazma/silme işlemleri veri değişince ilgili anahtarları temizler.
 */

// NOT: React Query persist katmanı `toonparrot-query-cache` DB'sini kullanıyor
// (src/lib/cache/idbPersister.ts). Aynı DB adını paylaşmamak için ayrı bir DB adı
// kullanılır; aksi halde ilk açan taraf DB'yi oluşturur ve diğer store eksik kalır.
const DB_NAME = 'toonparrot-catalog-cache-v2';
const STORE_NAME = 'entries';
const DB_VERSION = 1;

// Eski v1 veritabanı varsa arka planda temizle
if (typeof indexedDB !== 'undefined') {
  try {
    indexedDB.deleteDatabase('toonparrot-catalog-cache');
  } catch {
    // yoksay
  }
}

interface PersistedQueryEntry<T = unknown> {
  key: string;
  fetchedAt: number;
  value: T;
}

let dbPromise: Promise<IDBPDatabase | null> | null = null;

const isIndexedDbAvailable = () => typeof indexedDB !== 'undefined';

const getCacheDb = (): Promise<IDBPDatabase | null> => {
  if (!isIndexedDbAvailable()) {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      },
    }).catch(() => null);
  }

  return dbPromise;
};

export const readPersistedQueryCache = async <T>(
  key: string,
): Promise<{ fetchedAt: number; value: T } | null> => {
  try {
    const db = await getCacheDb();
    if (!db) {
      return null;
    }

    const entry = (await db.get(STORE_NAME, key)) as PersistedQueryEntry<T> | undefined;
    if (!entry || typeof entry.fetchedAt !== 'number' || entry.value == null) {
      return null;
    }

    return { fetchedAt: entry.fetchedAt, value: entry.value };
  } catch {
    return null;
  }
};

export const writePersistedQueryCache = async <T>(key: string, value: T): Promise<void> => {
  try {
    const db = await getCacheDb();
    if (!db) {
      return;
    }

    const entry: PersistedQueryEntry<T> = { key, fetchedAt: Date.now(), value };
    await db.put(STORE_NAME, entry);
  } catch {
    // Kota / IDB erişim hataları sessizce yutulur; uygulama ağ yoluna devam eder.
  }
};

export const removePersistedQueryCache = async (keys: string[]): Promise<void> => {
  try {
    const db = await getCacheDb();
    if (!db || keys.length === 0) {
      return;
    }

    const tx = db.transaction(STORE_NAME, 'readwrite');
    await Promise.all(keys.map((key) => tx.store.delete(key)));
    await tx.done;
  } catch {
    // yoksay
  }
};

export const clearPersistedQueryCache = async (): Promise<void> => {
  try {
    const db = await getCacheDb();
    if (!db) {
      return;
    }

    await db.clear(STORE_NAME);
  } catch {
    // yoksay
  }
};
