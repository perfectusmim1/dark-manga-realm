import { User, Favorite, ReadingProgress, Bookmark, ReaderSettings, LibraryCategory, Notification, MangaFollow } from './types';
import { supabase } from './supabase';

const STORAGE_KEYS = {
    READER_SETTINGS: 'manga_reader_settings',
    // We still keep local reader settings because they are device-specific and often don't need to be in DB
};

// ==================== FAVORITES (USER-SPECIFIC) ====================

export const getFavorites = async (userId: string): Promise<Favorite[]> => {
    const { data, error } = await supabase
        .from('favorites')
        .select(`
            *,
            manga:mangas (*)
        `)
        .eq('user_id', userId);

    if (error) return [];
    return data.map(f => ({
        userId: f.user_id,
        mangaId: f.manga_id,
        category: f.category as LibraryCategory,
        addedAt: f.added_at,
        mangaTitle: f.manga?.title,
        mangaCover: f.manga?.cover
    }));
};

export const addFavorite = async (userId: string, mangaId: string, category: LibraryCategory = 'reading'): Promise<void> => {
    await supabase.from('favorites').upsert({
        user_id: userId,
        manga_id: mangaId,
        category,
        added_at: new Date().toISOString()
    });
};

export const updateFavoriteCategory = async (userId: string, mangaId: string, category: LibraryCategory): Promise<void> => {
    await supabase
        .from('favorites')
        .update({ category })
        .eq('user_id', userId)
        .eq('manga_id', mangaId);
};

export const removeFavorite = async (userId: string, mangaId: string): Promise<void> => {
    await supabase
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('manga_id', mangaId);
};

export const isFavorite = async (userId: string, mangaId: string): Promise<boolean> => {
    const { count } = await supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('manga_id', mangaId);
    return !!count;
};

// ==================== READING PROGRESS (USER-SPECIFIC) ====================

export const getReadingHistory = async (userId: string): Promise<ReadingProgress[]> => {
    const { data, error } = await supabase
        .from('reading_progress')
        .select(`
            *,
            manga:mangas (*)
        `)
        .eq('user_id', userId)
        .order('last_read', { ascending: false });

    if (error) return [];
    return data.map(p => ({
        userId: p.user_id,
        mangaId: p.manga_id,
        chapterId: p.chapter_id,
        chapterNumber: Number(p.chapter_number),
        page: p.page,
        lastRead: p.last_read,
        mangaTitle: p.manga?.title,
        mangaCover: p.manga?.cover
    }));
};

export const updateReadingProgress = async (userId: string, progress: Omit<ReadingProgress, 'lastRead' | 'userId'>): Promise<void> => {
    await supabase.from('reading_progress').upsert({
        user_id: userId,
        manga_id: progress.mangaId,
        chapter_id: progress.chapterId,
        chapter_number: progress.chapterNumber,
        page: progress.page,
        last_read: new Date().toISOString()
    }, { onConflict: 'user_id,manga_id' });
};

export const getLatestProgress = async (userId: string, mangaId: string): Promise<ReadingProgress | undefined> => {
    const { data, error } = await supabase
        .from('reading_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('manga_id', mangaId)
        .maybeSingle();

    if (error || !data) return undefined;
    return {
        ...data,
        userId: data.user_id,
        mangaId: data.manga_id,
        chapterId: data.chapter_id,
        chapterNumber: Number(data.chapter_number),
        lastRead: data.last_read
    };
};

export const removeFromHistory = async (userId: string, mangaId: string): Promise<void> => {
    await supabase.from('reading_progress').delete().eq('user_id', userId).eq('manga_id', mangaId);
};

// ==================== BOOKMARKS (USER-SPECIFIC) ====================

export const getBookmarks = async (userId: string): Promise<Bookmark[]> => {
    const { data } = await supabase.from('bookmarks').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return (data || []).map(b => ({
        ...b,
        userId: b.user_id,
        mangaId: b.manga_id,
        chapterId: b.chapter_id,
        chapterNumber: Number(b.chapter_number),
        createdAt: b.created_at
    }));
};

export const addBookmark = async (userId: string, bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'userId'>): Promise<void> => {
    await supabase.from('bookmarks').insert({
        user_id: userId,
        manga_id: bookmark.mangaId,
        chapter_id: bookmark.chapterId,
        chapter_number: bookmark.chapterNumber,
        page: bookmark.page,
        note: bookmark.note,
        created_at: new Date().toISOString()
    });
};

export const removeBookmark = async (userId: string, id: string): Promise<void> => {
    await supabase.from('bookmarks').delete().eq('id', id).eq('user_id', userId);
};

// ==================== READER SETTINGS (KEEP LOCAL) ====================

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

// ==================== NOTIFICATIONS ====================

export const getNotifications = async (userId: string): Promise<Notification[]> => {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return (data || []).map(n => ({
        ...n,
        userId: n.user_id,
        mangaId: n.manga_id,
        chapterId: n.chapter_id,
        chapterNumber: Number(n.chapter_number),
        createdAt: n.created_at,
        fromUserId: n.from_user_id
    }));
};

export const markNotificationAsRead = async (userId: string, id: string): Promise<void> => {
    await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', userId);
};

export const getUnreadNotificationCount = async (userId: string): Promise<number> => {
    const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

    if (error) return 0;
    return count || 0;
};

export const markAllNotificationsAsRead = async (userId: string): Promise<void> => {
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId);
};

