import { invokeAuthenticatedFunction, isAuthSessionUnavailableError } from '@/lib/supabase';
import { CurrentUserBanState, CurrentUserWarning } from '@/lib/types';

export interface CurrentUserAccessSnapshot {
  warning: CurrentUserWarning | null;
  ban: CurrentUserBanState;
  warningCount: number;
  unreadWarningCount: number;
}

interface UserAccessSnapshotResponse {
  success?: boolean;
  message?: string;
  warning?: CurrentUserWarning | null;
  ban?: CurrentUserBanState;
  warningCount?: number;
  unreadWarningCount?: number;
}

interface UserAccessSnapshotRequestOptions {
  preferredAccessToken?: string | null;
  userId?: string | null;
  maxAttempts?: number;
  bypassBackoff?: boolean;
}

const USER_ACCESS_SNAPSHOT_RETRY_BACKOFF_MS = 3 * 60 * 1000;
const USER_ACCESS_AUTH_RETRY_BACKOFF_MS = 45 * 1000;
const USER_ACCESS_SNAPSHOT_CACHE_TTL_MS = 60_000;
const USER_ACCESS_SNAPSHOT_SESSION_PREFIX = 'toonparrot:user-access-snap:v1:';
let nextUserAccessSnapshotRetryAt = 0;
const userAccessSnapshotCache = new Map<string, {
  fetchedAt: number;
  value: CurrentUserAccessSnapshot;
}>();
const userAccessSnapshotInflightRequests = new Map<string, Promise<CurrentUserAccessSnapshot>>();

const decodeUserIdFromJwt = (token?: string | null): string | null => {
  const cleanToken = token?.trim();
  if (!cleanToken) {
    return null;
  }

  try {
    const [, payload] = cleanToken.split('.');
    if (!payload) {
      return null;
    }

    const normalized = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(normalized)) as { sub?: unknown };
    return typeof parsed?.sub === 'string' && parsed.sub.trim() ? parsed.sub.trim() : null;
  } catch {
    return null;
  }
};

const resolveSnapshotUserId = (options?: UserAccessSnapshotRequestOptions): string => {
  if (options?.userId?.trim()) {
    return options.userId.trim();
  }

  const jwtUserId = decodeUserIdFromJwt(options?.preferredAccessToken);
  if (jwtUserId) {
    return jwtUserId;
  }

  if (typeof window !== 'undefined') {
    try {
      const persistedUserId = window.sessionStorage.getItem('toonparrot_auth_user_id_v1');
      if (persistedUserId && persistedUserId !== '__anon__') {
        return persistedUserId;
      }
    } catch {
      // ignore storage errors
    }
  }

  return 'current';
};

const isRestrictedSnapshot = (snapshot: CurrentUserAccessSnapshot): boolean => (
  Boolean(snapshot.ban?.active) || Boolean(snapshot.warning)
);

const readPersistedSnapshotCache = (userKey: string): CurrentUserAccessSnapshot | null => {
  if (typeof window === 'undefined' || !userKey || userKey === 'current') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(`${USER_ACCESS_SNAPSHOT_SESSION_PREFIX}${userKey}`);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      userId?: unknown;
      fetchedAt?: unknown;
      value?: CurrentUserAccessSnapshot;
    };

    if (
      !parsed
      || parsed.userId !== userKey
      || typeof parsed.fetchedAt !== 'number'
      || !parsed.value
      || Date.now() - parsed.fetchedAt > USER_ACCESS_SNAPSHOT_CACHE_TTL_MS
      || isRestrictedSnapshot(parsed.value)
    ) {
      window.sessionStorage.removeItem(`${USER_ACCESS_SNAPSHOT_SESSION_PREFIX}${userKey}`);
      return null;
    }

    return cloneSnapshot(parsed.value);
  } catch {
    return null;
  }
};

const writePersistedSnapshotCache = (userKey: string, snapshot: CurrentUserAccessSnapshot) => {
  if (typeof window === 'undefined' || !userKey || userKey === 'current') {
    return;
  }

  const storageKey = `${USER_ACCESS_SNAPSHOT_SESSION_PREFIX}${userKey}`;
  try {
    if (isRestrictedSnapshot(snapshot)) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }

    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        userId: userKey,
        fetchedAt: Date.now(),
        value: cloneSnapshot(snapshot),
      }),
    );
  } catch {
    // ignore quota errors
  }
};

