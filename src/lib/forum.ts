import { supabase } from '@/lib/supabase';
import { fetchUserNotificationSettingsMap } from '@/lib/storage';
import { User } from '@/lib/types';
import type { ReportStatus } from '@/lib/database';

export type ForumCategoryId =
    | 'genel-sohbet'
    | 'tanisma'
    | 'seri-sohbetleri'
    | 'bolum-tartismalari'
    | 'oneri-tavsiye'
    | 'site-geri-bildirim';

export type ForumSortOption = 'latest' | 'newest' | 'most_liked' | 'most_replied';
export type ForumPinnedMode = 'all' | 'pinned' | 'unpinned';

export interface ForumCategoryMeta {
    id: ForumCategoryId;
    label: string;
    description: string;
}

export const FORUM_CATEGORIES: ForumCategoryMeta[] = [
    {
        id: 'genel-sohbet',
        label: 'Genel Sohbet',
        description: 'Seriler, topluluk ve gündelik konular hakkında sohbet et.',
    },
    {
        id: 'tanisma',
        label: 'Tanışma',
        description: 'Kendini tanıt, okuma zevklerini paylaş ve yeni okuyucularla tanış.',
    },
    {
        id: 'seri-sohbetleri',
        label: 'Seri Sohbetleri',
        description: 'Favori manga ve webtoon serileri üzerine teori ve analizler paylaş.',
    },
    {
        id: 'bolum-tartismalari',
        label: 'Bölüm Tartışmaları',
        description: 'Yeni bölümleri spoiler etiketiyle birlikte diğer okurlarla tartış.',
    },
    {
        id: 'oneri-tavsiye',
        label: 'Öneri / Tavsiye',
        description: 'Okuyacak yeni seri iste veya beğendiğin serileri başkalarına öner.',
    },
    {
        id: 'site-geri-bildirim',
        label: 'Site Geri Bildirim',
        description: 'Hata bildirimi, özellik isteği ve siteye dair düşüncelerini paylaş.',
    },
];

export const FORUM_CATEGORY_MAP = Object.fromEntries(
    FORUM_CATEGORIES.map((category) => [category.id, category]),
) as Record<ForumCategoryId, ForumCategoryMeta>;

export interface ForumTopic {
    id: string;
    userId: string;
    authorUsername: string;
    authorAvatar?: string;
    authorRole?: User['role'];
    category: ForumCategoryId;
    title: string;
    content: string;
    mangaId?: string;
    mangaTitle?: string;
    mangaCover?: string;
    chapterId?: string;
    chapterNumber?: number;
    chapterTitle?: string;
    isPinned: boolean;
    isLocked: boolean;
    isSpoiler: boolean;
    replyCount: number;
    likeCount: number;
    viewerHasLiked: boolean;
    lastPostAt: string;
    lastPostUserId?: string;
    lastPostUsername?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ForumPost {
    id: string;
    topicId: string;
    userId: string;
    authorUsername: string;
    authorAvatar?: string;
    authorRole?: User['role'];
    parentPostId?: string;
    parentAuthorUsername?: string;
    parentContent?: string;
    parentIsSpoiler: boolean;
    content: string;
    isSpoiler: boolean;
    likeCount: number;
    viewerHasLiked: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ForumReport {
    id: string;
    targetType: 'topic' | 'post';
    topicId: string;
    topicTitle: string;
    postId?: string;
    contentPreview: string;
    reporterId: string;
    reporterUsername?: string;
    reportedUserId: string;
    reportedUsername?: string;
    reason: string;
    details?: string;
    status: ReportStatus;
    createdAt: string;
    updatedAt: string;
}

export interface ForumFeedResult {
    topics: ForumTopic[];
    hasMore: boolean;
}

export interface ForumPostsResult {
    posts: ForumPost[];
    hasMore: boolean;
}

export const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    const result: T[] = [];

    for (const item of items) {
        if (!item?.id || seen.has(item.id)) {
            continue;
        }
        seen.add(item.id);
        result.push(item);
    }

    return result;
};

export const extractMentionUsernames = (content: string): string[] => {
    if (!content) {
        return [];
    }

    const matches = content.match(/(?:^|\s)@([a-zA-Z0-9_.-]{2,32})/g) || [];
    const unique = new Map<string, string>();

    for (const raw of matches) {
        const cleaned = raw.trim().replace(/^@/, '');
        if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(cleaned)) {
            continue;
        }
        const key = cleaned.toLowerCase();
        if (!unique.has(key)) {
            unique.set(key, cleaned);
        }
    }

