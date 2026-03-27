import { supabase } from '@/lib/supabase';
import { getDeviceIdentity } from './deviceFingerprint';
import { getOfflinePreferences } from '@/lib/offline/preferences';

const isEffectivelyOnline = () => (
    typeof navigator === 'undefined'
    || (navigator.onLine && !getOfflinePreferences().forceOfflineMode)
);

export interface AccessCheckResult {
    allowed: boolean;
    message?: string;
}

export const checkCurrentAccess = async (): Promise<AccessCheckResult> => {
    if (!isEffectivelyOnline()) {
        return { allowed: true, message: undefined };
    }

    const identity = await getDeviceIdentity();
    const { data, error } = await supabase.functions.invoke('check-access', {
        body: identity,
    });

    if (error) {
        throw error;
    }

    return data as AccessCheckResult;
};
