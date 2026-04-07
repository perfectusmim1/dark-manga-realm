import { useMemo } from 'react';
import type { User } from '@/lib/types';
import { useHeaderShellSnapshot } from '@/hooks/useHeaderShellSnapshot';

type AppearancePreferences = {
  manga_hover_preview: boolean;
  show_header_offline_toggle: boolean;
  show_chapter_card_images: boolean;
};

const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  manga_hover_preview: false,
  show_header_offline_toggle: true,
  show_chapter_card_images: false,
};

export const useBootstrappedAppearancePreferences = ({
  user,
  authLoading,
}: {
  user: User | null;
  authLoading: boolean;
}): AppearancePreferences => {
  const headerShellSnapshot = useHeaderShellSnapshot();

  return useMemo(() => {
    const appearance = user?.preferences?.appearance
      || (authLoading ? headerShellSnapshot?.user?.preferences?.appearance : undefined);
    const shouldDelayVisibleDefaults = authLoading && !user && !headerShellSnapshot?.user;

    return {
      manga_hover_preview: appearance?.manga_hover_preview ?? DEFAULT_APPEARANCE_PREFERENCES.manga_hover_preview,
      show_header_offline_toggle: appearance?.show_header_offline_toggle ?? (
        shouldDelayVisibleDefaults
          ? false
          : DEFAULT_APPEARANCE_PREFERENCES.show_header_offline_toggle
      ),
      show_chapter_card_images: appearance?.show_chapter_card_images ?? DEFAULT_APPEARANCE_PREFERENCES.show_chapter_card_images,
    };
  }, [authLoading, headerShellSnapshot?.user, user]);
};
