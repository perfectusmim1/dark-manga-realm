import { DBSchema, openDB } from 'idb';
import { AsyncPersister, PersistedClient } from '@tanstack/react-query-persist-client';

const DB_NAME = 'toonparrot-query-cache';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';
const CACHE_KEY = 'react_query_cache';

interface QueryCacheDbSchema extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: PersistedClient;
  };
}

let dbPromise: ReturnType<typeof openDB<QueryCacheDbSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return null;
    }
    dbPromise = openDB<QueryCacheDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    }).catch((err) => {
      console.warn('[Cache] IndexedDB açılamadı, RAM fallback devrede:', err);
      dbPromise = null;
      return null;
    });
  }
  return dbPromise;
}

export function createIdbPersister(key: string = CACHE_KEY): AsyncPersister {
  return {
    persistClient: async (persistedClient: PersistedClient) => {
      try {
        const db = await getDb();
        if (db) {
          await db.put(STORE_NAME, persistedClient, key);
        }
      } catch (error) {
        console.warn('[Cache] IndexedDB persist hatası:', error);
      }
    },
    restoreClient: async (): Promise<PersistedClient | undefined> => {
      try {
        const db = await getDb();
        if (!db) return undefined;
        const data = await db.get(STORE_NAME, key);
        return data;
      } catch (error) {
        console.warn('[Cache] IndexedDB restore hatası:', error);
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        const db = await getDb();
        if (db) {
          await db.delete(STORE_NAME, key);
        }
      } catch (error) {
        console.warn('[Cache] IndexedDB remove hatası:', error);
      }
    },
  };
}

export const idbPersister = createIdbPersister();
