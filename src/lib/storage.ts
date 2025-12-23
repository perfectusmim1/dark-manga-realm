import { User, Favorite, ReadingProgress, Bookmark, ReaderSettings, LibraryCategory, Notification } from './types';
import { getMangaById } from './database';

const STORAGE_KEYS = {
    USER: 'manga_user',
    FAVORITES: 'manga_favorites',
    READING_PROGRESS: 'manga_reading_progress',
    BOOKMARKS: 'manga_bookmarks',
    READER_SETTINGS: 'manga_reader_settings',
    NOTIFICATIONS: 'manga_notifications',
    ADMIN_SESSION: 'manga_admin_session',
};

// ==================== USER MANAGEMENT ====================

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

// ==================== ADMIN SESSION ====================

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

// ==================== FAVORITES (USER-SPECIFIC) ====================

const getAllFavorites = (): Favorite[] => {
    const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
    return data ? JSON.parse(data) : [];
};

const saveFavorites = (favorites: Favorite[]): void => {
    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
};

export const getFavorites = (userId?: string): Favorite[] => {
    const user = getUser();
    const currentUserId = userId || user?.id;
    if (!currentUserId) return [];

    return getAllFavorites().filter(f => f.userId === currentUserId);
};

export const addFavorite = (mangaId: string, category: LibraryCategory = 'reading'): void => {
    const user = getUser();
    if (!user) return;

    const allFavorites = getAllFavorites();
    if (!allFavorites.find(f => f.mangaId === mangaId && f.userId === user.id)) {
        allFavorites.push({
            userId: user.id,
            mangaId,
            addedAt: new Date().toISOString(),
            category
        });
        saveFavorites(allFavorites);
    }
};

export const updateFavoriteCategory = (mangaId: string, category: LibraryCategory): void => {
    const user = getUser();
    if (!user) return;

    const allFavorites = getAllFavorites();
    const index = allFavorites.findIndex(f => f.mangaId === mangaId && f.userId === user.id);
    if (index >= 0) {
        allFavorites[index].category = category;
        saveFavorites(allFavorites);
    }
};

export const removeFavorite = (mangaId: string): void => {
    const user = getUser();
    if (!user) return;

    const allFavorites = getAllFavorites().filter(
        f => !(f.mangaId === mangaId && f.userId === user.id)
    );
    saveFavorites(allFavorites);
};

export const isFavorite = (mangaId: string): boolean => {
    const user = getUser();
    if (!user) return false;

    return getAllFavorites().some(f => f.mangaId === mangaId && f.userId === user.id);
};

export const getFavoriteCategory = (mangaId: string): LibraryCategory | undefined => {
    const user = getUser();
    if (!user) return undefined;

    const favorite = getAllFavorites().find(f => f.mangaId === mangaId && f.userId === user.id);
    return favorite?.category;
};

export const getFavoritesByCategory = (category: LibraryCategory): Favorite[] => {
    const user = getUser();
    if (!user) return [];

    return getAllFavorites().filter(f => f.category === category && f.userId === user.id);
};

// ==================== READING PROGRESS (USER-SPECIFIC) ====================

const getAllReadingProgress = (): ReadingProgress[] => {
    const data = localStorage.getItem(STORAGE_KEYS.READING_PROGRESS);
    return data ? JSON.parse(data) : [];
};

const saveReadingProgress = (progress: ReadingProgress[]): void => {
    localStorage.setItem(STORAGE_KEYS.READING_PROGRESS, JSON.stringify(progress));
};

export const getReadingProgress = (userId?: string): ReadingProgress[] => {
    const user = getUser();
    const currentUserId = userId || user?.id;
    if (!currentUserId) return [];

    return getAllReadingProgress().filter(p => p.userId === currentUserId);
};

export const updateReadingProgress = (progress: Omit<ReadingProgress, 'lastRead' | 'userId'>): void => {
    const user = getUser();
    if (!user) return;

    const allProgress = getAllReadingProgress();
    const existingIndex = allProgress.findIndex(
        p => p.mangaId === progress.mangaId && p.userId === user.id
    );

    const manga = getMangaById(progress.mangaId);

    const newProgress: ReadingProgress = {
        ...progress,
        userId: user.id,
        lastRead: new Date().toISOString(),
        mangaTitle: manga?.title,
        mangaCover: manga?.cover,
    };

    if (existingIndex >= 0) {
        allProgress[existingIndex] = newProgress;
    } else {
        allProgress.push(newProgress);
    }

    saveReadingProgress(allProgress);
};

