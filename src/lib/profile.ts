import { supabase } from './supabase';
import { User } from './types';
import { parseCommentContent, stripCommentFormatting } from './commentContent';
import { createFollowNotification } from './storage';

export type PrivacyVisibility = NonNullable<NonNullable<User['preferences']>['privacy']>['visibility'];

export const canAccessPrivacyScope = (
    visibility: PrivacyVisibility | undefined,
    ownerId: string,
    viewerId?: string,
    isMutualFollow: boolean = false
) => {
    if (viewerId && viewerId === ownerId) {
        return true;
    }

    const resolvedVisibility = visibility || 'public';

    if (resolvedVisibility === 'public') {
        return true;
    }

    if (resolvedVisibility === 'members') {
        return Boolean(viewerId);
    }

    if (resolvedVisibility === 'mutuals') {
        return Boolean(viewerId) && isMutualFollow;
    }

    return false;
};

const buildProfileSectionAccess = (
    privacy: NonNullable<User['preferences']>['privacy'] | undefined,
    ownerId: string,
    viewerId?: string,
    isMutualFollow: boolean = false
) => {
    const profile = canAccessPrivacyScope(privacy?.visibility, ownerId, viewerId, isMutualFollow);

    if (!profile) {
        return {
            profile: false,
            readingHistory: false,
            comments: false,
            readingLists: false,
            tierLists: false,
            followedManga: false,
        };
    }

    return {
        profile: true,
        readingHistory: canAccessPrivacyScope(privacy?.reading_history_visibility, ownerId, viewerId, isMutualFollow),
        comments: canAccessPrivacyScope(privacy?.comments_visibility, ownerId, viewerId, isMutualFollow),
        readingLists: canAccessPrivacyScope(privacy?.reading_lists_visibility, ownerId, viewerId, isMutualFollow),
        tierLists: canAccessPrivacyScope(privacy?.tier_lists_visibility, ownerId, viewerId, isMutualFollow),
        followedManga: canAccessPrivacyScope(privacy?.followed_manga_visibility, ownerId, viewerId, isMutualFollow),
    };
};

export interface ProfileRecentComment {
    id: string;
    entityType: 'manga' | 'character' | 'author' | 'artist';
    entityId: string;
    targetName: string;
    targetHref: string;
    preview: string;
    createdAt: string;
    likes: number;
    isSpoiler: boolean;
    hasMedia: boolean;
    hasGif: boolean;
    parentId?: string;
}

export interface ProfileFollowedManga {
    id: string;
    title: string;
    cover: string;
    type?: string;
    status?: string;
    followedAt: string;
    href: string;
}

interface ProfileAccessContextRow {
    id: string;
    username: string;
    avatar?: string | null;
    role?: string | null;
    created_at: string;
    is_following: boolean;
    is_followed_by: boolean;
    is_mutual_follow: boolean;
    is_blocked: boolean;
    is_blocked_by_owner: boolean;
    can_view_profile: boolean;
    can_view_reading_history: boolean;
    can_view_comments: boolean;
    can_view_reading_lists: boolean;
    can_view_tier_lists: boolean;
    can_view_followed_manga: boolean;
}

interface ProfileRouteBundle {
    stats?: {
        totalSeries?: number;
        totalChapters?: number;
        totalReadingSeconds?: number;
        totalComments?: number;
        followersCount?: number;
        followingCount?: number;
    };
    recentReads?: any[];
    recentComments?: any[];
    followedManga?: any[];
    readingActivity?: { date: string; count: number }[];
    readingLists?: any[];
    tierLists?: any[];
}

export type ReadingTimeRange = 'today' | 'week' | 'month' | 'all';

export interface ReadingTimeOverview {
    todaySeconds: number;
    weekSeconds: number;
    monthSeconds: number;
    allTimeSeconds: number;
}

export interface ReadingTimeEntry {
    id: string;
    mangaId: string;
    mangaTitle: string;
    mangaCover?: string;
    chapterId?: string;
    chapterNumber?: number;
    readAt: string;
    secondsSpent: number;
}

export interface ReadingTimeDayBucket {
    date: string;
    label: string;
    seconds: number;
    chapters: number;
    seriesCount: number;
    entries: ReadingTimeEntry[];
}

const getLocalDateKey = (value: string | Date) => {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');

    return `${year}-${month}-${day}`;
};

