import { createClient, type Session } from '@supabase/supabase-js';
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

const withTimeout = async <T>(operation: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
    });

    try {
        return await Promise.race([operation, timeoutPromise]);
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }
};

const getSupabaseErrorStatus = (error: unknown): number | null => {
    if (!error || typeof error !== 'object') {
        return null;
    }

    if ('status' in error && typeof error.status === 'number') {
        return error.status;
    }

    const context = 'context' in error ? error.context : null;
    if (!context || typeof context !== 'object') {
        return null;
    }

    if ('status' in context && typeof context.status === 'number') {
        return context.status;
    }

    if (
        'response' in context
        && context.response
        && typeof context.response === 'object'
        && 'status' in context.response
        && typeof context.response.status === 'number'
    ) {
        return context.response.status;
    }

    return null;
};

const getSupabaseErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') {
        return error.toLowerCase();
    }

    if (error instanceof Error) {
        return error.message.toLowerCase();
    }

    if (
        error
        && typeof error === 'object'
        && 'message' in error
        && typeof error.message === 'string'
    ) {
        return error.message.toLowerCase();
    }

    return '';
};

export const isRetryableSupabaseBootstrapError = (error: unknown, status?: number | null) => {
    const resolvedStatus = status ?? getSupabaseErrorStatus(error);
    if (resolvedStatus !== null && [401, 408, 425, 429, 500, 502, 503, 504].includes(resolvedStatus)) {
        return true;
    }

    const normalizedMessage = getSupabaseErrorMessage(error);
    return normalizedMessage.includes('invalid jwt')
        || normalizedMessage.includes('jwt')
        || normalizedMessage.includes('token')
        || normalizedMessage.includes('unauthorized')
        || normalizedMessage.includes('not yet valid')
        || normalizedMessage.includes('issued in the future')
        || normalizedMessage.includes('future')
        || normalizedMessage.includes('timeout')
        || normalizedMessage.includes('failed to send a request to the edge function');
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

const decodeJwtPayload = (token: string) => {
    try {
        const [, payload] = token.split('.');
        if (!payload) {
            return null;
        }

        const normalizedPayload = payload
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(payload.length / 4) * 4, '=');

        return JSON.parse(atob(normalizedPayload)) as {
            iat?: number;
            nbf?: number;
        };
    } catch {
        return null;
    }
};

const getSessionFutureDelayMs = (session: Session | null | undefined) => {
    const payload = session?.access_token ? decodeJwtPayload(session.access_token) : null;
    if (!payload) {
        return 0;
    }

    const notBeforeSeconds = Math.max(payload.iat || 0, payload.nbf || 0);
    if (!notBeforeSeconds) {
        return 0;
    }

    return Math.max(0, (notBeforeSeconds * 1000) - Date.now());
};

const SESSION_STABILIZATION_RETRY_DELAYS_MS = [0, 120, 240];
let inflightSessionStabilization: Promise<Session | null> | null = null;

export const waitForUsableSupabaseSession = async (options?: {
    preferredSession?: Session | null;
    forceRefresh?: boolean;
    required?: boolean;
    maxWaitMs?: number;
}) => {
    const {
        preferredSession = null,
        forceRefresh = false,
        required = false,
        maxWaitMs = 2200,
    } = options || {};

    const canReuseInflight = !preferredSession && !forceRefresh && !required;
    if (canReuseInflight && inflightSessionStabilization) {
        return inflightSessionStabilization;
    }

    const run = async (): Promise<Session | null> => {
        if (forceRefresh) {
            await refreshSupabaseSession();
        }

        let candidateSession = preferredSession;
        let waitedMs = 0;

        for (let attempt = 0; attempt < SESSION_STABILIZATION_RETRY_DELAYS_MS.length; attempt += 1) {
            const retryDelay = SESSION_STABILIZATION_RETRY_DELAYS_MS[attempt];
            if (retryDelay > 0) {
                await waitFor(retryDelay);
                waitedMs += retryDelay;
                candidateSession = null;
            }

            if (!candidateSession) {
                const { data, error } = await supabase.auth.getSession();
                if (error) {
                    if (attempt === SESSION_STABILIZATION_RETRY_DELAYS_MS.length - 1) {
                        if (!required && isRetryableSupabaseBootstrapError(error)) {
                            return null;
                        }

                        throw error;
                    }

                    continue;
                }

                candidateSession = data.session;
            }

            if (!candidateSession?.access_token) {
                if (!required) {
                    return null;
                }

                continue;
            }

            const futureDelayMs = getSessionFutureDelayMs(candidateSession);
            if (futureDelayMs <= 0) {
                return candidateSession;
            }

            const remainingBudgetMs = Math.max(0, maxWaitMs - waitedMs);
            const stabilizationDelayMs = Math.min(futureDelayMs + 150, remainingBudgetMs || futureDelayMs + 150);
            if (stabilizationDelayMs > 0) {
                await waitFor(stabilizationDelayMs);
                waitedMs += stabilizationDelayMs;
            }

            candidateSession = null;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) {
            if (!required && isRetryableSupabaseBootstrapError(error)) {
                return null;
            }

            throw error;
        }

        return data.session;
    };

    const promise = run().finally(() => {
        if (canReuseInflight && inflightSessionStabilization === promise) {
            inflightSessionStabilization = null;
        }
    });

    if (canReuseInflight) {
        inflightSessionStabilization = promise;
    }

    return promise;
};

