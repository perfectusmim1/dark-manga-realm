import { createClient } from '@supabase/supabase-js';
import { getDeviceIdentity } from '@/lib/security/deviceFingerprint';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL veya Anon Key tanımlanmamış! .env dosyasını kontrol edin.');
}

let cachedDeviceIdentity: Awaited<ReturnType<typeof getDeviceIdentity>> | null = null;
let cachedDeviceIdentityPromise: Promise<Awaited<ReturnType<typeof getDeviceIdentity>>> | null = null;

const getCachedDeviceIdentity = async () => {
    if (typeof window === 'undefined') {
        return null;
    }

    if (cachedDeviceIdentity) {
        return cachedDeviceIdentity;
    }

    if (!cachedDeviceIdentityPromise) {
        cachedDeviceIdentityPromise = getDeviceIdentity()
            .then((identity) => {
                cachedDeviceIdentity = identity;
                return identity;
            })
            .finally(() => {
                cachedDeviceIdentityPromise = null;
            });
    }

    return cachedDeviceIdentityPromise;
};

const shouldAttachDeviceHeaders = (input: RequestInfo | URL) => {
    const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;

    return requestUrl.startsWith(`${supabaseUrl}/rest/v1/`);
};

const supabaseFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);

    if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => {
            headers.set(key, value);
        });
    }

    try {
        if (shouldAttachDeviceHeaders(input)) {
            const identity = await getCachedDeviceIdentity();
            if (identity) {
                headers.set('x-device-hash', identity.deviceHash);
            }
        }
    } catch (error) {
        console.error('Supabase device header injection failed:', error);
    }

    return globalThis.fetch(input, {
        ...init,
        headers,
    });
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
        fetch: supabaseFetch,
    },
});

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryFunctionAuth = (status: number, message: string | null) => {
    if (status !== 401) {
        return false;
    }

    const normalizedMessage = message?.toLowerCase() || '';
    return normalizedMessage.includes('invalid jwt')
        || normalizedMessage.includes('jwt')
        || normalizedMessage.includes('token')
        || normalizedMessage.includes('unauthorized')
        || normalizedMessage.includes('not yet valid')
        || normalizedMessage.includes('future');
};

const refreshSupabaseSession = async () => {
    try {
        const { data } = await supabase.auth.refreshSession();
        return data.session?.access_token || null;
    } catch (error) {
        console.error('Supabase session refresh failed:', error);
        return null;
    }
};

export const getAuthenticatedFunctionHeaders = async (options?: { forceRefresh?: boolean }) => {
    if (options?.forceRefresh) {
        const refreshedAccessToken = await refreshSupabaseSession();
        if (refreshedAccessToken) {
            return {
                Authorization: `Bearer ${refreshedAccessToken}`,
            };
        }
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;

        if (accessToken) {
            return {
                Authorization: `Bearer ${accessToken}`,
            };
        }

        if (attempt < 5) {
            await waitFor(attempt < 2 ? 150 : 300);
        }
    }

    return {};
};

const parseFunctionResponse = async (response: Response) => {
    const raw = await response.text();

    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return raw;
    }
};

export const invokeAuthenticatedFunction = async <TResponse>(
    functionName: string,
    body: unknown,
) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const authHeaders = await getAuthenticatedFunctionHeaders({
            forceRefresh: attempt > 0,
        });
        const response = await globalThis.fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                ...authHeaders,
            },
            body: JSON.stringify(body),
        });

        const data = await parseFunctionResponse(response);
        const message = typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
            ? data.message
            : typeof data === 'string' && data
                ? data
                : `Edge Function returned ${response.status}`;

        if (response.ok) {
            return data as TResponse;
        }

        if (attempt === 0 && shouldRetryFunctionAuth(response.status, message)) {
            await waitFor(200);
            continue;
        }

        throw new Error(message);
    }

    throw new Error('Authenticated function call failed');
};

