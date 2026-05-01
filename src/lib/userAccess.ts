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
  maxAttempts?: number;
  bypassBackoff?: boolean;
}

const USER_ACCESS_SNAPSHOT_RETRY_BACKOFF_MS = 3 * 60 * 1000;
const USER_ACCESS_AUTH_RETRY_BACKOFF_MS = 45 * 1000;
const USER_ACCESS_SNAPSHOT_CACHE_TTL_MS = 8_000;
let nextUserAccessSnapshotRetryAt = 0;
const userAccessSnapshotCache = new Map<string, {
  fetchedAt: number;
  value: CurrentUserAccessSnapshot;
}>();
const userAccessSnapshotInflightRequests = new Map<string, Promise<CurrentUserAccessSnapshot>>();

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
  options?.preferredAccessToken?.trim()
    ? options.preferredAccessToken.trim().slice(-24)
    : 'current'
);

const readSnapshotCache = (cacheKey: string): CurrentUserAccessSnapshot | null => {
  const cached = userAccessSnapshotCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.fetchedAt > USER_ACCESS_SNAPSHOT_CACHE_TTL_MS) {
    userAccessSnapshotCache.delete(cacheKey);
    return null;
  }

  return cloneSnapshot(cached.value);
};

const writeSnapshotCache = (cacheKey: string, snapshot: CurrentUserAccessSnapshot) => {
  userAccessSnapshotCache.set(cacheKey, {
    fetchedAt: Date.now(),
    value: cloneSnapshot(snapshot),
  });
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

  userAccessSnapshotCache.clear();
  return normalizeSnapshot(data);
};
