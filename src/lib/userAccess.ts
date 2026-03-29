import { getAuthenticatedFunctionHeaders, supabase } from '@/lib/supabase';
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

const invokeUserAccessState = async (body: Record<string, unknown>) => {
  const headers = await getAuthenticatedFunctionHeaders();

  return supabase.functions.invoke<UserAccessSnapshotResponse>('user-access-state', {
    body,
    headers,
  });
};

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

export const getCurrentUserAccessSnapshot = async (): Promise<CurrentUserAccessSnapshot> => {
  const { data, error } = await invokeUserAccessState({
    action: 'get',
  });

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(data?.message || 'USER_ACCESS_STATE_FAILED');
  }

  return normalizeSnapshot(data);
};

export const acknowledgeCurrentUserWarning = async (
  warningId: string,
): Promise<CurrentUserAccessSnapshot> => {
  const { data, error } = await invokeUserAccessState({
    action: 'acknowledge-warning',
    warningId,
  });

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(data?.message || 'WARNING_ACK_FAILED');
  }

  return normalizeSnapshot(data);
};