    return Array.from(unique.values()).slice(0, 8);
};

const normalizeUserRole = (role: unknown): User['role'] | undefined => {
    if (role === 'admin' || role === 'moderator' || role === 'user') {
        return role;
    }
    return undefined;
};

const normalizeCategory = (category: unknown): ForumCategoryId => {
    if (typeof category === 'string' && category in FORUM_CATEGORY_MAP) {
        return category as ForumCategoryId;
    }
    return 'genel-sohbet';
};

const mapForumTopicRow = (row: Record<string, unknown>): ForumTopic => ({
    id: String(row.id),
    userId: String(row.user_id),
    authorUsername: String(row.author_username || 'Kullanıcı'),
    authorAvatar: typeof row.author_avatar === 'string' && row.author_avatar ? row.author_avatar : undefined,
    authorRole: normalizeUserRole(row.author_role),
    category: normalizeCategory(row.category),
    title: String(row.title || ''),
    content: String(row.content || ''),
    mangaId: typeof row.manga_id === 'string' && row.manga_id ? row.manga_id : undefined,
    mangaTitle: typeof row.manga_title === 'string' && row.manga_title ? row.manga_title : undefined,
    mangaCover: typeof row.manga_cover === 'string' && row.manga_cover ? row.manga_cover : undefined,
    chapterId: typeof row.chapter_id === 'string' && row.chapter_id ? row.chapter_id : undefined,
    chapterNumber: row.chapter_number !== null && row.chapter_number !== undefined ? Number(row.chapter_number) : undefined,
    chapterTitle: typeof row.chapter_title === 'string' && row.chapter_title ? row.chapter_title : undefined,
    isPinned: Boolean(row.is_pinned),
    isLocked: Boolean(row.is_locked),
    isSpoiler: Boolean(row.is_spoiler),
    replyCount: Number(row.reply_count || 0),
    likeCount: Number(row.like_count || 0),
    viewerHasLiked: Boolean(row.viewer_has_liked),
    lastPostAt: String(row.last_post_at || row.created_at),
    lastPostUserId: typeof row.last_post_user_id === 'string' && row.last_post_user_id ? row.last_post_user_id : undefined,
    lastPostUsername: typeof row.last_post_username === 'string' && row.last_post_username ? row.last_post_username : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
});

const mapForumPostRow = (row: Record<string, unknown>): ForumPost => ({
    id: String(row.id),
    topicId: String(row.topic_id),
    userId: String(row.user_id),
    authorUsername: String(row.author_username || 'Kullanıcı'),
    authorAvatar: typeof row.author_avatar === 'string' && row.author_avatar ? row.author_avatar : undefined,
    authorRole: normalizeUserRole(row.author_role),
    parentPostId: typeof row.parent_post_id === 'string' && row.parent_post_id ? row.parent_post_id : undefined,
    parentAuthorUsername:
        typeof row.parent_author_username === 'string' && row.parent_author_username
            ? row.parent_author_username
            : undefined,
    parentContent: typeof row.parent_content === 'string' ? row.parent_content : undefined,
    parentIsSpoiler: Boolean(row.parent_is_spoiler),
    content: String(row.content || ''),
    isSpoiler: Boolean(row.is_spoiler),
    likeCount: Number(row.like_count || 0),
    viewerHasLiked: Boolean(row.viewer_has_liked),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
});