const clampReadingSeconds = (seconds: number) => {
    if (!Number.isFinite(seconds)) {
        return 0;
    }

    return Math.max(0, Math.min(43200, Math.round(seconds)));
};

const getRangeStartDate = (range: ReadingTimeRange) => {
    if (range === 'all') {
        return null;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (range === 'today') {
        return now;
    }

    const daysToSubtract = range === 'week' ? 6 : 29;
    const start = new Date(now);
    start.setDate(start.getDate() - daysToSubtract);
    return start;
};

const buildCommentPreview = (rawContent: string) => {
    const parsed = parseCommentContent(rawContent);
    const text = stripCommentFormatting(parsed.body).replace(/\s+/g, ' ').trim();

    if (parsed.isSpoiler) {
        return 'Spoiler olarak isaretlenmis yorum';
    }

    if (text) {
        return text;
    }

    if (parsed.mediaUrls?.length) {
        return 'Gorsel eklenmis yorum';
    }

    return 'Yorum birakildi';
};

export const getUserRecentComments = async (userId: string, limit: number = 8): Promise<ProfileRecentComment[]> => {
    const [mangaComments, characterComments, authorComments, artistComments] = await Promise.all([
        supabase
            .from('comments')
            .select('id, manga_id, content, gif_url, parent_id, likes, created_at, mangas:manga_id(title)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit),
        supabase
            .from('character_comments')
            .select('id, character_id, content, likes, created_at, characters:character_id(name)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit),
        supabase
            .from('author_comments')
            .select('id, author_id, content, likes, created_at, authors:author_id(name)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit),
        supabase
            .from('artist_comments')
            .select('id, artist_id, content, likes, created_at, artists:artist_id(name)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit),
    ]);

    const normalizedMangaComments: ProfileRecentComment[] = (mangaComments.data || []).map((comment: any) => {
        const parsed = parseCommentContent(comment.content || '');

        return {
            id: comment.id,
            entityType: 'manga',
            entityId: comment.manga_id,
            targetName: comment.mangas?.title || 'Seri',
            targetHref: `/manga/${comment.manga_id}`,
            preview: buildCommentPreview(comment.content || ''),
            createdAt: comment.created_at,
            likes: comment.likes || 0,
            isSpoiler: Boolean(parsed.isSpoiler),
            hasMedia: Boolean(parsed.mediaUrls?.length),
            hasGif: Boolean(comment.gif_url),
            parentId: comment.parent_id || undefined,
        };
    });

    const normalizeEntityComments = (
        items: any[],
        entityType: 'character' | 'author' | 'artist',
        entityKey: 'character_id' | 'author_id' | 'artist_id',
        relationKey: 'characters' | 'authors' | 'artists',
        hrefPrefix: '/character' | '/author' | '/artist',
        fallbackName: string
    ): ProfileRecentComment[] =>
        items.map((comment: any) => {
            const parsed = parseCommentContent(comment.content || '');

            return {
                id: comment.id,
                entityType,
                entityId: comment[entityKey],
                targetName: comment[relationKey]?.name || fallbackName,
                targetHref: `${hrefPrefix}/${comment[entityKey]}`,
                preview: buildCommentPreview(comment.content || ''),
                createdAt: comment.created_at,
                likes: comment.likes || 0,
                isSpoiler: Boolean(parsed.isSpoiler),
                hasMedia: Boolean(parsed.mediaUrls?.length),
                hasGif: false,
            };
        });

    return [
        ...normalizedMangaComments,
        ...normalizeEntityComments(characterComments.data || [], 'character', 'character_id', 'characters', '/character', 'Karakter'),
        ...normalizeEntityComments(authorComments.data || [], 'author', 'author_id', 'authors', '/author', 'Yazar'),
        ...normalizeEntityComments(artistComments.data || [], 'artist', 'artist_id', 'artists', '/artist', 'Cizer'),
    ]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
};

export const getUserFollowedManga = async (userId: string, limit: number = 18): Promise<ProfileFollowedManga[]> => {
    const { data, error } = await supabase
        .from('follows')
        .select('followed_at, mangas:manga_id(id, title, cover, type, status)')
        .eq('user_id', userId)
        .order('followed_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Followed manga fetch error:', error);
        return [];
    }

    return (data || [])
        .map((entry: any) => {
            const manga = Array.isArray(entry.mangas) ? entry.mangas[0] : entry.mangas;

            if (!manga?.id) {
                return null;
            }

            return {
                id: manga.id,
                title: manga.title,
                cover: manga.cover,
                type: manga.type || undefined,
                status: manga.status || undefined,
                followedAt: entry.followed_at,
                href: `/manga/${manga.id}`,
            } satisfies ProfileFollowedManga;
        })
        .filter(Boolean) as ProfileFollowedManga[];
};

const getProfileAccessContext = async (userId: string): Promise<ProfileAccessContextRow | null> => {
    const { data, error } = await supabase.rpc('get_profile_access_context', {
        p_target_user_id: userId,
    });

    if (error) {
        throw error;
    }

    if (Array.isArray(data)) {
        return (data[0] as ProfileAccessContextRow | undefined) || null;
    }

    return (data as ProfileAccessContextRow | null) || null;
};

const getProfileRouteBundle = async (userId: string): Promise<ProfileRouteBundle> => {
    const { data, error } = await supabase.rpc('get_profile_route_bundle', {
        p_target_user_id: userId,
    });

    if (error) {
        throw error;
    }

    return (data as ProfileRouteBundle | null) || {};
};

// Fetch profile data including stats
export const getUserProfile = async (userId: string, currentUserId?: string) => {
    let context: ProfileAccessContextRow | null = null;

    try {
        context = await getProfileAccessContext(userId);
    } catch (contextError) {
        if (!(currentUserId && currentUserId === userId)) {
            throw contextError;
        }

        const { error: syncError } = await supabase.rpc('sync_current_auth_profile', {
            p_avatar: null,
            p_base_username: null,
        });

        if (syncError) {
            throw contextError;
        }

        context = await getProfileAccessContext(userId);
    }

    if (!context) {
        throw new Error('PROFILE_NOT_FOUND');
    }

    const user = {
        id: context.id,
        username: context.username,
        avatar: context.avatar,
        role: context.role,
        created_at: context.created_at,
    };

    const sectionAccess = {
        profile: context.can_view_profile,
        readingHistory: context.can_view_reading_history,
        comments: context.can_view_comments,
        readingLists: context.can_view_reading_lists,
        tierLists: context.can_view_tier_lists,
        followedManga: context.can_view_followed_manga,
    };

    let bundle: ProfileRouteBundle = {};

    if (sectionAccess.profile) {
        try {
            bundle = await getProfileRouteBundle(userId);
        } catch (bundleError) {
            console.error('Profile route bundle error:', bundleError);
            bundle = {};
        }
    }

    if (!sectionAccess.profile) {
        return {
            ...user,
            stats: {
                totalSeries: 0,
                totalChapters: 0,
                totalReadingSeconds: 0,
                totalComments: 0,
                followersCount: 0,
                followingCount: 0,
            },
            relationship: {
                isFollowing: context.is_following,
                isFollowedBy: context.is_followed_by,
                isMutualFollow: context.is_mutual_follow,
                isBlocked: context.is_blocked,
                isBlockedByOwner: context.is_blocked_by_owner,
            },
            sectionAccess,
            recentReads: [],
            recentComments: [],
            followedManga: [],
            activity: [],
            readingLists: [],
            tierLists: [],
        };
    }

    return {
        ...user,
        stats: {
            totalSeries: bundle.stats?.totalSeries || 0,
            totalChapters: bundle.stats?.totalChapters || 0,
            totalReadingSeconds: bundle.stats?.totalReadingSeconds || 0,
            totalComments: bundle.stats?.totalComments || 0,
            followersCount: bundle.stats?.followersCount || 0,
            followingCount: bundle.stats?.followingCount || 0,
        },
        relationship: {
            isFollowing: context.is_following,
            isFollowedBy: context.is_followed_by,
            isMutualFollow: context.is_mutual_follow,
            isBlocked: context.is_blocked,
            isBlockedByOwner: context.is_blocked_by_owner
        },
        sectionAccess,
        recentReads: bundle.recentReads || [],
        recentComments: (bundle.recentComments || []).map((comment: any) => {
            const parsed = parseCommentContent(comment.content || '');

            return {
                id: comment.id,
                entityType: comment.entityType,
                entityId: comment.entityId,
                targetName: comment.targetName,
                targetHref: comment.targetHref,
                preview: buildCommentPreview(comment.content || ''),
                createdAt: comment.createdAt,
                likes: comment.likes || 0,
                isSpoiler: Boolean(parsed.isSpoiler),
                hasMedia: Boolean(parsed.mediaUrls?.length),
                hasGif: Boolean(comment.gifUrl),
                parentId: comment.parentId || undefined,
            };
        }),
        followedManga: bundle.followedManga || [],
        activity: bundle.readingActivity || [],
        readingLists: bundle.readingLists || [],
        tierLists: bundle.tierLists || [],
    };
};

export const getReadingActivity = async (userId: string, days: number = 365) => {
    // Calculate the date X days ago
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    
    // In reading_activity_log, read_at is the timestamp
    const { data, error } = await supabase
        .from('reading_activity_log')
        .select('read_at, chapter_id')
        .eq('user_id', userId)
        .gte('read_at', dateFrom.toISOString());
        
    if (error) {
        console.error('Activity log error:', error);
        return [];
    }
    
    // Group by date (YYYY-MM-DD)
    const activityMap: Record<string, number> = {};
    data.forEach(log => {
        const dateStr = new Date(log.read_at).toISOString().split('T')[0];
        activityMap[dateStr] = (activityMap[dateStr] || 0) + 1;
    });
    
    return Object.entries(activityMap).map(([date, count]) => ({ date, count }));
};

export const logChapterRead = async (userId: string, mangaId: string, chapterId: string, chapterNumber: number, secondsSpent: number = 0) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const normalizedSeconds = clampReadingSeconds(secondsSpent);

    const { data, error } = await supabase
        .from('reading_activity_log')
        .select('id, seconds_spent')
        .eq('user_id', userId)
        .eq('chapter_id', chapterId)
        .gte('read_at', startOfToday.toISOString())
        .order('read_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Reading time lookup error:', error);
        return;
    }

    const existingRow = data?.[0];

    if (existingRow?.id) {
        const nextSeconds = (existingRow.seconds_spent || 0) + normalizedSeconds;
        const { error: updateError } = await supabase
            .from('reading_activity_log')
            .update({
                read_at: new Date().toISOString(),
                seconds_spent: nextSeconds,
            })
            .eq('id', existingRow.id);

        if (updateError) {
            console.error('Reading time update error:', updateError);
        }

        return;
    }

    const { error: insertError } = await supabase
        .from('reading_activity_log')
        .insert({
            user_id: userId,
            manga_id: mangaId,
            chapter_id: chapterId,
            chapter_number: chapterNumber,
            seconds_spent: normalizedSeconds,
        });

    if (insertError) {
        console.error('Reading time insert error:', insertError);
    }
};

export const formatReadingDuration = (seconds: number) => {
    const normalized = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;

    if (normalized < 60) {
        return `${normalized} sn`;
    }

    const hours = Math.floor(normalized / 3600);
    const minutes = Math.floor((normalized % 3600) / 60);

    if (hours === 0) {
        return `${minutes} dk`;
    }

    if (minutes === 0) {
        return `${hours} sa`;
    }

    return `${hours} sa ${minutes} dk`;
};

export const getReadingTimeOverview = async (userId: string): Promise<ReadingTimeOverview> => {
    const { data, error } = await supabase
        .from('reading_activity_log')
        .select('read_at, seconds_spent')
        .eq('user_id', userId)
        .order('read_at', { ascending: false });

    if (error) {
        console.error('Reading time overview error:', error);
        return {
            todaySeconds: 0,
            weekSeconds: 0,
            monthSeconds: 0,
            allTimeSeconds: 0,
        };
    }

    const startOfToday = getRangeStartDate('today')!;
    const startOfWeek = getRangeStartDate('week')!;
    const startOfMonth = getRangeStartDate('month')!;

    return (data || []).reduce<ReadingTimeOverview>((summary, row: any) => {
        const readAt = new Date(row.read_at);
        const seconds = clampReadingSeconds(row.seconds_spent || 0);

        summary.allTimeSeconds += seconds;

        if (readAt >= startOfMonth) {
            summary.monthSeconds += seconds;
        }

        if (readAt >= startOfWeek) {
            summary.weekSeconds += seconds;
        }

        if (readAt >= startOfToday) {
            summary.todaySeconds += seconds;
        }

        return summary;
    }, {
        todaySeconds: 0,
        weekSeconds: 0,
        monthSeconds: 0,
        allTimeSeconds: 0,
    });
};

export const getMangaReadingTimeTotal = async (userId: string, mangaId: string): Promise<number> => {
    const { data, error } = await supabase
        .from('reading_activity_log')
        .select('seconds_spent')
        .eq('user_id', userId)
        .eq('manga_id', mangaId);

    if (error) {
        console.error('Manga reading time total error:', error);
        return 0;
    }

    return (data || []).reduce((sum: number, row: any) => sum + clampReadingSeconds(row.seconds_spent || 0), 0);
};

export const getReadingTimeTimeline = async (userId: string, range: ReadingTimeRange = 'week'): Promise<ReadingTimeDayBucket[]> => {
    let query = supabase
        .from('reading_activity_log')
        .select('id, manga_id, chapter_id, chapter_number, read_at, seconds_spent')
        .eq('user_id', userId)
        .order('read_at', { ascending: false });

    const startDate = getRangeStartDate(range);
    if (startDate) {
        query = query.gte('read_at', startDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
        console.error('Reading time timeline error:', error);
        return [];
    }

    const logs = data || [];
    const mangaIds = [...new Set(logs.map((log: any) => log.manga_id).filter(Boolean))];
    const { data: mangaRows } = mangaIds.length > 0
        ? await supabase.from('mangas').select('id, title, cover').in('id', mangaIds)
        : { data: [] as any[] };

    const mangaMap = new Map((mangaRows || []).map((manga: any) => [manga.id, manga]));
    const dayMap = new Map<string, ReadingTimeDayBucket>();

    logs.forEach((log: any) => {
        const dateKey = getLocalDateKey(log.read_at);
        const manga = mangaMap.get(log.manga_id);
        const entry: ReadingTimeEntry = {
            id: log.id,
            mangaId: log.manga_id,
            mangaTitle: manga?.title || 'Seri',
            mangaCover: manga?.cover || undefined,
            chapterId: log.chapter_id || undefined,
            chapterNumber: log.chapter_number ? Number(log.chapter_number) : undefined,
            readAt: log.read_at,
            secondsSpent: clampReadingSeconds(log.seconds_spent || 0),
        };

        const existingBucket = dayMap.get(dateKey);
        if (existingBucket) {
            existingBucket.seconds += entry.secondsSpent;
            existingBucket.chapters += 1;
            existingBucket.entries.push(entry);
            existingBucket.seriesCount = new Set(existingBucket.entries.map((item) => item.mangaId)).size;
            return;
        }

        dayMap.set(dateKey, {
            date: dateKey,
            label: new Date(log.read_at).toLocaleDateString('tr-TR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
            }),
            seconds: entry.secondsSpent,
            chapters: 1,
            seriesCount: 1,
            entries: [entry],
        });
    });

    return Array.from(dayMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const updatePrivacySettings = async (userId: string, visibility: 'public' | 'private' | 'members' | 'mutuals', currentPreferences: any = {}) => {
    const updatedPreferences = {
        ...currentPreferences,
        privacy: {
            visibility // public, members, mutuals, private
        }
    };
    
    const { error } = await supabase
        .from('users')
        .update({ preferences: updatedPreferences })
        .eq('id', userId);
        
    if (error) throw error;
};

// Evaluate and sync achievements
export const syncAchievements = async (userId: string, stats: { totalSeries: number, totalChapters: number, totalComments: number }) => {
    const { totalSeries, totalChapters, totalComments } = stats;

    const currentProgress: Record<string, number> = {
        'first_blood': totalChapters,
        'manga_worm': totalChapters,
        'veteran': totalChapters,
        'critic': totalComments,
        'explorer': totalSeries,
    };

    const { data: existingAchievements } = await supabase
        .from('user_achievements')
        .select('achievement_id, unlocked_at')
        .eq('user_id', userId);

    const unlockedIds = new Set(existingAchievements?.filter(a => a.unlocked_at).map(a => a.achievement_id) || []);
    
    // We only care about unlocking new ones
    const toInsert = [];
    const now = new Date().toISOString();

    for (const [id, value] of Object.entries(currentProgress)) {
        let maxNeeded = 1;
        if (id === 'manga_worm') maxNeeded = 100;
        if (id === 'critic') maxNeeded = 50;
        if (id === 'explorer') maxNeeded = 10;
        if (id === 'veteran') maxNeeded = 1000;

        if (value >= maxNeeded && !unlockedIds.has(id)) {
            toInsert.push({
                user_id: userId,
                achievement_id: id,
                progress: maxNeeded,
                unlocked_at: now
            });
        }
    }

    if (toInsert.length > 0) {
        const { error } = await supabase.from('user_achievements').upsert(toInsert, { onConflict: 'user_id, achievement_id' });
        if (error) console.error('Achievements upsert error:', error);
    }
    
    // Return all unlocked with their timestamps
    return await supabase
        .from('user_achievements')
        .select('*')
        .eq('user_id', userId)
        .not('unlocked_at', 'is', null);
};

// Social Functions
export const followUser = async (followerId: string, followedId: string) => {
    if (followerId === followedId) return { error: 'Kendinizi takip edemezsiniz.' };

    const { data, error } = await supabase
        .from('user_follows')
        .insert({ follower_id: followerId, followed_id: followedId });

    if (!error) {
        const { data: followerProfile } = await supabase
            .from('users')
            .select('username')
            .eq('id', followerId)
            .single();

        await createFollowNotification(
            followedId,
            followerId,
            followerProfile?.username || 'Bir kullanıcı'
        );
    }

    return { data, error };
};

export const unfollowUser = async (followerId: string, followedId: string) => {
    const { data, error } = await supabase
        .from('user_follows')
        .delete()
        .eq('follower_id', followerId)
        .eq('followed_id', followedId);
        
    return { data, error };
};

export const blockUser = async (blockerId: string, blockedId: string) => {
    if (blockerId === blockedId) return { error: 'Kendinizi engelleyemezsiniz.' };
    
    // Automatically unfollow when blocking
    await unfollowUser(blockerId, blockedId);
    await unfollowUser(blockedId, blockerId);
    
    const { data, error } = await supabase
        .from('user_blocks')
        .insert({ blocker_id: blockerId, blocked_id: blockedId });
        
    return { data, error };
};

export const unblockUser = async (blockerId: string, blockedId: string) => {
    const { data, error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId);
        
    return { data, error };
};

export const getBlockedUserIds = async (userId: string) => {
    const [{ data: blockedByMe, error: blockedByMeError }, { data: blockedMe, error: blockedMeError }] = await Promise.all([
        supabase
            .from('user_blocks')
            .select('blocked_id')
            .eq('blocker_id', userId),
        supabase
            .from('user_blocks')
            .select('blocker_id')
            .eq('blocked_id', userId),
    ]);

    return {
        ids: Array.from(new Set([
            ...(blockedByMe || []).map((item) => item.blocked_id),
            ...(blockedMe || []).map((item) => item.blocker_id),
        ])),
        error: blockedByMeError || blockedMeError
    };
};

export const getBlockedUsers = async (userId: string) => {
    const { data, error } = await supabase
        .from('user_blocks')
        .select('blocked_id, blocked:blocked_id(id, username, avatar)')
        .eq('blocker_id', userId)
        .order('created_at', { ascending: false });

    return {
        users: (data || [])
            .map((item: any) => item.blocked)
            .filter(Boolean),
        error,
    };
};

export const getUserFollowers = async (userId: string, page: number = 1, limit: number = 50) => {
    const offset = (page - 1) * limit;
    
    const { data, error, count } = await supabase
        .from('user_follows')
        .select('follower:follower_id (id, username, avatar, role)', { count: 'exact' })
        .eq('followed_id', userId)
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });
        
    return { 
        users: data?.map(d => d.follower) || [], 
        total: count || 0,
        error 
    };
};

export const getUserFollowing = async (userId: string, page: number = 1, limit: number = 50) => {
    const offset = (page - 1) * limit;
    
    const { data, error, count } = await supabase
        .from('user_follows')
        .select('followed:followed_id (id, username, avatar, role)', { count: 'exact' })
        .eq('follower_id', userId)
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });
        
    return { 
        users: data?.map(d => d.followed) || [], 
        total: count || 0,
        error 
    };
};

export const getUserComments = async (userId: string, page: number = 1, limit: number = 50) => {
    const offset = (page - 1) * limit;
    const { data, error, count } = await supabase
        .from('comments')
        .select(`
            id, 
            content, 
            created_at, 
            manga_id, 
            chapter_id,
            likes,
            gif_url,
            mangas:manga_id (title, cover),
            chapters:chapter_id (number, title)
        `, { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
        
    return { 
        comments: data || [], 
        total: count || 0, 
        error 
    };
};
