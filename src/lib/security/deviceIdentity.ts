import { supabase } from '@/lib/supabase';
import { getDeviceIdentity } from './deviceFingerprint';
import { getOfflinePreferences } from '@/lib/offline/preferences';

const isEffectivelyOnline = () => (
    typeof navigator === 'undefined'
    || (navigator.onLine && !getOfflinePreferences().forceOfflineMode)
);

export const checkCurrentAccess = async () => {
    if (!isEffectivelyOnline()) {
        return { allowed: true };
    }

    const identity = await getDeviceIdentity();
    const { data, error } = await supabase.functions.invoke('check-access', {
        body: identity,
    });

    if (error) {
        throw error;
    }

    return data as { allowed: boolean; message?: string };
};