export const getLatestProgress = (mangaId: string): ReadingProgress | undefined => {
    const user = getUser();
    if (!user) return undefined;

    return getAllReadingProgress()
        .filter(p => p.mangaId === mangaId && p.userId === user.id)
        .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime())[0];
};

export const getReadingHistory = (): ReadingProgress[] => {
    const user = getUser();
    if (!user) return [];

    return getAllReadingProgress()
        .filter(p => p.userId === user.id)
        .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime());
};

export const clearReadingHistory = (): void => {
    const user = getUser();
    if (!user) return;

    const allProgress = getAllReadingProgress().filter(p => p.userId !== user.id);
    saveReadingProgress(allProgress);
};

export const removeFromHistory = (mangaId: string): void => {
    const user = getUser();
    if (!user) return;

    const allProgress = getAllReadingProgress().filter(
        p => !(p.mangaId === mangaId && p.userId === user.id)
    );
    saveReadingProgress(allProgress);
};

// ==================== BOOKMARKS (USER-SPECIFIC) ====================

const getAllBookmarks = (): Bookmark[] => {
    const data = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
    return data ? JSON.parse(data) : [];
};

const saveBookmarks = (bookmarks: Bookmark[]): void => {
    localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
};

export const getBookmarks = (): Bookmark[] => {
    const user = getUser();
    if (!user) return [];

    return getAllBookmarks().filter(b => b.userId === user.id);
};

export const addBookmark = (bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'userId'>): void => {
    const user = getUser();
    if (!user) return;

    const allBookmarks = getAllBookmarks();
    allBookmarks.push({
        ...bookmark,
        id: `bookmark-${Date.now()}`,
        userId: user.id,
        createdAt: new Date().toISOString(),
    });
    saveBookmarks(allBookmarks);
};

export const removeBookmark = (id: string): void => {
    const user = getUser();
    if (!user) return;

    const allBookmarks = getAllBookmarks().filter(
        b => !(b.id === id && b.userId === user.id)
    );
    saveBookmarks(allBookmarks);
};

export const getBookmarksForManga = (mangaId: string): Bookmark[] => {
    const user = getUser();
    if (!user) return [];

    return getAllBookmarks().filter(b => b.mangaId === mangaId && b.userId === user.id);
};

// ==================== READER SETTINGS ====================

export const getReaderSettings = (): ReaderSettings => {
    const data = localStorage.getItem(STORAGE_KEYS.READER_SETTINGS);
    return data ? JSON.parse(data) : {
        mode: 'vertical',
        fitWidth: true,
        showProgress: true,
        backgroundColor: 'dark',
        preloadPages: 3,
        zoom: 100,
    };
};

export const setReaderSettings = (settings: ReaderSettings): void => {
    localStorage.setItem(STORAGE_KEYS.READER_SETTINGS, JSON.stringify(settings));
};

// ==================== NOTIFICATIONS (USER-SPECIFIC) ====================

const getAllNotifications = (): Notification[] => {
    const data = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    return data ? JSON.parse(data) : [];
};

const saveNotifications = (notifications: Notification[]): void => {
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications));
};

export const getNotifications = (): Notification[] => {
    const user = getUser();
    if (!user) return [];

    return getAllNotifications().filter(n => n.userId === user.id);
};

export const addNotification = (notification: Omit<Notification, 'id' | 'read' | 'createdAt' | 'userId'>): void => {
    const user = getUser();
    if (!user) return;

    const allNotifications = getAllNotifications();
    allNotifications.unshift({
        ...notification,
        id: `notif-${Date.now()}`,
        userId: user.id,
        read: false,
        createdAt: new Date().toISOString(),
    });

    if (allNotifications.length > 100) {
        allNotifications.pop();
    }
    saveNotifications(allNotifications);
};

export const markNotificationAsRead = (id: string): void => {
    const user = getUser();
    if (!user) return;

    const allNotifications = getAllNotifications();
    const index = allNotifications.findIndex(n => n.id === id && n.userId === user.id);
    if (index >= 0) {
        allNotifications[index].read = true;
        saveNotifications(allNotifications);
    }
};

export const markAllNotificationsAsRead = (): void => {
    const user = getUser();
    if (!user) return;

    const allNotifications = getAllNotifications().map(n =>
        n.userId === user.id ? { ...n, read: true } : n
    );
    saveNotifications(allNotifications);
};

export const getUnreadNotificationCount = (): number => {
    const user = getUser();
    if (!user) return 0;

    return getAllNotifications().filter(n => !n.read && n.userId === user.id).length;
};

export const clearNotifications = (): void => {
    const user = getUser();
    if (!user) return;

    const allNotifications = getAllNotifications().filter(n => n.userId !== user.id);
    saveNotifications(allNotifications);
};
