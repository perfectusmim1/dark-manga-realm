import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AdminAccessContext, getAdminAccessContext, getCachedAdminAccessContext } from '@/lib/database';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { isExpectedAccessControlError } from '@/lib/supabase';

const DEFAULT_ACCESS: AdminAccessContext = {
    canAccessAdminPanel: false,
    isPrimaryAdmin: false,
};

export const useAdminAccess = (options?: { requireOnlineValidation?: boolean }) => {
    const { user, isLoading: authLoading } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const requireOnlineValidation = options?.requireOnlineValidation ?? false;
    const [access, setAccess] = useState<AdminAccessContext>(
        () => getCachedAdminAccessContext(user?.id) || DEFAULT_ACCESS
    );
    const [isLoading, setIsLoading] = useState(
        () => Boolean(user?.id) && !getCachedAdminAccessContext(user?.id)
    );

    useEffect(() => {
        if (authLoading) {
            return;
        }

        if (!isOnline) {
            setAccess(getCachedAdminAccessContext(user?.id) || DEFAULT_ACCESS);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;

        const loadAccess = async () => {
            if (!user?.id) {
                setAccess(DEFAULT_ACCESS);
                setIsLoading(false);
                return;
            }

            const cachedAccess = getCachedAdminAccessContext(user.id);
            if (cachedAccess) {
                setAccess(cachedAccess);
                setIsLoading(requireOnlineValidation);
            } else {
                setIsLoading(true);
            }

            try {
                const nextAccess = await getAdminAccessContext();

                if (!isCancelled) {
                    setAccess(nextAccess);
                }
            } catch (error) {
                if (!isExpectedAccessControlError(error)) {
                    console.error('Admin access load error:', error);
                }
                if (!isCancelled) {
                    setAccess(DEFAULT_ACCESS);
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        void loadAccess();

        return () => {
            isCancelled = true;
        };
    }, [authLoading, isOnline, requireOnlineValidation, user?.id]);

    return {
        access,
        isLoading: authLoading || isLoading,
    };
};
