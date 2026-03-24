import { supabase } from './supabase';
import { User } from './types';
import { parseCommentContent, stripCommentFormatting } from './commentContent';

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

// Fetch profile data including stats
export const getUserProfile = async (userId: string, currentUserId?: string) => {
    // Get user details
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, username, avatar, created_at, preferences')
        .eq('id', userId)
        .single();
        
    if (userError) throw userError;
    
    // Get stats: total distinct series read, total chapters read
    const { count: totalSeries } = await supabase
        .from('reading_progress')
        .select('manga_id', { count: 'exact', head: true })
        .eq('user_id', userId);
        
    // Fetch last 4 recently read mangas
    const { data: recentReads } = await supabase
        .from('reading_progress')
        .select('manga_id, chapter_number, page, last_read, mangas:manga_id (id, title, cover)')
        .eq('user_id', userId)
        .order('last_read', { ascending: false })
        .limit(4);
        
    const { count: totalChapters } = await supabase
        .from('reading_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
        
    const [
        { count: totalComments },
        { count: totalCharacterComments },
        { count: totalAuthorComments },
        { count: totalArtistComments },
        recentComments,
        followedManga,
    ] = await Promise.all([
        supabase
            .from('comments')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),
        supabase
            .from('character_comments')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),
        supabase
            .from('author_comments')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),
        supabase
            .from('artist_comments')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),
        getUserRecentComments(userId),
        getUserFollowedManga(userId),
    ]);

    // Get following/follower counts
    const { count: followersCount } = await supabase
        .from('user_follows')
        .select('id', { count: 'exact', head: true })
        .eq('followed_id', userId);

    const { count: followingCount } = await supabase
        .from('user_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', userId);

    // Check relationship with current user
    let isFollowing = false;
    let isBlocked = false;
    let isBlockedByOwner = false;

    if (currentUserId && currentUserId !== userId) {
        const [followCheck, blockCheck, blockByOwnerCheck] = await Promise.all([
            supabase.from('user_follows').select('id').eq('follower_id', currentUserId).eq('followed_id', userId).maybeSingle(),
            supabase.from('user_blocks').select('id').eq('blocker_id', currentUserId).eq('blocked_id', userId).maybeSingle(),
            supabase.from('user_blocks').select('id').eq('blocker_id', userId).eq('blocked_id', currentUserId).maybeSingle()
        ]);
        
        isFollowing = !!followCheck.data;
        isBlocked = !!blockCheck.data;
        isBlockedByOwner = !!blockByOwnerCheck.data;
    }

    return {
        ...user,
        stats: {
            totalSeries: totalSeries || 0,
            totalChapters: totalChapters || 0,
            totalComments: (totalComments || 0) + (totalCharacterComments || 0) + (totalAuthorComments || 0) + (totalArtistComments || 0),
            followersCount: followersCount || 0,
            followingCount: followingCount || 0,
        },
        relationship: {
            isFollowing,
            isBlocked,
            isBlockedByOwner
        },
        recentReads: recentReads || [],
        recentComments,
        followedManga,
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

export const logChapterRead = async (userId: string, mangaId: string, chapterId: string, chapterNumber: number) => {
    // Optional optimization: don't log if already logged today for the same chapter
    const today = new Date().toISOString().split('T')[0];
    
    const { data } = await supabase
        .from('reading_activity_log')
        .select('id')
        .eq('user_id', userId)
        .eq('chapter_id', chapterId)
        .gte('read_at', today + 'T00:00:00Z')
        .maybeSingle();
        
    if (!data) {
        // Log it!
        await supabase.from('reading_activity_log').insert({
            user_id: userId,
            manga_id: mangaId,
            chapter_id: chapterId,
            chapter_number: chapterNumber
        });
    }
};

export const updatePrivacySettings = async (userId: string, visibility: 'public' | 'private' | 'members', currentPreferences: any = {}) => {
    const updatedPreferences = {
        ...currentPreferences,
        privacy: {
            visibility // public, members, private
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
        .select('follower:follower_id (id, username, avatar)', { count: 'exact' })
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
        .select('followed:followed_id (id, username, avatar)', { count: 'exact' })
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