export const clearUserAccessSnapshotCache = () => {
  userAccessSnapshotCache.clear();
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(USER_ACCESS_SNAPSHOT_SESSION_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
};

const invokeUserAccessState = (
  body: Record<string, unknown>,
  options?: UserAccessSnapshotRequestOptions,
) => (
  invokeAuthenticatedFunction<UserAccessSnapshotResponse>('user-access-state', body, {
    maxAttempts: options?.maxAttempts,
    preferredAccessToken: options?.preferredAccessToken,
  })
);

const normalizeSnapshot = (payload: UserAccessSnapshotResponse | null | undefined): CurrentUserAccessSnapshot => ({
  warning: payload?.warning
    ? {
      id: payload.warning.id,
      title: payload.warning.title,
      message: payload.warning.message,
      createdAt: payload.warning.createdAt,
    }
    : null,
  ban: payload?.ban
    ? {
      active: Boolean(payload.ban.active),
      type: payload.ban.type ?? null,
      reason: payload.ban.reason ?? null,
      expiresAt: payload.ban.expiresAt ?? null,
      bannedAt: payload.ban.bannedAt ?? null,
    }
    : {
      active: false,
      type: null,
      reason: null,
      expiresAt: null,
      bannedAt: null,
    },
  warningCount: Number(payload?.warningCount) || 0,
  unreadWarningCount: Number(payload?.unreadWarningCount) || 0,
});

const cloneSnapshot = (snapshot: CurrentUserAccessSnapshot): CurrentUserAccessSnapshot => ({
  warning: snapshot.warning ? { ...snapshot.warning } : null,
  ban: { ...snapshot.ban },
  warningCount: snapshot.warningCount,
  unreadWarningCount: snapshot.unreadWarningCount,
});

const getSnapshotCacheKey = (options?: UserAccessSnapshotRequestOptions) => (
  resolveSnapshotUserId(options)
);

const readSnapshotCache = (cacheKey: string): CurrentUserAccessSnapshot | null => {
  const cached = userAccessSnapshotCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.fetchedAt > USER_ACCESS_SNAPSHOT_CACHE_TTL_MS || isRestrictedSnapshot(cached.value)) {
      userAccessSnapshotCache.delete(cacheKey);
    } else {
      return cloneSnapshot(cached.value);
    }
  }

  const persisted = readPersistedSnapshotCache(cacheKey);
  if (persisted) {
    userAccessSnapshotCache.set(cacheKey, {
      fetchedAt: Date.now(),
      value: cloneSnapshot(persisted),
    });
    return persisted;
  }

  return null;
};

const writeSnapshotCache = (cacheKey: string, snapshot: CurrentUserAccessSnapshot) => {
  if (isRestrictedSnapshot(snapshot)) {
    userAccessSnapshotCache.delete(cacheKey);
    writePersistedSnapshotCache(cacheKey, snapshot);
    return;
  }

  userAccessSnapshotCache.set(cacheKey, {
    fetchedAt: Date.now(),
    value: cloneSnapshot(snapshot),
  });
  writePersistedSnapshotCache(cacheKey, snapshot);
};

export const getCurrentUserAccessSnapshot = async (
  options?: UserAccessSnapshotRequestOptions,
): Promise<CurrentUserAccessSnapshot> => {
  if (!options?.bypassBackoff && Date.now() < nextUserAccessSnapshotRetryAt) {
    throw new Error('USER_ACCESS_STATE_BACKOFF_ACTIVE');
  }

  const cacheKey = getSnapshotCacheKey(options);
  const cachedSnapshot = readSnapshotCache(cacheKey);
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const inflightRequest = userAccessSnapshotInflightRequests.get(cacheKey);
  if (inflightRequest) {
    return cloneSnapshot(await inflightRequest);
  }

  const request = (async () => {
    let data: UserAccessSnapshotResponse | null | undefined;
    try {
      data = await invokeUserAccessState({
        action: 'get',
      }, {
        maxAttempts: options?.maxAttempts ?? 2,
        preferredAccessToken: options?.preferredAccessToken,
      });
    } catch (error) {
      nextUserAccessSnapshotRetryAt = Date.now() + (
        isAuthSessionUnavailableError(error)
          ? USER_ACCESS_AUTH_RETRY_BACKOFF_MS
          : USER_ACCESS_SNAPSHOT_RETRY_BACKOFF_MS
      );
      throw error;
    }

    if (!data?.success) {
      nextUserAccessSnapshotRetryAt = Date.now() + USER_ACCESS_SNAPSHOT_RETRY_BACKOFF_MS;
      throw new Error(data?.message || 'USER_ACCESS_STATE_FAILED');
    }

    nextUserAccessSnapshotRetryAt = 0;
    return normalizeSnapshot(data);
  })();

  userAccessSnapshotInflightRequests.set(cacheKey, request);

  try {
    const snapshot = await request;
    writeSnapshotCache(cacheKey, snapshot);
    return cloneSnapshot(snapshot);
  } finally {
    if (userAccessSnapshotInflightRequests.get(cacheKey) === request) {
      userAccessSnapshotInflightRequests.delete(cacheKey);
    }
  }
};

export const acknowledgeCurrentUserWarning = async (
  warningId: string,
): Promise<CurrentUserAccessSnapshot> => {
  const data = await invokeUserAccessState({
    action: 'acknowledge-warning',
    warningId,
  });

  if (!data?.success) {
    throw new Error(data?.message || 'WARNING_ACK_FAILED');
  }

  clearUserAccessSnapshotCache();
  return normalizeSnapshot(data);
};
