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
let nextUserAccessSnapshotRetryAt = 0;

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

export const getCurrentUserAccessSnapshot = async (
  options?: UserAccessSnapshotRequestOptions,
): Promise<CurrentUserAccessSnapshot> => {
  if (!options?.bypassBackoff && Date.now() < nextUserAccessSnapshotRetryAt) {
    throw new Error('USER_ACCESS_STATE_BACKOFF_ACTIVE');
  }

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

  return normalizeSnapshot(data);
};