export const getForumCategoryCounts = async (): Promise<{
    totalCount: number;
    counts: Record<ForumCategoryId, number>;
}> => {
    const emptyCounts: Record<ForumCategoryId, number> = {
        'genel-sohbet': 0,
        tanisma: 0,
        'seri-sohbetleri': 0,
        'bolum-tartismalari': 0,
        'oneri-tavsiye': 0,
        'site-geri-bildirim': 0,
    };

    const { data, error } = await supabase.rpc('get_forum_category_counts');
    if (error) {
        console.error('Forum category counts error:', error);
        return { totalCount: 0, counts: emptyCounts };
    }

    let totalCount = 0;
    for (const row of (data || []) as Array<{ category: string; topic_count: number | string }>) {
        const category = row.category as ForumCategoryId;
        if (category in emptyCounts) {
            const count = Number(row.topic_count || 0);
            emptyCounts[category] = count;
            totalCount += count;
        }
    }

    return { totalCount, counts: emptyCounts };
};

export const getForumTopicsFeed = async (options: {
    category?: ForumCategoryId | null;
    search?: string;
    sort?: ForumSortOption;
    pinnedMode?: ForumPinnedMode;
    limit?: number;
    offset?: number;
} = {}): Promise<ForumFeedResult> => {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 49);
    const offset = Math.max(options.offset ?? 0, 0);

    const { data, error } = await supabase.rpc('get_forum_topics_feed', {
        p_category: options.category || null,
        p_search: options.search?.trim() || null,
        p_sort: options.sort || 'latest',
        p_pinned_mode: options.pinnedMode || 'all',
        p_limit: limit + 1,
        p_offset: offset,
    });

    if (error) {
        console.error('Forum topics feed error:', error);
        throw error;
    }

    const mapped = dedupeById(((data || []) as Record<string, unknown>[]).map(mapForumTopicRow));
    return {
        topics: mapped.slice(0, limit),
        hasMore: mapped.length > limit,
    };
};

export const getForumTopicDetail = async (topicId: string): Promise<ForumTopic | null> => {
    const { data, error } = await supabase.rpc('get_forum_topic_detail', {
        p_topic_id: topicId,
    });

    if (error) {
        console.error('Forum topic detail error:', error);
        throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapForumTopicRow(row) : null;
};

export const getForumTopicPosts = async (
    topicId: string,
    limit = 40,
    offset = 0,
): Promise<ForumPostsResult> => {
    const clampedLimit = Math.min(Math.max(limit, 1), 99);
    const { data, error } = await supabase.rpc('get_forum_topic_posts', {
        p_topic_id: topicId,
        p_limit: clampedLimit + 1,
        p_offset: Math.max(offset, 0),
    });

    if (error) {
        console.error('Forum topic posts error:', error);
        throw error;
    }

    const mapped = dedupeById(((data || []) as Record<string, unknown>[]).map(mapForumPostRow));
    return {
        posts: mapped.slice(0, clampedLimit),
        hasMore: mapped.length > clampedLimit,
    };
};

const insertNotificationsBatch = async (
    payloads: Array<{
        userId: string;
        type: 'reply' | 'like';
        title: string;
        message: string;
        fromUserId: string;
        link: string;
    }>,
) => {
    if (payloads.length === 0) {
        return;
    }

    try {
        const targetIds = Array.from(new Set(payloads.map((item) => item.userId)));
        const settingsMap = await fetchUserNotificationSettingsMap(targetIds);
        const nowIso = new Date().toISOString();

        const rows = payloads
            .filter((item) => {
                if (!item.userId || item.userId === item.fromUserId) {
                    return false;
                }
                const settings = settingsMap.get(item.userId);
                if (item.type === 'reply' && settings?.replies === false) {
                    return false;
                }
                if (item.type === 'like' && settings?.likes === false) {
                    return false;
                }
                return true;
            })
            .map((item) => ({
                user_id: item.userId,
                type: item.type,
                title: item.title,
                message: item.message,
                from_user_id: item.fromUserId,
                link: item.link,
                read: false,
                created_at: nowIso,
            }));

        if (rows.length === 0) {
            return;
        }

        const { error } = await supabase.from('notifications').insert(rows);
        if (error) {
            console.error('Forum notification insert error:', error);
        }
    } catch (error) {
        console.error('Forum notification dispatch error:', error);
    }
};

export const resolveUserIdsByUsernames = async (
    usernames: string[],
    knownMap: Record<string, string> = {},
): Promise<Record<string, string>> => {
    const resolved: Record<string, string> = {};
    const missing: string[] = [];

    for (const username of usernames) {
        const clean = username.trim().replace(/^@/, '');
        if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(clean)) {
            continue;
        }
        const key = clean.toLowerCase();
        if (knownMap[key]) {
            resolved[key] = knownMap[key];
        } else {
            missing.push(clean);
        }
    }

    if (missing.length > 0) {
        try {
            const orFilter = missing.slice(0, 8).map((name) => `username.ilike.${name}`).join(',');
            const { data } = await supabase
                .from('users')
                .select('id, username')
                .or(orFilter)
                .limit(12);

            for (const row of (data || []) as Array<{ id: string; username?: string | null }>) {
                if (row?.id && row.username) {
                    resolved[row.username.toLowerCase()] = row.id;
                }
            }
        } catch {
            // Ignore public lookup failures gracefully
        }
    }

    return resolved;
};