const shouldRetryFunctionAuth = (status: number, message: string | null) =>
    isRetryableSupabaseBootstrapError(message || '', status);

export const getAuthenticatedFunctionHeaders = async (options?: { forceRefresh?: boolean; maxWaitMs?: number }) => {
    const accessToken = await getCurrentAccessToken({
        forceRefresh: options?.forceRefresh,
        required: true,
        maxWaitMs: options?.maxWaitMs ?? 5000,
    });

    if (accessToken) {
        return {
            Authorization: `Bearer ${accessToken}`,
        };
    }

    throw new Error('AUTH_SESSION_UNAVAILABLE');
};

export const getCurrentAccessToken = async (options?: {
    forceRefresh?: boolean;
    required?: boolean;
    maxWaitMs?: number;
}) => {
    const session = await waitForUsableSupabaseSession({
        forceRefresh: options?.forceRefresh,
        required: options?.required ?? false,
        maxWaitMs: options?.maxWaitMs ?? 5000,
    });

    return session?.access_token ?? null;
};

export const runWithSupabaseBootstrapRetry = async <T>(options: {
    run: () => Promise<T>;
    timeoutMs?: number;
    timeoutMessage: string;
    shouldRetryResult?: (result: T) => boolean;
}) => {
    const {
        run,
        timeoutMs = 6000,
        timeoutMessage,
        shouldRetryResult,
    } = options;

    const execute = async (forceRefresh: boolean) => {
        await waitForUsableSupabaseSession({
            forceRefresh,
            required: false,
        });

        return withTimeout(run(), timeoutMs, timeoutMessage);
    };

    let result: T;
    try {
        result = await execute(false);
    } catch (error) {
        if (!isRetryableSupabaseBootstrapError(error)) {
            throw error;
        }

        return execute(true);
    }

    if (shouldRetryResult?.(result)) {
        return execute(true);
    }

    return result;
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

const getFunctionErrorMessage = async (error: unknown) => {
    const fallbackMessage = error instanceof Error
        ? error.message
        : 'Edge Function invocation failed';

    if (
        !error
        || typeof error !== 'object'
        || !('context' in error)
        || !(error.context instanceof Response)
    ) {
        return {
            status: getSupabaseErrorStatus(error),
            message: fallbackMessage,
        };
    }

    const response = error.context;
    const parsedBody = await parseFunctionResponse(response.clone()).catch(() => null);
    const parsedMessage = typeof parsedBody === 'object'
        && parsedBody
        && 'message' in parsedBody
        && typeof parsedBody.message === 'string'
        ? parsedBody.message
        : typeof parsedBody === 'string' && parsedBody
            ? parsedBody
            : fallbackMessage;

    return {
        status: response.status,
        message: parsedMessage,
    };
};

export const invokeAuthenticatedFunction = async <TResponse>(
    functionName: string,
    body: unknown,
) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const headers = await getAuthenticatedFunctionHeaders({
            forceRefresh: attempt > 0,
            maxWaitMs: 5000 + (attempt * 1200),
        });

        const { data, error } = await supabase.functions.invoke<TResponse>(functionName, {
            body,
            headers,
        });

        if (!error) {
            return data;
        }

        const { status, message } = await getFunctionErrorMessage(error);
        if (attempt < 2 && shouldRetryFunctionAuth(status ?? 0, message)) {
            await waitFor(350 * (attempt + 1));
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
