import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminAccessContext } from '@/lib/database';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { isExpectedAccessControlError } from '@/lib/supabase';
import type { User } from '@/lib/types';

const DEFAULT_ACCESS: AdminAccessContext = {
    canAccessAdminPanel: false,
    isPrimaryAdmin: false,
};

const PRIMARY_ADMIN_EMAIL = 'caganherdil@gmail.com';

const getRoleBasedAccess = (user?: Pick<User, 'id' | 'role' | 'email'> | null) => {
    if (user?.role === 'admin') {
        return {
            userId: user.id,
            role: 'admin',
            canAccessAdminPanel: true,
            isPrimaryAdmin: user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL,
        } satisfies AdminAccessContext;
    }

    return DEFAULT_ACCESS;
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
    const [access, setAccess] = useState<AdminAccessContext>(() => getRoleBasedAccess(user));
    const [isLoading, setIsLoading] = useState(() => Boolean(user?.id && user.role !== 'admin'));

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

            if (user.role === 'admin') {
                setAccess(getRoleBasedAccess(user));
                setIsLoading(requireOnlineValidation && isOnline);
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
    }, [authLoading, isOnline, requireOnlineValidation, user?.email, user?.id, user?.role]);

    return {
        access,
        isLoading: authLoading || isLoading,
    };
};
