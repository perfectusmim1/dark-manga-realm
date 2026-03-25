import { supabase } from '@/lib/supabase';
import { getDeviceIdentity } from './deviceFingerprint';

export const checkCurrentAccess = async () => {
    const identity = await getDeviceIdentity();
    const { data, error } = await supabase.functions.invoke('check-access', {
        body: identity,
    });

    if (error) {
        throw error;
    }

    return data as { allowed: boolean; message?: string };
};