export const createForumTopic = async (payload: {
    userId: string;
    actorUsername: string;
    category: ForumCategoryId;
    title: string;
    content: string;
    mangaId?: string | null;
    chapterId?: string | null;
    isSpoiler?: boolean;
}): Promise<ForumTopic> => {
    const trimmedTitle = payload.title.trim();
    const trimmedContent = payload.content.trim();

    const { data, error } = await supabase
        .from('forum_topics')
        .insert({
            user_id: payload.userId,
            category: payload.category,
            title: trimmedTitle,
            content: trimmedContent,
            manga_id: payload.mangaId || null,
            chapter_id: payload.mangaId ? payload.chapterId || null : null,
            is_spoiler: Boolean(payload.isSpoiler),
        })
        .select('id')
        .single();

    if (error || !data?.id) {
        throw error || new Error('FORUM_TOPIC_CREATE_FAILED');
    }

    const mentionedUsernames = extractMentionUsernames(trimmedContent);
    if (mentionedUsernames.length > 0) {
        void (async () => {
            const mentionMap = await resolveUserIdsByUsernames(mentionedUsernames);
            const notifiedIds = new Set<string>([payload.userId]);
            const notifications: Parameters<typeof insertNotificationsBatch>[0] = [];

            for (const targetId of Object.values(mentionMap)) {
                if (!notifiedIds.has(targetId)) {
                    notifiedIds.add(targetId);
                    notifications.push({
                        userId: targetId,
                        type: 'reply',
                        title: 'Forum Bahsetmesi',
                        message: `${payload.actorUsername}, "${trimmedTitle}" konusunda sizden bahsetti.`,
                        fromUserId: payload.userId,
                        link: `/community/topic/${data.id}`,
                    });
                }
            }

            await insertNotificationsBatch(notifications);
        })();
    }

    const detail = await getForumTopicDetail(data.id);
    if (!detail) {
        throw new Error('FORUM_TOPIC_DETAIL_UNAVAILABLE');
    }

    return detail;
};

export const updateForumTopic = async (
    topicId: string,
    updates: {
        category?: ForumCategoryId;
        title?: string;
        content?: string;
        mangaId?: string | null;
        chapterId?: string | null;
        isSpoiler?: boolean;
        isPinned?: boolean;
        isLocked?: boolean;
    },
): Promise<void> => {
    const patch: Record<string, unknown> = {};

    if (updates.category !== undefined) patch.category = updates.category;
    if (updates.title !== undefined) patch.title = updates.title.trim();
    if (updates.content !== undefined) patch.content = updates.content.trim();
    if (updates.mangaId !== undefined) patch.manga_id = updates.mangaId || null;
    if (updates.chapterId !== undefined) patch.chapter_id = updates.mangaId === null ? null : updates.chapterId || null;
    if (updates.isSpoiler !== undefined) patch.is_spoiler = updates.isSpoiler;
    if (updates.isPinned !== undefined) patch.is_pinned = updates.isPinned;
    if (updates.isLocked !== undefined) patch.is_locked = updates.isLocked;

    if (Object.keys(patch).length === 0) {
        return;
    }

    const { error } = await supabase
        .from('forum_topics')
        .update(patch)
        .eq('id', topicId);

    if (error) {
        console.error('Forum topic update error:', error);
        throw error;
    }
};

