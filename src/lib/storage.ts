import { User, Favorite, ReadingProgress, Bookmark, ReaderSettings, LibraryCategory, Notification } from './types';
import { getMangaById } from './database';

const STORAGE_KEYS = {
  USER: 'manga_user',
  READER_SETTINGS: 'manga_reader_settings',
  ADMIN_SESSION: 'manga_admin_session',
};

// User-specific storage key generator
const getUserKey = (baseKey: string, userId: string): string => {
  return `${baseKey}_${userId}`;
};

// Get current user ID for data isolation
const getCurrentUserId = (): string | null => {
  const user = getUser();
  return user?.id || null;
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

// Admin Session
export const getAdminSession = (): { adminId: string; username: string; role: string } | null => {
  const data = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION);
  return data ? JSON.parse(data) : null;
};

export const setAdminSession = (session: { adminId: string; username: string; role: string }): void => {
  localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(session));
};

export const removeAdminSession = (): void => {
  localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
};

// ==================== USER-SPECIFIC DATA ====================

// Favorites with Categories (User-specific)
export const getFavorites = (): Favorite[] => {
  const userId = getCurrentUserId();
  if (!userId) return [];

  const data = localStorage.getItem(getUserKey('favorites', userId));
  return data ? JSON.parse(data) : [];
};

export const addFavorite = (mangaId: string, category: LibraryCategory = 'reading'): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const favorites = getFavorites();
  if (!favorites.find(f => f.mangaId === mangaId)) {
    favorites.push({ mangaId, addedAt: new Date().toISOString(), category });
    localStorage.setItem(getUserKey('favorites', userId), JSON.stringify(favorites));
  }
};

export const updateFavoriteCategory = (mangaId: string, category: LibraryCategory): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const favorites = getFavorites();
  const index = favorites.findIndex(f => f.mangaId === mangaId);
  if (index >= 0) {
    favorites[index].category = category;
    localStorage.setItem(getUserKey('favorites', userId), JSON.stringify(favorites));
  }
};

export const removeFavorite = (mangaId: string): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const favorites = getFavorites().filter(f => f.mangaId !== mangaId);
  localStorage.setItem(getUserKey('favorites', userId), JSON.stringify(favorites));
};

export const isFavorite = (mangaId: string): boolean => {
  return getFavorites().some(f => f.mangaId === mangaId);
};

export const getFavoriteCategory = (mangaId: string): LibraryCategory | undefined => {
  const favorite = getFavorites().find(f => f.mangaId === mangaId);
  return favorite?.category;
};

export const getFavoritesByCategory = (category: LibraryCategory): Favorite[] => {
  return getFavorites().filter(f => f.category === category);
};

// Reading Progress (User-specific)
export const getReadingProgress = (): ReadingProgress[] => {
  const userId = getCurrentUserId();
  if (!userId) return [];

  const data = localStorage.getItem(getUserKey('reading_progress', userId));
  return data ? JSON.parse(data) : [];
};

export const updateReadingProgress = (progress: Omit<ReadingProgress, 'lastRead'>): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const allProgress = getReadingProgress();
  const existingIndex = allProgress.findIndex(p => p.mangaId === progress.mangaId);

  // Get manga info for display
  const manga = getMangaById(progress.mangaId);

  const newProgress: ReadingProgress = {
    ...progress,
    lastRead: new Date().toISOString(),
    mangaTitle: manga?.title,
    mangaCover: manga?.cover,
  };

  if (existingIndex >= 0) {
    allProgress[existingIndex] = newProgress;
  } else {
    allProgress.push(newProgress);
  }

  localStorage.setItem(getUserKey('reading_progress', userId), JSON.stringify(allProgress));
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

export const clearReadingHistory = (): void => {
  const userId = getCurrentUserId();
  if (!userId) return;
  localStorage.removeItem(getUserKey('reading_progress', userId));
};

export const removeFromHistory = (mangaId: string): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const progress = getReadingProgress().filter(p => p.mangaId !== mangaId);
  localStorage.setItem(getUserKey('reading_progress', userId), JSON.stringify(progress));
};

// Bookmarks (User-specific)
export const getBookmarks = (): Bookmark[] => {
  const userId = getCurrentUserId();
  if (!userId) return [];

  const data = localStorage.getItem(getUserKey('bookmarks', userId));
  return data ? JSON.parse(data) : [];
};

export const addBookmark = (bookmark: Omit<Bookmark, 'id' | 'createdAt'>): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const bookmarks = getBookmarks();
  bookmarks.push({
    ...bookmark,
    id: `bookmark-${Date.now()}`,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(getUserKey('bookmarks', userId), JSON.stringify(bookmarks));
};

export const removeBookmark = (id: string): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const bookmarks = getBookmarks().filter(b => b.id !== id);
  localStorage.setItem(getUserKey('bookmarks', userId), JSON.stringify(bookmarks));
};

export const getBookmarksForManga = (mangaId: string): Bookmark[] => {
  return getBookmarks().filter(b => b.mangaId === mangaId);
};

// Reader Settings (Global - not user-specific)
export const getReaderSettings = (): ReaderSettings => {
  const data = localStorage.getItem(STORAGE_KEYS.READER_SETTINGS);
  return data ? JSON.parse(data) : {
    mode: 'vertical',
    fitWidth: true,
    showProgress: true,
    backgroundColor: 'dark',
    preloadPages: 3,
  };
};

export const setReaderSettings = (settings: ReaderSettings): void => {
  localStorage.setItem(STORAGE_KEYS.READER_SETTINGS, JSON.stringify(settings));
};

// Notifications (User-specific)
export const getNotifications = (): Notification[] => {
  const userId = getCurrentUserId();
  if (!userId) return [];

  const data = localStorage.getItem(getUserKey('notifications', userId));
  return data ? JSON.parse(data) : [];
};

export const addNotification = (notification: Omit<Notification, 'id' | 'read' | 'createdAt'>): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const notifications = getNotifications();
  notifications.unshift({
    ...notification,
    id: `notif-${Date.now()}`,
    read: false,
    createdAt: new Date().toISOString(),
  });
  // Keep only last 50 notifications
  if (notifications.length > 50) {
    notifications.pop();
  }
  localStorage.setItem(getUserKey('notifications', userId), JSON.stringify(notifications));
};

export const markNotificationAsRead = (id: string): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const notifications = getNotifications();
  const index = notifications.findIndex(n => n.id === id);
  if (index >= 0) {
    notifications[index].read = true;
    localStorage.setItem(getUserKey('notifications', userId), JSON.stringify(notifications));
  }
};

export const markAllNotificationsAsRead = (): void => {
  const userId = getCurrentUserId();
  if (!userId) return;

  const notifications = getNotifications().map(n => ({ ...n, read: true }));
  localStorage.setItem(getUserKey('notifications', userId), JSON.stringify(notifications));
};

export const getUnreadNotificationCount = (): number => {
  return getNotifications().filter(n => !n.read).length;
};

export const clearNotifications = (): void => {
  const userId = getCurrentUserId();
  if (!userId) return;
  localStorage.removeItem(getUserKey('notifications', userId));
};
