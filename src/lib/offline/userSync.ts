import { Bookmark, Favorite, ReadingList, User as AppUser } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { getOfflinePreferences, subscribeOfflinePreferences } from '@/lib/offline/preferences';

const OFFLINE_USER_SYNC_STORAGE_KEY = 'toonparrot_offline_user_sync_v1';
const OFFLINE_USER_SYNC_EVENT = 'toonparrot:offline-user-sync-updated';

type CachedReadingList = Omit<ReadingList, 'items'> & {
  mangaIds: string[];
};

type PendingUserSyncType =
  | 'favorite-upsert'
  | 'favorite-remove'
  | 'follow-upsert'
  | 'follow-remove'
  | 'bookmark-add'
  | 'bookmark-remove'
  | 'preferences-update'
  | 'reading-list-create'
  | 'reading-list-update'
  | 'reading-list-delete'
  | 'reading-list-add-item'
  | 'reading-list-remove-item';

interface PendingFavoriteSyncPayload {
  favorite: Favorite;
}

interface PendingFavoriteRemovePayload {
  mangaId: string;
}

interface PendingFollowSyncPayload {
  mangaId: string;
}

interface PendingBookmarkSyncPayload {
  bookmark: Bookmark;
}

interface PendingPreferencesSyncPayload {
  preferences: AppUser['preferences'];
}

interface PendingReadingListCreatePayload {
  list: CachedReadingList;
}

interface PendingReadingListUpdatePayload {
  listId: string;
  updates: Partial<Pick<ReadingList, 'name' | 'description' | 'imageUrl' | 'isPublic'>>;
}

interface PendingReadingListDeletePayload {
  listId: string;
}

interface PendingReadingListItemPayload {
  listId: string;
  mangaId: string;
}

type PendingUserSyncPayload =
  | PendingFavoriteSyncPayload
  | PendingFavoriteRemovePayload
  | PendingFollowSyncPayload
  | PendingBookmarkSyncPayload
  | PendingPreferencesSyncPayload
  | PendingReadingListCreatePayload
  | PendingReadingListUpdatePayload
  | PendingReadingListDeletePayload
  | PendingReadingListItemPayload;

interface PendingUserSyncOperation {
  id: string;
  userId: string;
  type: PendingUserSyncType;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  payload: PendingUserSyncPayload;
}

interface OfflineUserCache {
  favoritesInitialized: boolean;
  favorites: Favorite[];
  followsInitialized: boolean;
  follows: string[];
  bookmarksInitialized: boolean;
  bookmarks: Bookmark[];
  preferencesInitialized: boolean;
  preferences?: AppUser['preferences'];
  readingListsInitialized: boolean;
  readingLists: CachedReadingList[];
}

interface OfflineUserSyncStore {
  users: Record<string, OfflineUserCache>;
  operations: PendingUserSyncOperation[];
}

const DEFAULT_STORE: OfflineUserSyncStore = {
  users: {},
  operations: [],
};

const DEFAULT_USER_CACHE: OfflineUserCache = {
  favoritesInitialized: false,
  favorites: [],
  followsInitialized: false,
  follows: [],
  bookmarksInitialized: false,
  bookmarks: [],
  preferencesInitialized: false,
  preferences: undefined,
  readingListsInitialized: false,
  readingLists: [],
};

let initialized = false;
let flushInFlight: Promise<void> | null = null;

const canUseStorage = () => typeof window !== 'undefined';

const emitOfflineUserSyncChange = () => {
  if (!canUseStorage()) {
    return;
  }

  window.dispatchEvent(new Event(OFFLINE_USER_SYNC_EVENT));
};

const cloneFavorite = (favorite: Favorite): Favorite => ({
  ...favorite,
  category: favorite.category,
});

const cloneBookmark = (bookmark: Bookmark): Bookmark => ({
  ...bookmark,
});

const cloneReadingList = (list: CachedReadingList): CachedReadingList => ({
  ...list,
  mangaIds: [...list.mangaIds],
});

const cloneUserCache = (cache: OfflineUserCache): OfflineUserCache => ({
  favoritesInitialized: cache.favoritesInitialized,
  favorites: cache.favorites.map(cloneFavorite),
  followsInitialized: cache.followsInitialized,
  follows: [...cache.follows],
  bookmarksInitialized: cache.bookmarksInitialized,
  bookmarks: cache.bookmarks.map(cloneBookmark),
  preferencesInitialized: cache.preferencesInitialized,
  preferences: cache.preferences ? JSON.parse(JSON.stringify(cache.preferences)) : undefined,
  readingListsInitialized: cache.readingListsInitialized,
  readingLists: cache.readingLists.map(cloneReadingList),
});