export const deleteForumTopic = async (topicId: string): Promise<void> => {
    const { error } = await supabase
        .from('forum_topics')
        .delete()
        .eq('id', topicId);

    if (error) {
        console.error('Forum topic delete error:', error);
        throw error;
    }
};

export const toggleForumTopicLike = async (options: {
    topicId: string;
    userId: string;
    currentlyLiked: boolean;
    topicAuthorId?: string;
    topicTitle?: string;
    actorUsername?: string;
}): Promise<boolean> => {
    const { topicId, userId, currentlyLiked } = options;

    if (currentlyLiked) {
        const { error } = await supabase
            .from('forum_topic_likes')
            .delete()
            .eq('topic_id', topicId)
            .eq('user_id', userId);

        if (error) {
            throw error;
        }
        return false;
    }

    const { error } = await supabase
        .from('forum_topic_likes')
        .insert({
            topic_id: topicId,
            user_id: userId,
        });

    if (error) {
        if (error.code === '23505') {
            return true;
        }
        throw error;
    }

    if (options.topicAuthorId && options.topicAuthorId !== userId && options.actorUsername) {
        void insertNotificationsBatch([
            {
                userId: options.topicAuthorId,
                type: 'like',
                title: 'Konu Beğenisi',
                message: `${options.actorUsername}, "${options.topicTitle || 'forum'}" konunuzu beğendi.`,
                fromUserId: userId,
                link: `/community/topic/${topicId}`,
            },
        ]);
    }

    return true;
};

export const createForumPost = async (payload: {
    topicId: string;
    topicTitle: string;
    topicAuthorId: string;
    userId: string;
    actorUsername: string;
    parentPostId?: string | null;
    parentAuthorId?: string | null;
    content: string;
    isSpoiler?: boolean;
    knownUserMap?: Record<string, string>;
}): Promise<{ id: string }> => {
    const trimmedContent = payload.content.trim();
    const { data, error } = await supabase
        .from('forum_posts')
        .insert({
            topic_id: payload.topicId,
            user_id: payload.userId,
            parent_post_id: payload.parentPostId || null,
            content: trimmedContent,
            is_spoiler: Boolean(payload.isSpoiler),
        })
        .select('id')
        .single();

    if (error || !data?.id) {
        console.error('Forum post create error:', error);
        throw error || new Error('FORUM_POST_CREATE_FAILED');
    }

    const postLink = `/community/topic/${payload.topicId}?postId=${encodeURIComponent(data.id)}`;
    void (async () => {
        const notifiedIds = new Set<string>([payload.userId]);
        const notifications: Parameters<typeof insertNotificationsBatch>[0] = [];

        if (payload.parentPostId && payload.parentAuthorId && !notifiedIds.has(payload.parentAuthorId)) {
            notifiedIds.add(payload.parentAuthorId);
            notifications.push({
                userId: payload.parentAuthorId,
                type: 'reply',
                title: 'Yeni Forum Yanıtı',
                message: `${payload.actorUsername}, "${payload.topicTitle}" konusundaki yanıtınıza cevap verdi.`,
                fromUserId: payload.userId,
                link: postLink,
            });
        }

        if (payload.topicAuthorId && !notifiedIds.has(payload.topicAuthorId)) {
            notifiedIds.add(payload.topicAuthorId);
            notifications.push({
                userId: payload.topicAuthorId,
                type: 'reply',
                title: 'Konunuza Yeni Yanıt',
                message: `${payload.actorUsername}, "${payload.topicTitle}" konunuza yanıt yazdı.`,
                fromUserId: payload.userId,
                link: postLink,
            });
        }

        const mentionedUsernames = extractMentionUsernames(trimmedContent);
        if (mentionedUsernames.length > 0) {
            const mentionMap = await resolveUserIdsByUsernames(mentionedUsernames, payload.knownUserMap);
            for (const targetId of Object.values(mentionMap)) {
                if (!notifiedIds.has(targetId)) {
                    notifiedIds.add(targetId);
                    notifications.push({
                        userId: targetId,
                        type: 'reply',
                        title: 'Forum Bahsetmesi',
                        message: `${payload.actorUsername}, "${payload.topicTitle}" konusunda sizden bahsetti.`,
                        fromUserId: payload.userId,
                        link: postLink,
                    });
                }
            }
        }

        await insertNotificationsBatch(notifications);
    })();

    return { id: data.id };
};