export const clearNotifications = async (userId: string): Promise<void> => {
    await supabase.from('notifications').delete().eq('user_id', userId);
};

// ==================== FOLLOWS ====================

export const followManga = async (userId: string, mangaId: string): Promise<void> => {
    await supabase.from('follows').upsert({ user_id: userId, manga_id: mangaId });
};

export const unfollowManga = async (userId: string, mangaId: string): Promise<void> => {
    await supabase.from('follows').delete().eq('user_id', userId).eq('manga_id', mangaId);
};

export const isFollowingManga = async (userId: string, mangaId: string): Promise<boolean> => {
    const { count } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('manga_id', mangaId);
    return !!count;
};

// Legacy auth functions - these are now in AuthContext but some components might still call them
export const getUserLocal = (): any => {
    const data = localStorage.getItem('manga_user');
    return data ? JSON.parse(data) : null;
};

export const createCommentNotification = async (
    targetUserId: string,
    type: 'reply' | 'like',
    fromUserId: string,
    fromUsername: string,
    entityId: string,
    entityTitle: string,
    commentId: string,
    chapterId?: string,
    entityType: string = 'manga'
) => {
    // Check user preferences
    const { data: userData } = await supabase
        .from('users')
        .select('preferences')
        .eq('id', targetUserId)
        .single();

    const prefs = userData?.preferences;
    if (type === 'reply' && prefs?.notifications?.replies === false) return;
    if (type === 'like' && prefs?.notifications?.likes === false) return;

    const title = type === 'reply' ? 'Yeni Yanıt' : 'Yorum Beğenisi';
    const message = type === 'reply'
        ? `${fromUsername} ${entityTitle} yorumunuza yanıt verdi.`
        : `${fromUsername} ${entityTitle} yorumunuzu beğendi.`;

    const link = entityType === 'manga'
        ? (chapterId ? `/manga/${entityId}/chapter/${chapterId}#comment-${commentId}` : `/manga/${entityId}#comment-${commentId}`)
        : `/${entityType}/${entityId}#comment-${commentId}`;

    const { error } = await supabase.from('notifications').insert({
        user_id: targetUserId,
        type,
        title,
        message,
        from_user_id: fromUserId,
        from_username: fromUsername,
        link,
        read: false,
        created_at: new Date().toISOString()
    });

    if (error) console.error('Notification error:', error);
};

export const createNotificationForFollowers = async (
    mangaId: string,
    mangaTitle: string,
    mangaCover: string,
    chapterId: string,
    chapterNumber: number
) => {
    try {
        // Get all followers for this manga
        const { data: followers, error: followError } = await supabase
            .from('follows')
            .select('user_id')
            .eq('manga_id', mangaId);

        if (followError || !followers || followers.length === 0) {
            if (followError) console.error('Follower fetch error:', followError);
            return;
        }

        // Get user preferences for each follower
        const userIds = followers.map(f => f.user_id);
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id, preferences')
            .in('id', userIds);

        if (usersError) {
            console.error('User preferences fetch error:', usersError);
            return;
        }

        // Create a map of user preferences
        const userPrefsMap = new Map<string, any>();
        usersData?.forEach(u => {
            userPrefsMap.set(u.id, u.preferences);
        });

        // Filter followers who want new chapter notifications
        const activeFollowers = followers.filter(f => {
            const prefs = userPrefsMap.get(f.user_id);
            return prefs?.notifications?.new_chapter !== false;
        });

        if (activeFollowers.length === 0) return;

        // Create notifications for each active follower
        const notifications = activeFollowers.map(f => ({
            user_id: f.user_id,
            type: 'new_chapter',
            title: 'Yeni Bölüm',
            message: `${mangaTitle} - Bölüm ${chapterNumber} yayınlandı.`,
            manga_id: mangaId,
            chapter_id: chapterId,
            link: `/manga/${mangaId}/chapter/${chapterId}`,
            read: false,
            created_at: new Date().toISOString()
        }));

        const { error } = await supabase.from('notifications').insert(notifications);
        if (error) console.error('Follower notification error:', error);
    } catch (err) {
        console.error('createNotificationForFollowers error:', err);
    }
};

// ==================== ADMIN SESSION (LOCAL) ====================

export const getAdminSession = () => {
    const data = localStorage.getItem('manga_admin_session');
    return data ? JSON.parse(data) : null;
};

export const setAdminSession = (session: any) => {
    localStorage.setItem('manga_admin_session', JSON.stringify(session));
};

export const removeAdminSession = () => {
    localStorage.removeItem('manga_admin_session');
};

