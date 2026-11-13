import { supabase } from '@/lib/supabase';
import { dedupeById } from '@/lib/forum';
import { User } from '@/lib/types';

export type TierListDiscoverySort = 'popular' | 'newest' | 'most_items';
export type TierListTypeFilter = 'all' | 'manga' | 'character';
export type ReadingListDiscoverySort = 'popular' | 'newest' | 'most_items';

export interface TierListPreviewItem {
    id: string;
    name: string;
    image: string;
}

export interface TierListPreviewTier {
    tier: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
    label: string;
    totalCount: number;
    items: TierListPreviewItem[];
}

export interface PublicTierListCard {
    id: string;
    userId: string;
    ownerUsername: string;
    ownerAvatar?: string;
    ownerRole?: User['role'];
    title: string;
    type: 'manga' | 'character';
    tierLabels: Record<string, string>;
    itemsCount: number;
    likeCount: number;
    viewerHasLiked: boolean;
    previewTiers: TierListPreviewTier[];
    createdAt: string;
}

export interface PublicReadingListCard {
    id: string;
    userId: string;
    ownerUsername: string;
    ownerAvatar?: string;
    ownerRole?: User['role'];
    name: string;
    description: string;
    imageUrl?: string;
    itemsCount: number;
    likeCount: number;
    viewerHasLiked: boolean;
    previewCovers: string[];
    createdAt: string;
}

const normalizeRole = (role: unknown): User['role'] | undefined => {
    if (role === 'admin' || role === 'moderator' || role === 'user') {
        return role;
    }
    return undefined;
};

const parsePreviewTiers = (raw: unknown): TierListPreviewTier[] => {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
        .map((entry) => ({
            tier: (typeof entry.tier === 'string' ? entry.tier : 'S') as TierListPreviewTier['tier'],
            label: typeof entry.label === 'string' && entry.label ? entry.label : String(entry.tier || 'S'),
            totalCount: Number(entry.totalCount || 0),
            items: Array.isArray(entry.items)
                ? entry.items
                    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
                    .map((item) => ({
                        id: String(item.id || ''),
                        name: String(item.name || ''),
                        image: String(item.image || ''),
                    }))
                    .filter((item) => Boolean(item.id || item.image))
                : [],
        }));
};

export const getPublicTierListsCatalog = async (options: {
    search?: string;
    type?: TierListTypeFilter;
    sort?: TierListDiscoverySort;
    limit?: number;
    offset?: number;
} = {}): Promise<{ items: PublicTierListCard[]; hasMore: boolean }> => {
    const limit = Math.min(Math.max(options.limit ?? 18, 1), 47);
    const offset = Math.max(options.offset ?? 0, 0);

    const { data, error } = await supabase.rpc('get_public_tier_lists_feed', {
        p_search: options.search?.trim() || null,
        p_type: options.type && options.type !== 'all' ? options.type : null,
        p_sort: options.sort || 'popular',
        p_limit: limit + 1,
        p_offset: offset,
    });

    if (error) {
        console.error('Public tier lists catalog error:', error);
        throw error;
    }

    const mapped = dedupeById(
        ((data || []) as Record<string, unknown>[]).map((row): PublicTierListCard => ({
            id: String(row.id),
            userId: String(row.user_id),
            ownerUsername: String(row.owner_username || 'Kullanıcı'),
            ownerAvatar: typeof row.owner_avatar === 'string' && row.owner_avatar ? row.owner_avatar : undefined,
            ownerRole: normalizeRole(row.owner_role),
            title: String(row.title || ''),
            type: row.type === 'character' ? 'character' : 'manga',
            tierLabels: row.tier_labels && typeof row.tier_labels === 'object' ? (row.tier_labels as Record<string, string>) : {},
            itemsCount: Number(row.items_count || 0),
            likeCount: Number(row.like_count || 0),
            viewerHasLiked: Boolean(row.viewer_has_liked),
            previewTiers: parsePreviewTiers(row.preview_tiers),
            createdAt: String(row.created_at),
        })),
    );

    return {
        items: mapped.slice(0, limit),
        hasMore: mapped.length > limit,
    };
};

