import { User, Favorite, ReadingProgress, Bookmark, ReaderSettings } from './types';

const STORAGE_KEYS = {
  USER: 'manga_user',
  FAVORITES: 'manga_favorites',
  READING_PROGRESS: 'manga_reading_progress',
  BOOKMARKS: 'manga_bookmarks',
  READER_SETTINGS: 'manga_reader_settings',
};

// User Management
export const getUser = (): User | null => {
  const data = localStorage.getItem(STORAGE_KEYS.USER);
  return data ? JSON.parse(data) : null;
};

export const setUser = (user: User): void => {
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
};

export const removeUser = (): void => {
  localStorage.removeItem(STORAGE_KEYS.USER);
};

// Favorites
export const getFavorites = (): Favorite[] => {
  const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
  return data ? JSON.parse(data) : [];
};

export const addFavorite = (mangaId: string): void => {
  const favorites = getFavorites();
  if (!favorites.find(f => f.mangaId === mangaId)) {
    favorites.push({ mangaId, addedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
  }
};

export const removeFavorite = (mangaId: string): void => {
  const favorites = getFavorites().filter(f => f.mangaId !== mangaId);
  localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
};

export const isFavorite = (mangaId: string): boolean => {
  return getFavorites().some(f => f.mangaId === mangaId);
};

// Reading Progress
export const getReadingProgress = (): ReadingProgress[] => {
  const data = localStorage.getItem(STORAGE_KEYS.READING_PROGRESS);
  return data ? JSON.parse(data) : [];
};

export const updateReadingProgress = (progress: Omit<ReadingProgress, 'lastRead'>): void => {
  const allProgress = getReadingProgress();
  const existingIndex = allProgress.findIndex(
    p => p.mangaId === progress.mangaId && p.chapterId === progress.chapterId
  );
  
  const newProgress: ReadingProgress = {
    ...progress,
    lastRead: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    allProgress[existingIndex] = newProgress;
  } else {
    allProgress.push(newProgress);
  }

  localStorage.setItem(STORAGE_KEYS.READING_PROGRESS, JSON.stringify(allProgress));
};

export const getLatestProgress = (mangaId: string): ReadingProgress | undefined => {
  return getReadingProgress()
    .filter(p => p.mangaId === mangaId)
    .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime())[0];
};

export const getReadingHistory = (): ReadingProgress[] => {
  return getReadingProgress()
    .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime());
};

// Bookmarks
export const getBookmarks = (): Bookmark[] => {
  const data = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
  return data ? JSON.parse(data) : [];
};

export const addBookmark = (bookmark: Omit<Bookmark, 'id' | 'createdAt'>): void => {
  const bookmarks = getBookmarks();
  bookmarks.push({
    ...bookmark,
    id: `bookmark-${Date.now()}`,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
};

export const removeBookmark = (id: string): void => {
  const bookmarks = getBookmarks().filter(b => b.id !== id);
  localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
};

export const getBookmarksForManga = (mangaId: string): Bookmark[] => {
  return getBookmarks().filter(b => b.mangaId === mangaId);
};

// Reader Settings
export const getReaderSettings = (): ReaderSettings => {
  const data = localStorage.getItem(STORAGE_KEYS.READER_SETTINGS);
  return data ? JSON.parse(data) : {
    mode: 'vertical',
    fitWidth: true,
    showProgress: true,
  };
};

export const setReaderSettings = (settings: ReaderSettings): void => {
  localStorage.setItem(STORAGE_KEYS.READER_SETTINGS, JSON.stringify(settings));
};
