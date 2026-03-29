import { invokeAuthenticatedFunction } from '@/lib/supabase';
import { User, UserBanKind, UserBanRecord, UserWarning } from '@/lib/types';

export interface UserAccessHistory {
  user: User | null;
  warnings: UserWarning[];
  bans: UserBanRecord[];
}

interface UserAccessHistoryResponse {
  success?: boolean;
  message?: string;
  user?: User | null;
  warnings?: UserWarning[];
  bans?: UserBanRecord[];
  autoBan?: { kind: UserBanKind; expiresAt?: string | null; notificationDelivered?: boolean } | null;
  ban?: { kind: UserBanKind; expiresAt?: string | null; notificationDelivered?: boolean } | null;
  warningNotificationDelivered?: boolean | null;
  banNotificationDelivered?: boolean | null;
}

const ensureSuccess = (data: UserAccessHistoryResponse | null | undefined, fallback: string) => {
  if (!data?.success) {
    throw new Error(data?.message || fallback);
  }
};

const normalizeHistory = (data: UserAccessHistoryResponse | null | undefined): UserAccessHistory => ({
  user: data?.user || null,
  warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  bans: Array.isArray(data?.bans) ? data.bans : [],
});

export const getUserAccessHistory = async (
  targetUserId: string,
  accessToken?: string | null,
): Promise<UserAccessHistory> => {
  const data = await invokeAuthenticatedFunction<UserAccessHistoryResponse>('admin-user-access', {
    action: 'history',
    targetUserId,
  }, {
    maxAttempts: 3,
    retryDelayMs: 500,
    preferredAccessToken: accessToken || null,
  });

  ensureSuccess(data, 'USER_HISTORY_FETCH_FAILED');
  return normalizeHistory(data);
};

export const issueUserWarning = async (payload: {
  targetUserId: string;
  title?: string;
  message: string;
  durationHours?: number;
}): Promise<UserAccessHistory & {
  autoBan?: { kind: UserBanKind; expiresAt?: string | null; notificationDelivered?: boolean } | null;
  warningNotificationDelivered?: boolean | null;
  banNotificationDelivered?: boolean | null;
}> => {
  const data = await invokeAuthenticatedFunction<UserAccessHistoryResponse>('admin-user-access', {
    action: 'warn',
    ...payload,
  });

  ensureSuccess(data, 'USER_WARNING_FAILED');
  return {
    ...normalizeHistory(data),
    autoBan: data?.autoBan || null,
    warningNotificationDelivered: data?.warningNotificationDelivered ?? null,
    banNotificationDelivered: data?.banNotificationDelivered ?? null,
  };
};

export const banUserAccount = async (payload: {
  targetUserId: string;
  kind: UserBanKind;
  reason: string;
  durationHours?: number;
}): Promise<UserAccessHistory & {
  ban?: { kind: UserBanKind; expiresAt?: string | null; notificationDelivered?: boolean } | null;
  banNotificationDelivered?: boolean | null;
}> => {
  const data = await invokeAuthenticatedFunction<UserAccessHistoryResponse>('admin-user-access', {
    action: 'ban',
    ...payload,
  });

  ensureSuccess(data, 'USER_BAN_FAILED');
  return {
    ...normalizeHistory(data),
    ban: data?.ban || null,
    banNotificationDelivered: data?.banNotificationDelivered ?? null,
  };
};

export const unbanUserAccount = async (targetUserId: string): Promise<UserAccessHistory> => {
  const data = await invokeAuthenticatedFunction<UserAccessHistoryResponse>('admin-user-access', {
    action: 'unban',
    targetUserId,
  });

  ensureSuccess(data, 'USER_UNBAN_FAILED');
  return normalizeHistory(data);
};

export const deleteUserWarning = async (payload: {
  targetUserId: string;
  warningId: string;
}): Promise<UserAccessHistory> => {
  const data = await invokeAuthenticatedFunction<UserAccessHistoryResponse>('admin-user-access', {
    action: 'delete-warning',
    ...payload,
  });

  ensureSuccess(data, 'USER_WARNING_DELETE_FAILED');
  return normalizeHistory(data);
};