const getStore = (): OfflineUserSyncStore => {
  if (!canUseStorage()) {
    return DEFAULT_STORE;
  }

  const raw = window.localStorage.getItem(OFFLINE_USER_SYNC_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_STORE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OfflineUserSyncStore>;
    return {
      users: parsed.users || {},
      operations: Array.isArray(parsed.operations) ? parsed.operations : [],
    };
  } catch {
    return DEFAULT_STORE;
  }
};

const setStore = (store: OfflineUserSyncStore) => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(OFFLINE_USER_SYNC_STORAGE_KEY, JSON.stringify(store));
  emitOfflineUserSyncChange();
};

const readUserCache = (userId: string): OfflineUserCache =>
  cloneUserCache(getStore().users[userId] || DEFAULT_USER_CACHE);

const writeUserCache = (userId: string, cache: OfflineUserCache) => {
  const store = getStore();
  store.users[userId] = cloneUserCache(cache);
  setStore(store);
};

const updateUserCache = (userId: string, updater: (cache: OfflineUserCache) => OfflineUserCache) => {
  const current = readUserCache(userId);
  writeUserCache(userId, updater(current));
};

const pushPendingOperation = (operation: PendingUserSyncOperation) => {
  const store = getStore();
  store.operations = [...store.operations, operation];
  setStore(store);
};

const updatePendingOperation = (operationId: string, updater: (operation: PendingUserSyncOperation) => PendingUserSyncOperation) => {
  const store = getStore();
  store.operations = store.operations.map((operation) => (
    operation.id === operationId ? updater(operation) : operation
  ));
  setStore(store);
};

const removePendingOperation = (operationId: string) => {
  const store = getStore();
  store.operations = store.operations.filter((operation) => operation.id !== operationId);
  setStore(store);
};

const buildOperationId = (type: PendingUserSyncType, userId: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${type}:${userId}:${crypto.randomUUID()}`;
  }

  return `${type}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
};

const createOperation = (
  userId: string,
  type: PendingUserSyncType,
  payload: PendingUserSyncPayload,
): PendingUserSyncOperation => {
  const now = new Date().toISOString();

  return {
    id: buildOperationId(type, userId),
    userId,
    type,
    payload,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };
};

const normalizeFavoriteOrder = (favorites: Favorite[]) => (
  [...favorites].sort((left, right) => {
    const leftTime = new Date(left.addedAt || 0).getTime();
    const rightTime = new Date(right.addedAt || 0).getTime();
    return rightTime - leftTime;
  })
);

const normalizeBookmarkOrder = (bookmarks: Bookmark[]) => (
  [...bookmarks].sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime();
    const rightTime = new Date(right.createdAt || 0).getTime();
    return rightTime - leftTime;
  })
);

export const isEffectivelyOnline = () => {
  if (typeof navigator === 'undefined') {
    return true;
  }

  return navigator.onLine && !getOfflinePreferences().forceOfflineMode;
};

export const createClientEntityId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const getCachedFavoritesState = (userId: string) => readUserCache(userId).favorites;

export const areFavoritesInitialized = (userId: string) => readUserCache(userId).favoritesInitialized;

export const setCachedFavorites = (userId: string, favorites: Favorite[]) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    favoritesInitialized: true,
    favorites: normalizeFavoriteOrder(favorites),
  }));
};

export const upsertCachedFavorite = (userId: string, favorite: Favorite) => {
  updateUserCache(userId, (cache) => {
    const nextFavorites = cache.favorites.filter((entry) => entry.mangaId !== favorite.mangaId);
    nextFavorites.unshift(cloneFavorite(favorite));

    return {
      ...cache,
      favoritesInitialized: true,
      favorites: normalizeFavoriteOrder(nextFavorites),
    };
  });
};

export const removeCachedFavorite = (userId: string, mangaId: string) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    favoritesInitialized: true,
    favorites: cache.favorites.filter((entry) => entry.mangaId !== mangaId),
  }));
};

export const queueFavoriteUpsert = (userId: string, favorite: Favorite) => {
  pushPendingOperation(createOperation(userId, 'favorite-upsert', { favorite }));
};

export const queueFavoriteRemove = (userId: string, mangaId: string) => {
  pushPendingOperation(createOperation(userId, 'favorite-remove', { mangaId }));
};