export const updateForumPost = async (
    postId: string,
    updates: { content: string; isSpoiler: boolean },
): Promise<void> => {
    const { error } = await supabase
        .from('forum_posts')
        .update({
            content: updates.content.trim(),
            is_spoiler: updates.isSpoiler,
        })
        .eq('id', postId);

    if (error) {
        console.error('Forum post update error:', error);
        throw error;
    }
};

export const deleteForumPost = async (postId: string): Promise<void> => {
    const { error } = await supabase
        .from('forum_posts')
        .delete()
        .eq('id', postId);

    if (error) {
        console.error('Forum post delete error:', error);
        throw error;
    }
};

export const toggleForumPostLike = async (options: {
    postId: string;
    topicId: string;
    userId: string;
    currentlyLiked: boolean;
    postAuthorId?: string;
    topicTitle?: string;
    actorUsername?: string;
}): Promise<boolean> => {
    const { postId, topicId, userId, currentlyLiked } = options;

    if (currentlyLiked) {
        const { error } = await supabase
            .from('forum_post_likes')
            .delete()
            .eq('post_id', postId)
            .eq('user_id', userId);

        if (error) {
            throw error;
        }
        return false;
    }

    const { error } = await supabase
        .from('forum_post_likes')
        .insert({
            post_id: postId,
            user_id: userId,
        });

    if (error) {
        if (error.code === '23505') {
            return true;
        }
        throw error;
    }

    if (options.postAuthorId && options.postAuthorId !== userId && options.actorUsername) {
        void insertNotificationsBatch([
            {
                userId: options.postAuthorId,
                type: 'like',
                title: 'Yanıt Beğenisi',
                message: `${options.actorUsername}, "${options.topicTitle || 'forum'}" konusundaki yanıtınızı beğendi.`,
                fromUserId: userId,
                link: `/community/topic/${topicId}?postId=${encodeURIComponent(postId)}`,
            },
        ]);
    }

    return true;
};

export const createForumReport = async (payload: {
    targetType: 'topic' | 'post';
    topicId: string;
    postId?: string;
    reporterId: string;
    reportedUserId: string;
    reason: string;
    details?: string;
}): Promise<void> => {
    const { error } = await supabase.from('forum_reports').insert({
        target_type: payload.targetType,
        topic_id: payload.topicId,
        post_id: payload.targetType === 'post' ? payload.postId || null : null,
        reporter_id: payload.reporterId,
        reported_user_id: payload.reportedUserId,
        reason: payload.reason.trim(),
        details: payload.details?.trim() || null,
    });

    if (error) {
        if (error.code === '23505') {
            throw new Error('Bu içerik için zaten açık bir bildiriminiz bulunuyor.');
        }
        console.error('Forum report create error:', error);
        throw error;
    }
};

export const getForumReports = async (): Promise<ForumReport[]> => {
    const { data, error } = await supabase.rpc('get_forum_reports_admin');

    if (error) {
        console.error('Forum reports fetch error:', error);
        throw error;
    }

    return ((data || []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        targetType: row.target_type === 'post' ? 'post' : 'topic',
        topicId: String(row.topic_id),
        topicTitle: String(row.topic_title || 'Konu'),
        postId: typeof row.post_id === 'string' && row.post_id ? row.post_id : undefined,
        contentPreview: String(row.content_preview || ''),
        reporterId: String(row.reporter_id),
        reporterUsername: typeof row.reporter_username === 'string' ? row.reporter_username : undefined,
        reportedUserId: String(row.reported_user_id),
        reportedUsername: typeof row.reported_username === 'string' ? row.reported_username : undefined,
        reason: String(row.reason || ''),
        details: typeof row.details === 'string' && row.details ? row.details : undefined,
        status: (row.status as ReportStatus) || 'open',
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at || row.created_at),
    }));
};

export const updateForumReportStatus = async (id: string, status: ReportStatus): Promise<void> => {
    const { error } = await supabase
        .from('forum_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error('Forum report status update error:', error);
        throw error;
    }
};
