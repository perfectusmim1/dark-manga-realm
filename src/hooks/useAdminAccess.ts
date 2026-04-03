import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminAccessContext } from '@/lib/database';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { isExpectedAccessControlError } from '@/lib/supabase';

const DEFAULT_ACCESS: AdminAccessContext = {
    canAccessAdminPanel: false,
    isPrimaryAdmin: false,
};

type AdminAccessModule = {
    getAdminAccessContext: () => Promise<AdminAccessContext>;
    getCachedAdminAccessContext: (authUserId?: string | null) => AdminAccessContext | null;
};

let adminAccessModulePromise: Promise<AdminAccessModule> | null = null;

const loadAdminAccessModule = () => {
    if (!adminAccessModulePromise) {
        adminAccessModulePromise = import('@/lib/database').then((module) => ({
            getAdminAccessContext: module.getAdminAccessContext,
            getCachedAdminAccessContext: module.getCachedAdminAccessContext,
        }));
    }

    return adminAccessModulePromise;
};

export const useAdminAccess = (options?: { requireOnlineValidation?: boolean }) => {
    const { user, isLoading: authLoading } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const requireOnlineValidation = options?.requireOnlineValidation ?? false;
    const [access, setAccess] = useState<AdminAccessContext>(DEFAULT_ACCESS);
    const [isLoading, setIsLoading] = useState(() => Boolean(user?.id));

    useEffect(() => {
        if (authLoading) {
            return;
        }

        let isCancelled = false;

        const loadAccess = async () => {
            if (!user?.id) {
                setAccess(DEFAULT_ACCESS);
                setIsLoading(false);
                return;
            }

            const { getAdminAccessContext, getCachedAdminAccessContext } = await loadAdminAccessModule();

            if (isCancelled) {
                return;
            }

            const cachedAccess = getCachedAdminAccessContext(user.id);

            if (!isOnline) {
                setAccess(cachedAccess || DEFAULT_ACCESS);
                setIsLoading(false);
                return;
            }

            if (cachedAccess) {
                setAccess(cachedAccess);
                setIsLoading(requireOnlineValidation);
            } else {
                setAccess(DEFAULT_ACCESS);
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