export const getCachedFollowedMangaIds = (userId: string) => readUserCache(userId).follows;

export const areFollowsInitialized = (userId: string) => readUserCache(userId).followsInitialized;

export const setCachedFollowedMangaIds = (userId: string, mangaIds: string[]) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    followsInitialized: true,
    follows: [...new Set(mangaIds)],
  }));
};

export const addCachedFollowedManga = (userId: string, mangaId: string) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    followsInitialized: true,
    follows: cache.follows.includes(mangaId) ? cache.follows : [...cache.follows, mangaId],
  }));
};

export const removeCachedFollowedManga = (userId: string, mangaId: string) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    followsInitialized: true,
    follows: cache.follows.filter((entry) => entry !== mangaId),
  }));
};

export const queueFollowUpsert = (userId: string, mangaId: string) => {
  pushPendingOperation(createOperation(userId, 'follow-upsert', { mangaId }));
};

export const queueFollowRemove = (userId: string, mangaId: string) => {
  pushPendingOperation(createOperation(userId, 'follow-remove', { mangaId }));
};

export const getCachedBookmarksState = (userId: string) => readUserCache(userId).bookmarks;

export const areBookmarksInitialized = (userId: string) => readUserCache(userId).bookmarksInitialized;

export const setCachedBookmarks = (userId: string, bookmarks: Bookmark[]) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    bookmarksInitialized: true,
    bookmarks: normalizeBookmarkOrder(bookmarks),
  }));
};

export const addCachedBookmark = (userId: string, bookmark: Bookmark) => {
  updateUserCache(userId, (cache) => {
    const existing = cache.bookmarks.find(
      (entry) => entry.mangaId === bookmark.mangaId
        && entry.chapterId === bookmark.chapterId
        && entry.page === bookmark.page,
    );

    if (existing) {
      return cache;
    }

    return {
      ...cache,
      bookmarksInitialized: true,
      bookmarks: normalizeBookmarkOrder([cloneBookmark(bookmark), ...cache.bookmarks]),
    };
  });
};

export const removeCachedBookmark = (userId: string, bookmarkId: string) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    bookmarksInitialized: true,
    bookmarks: cache.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
  }));
};

export const findCachedBookmark = (userId: string, bookmarkId: string) =>
  readUserCache(userId).bookmarks.find((bookmark) => bookmark.id === bookmarkId);

export const queueBookmarkAdd = (userId: string, bookmark: Bookmark) => {
  pushPendingOperation(createOperation(userId, 'bookmark-add', { bookmark }));
};

export const queueBookmarkRemove = (userId: string, bookmark: Bookmark) => {
  pushPendingOperation(createOperation(userId, 'bookmark-remove', { bookmark }));
};

export const getCachedPreferencesForUser = (userId: string) => readUserCache(userId).preferences;

export const setCachedPreferencesForUser = (userId: string, preferences: AppUser['preferences']) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    preferencesInitialized: true,
    preferences: preferences ? JSON.parse(JSON.stringify(preferences)) : preferences,
  }));
};

export const queuePreferencesUpdate = (userId: string, preferences: AppUser['preferences']) => {
  pushPendingOperation(createOperation(userId, 'preferences-update', { preferences }));
};

export const getCachedReadingListsState = (userId: string) => readUserCache(userId).readingLists;

export const areReadingListsInitialized = (userId: string) => readUserCache(userId).readingListsInitialized;

export const setCachedReadingLists = (userId: string, lists: CachedReadingList[]) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    readingListsInitialized: true,
    readingLists: lists.map(cloneReadingList),
  }));
};

export const upsertCachedReadingList = (userId: string, list: CachedReadingList) => {
  updateUserCache(userId, (cache) => {
    const nextLists = cache.readingLists.filter((entry) => entry.id !== list.id);
    nextLists.unshift(cloneReadingList(list));

    return {
      ...cache,
      readingListsInitialized: true,
      readingLists: nextLists,
    };
  });
};

export const removeCachedReadingList = (userId: string, listId: string) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    readingListsInitialized: true,
    readingLists: cache.readingLists.filter((list) => list.id !== listId),
  }));
};

export const getCachedReadingListRecord = (userId: string, listId: string) =>
  readUserCache(userId).readingLists.find((list) => list.id === listId);

export const findCachedReadingListRecord = (listId: string) => {
  const store = getStore();

  for (const [userId, cache] of Object.entries(store.users)) {
    const list = (cache.readingLists || []).find((entry) => entry.id === listId);
    if (list) {
      return {
        userId,
        list: cloneReadingList(list),
      };
    }
  }

  return undefined;
};