// Database types (will be expanded as we create tables)
export type Database = {
    public: {
        Tables: {
            mangas: {
                Row: {
                    id: string;
                    title: string;
                    author: string;
                    artist: string | null;
                    description: string;
                    cover: string;
                    banner: string | null;
                    genres: string[];
                    status: 'ongoing' | 'completed' | 'hiatus';
                    type: 'manga' | 'manhwa' | 'manhua' | 'webtoon';
                    views: number;
                    created_at: string;
                    last_updated: string;
                };
                Insert: Omit<Database['public']['Tables']['mangas']['Row'], 'id' | 'created_at' | 'views'> & {
                    id?: string;
                    created_at?: string;
                    views?: number;
                };
                Update: Partial<Database['public']['Tables']['mangas']['Insert']>;
            };
            chapters: {
                Row: {
                    id: string;
                    manga_id: string;
                    number: number;
                    title: string;
                    pages: string[];
                    views: number;
                    release_date: string;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['chapters']['Row'], 'id' | 'created_at' | 'views'> & {
                    id?: string;
                    created_at?: string;
                    views?: number;
                };
                Update: Partial<Database['public']['Tables']['chapters']['Insert']>;
            };
            users: {
                Row: {
                    id: string;
                    username: string;
                    username_last_changed_at: string | null;
                    email: string;
                    password_hash: string;
                    avatar: string | null;
                    role: 'user' | 'admin' | 'moderator';
                    is_banned: boolean;
                    ban_reason: string | null;
                    banned_at: string | null;
                    banned_by: string | null;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['users']['Insert']>;
            };
            comments: {
                Row: {
                    id: string;
                    manga_id: string;
                    chapter_id: string | null;
                    page_number: number | null;
                    user_id: string;
                    content: string;
                    gif_url: string | null;
                    parent_id: string | null;
                    likes: number;
                    created_at: string;
                    updated_at: string | null;
                };
                Insert: Omit<Database['public']['Tables']['comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['comments']['Insert']>;
            };
            ratings: {
                Row: {
                    id: string;
                    manga_id: string;
                    user_id: string;
                    rating: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['ratings']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['ratings']['Insert']>;
            };
            favorites: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    category: 'reading' | 'completed' | 'plan_to_read' | 'on_hold' | 'dropped';
                    added_at: string;
                };
                Insert: Omit<Database['public']['Tables']['favorites']['Row'], 'id' | 'added_at'> & {
                    id?: string;
                    added_at?: string;
                };
                Update: Partial<Database['public']['Tables']['favorites']['Insert']>;
            };
            reading_progress: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    chapter_id: string;
                    page: number;
                    last_read: string;
                };
                Insert: Omit<Database['public']['Tables']['reading_progress']['Row'], 'id'> & {
                    id?: string;
                };
                Update: Partial<Database['public']['Tables']['reading_progress']['Insert']>;
            };
            bookmarks: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    chapter_id: string;
                    page: number;
                    note: string | null;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['bookmarks']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['bookmarks']['Insert']>;
            };
            comment_likes: {
                Row: {
                    id: string;
                    comment_id: string;
                    user_id: string;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['comment_likes']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['comment_likes']['Insert']>;
            };
            follows: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    followed_at: string;
                };
                Insert: Omit<Database['public']['Tables']['follows']['Row'], 'id' | 'followed_at'> & {
                    id?: string;
                    followed_at?: string;
                };
                Update: Partial<Database['public']['Tables']['follows']['Insert']>;
            };
            notifications: {
                Row: {
                    id: string;
                    user_id: string;
                    type: string;
                    title: string;
                    message: string;
                    link: string | null;
                    read: boolean;
                    created_at: string;
                    manga_id: string | null;
                    chapter_id: string | null;
                };
                Insert: Omit<Database['public']['Tables']['notifications']['Row'], 'id' | 'created_at' | 'read'> & {
                    id?: string;
                    created_at?: string;
                    read?: boolean;
                };
                Update: Partial<Database['public']['Tables']['notifications']['Insert']>;
            };
            characters: {
                Row: {
                    id: string;
                    name: string;
                    image_url: string | null;
                    description: string | null;
                    likes_count: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['characters']['Row'], 'id' | 'created_at' | 'likes_count'> & {
                    id?: string;
                    created_at?: string;
                    likes_count?: number;
                };
                Update: Partial<Database['public']['Tables']['characters']['Insert']>;
            };
            authors: {
                Row: {
                    id: string;
                    name: string;
                    image_url: string | null;
                    description: string | null;
                    likes_count: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['authors']['Row'], 'id' | 'created_at' | 'likes_count'> & {
                    id?: string;
                    created_at?: string;
                    likes_count?: number;
                };
                Update: Partial<Database['public']['Tables']['authors']['Insert']>;
            };
            artists: {
                Row: {
                    id: string;
                    name: string;
                    image_url: string | null;
                    description: string | null;
                    likes_count: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['artists']['Row'], 'id' | 'created_at' | 'likes_count'> & {
                    id?: string;
                    created_at?: string;
                    likes_count?: number;
                };
                Update: Partial<Database['public']['Tables']['artists']['Insert']>;
            };
            manga_characters: {
                Row: {
                    manga_id: string;
                    character_id: string;
                };
                Insert: Database['public']['Tables']['manga_characters']['Row'];
                Update: Partial<Database['public']['Tables']['manga_characters']['Insert']>;
            };
            manga_authors: {
                Row: {
                    manga_id: string;
                    author_id: string;
                };
                Insert: Database['public']['Tables']['manga_authors']['Row'];
                Update: Partial<Database['public']['Tables']['manga_authors']['Insert']>;
            };
            manga_artists: {
                Row: {
                    manga_id: string;
                    artist_id: string;
                };
                Insert: Database['public']['Tables']['manga_artists']['Row'];
                Update: Partial<Database['public']['Tables']['manga_artists']['Insert']>;
            };
            character_likes: {
                Row: {
                    user_id: string;
                    character_id: string;
                };
                Insert: Database['public']['Tables']['character_likes']['Row'];
                Update: Partial<Database['public']['Tables']['character_likes']['Insert']>;
            };
            author_likes: {
                Row: {
                    user_id: string;
                    author_id: string;
                };
                Insert: Database['public']['Tables']['author_likes']['Row'];
                Update: Partial<Database['public']['Tables']['author_likes']['Insert']>;
            };
            artist_likes: {
                Row: {
                    user_id: string;
                    artist_id: string;
                };
                Insert: Database['public']['Tables']['artist_likes']['Row'];
                Update: Partial<Database['public']['Tables']['artist_likes']['Insert']>;
            };
            character_comments: {
                Row: {
                    id: string;
                    character_id: string;
                    user_id: string;
                    content: string;
                    likes: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['character_comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['character_comments']['Insert']>;
            };
            author_comments: {
                Row: {
                    id: string;
                    author_id: string;
                    user_id: string;
                    content: string;
                    likes: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['author_comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['author_comments']['Insert']>;
            };
            artist_comments: {
                Row: {
                    id: string;
                    artist_id: string;
                    user_id: string;
                    content: string;
                    likes: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['artist_comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['artist_comments']['Insert']>;
            };
        };
    };
};
