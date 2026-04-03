import type { User } from '@/lib/types';

const HEADER_SHELL_STORAGE_KEY = 'toonparrot:header-shell:v1';
export const HEADER_SHELL_CACHE_EVENT = 'toonparrot:header-shell-updated';

export interface HeaderShellUser {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  preferences?: User['preferences'];
}

export interface HeaderShellSnapshot {
  user: HeaderShellUser | null;
  unreadNotificationCount: number;
  unreadAnnouncementCount: number;
  updatedAt: number;
}

const canUseStorage = () => typeof window !== 'undefined';

const emitHeaderShellChange = () => {
  if (!canUseStorage()) {
    return;
  }

  window.dispatchEvent(new Event(HEADER_SHELL_CACHE_EVENT));
};

const sanitizeHeaderUser = (user: User): HeaderShellUser => ({
  id: user.id,
  username: user.username,
  email: user.email,
  avatar: user.avatar,
  preferences: user.preferences,
});

const writeSnapshot = (snapshot: HeaderShellSnapshot | null) => {
  if (!canUseStorage()) {
    return;
  }

  if (!snapshot?.user) {
    window.sessionStorage.removeItem(HEADER_SHELL_STORAGE_KEY);
    emitHeaderShellChange();
    return;
  }

  window.sessionStorage.setItem(HEADER_SHELL_STORAGE_KEY, JSON.stringify(snapshot));
  emitHeaderShellChange();
};

export const readHeaderShellSnapshot = (): HeaderShellSnapshot | null => {
  if (!canUseStorage()) {
    return null;
  }

  const raw = window.sessionStorage.getItem(HEADER_SHELL_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<HeaderShellSnapshot>;
    if (!parsed?.user?.id) {
      return null;
    }

    return {
      user: {
        id: parsed.user.id,
        username: parsed.user.username || 'user',
        email: parsed.user.email || '',
        avatar: parsed.user.avatar,
        preferences: parsed.user.preferences,
      },
      unreadNotificationCount: Number(parsed.unreadNotificationCount) || 0,
      unreadAnnouncementCount: Number(parsed.unreadAnnouncementCount) || 0,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
};

export const writeHeaderShellUser = (user: User) => {
  const previousSnapshot = readHeaderShellSnapshot();
  const isSameUser = previousSnapshot?.user?.id === user.id;

  writeSnapshot({
    user: sanitizeHeaderUser(user),
    unreadNotificationCount: isSameUser ? previousSnapshot?.unreadNotificationCount || 0 : 0,
    unreadAnnouncementCount: isSameUser ? previousSnapshot?.unreadAnnouncementCount || 0 : 0,
    updatedAt: Date.now(),
  });
};

export const updateHeaderShellCounts = (
  userId: string,
  counts: Partial<Pick<HeaderShellSnapshot, 'unreadNotificationCount' | 'unreadAnnouncementCount'>>,
) => {
  const currentSnapshot = readHeaderShellSnapshot();
  if (!currentSnapshot?.user || currentSnapshot.user.id !== userId) {
    return;
  }

  writeSnapshot({
    ...currentSnapshot,
    unreadNotificationCount: counts.unreadNotificationCount ?? currentSnapshot.unreadNotificationCount,
    unreadAnnouncementCount: counts.unreadAnnouncementCount ?? currentSnapshot.unreadAnnouncementCount,
    updatedAt: Date.now(),
  });
};

export const clearHeaderShellSnapshot = () => {
  writeSnapshot(null);
};