export const getPublicReadingListsCatalog = async (options: {
    search?: string;
    sort?: ReadingListDiscoverySort;
    limit?: number;
    offset?: number;
} = {}): Promise<{ items: PublicReadingListCard[]; hasMore: boolean }> => {
    const limit = Math.min(Math.max(options.limit ?? 18, 1), 47);
    const offset = Math.max(options.offset ?? 0, 0);

    const { data, error } = await supabase.rpc('get_public_reading_lists_feed', {
        p_search: options.search?.trim() || null,
        p_sort: options.sort || 'popular',
        p_limit: limit + 1,
        p_offset: offset,
    });

    if (error) {
        console.error('Public reading lists catalog error:', error);
        throw error;
    }

    const mapped = dedupeById(
        ((data || []) as Record<string, unknown>[]).map((row): PublicReadingListCard => ({
            id: String(row.id),
            userId: String(row.user_id),
            ownerUsername: String(row.owner_username || 'Kullanıcı'),
            ownerAvatar: typeof row.owner_avatar === 'string' && row.owner_avatar ? row.owner_avatar : undefined,
            ownerRole: normalizeRole(row.owner_role),
            name: String(row.name || ''),
            description: String(row.description || ''),
            imageUrl: typeof row.image_url === 'string' && row.image_url ? row.image_url : undefined,
            itemsCount: Number(row.items_count || 0),
            likeCount: Number(row.like_count || 0),
            viewerHasLiked: Boolean(row.viewer_has_liked),
            previewCovers: Array.isArray(row.preview_covers)
                ? row.preview_covers.filter((cover: unknown): cover is string => typeof cover === 'string' && Boolean(cover))
                : [],
            createdAt: String(row.created_at),
        })),
    );

    return {
        items: mapped.slice(0, limit),
        hasMore: mapped.length > limit,
    };
};

export const getTierListLikeSummary = async (
    tierListId: string,
): Promise<{ likeCount: number; viewerHasLiked: boolean }> => {
    const { data, error } = await supabase.rpc('get_tier_list_like_summary', {
        p_tier_list_id: tierListId,
    });

    if (error) {
        console.error('Tier list like summary error:', error);
        return { likeCount: 0, viewerHasLiked: false };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
        likeCount: Number(row?.like_count || 0),
        viewerHasLiked: Boolean(row?.viewer_has_liked),
    };
};

export const toggleTierListLike = async (options: {
    tierListId: string;
    userId: string;
    currentlyLiked: boolean;
}): Promise<boolean> => {
    const { tierListId, userId, currentlyLiked } = options;

    if (currentlyLiked) {
        const { error } = await supabase
            .from('tier_list_likes')
            .delete()
            .eq('tier_list_id', tierListId)
            .eq('user_id', userId);

        if (error) {
            throw error;
        }
        return false;
    }

    const { error } = await supabase
        .from('tier_list_likes')
        .insert({
            tier_list_id: tierListId,
            user_id: userId,
        });

    if (error) {
        if (error.code === '23505') {
            return true;
        }
        throw error;
    }

    return true;
};

export const toggleReadingListLike = async (options: {
    listId: string;
    userId: string;
    currentlyLiked: boolean;
}): Promise<boolean> => {
    const { listId, userId, currentlyLiked } = options;

    if (currentlyLiked) {
        const { error } = await supabase
            .from('reading_list_likes')
            .delete()
            .eq('list_id', listId)
            .eq('user_id', userId);

        if (error) {
            throw error;
        }
        return false;
    }

    const { error } = await supabase
        .from('reading_list_likes')
        .insert({
            list_id: listId,
            user_id: userId,
        });

    if (error) {
        if (error.code === '23505') {
            return true;
        }
        throw error;
    }

    return true;
};