export const updateCachedReadingList = (
  userId: string,
  listId: string,
  updater: (list: CachedReadingList) => CachedReadingList,
) => {
  updateUserCache(userId, (cache) => ({
    ...cache,
    readingListsInitialized: true,
    readingLists: cache.readingLists.map((list) => (
      list.id === listId ? cloneReadingList(updater(list)) : list
    )),
  }));
};

export const queueReadingListCreate = (userId: string, list: CachedReadingList) => {
  pushPendingOperation(createOperation(userId, 'reading-list-create', { list }));
};

export const queueReadingListUpdate = (
  userId: string,
  listId: string,
  updates: Partial<Pick<ReadingList, 'name' | 'description' | 'imageUrl' | 'isPublic'>>,
) => {
  pushPendingOperation(createOperation(userId, 'reading-list-update', { listId, updates }));
};

export const queueReadingListDelete = (userId: string, listId: string) => {
  pushPendingOperation(createOperation(userId, 'reading-list-delete', { listId }));
};

export const queueReadingListAddItem = (userId: string, listId: string, mangaId: string) => {
  pushPendingOperation(createOperation(userId, 'reading-list-add-item', { listId, mangaId }));
};

export const queueReadingListRemoveItem = (userId: string, listId: string, mangaId: string) => {
  pushPendingOperation(createOperation(userId, 'reading-list-remove-item', { listId, mangaId }));
};

export const mapCachedReadingListToReadingList = (list: CachedReadingList): ReadingList => ({
  id: list.id,
  userId: list.userId,
  name: list.name,
  description: list.description,
  imageUrl: list.imageUrl,
  isPublic: list.isPublic,
  createdAt: list.createdAt,
});

const syncFavoriteUpsert = async (operation: PendingUserSyncOperation) => {
  const { favorite } = operation.payload as PendingFavoriteSyncPayload;
  await supabase.from('favorites').upsert({
    user_id: operation.userId,
    manga_id: favorite.mangaId,
    category: favorite.category,
    added_at: favorite.addedAt || new Date().toISOString(),
  });
};

const syncFavoriteRemove = async (operation: PendingUserSyncOperation) => {
  const { mangaId } = operation.payload as PendingFavoriteRemovePayload;
  await supabase
    .from('favorites')
    .delete()
    .eq('user_id', operation.userId)
    .eq('manga_id', mangaId);
};

const syncFollowUpsert = async (operation: PendingUserSyncOperation) => {
  const { mangaId } = operation.payload as PendingFollowSyncPayload;
  await supabase.from('follows').upsert({
    user_id: operation.userId,
    manga_id: mangaId,
  });
};

const syncFollowRemove = async (operation: PendingUserSyncOperation) => {
  const { mangaId } = operation.payload as PendingFollowSyncPayload;
  await supabase
    .from('follows')
    .delete()
    .eq('user_id', operation.userId)
    .eq('manga_id', mangaId);
};

