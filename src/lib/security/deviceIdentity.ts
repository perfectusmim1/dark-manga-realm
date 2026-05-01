import { getCurrentAccessToken, supabase } from '@/lib/supabase';
import { getDeviceIdentity } from './deviceFingerprint';
import { getOfflinePreferences } from '@/lib/offline/preferences';
import { AccessDecisionReason, CurrentUserBanState, CurrentUserWarning, User } from '@/lib/types';

const isEffectivelyOnline = () => (
    typeof navigator === 'undefined'
    || (navigator.onLine && !getOfflinePreferences().forceOfflineMode)
);

export interface AccessCheckResult {
    allowed: boolean;
    message?: string;
    reason?: AccessDecisionReason;
    supportOnly?: boolean;
    warning?: CurrentUserWarning | null;
    ban?: CurrentUserBanState;
    user?: Pick<User, 'id' | 'username' | 'email' | 'role' | 'warningCount' | 'unreadWarningCount'> | null;
}

const ACCESS_CHECK_RETRY_DELAYS_MS = [0, 900, 1800];
const ACCESS_CHECK_ALLOWED_CACHE_TTL_MS = 8_000;
const ACCESS_CHECK_BLOCKED_CACHE_TTL_MS = 3_000;
const ACCESS_CHECK_FAILURE_CACHE_TTL_MS = 2_000;
const accessCheckInflightRequests = new Map<string, Promise<AccessCheckResult>>();
const accessCheckResultCache = new Map<string, {
    fetchedAt: number;
    ttlMs: number;
    value: AccessCheckResult;
}>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getAccessCheckErrorStatus = (error: unknown) => {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const maybeContext = 'context' in error ? error.context : null;
    if (maybeContext && typeof maybeContext === 'object') {
        if ('status' in maybeContext && typeof maybeContext.status === 'number') {
            return maybeContext.status;
        }

        if (
            'response' in maybeContext
            && maybeContext.response
            && typeof maybeContext.response === 'object'
            && 'status' in maybeContext.response
            && typeof maybeContext.response.status === 'number'
        ) {
            return maybeContext.response.status;
        }
    }

    return null;
};

const isRetryableAccessCheckError = (error: unknown) => {
    const status = getAccessCheckErrorStatus(error);
    if (status !== null) {
        return [401, 408, 429, 500, 502, 503, 504].includes(status);
    }

    const message = error instanceof Error ? error.message.toLocaleLowerCase('tr-TR') : '';
    return (
        message.includes('fetch')
        || message.includes('network')
        || message.includes('timeout')
        || message.includes('future')
        || message.includes('jwt')
        || message.includes('token')
    );
};

const buildSoftAccessCheckFallback = (): AccessCheckResult => ({
    allowed: true,
    message: undefined,
    reason: 'access_check_failed',
    supportOnly: false,
    warning: null,
    ban: { active: false },
    user: null,
});

const cloneAccessCheckResult = (result: AccessCheckResult): AccessCheckResult => ({
    ...result,
    warning: result.warning ? { ...result.warning } : result.warning,
    ban: result.ban ? { ...result.ban } : result.ban,
    user: result.user ? { ...result.user } : result.user,
});

const getAccessCheckResultCacheTtl = (result: AccessCheckResult) => {
    if (result.reason === 'access_check_failed') {
        return ACCESS_CHECK_FAILURE_CACHE_TTL_MS;
    }

    return result.allowed
        ? ACCESS_CHECK_ALLOWED_CACHE_TTL_MS
        : ACCESS_CHECK_BLOCKED_CACHE_TTL_MS;
};

const readAccessCheckResultCache = (cacheKey: string): AccessCheckResult | null => {
    const cached = accessCheckResultCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    if (Date.now() - cached.fetchedAt > cached.ttlMs) {
        accessCheckResultCache.delete(cacheKey);
        return null;
    }

    return cloneAccessCheckResult(cached.value);
};

const writeAccessCheckResultCache = (cacheKey: string, result: AccessCheckResult) => {
    accessCheckResultCache.set(cacheKey, {
        fetchedAt: Date.now(),
        ttlMs: getAccessCheckResultCacheTtl(result),
        value: cloneAccessCheckResult(result),
    });
};

const getAccessCheckCacheKey = async (
    path: string,
    preferredAccessToken?: string | null,
) => {
    const tokenKey = preferredAccessToken?.trim()
        ? preferredAccessToken.trim().slice(-24)
        : (await supabase.auth.getSession()).data.session?.access_token?.slice(-24) || 'anon';
    return `${tokenKey}:${path}`;
};

export const checkCurrentAccess = async (
    path = typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/',
    options?: {
        preferredAccessToken?: string | null;
    },
): Promise<AccessCheckResult> => {
    if (!isEffectivelyOnline()) {
        return {
            allowed: true,
            message: undefined,
            reason: 'ok',
            supportOnly: false,
            warning: null,
            ban: { active: false },
            user: null,
        };
    }

    const preferredAccessToken = options?.preferredAccessToken?.trim() || null;
    const cacheKey = await getAccessCheckCacheKey(path, preferredAccessToken);
    const cachedResult = readAccessCheckResultCache(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    const inflightRequest = accessCheckInflightRequests.get(cacheKey);
    if (inflightRequest) {
        try {
            return cloneAccessCheckResult(await inflightRequest);
        } catch (error) {
            if (isRetryableAccessCheckError(error)) {
                return buildSoftAccessCheckFallback();
            }

            throw error;
        }
    }

    const request = (async () => {
        const identity = await getDeviceIdentity();
        let lastError: unknown = null;

        for (const [attemptIndex, retryDelay] of ACCESS_CHECK_RETRY_DELAYS_MS.entries()) {
            if (retryDelay > 0) {
                await sleep(retryDelay);
            }

            const accessToken = preferredAccessToken || await getCurrentAccessToken({
                forceRefresh: attemptIndex > 0,
                required: false,
            });

            const { data, error } = await supabase.functions.invoke('check-access', {
                body: {
                    ...identity,
                    path,
                },
                headers: accessToken
                    ? {
                        Authorization: `Bearer ${accessToken}`,
                    }
                    : undefined,
            });

            if (!error) {
                return data as AccessCheckResult;
            }

            const status = getAccessCheckErrorStatus(error);
            if (status === 403 && data && typeof data === 'object' && 'allowed' in data) {
                return data as AccessCheckResult;
            }

            lastError = error;
            const shouldRetry = attemptIndex < ACCESS_CHECK_RETRY_DELAYS_MS.length - 1 && isRetryableAccessCheckError(error);
            if (!shouldRetry) {
                throw error;
            }
        }

        throw lastError;
    })();

    accessCheckInflightRequests.set(cacheKey, request);

    try {
        const result = await request;
        writeAccessCheckResultCache(cacheKey, result);
        return cloneAccessCheckResult(result);
    } catch (error) {
        if (isRetryableAccessCheckError(error)) {
            const fallback = buildSoftAccessCheckFallback();
            writeAccessCheckResultCache(cacheKey, fallback);
            return fallback;
        }

        throw error;
    } finally {
        if (accessCheckInflightRequests.get(cacheKey) === request) {
            accessCheckInflightRequests.delete(cacheKey);
        }
    }
};

export const recoverAccessCheckFailure = (error: unknown, context: string): AccessCheckResult => {
    console.error(context, error);
    return buildSoftAccessCheckFallback();
};
