import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAccess } from '@/hooks/useAdminAccess';

type GuardRole = 'admin' | 'primary-admin';

interface UseAdminPageGuardOptions {
  requiredRole: GuardRole;
  requireOnlineValidation?: boolean;
}

const getGuardMessage = (requiredRole: GuardRole) => (
  requiredRole === 'primary-admin'
    ? 'Bu sayfa yalnızca ana admin hesabına açıktır'
    : 'Bu sayfa yalnızca admin hesabına açıktır'
);

export const useAdminPageGuard = (options: UseAdminPageGuardOptions) => {
  const navigate = useNavigate();
  const redirectAttemptedRef = useRef(false);
  const { user, isLoading: authLoading } = useAuth();
  const { access, isLoading: accessLoading } = useAdminAccess({
    requireOnlineValidation: options.requireOnlineValidation ?? false,
  });

  const isAllowed = options.requiredRole === 'primary-admin'
    ? access.isPrimaryAdmin
    : access.canAccessAdminPanel && access.role === 'admin';

  useEffect(() => {
    if (authLoading || accessLoading) {
      redirectAttemptedRef.current = false;
      return;
    }

    if (user && isAllowed) {
      redirectAttemptedRef.current = false;
      return;
    }

    if (redirectAttemptedRef.current) {
      return;
    }

    redirectAttemptedRef.current = true;
    toast.error(getGuardMessage(options.requiredRole));
    navigate(user ? '/admin' : '/admin/login', { replace: true });
  }, [accessLoading, authLoading, isAllowed, navigate, options.requiredRole, user]);

  return {
    user,
    access,
    isAllowed,
    isLoading: authLoading || accessLoading,
  };
};