const syncBookmarkAdd = async (operation: PendingUserSyncOperation) => {
  const { bookmark } = operation.payload as PendingBookmarkSyncPayload;
  const { data: existing, error: existingError } = await supabase
    .from('bookmarks')
    .select('id')
    .eq('user_id', operation.userId)
    .eq('manga_id', bookmark.mangaId)
    .eq('chapter_id', bookmark.chapterId)
    .eq('page', bookmark.page)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing?.id) {
    return;
  }

  const { error } = await supabase.from('bookmarks').insert({
    id: bookmark.id,
    user_id: operation.userId,
    manga_id: bookmark.mangaId,
    chapter_id: bookmark.chapterId,
    chapter_number: bookmark.chapterNumber,
    page: bookmark.page,
    note: bookmark.note,
    created_at: bookmark.createdAt || new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
};

const syncBookmarkRemove = async (operation: PendingUserSyncOperation) => {
  const { bookmark } = operation.payload as PendingBookmarkSyncPayload;
  const baseQuery = supabase
    .from('bookmarks')
    .delete()
    .eq('user_id', operation.userId);

  if (bookmark.id) {
    const { error } = await baseQuery.eq('id', bookmark.id);
    if (!error) {
      return;
    }
  }

  const { error } = await supabase
    .from('bookmarks')
    .delete()
    .eq('user_id', operation.userId)
    .eq('manga_id', bookmark.mangaId)
    .eq('chapter_id', bookmark.chapterId)
    .eq('page', bookmark.page);

  if (error) {
    throw error;
  }
};

const syncPreferencesUpdate = async (operation: PendingUserSyncOperation) => {
  const { preferences } = operation.payload as PendingPreferencesSyncPayload;
  const { error } = await supabase
    .from('users')
    .update({ preferences })
    .eq('id', operation.userId);

  if (error) {
    throw error;
  }
};

const syncReadingListCreate = async (operation: PendingUserSyncOperation) => {
  const { list } = operation.payload as PendingReadingListCreatePayload;
  const { error } = await supabase
    .from('reading_lists')
    .upsert({
      id: list.id,
      user_id: operation.userId,
      name: list.name,
      description: list.description,
      image_url: list.imageUrl,
      is_public: list.isPublic,
      created_at: list.createdAt,
    });

  if (error) {
    throw error;
  }
};

const syncReadingListUpdate = async (operation: PendingUserSyncOperation) => {
  const { listId, updates } = operation.payload as PendingReadingListUpdatePayload;
  const { error } = await supabase
    .from('reading_lists')
    .update({
      name: updates.name,
      description: updates.description,
      image_url: updates.imageUrl,
      is_public: updates.isPublic,
    })
    .eq('id', listId)
    .eq('user_id', operation.userId);

  if (error) {
    throw error;
  }
};

const syncReadingListDelete = async (operation: PendingUserSyncOperation) => {
  const { listId } = operation.payload as PendingReadingListDeletePayload;
  const { error } = await supabase
    .from('reading_lists')
    .delete()
    .eq('id', listId)
    .eq('user_id', operation.userId);

  if (error) {
    throw error;
  }
};

const syncReadingListAddItem = async (operation: PendingUserSyncOperation) => {
  const { listId, mangaId } = operation.payload as PendingReadingListItemPayload;
  const { error } = await supabase
    .from('reading_list_items')
    .upsert({
      list_id: listId,
      manga_id: mangaId,
    }, { onConflict: 'list_id,manga_id' });

  if (error) {
    throw error;
  }
};

const syncReadingListRemoveItem = async (operation: PendingUserSyncOperation) => {
  const { listId, mangaId } = operation.payload as PendingReadingListItemPayload;
  const { error } = await supabase
    .from('reading_list_items')
    .delete()
    .eq('list_id', listId)
    .eq('manga_id', mangaId);

  if (error) {
    throw error;
  }
};

const syncOperation = async (operation: PendingUserSyncOperation) => {
  switch (operation.type) {
    case 'favorite-upsert':
      await syncFavoriteUpsert(operation);
      return;
    case 'favorite-remove':
      await syncFavoriteRemove(operation);
      return;
    case 'follow-upsert':
      await syncFollowUpsert(operation);
      return;
    case 'follow-remove':
      await syncFollowRemove(operation);
      return;
    case 'bookmark-add':
      await syncBookmarkAdd(operation);
      return;
    case 'bookmark-remove':
      await syncBookmarkRemove(operation);
      return;
    case 'preferences-update':
      await syncPreferencesUpdate(operation);
      return;
    case 'reading-list-create':
      await syncReadingListCreate(operation);
      return;
    case 'reading-list-update':
      await syncReadingListUpdate(operation);
      return;
    case 'reading-list-delete':
      await syncReadingListDelete(operation);
      return;
    case 'reading-list-add-item':
      await syncReadingListAddItem(operation);
      return;
    case 'reading-list-remove-item':
      await syncReadingListRemoveItem(operation);
      return;
    default:
      return;
  }
};

export const flushPendingUserSync = async () => {
  if (!isEffectivelyOnline()) {
    return;
  }

  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async () => {
    const operations = [...getStore().operations]
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    for (const operation of operations) {
      try {
        await syncOperation(operation);
        removePendingOperation(operation.id);
      } catch (error) {
        console.error('Offline user sync flush error:', error);
        updatePendingOperation(operation.id, (current) => ({
          ...current,
          attempts: current.attempts + 1,
          updatedAt: new Date().toISOString(),
        }));
        break;
      }
    }
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
};

export const initializeOfflineUserSync = () => {
  if (initialized || !canUseStorage()) {
    return;
  }

  initialized = true;

  const handleMaybeFlush = () => {
    if (!isEffectivelyOnline()) {
      return;
    }

    void flushPendingUserSync();
  };

  window.addEventListener('online', handleMaybeFlush);
  subscribeOfflinePreferences(handleMaybeFlush);
  void flushPendingUserSync();
};
