import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AdminAccessContext, getAdminAccessContext, getCachedAdminAccessContext } from '@/lib/database';

const DEFAULT_ACCESS: AdminAccessContext = {
    canAccessAdminPanel: false,
    isPrimaryAdmin: false,
};

export const useAdminAccess = () => {
    const { user, isLoading: authLoading } = useAuth();
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
                setIsLoading(false);
            } else {
                setIsLoading(true);
            }

            try {
                const nextAccess = await getAdminAccessContext();

                if (!isCancelled) {
                    setAccess(nextAccess);
                }
            } catch (error) {
                console.error('Admin access load error:', error);
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
    }, [authLoading, user?.id]);

    return {
        access,
        isLoading: authLoading || isLoading,
    };
};
