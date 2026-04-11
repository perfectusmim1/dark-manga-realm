import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBootstrappedAppearancePreferences } from '@/hooks/useBootstrappedAppearancePreferences';

export const useAdultImageBlurPreference = () => {
  const { user, isLoading: authLoading } = useAuth();
  const appearancePreferences = useBootstrappedAppearancePreferences({ user, authLoading });

  return useMemo(
    () => user?.preferences?.content?.adult_mode === true && appearancePreferences.adult_cover_blur,
    [appearancePreferences.adult_cover_blur, user?.preferences?.content?.adult_mode],
  );
};
