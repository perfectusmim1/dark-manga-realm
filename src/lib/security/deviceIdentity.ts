import { supabase } from '@/lib/supabase';
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

export const checkCurrentAccess = async (
    path = typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/'
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

    const identity = await getDeviceIdentity();
    const { data, error } = await supabase.functions.invoke('check-access', {
        body: {
            ...identity,
            path,
        },
    });

    if (error) {
        throw error;
    }

    return data as AccessCheckResult;
};
