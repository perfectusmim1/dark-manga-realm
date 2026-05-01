import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { EmailOtpType, Factor, PostgrestSingleResponse } from '@supabase/supabase-js';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { isAuthSessionUnavailableError, isExpectedAccessControlError, supabase, waitForUsableSupabaseSession } from '@/lib/supabase';
import { User, UserAccessState } from '@/lib/types';
import { checkCurrentAccess, recoverAccessCheckFailure, type AccessCheckResult } from '@/lib/security/deviceIdentity';
import { getDeviceIdentity } from '@/lib/security/deviceFingerprint';
import { syncLocalChapterReadFallbackToRemote } from '@/lib/storage';
import {
  getCachedPreferencesForUser,
  isEffectivelyOnline,
  queuePreferencesUpdate,
  setCachedPreferencesForUser,
} from '@/lib/offline/userSync';
import { clearHeaderShellSnapshot, writeHeaderShellUser } from '@/lib/headerShellCache';
import { PASSWORD_MIN_LENGTH, translatePasswordPolicyError } from '@/lib/auth/passwordPolicy';
import { dispatchAdultModeChanged } from '@/lib/adultModeEvents';
import { isDocumentVisible } from '@/lib/documentVisibility';
import { acknowledgeCurrentUserWarning, getCurrentUserAccessSnapshot, type CurrentUserAccessSnapshot } from '@/lib/userAccess';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  isLoading: boolean;
  mfaState: MfaState;
  accessState: UserAccessState;
  login: (email: string, password: string) => Promise<{
    success: boolean;
    error?: string;
    email?: string;
    requiresTwoFactor?: boolean;
    accessRestricted?: boolean;
    retryAfterSeconds?: number;
  }>;
  register: (username: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateProfile: (updates: { username?: string, avatar?: string }) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (
    newPassword: string,
    verification?: {
      currentPassword?: string;
      mfaCode?: string;
      skipVerification?: boolean;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  updateEmail: (newEmail: string) => Promise<{ success: boolean; error?: string }>;
  updatePreferences: (newPreferences: User['preferences']) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (email: string, token: string, type: 'signup' | 'recovery' | 'email') => Promise<{ success: boolean; error?: string }>;
  refreshMfaState: () => Promise<void>;
  enrollTwoFactor: () => Promise<{ success: boolean; error?: string; enrollment?: TotpEnrollment }>;
  cancelTwoFactorEnrollment: (factorId: string) => Promise<void>;
  verifyTwoFactorEnrollment: (factorId: string, code: string) => Promise<{ success: boolean; error?: string }>;
  challengeTwoFactor: (code: string, factorId?: string) => Promise<{ success: boolean; error?: string }>;
  disableTwoFactor: (code: string, factorId?: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: (redirectTo?: string) => Promise<void>;
  resendEmail: (email: string, type: 'signup' | 'recovery') => Promise<{ success: boolean; error?: string }>;
  refreshAccessState: () => Promise<void>;
  acknowledgeWarning: (warningId: string) => Promise<{ success: boolean; error?: string; banActive?: boolean }>;
}

type AuthenticatorLevel = 'aal1' | 'aal2' | null;

export interface TotpFactor {
  id: string;
  friendlyName?: string;
  status: 'verified' | 'unverified';
  createdAt: string;
  updatedAt: string;
}

export interface TotpEnrollment {
  factorId: string;
  friendlyName?: string;
  qrCodeSvg: string;
  secret: string;
  uri: string;
}

export interface MfaState {
  isLoading: boolean;
  currentLevel: AuthenticatorLevel;
  nextLevel: AuthenticatorLevel;
  needsVerification: boolean;
  verifiedFactorCount: number;
  factors: TotpFactor[];
}

const DEFAULT_MFA_STATE: MfaState = {
  isLoading: false,
  currentLevel: null,
  nextLevel: null,
  needsVerification: false,
  verifiedFactorCount: 0,
  factors: [],
};



const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface UserProfileRow {
  id: string;
  username: string;
  username_last_changed_at?: string | null;
  avatar: string | null;
  role: User['role'];
  is_banned?: boolean;
  ban_reason?: string | null;
  banned_at?: string | null;
  active_ban_type?: User['activeBanType'];
  ban_expires_at?: string | null;
  warning_count?: number;
  unread_warning_count?: number;
  created_at: string;
  preferences?: User['preferences'];
  two_factor_enabled?: boolean;
}

type TotpFactorRecord = Factor<'totp', 'verified' | 'unverified'>;

const PROFILE_SELECT_COLUMNS = 'id, username, username_last_changed_at, avatar, role, is_banned, ban_reason, banned_at, active_ban_type, ban_expires_at, warning_count, unread_warning_count, created_at, preferences, two_factor_enabled';
const DEFAULT_USER_PREFERENCES: NonNullable<User['preferences']> = {
  notifications: {
    new_chapter: true,
    replies: true,
    likes: true,
    follows: true,
  },
  content: {
    adult_mode: false,
  },
  comments: {
    auto_show_media: false,
    auto_show_gifs: false,
    auto_show_replies: false,
    show_page_comments: false,
  },
  appearance: {
    manga_hover_preview: false,
    show_header_offline_toggle: true,
    show_chapter_card_images: false,
    adult_cover_blur: false,
  },
  privacy: {
    visibility: 'public',
    reading_history_visibility: 'public',
    comments_visibility: 'public',
    reviews_visibility: 'public',
    reading_lists_visibility: 'public',
    tier_lists_visibility: 'public',
    followed_manga_visibility: 'public',
  },
  externalSync: {
    global: {
      autoSync: true,
      disableWhileIncognito: true,
    },
    providers: {
      myanimelist: {
        enabled: true,
        connected: false,
        fieldToggles: {
          status: true,
          progress: true,
          score: true,
          dates: true,
        },
      },
      anilist: {
        enabled: true,
        connected: false,
        fieldToggles: {
          status: true,
          progress: true,
          score: true,
          dates: true,
          favorite: true,
        },
      },
    },
  },
};

const normalizeUserPreferences = (preferences?: User['preferences']): NonNullable<User['preferences']> => ({
  notifications: {
    ...DEFAULT_USER_PREFERENCES.notifications,
    ...preferences?.notifications,
  },
  content: {
    ...DEFAULT_USER_PREFERENCES.content,
    ...preferences?.content,
  },
  comments: {
    ...DEFAULT_USER_PREFERENCES.comments,
    ...preferences?.comments,
  },
  appearance: {
    ...DEFAULT_USER_PREFERENCES.appearance,
    ...preferences?.appearance,
  },
  privacy: {
    ...DEFAULT_USER_PREFERENCES.privacy,
    ...preferences?.privacy,
  },
  externalSync: {
    global: {
      ...DEFAULT_USER_PREFERENCES.externalSync.global,
      ...preferences?.externalSync?.global,
    },
    providers: {
      myanimelist: {
        ...DEFAULT_USER_PREFERENCES.externalSync.providers.myanimelist,
        ...preferences?.externalSync?.providers?.myanimelist,
        fieldToggles: {
          ...DEFAULT_USER_PREFERENCES.externalSync.providers.myanimelist.fieldToggles,
          ...preferences?.externalSync?.providers?.myanimelist?.fieldToggles,
        },
      },
      anilist: {
        ...DEFAULT_USER_PREFERENCES.externalSync.providers.anilist,
        ...preferences?.externalSync?.providers?.anilist,
        fieldToggles: {
          ...DEFAULT_USER_PREFERENCES.externalSync.providers.anilist.fieldToggles,
          ...preferences?.externalSync?.providers?.anilist?.fieldToggles,
        },
      },
    },
  },
});

const getErrorMessage = (error: unknown, fallback = 'Bir hata oluştu') => (
  error instanceof Error ? error.message : fallback
);

const allowAccessOnFailure = (error: unknown, context: string): AccessCheckResult => {
  return recoverAccessCheckFailure(error, context);
};

const DEFAULT_ACCESS_STATE: UserAccessState = {
  reason: 'ok',
  blockedMessage: null,
  supportOnly: false,
  warning: null,
  ban: {
    active: false,
    type: null,
    reason: null,
    expiresAt: null,
    bannedAt: null,
  },
};
const ACCESS_STATE_BOOTSTRAP_RETRY_DELAY_MS = 4000;
const WARNING_BAN_SYNC_INTERVAL_MS = 120000;
const USER_ACCESS_STATE_AUTH_FAILURE_BACKOFF_MS = 5000;
const USER_ACCESS_STATE_FAILURE_BACKOFF_MS = 3 * 60 * 1000;

const isConcreteAccessDenial = (accessCheck: AccessCheckResult) => (
  !accessCheck.allowed && accessCheck.reason !== 'access_check_failed'
);

const mapAccessCheckToAccessState = (accessCheck: AccessCheckResult): UserAccessState => ({
  reason: accessCheck.reason || 'ok',
  blockedMessage: isConcreteAccessDenial(accessCheck) ? accessCheck.message || null : null,
  supportOnly: Boolean(accessCheck.supportOnly),
  warning: accessCheck.warning || null,
  ban: accessCheck.ban || {
    active: false,
    type: null,
    reason: null,
    expiresAt: null,
    bannedAt: null,
  },
});

const shouldHydrateAccessSnapshot = (accessCheck: AccessCheckResult) => (
  accessCheck.reason === 'access_check_failed'
  || (
    accessCheck.reason === 'ok'
    && !accessCheck.user
    && !accessCheck.ban?.active
  )
);

const mergeAccessCheckWithSnapshot = (
  accessCheck: AccessCheckResult,
  snapshot: CurrentUserAccessSnapshot,
): AccessCheckResult => {
  if (!shouldHydrateAccessSnapshot(accessCheck)) {
    return {
      ...accessCheck,
      warning: snapshot.warning,
      ban: snapshot.ban,
      user: accessCheck.user
        ? {
          ...accessCheck.user,
          warningCount: snapshot.warningCount,
          unreadWarningCount: snapshot.unreadWarningCount,
        }
        : accessCheck.user,
    };
  }

  return {
    ...accessCheck,
    allowed: !snapshot.ban.active,
    reason: snapshot.ban.active ? 'user_banned' : 'ok',
    supportOnly: snapshot.ban.active,
    message: snapshot.ban.active
      ? snapshot.ban.reason || accessCheck.message || 'Hesabınız banlandı.'
      : undefined,
    warning: snapshot.warning,
    ban: snapshot.ban,
    user: accessCheck.user
      ? {
        ...accessCheck.user,
        warningCount: snapshot.warningCount,
        unreadWarningCount: snapshot.unreadWarningCount,
      }
      : accessCheck.user,
  };
};

const buildProfileFromAccessCheck = (
  supabaseUser: SupabaseUser,
  accessCheck: AccessCheckResult,
): UserProfileRow | null => {
  if (!accessCheck.user && !accessCheck.ban?.active) {
    return null;
  }

  return {
    id: supabaseUser.id,
    username: accessCheck.user?.username
      || supabaseUser.user_metadata?.username
      || supabaseUser.email?.split('@')[0]
      || 'user',
    username_last_changed_at: null,
    avatar: supabaseUser.user_metadata?.avatar_url || null,
    role: accessCheck.user?.role || 'user',
    is_banned: Boolean(accessCheck.ban?.active),
    ban_reason: accessCheck.ban?.reason || null,
    banned_at: accessCheck.ban?.bannedAt || null,
    active_ban_type: accessCheck.ban?.type || null,
    ban_expires_at: accessCheck.ban?.expiresAt || null,
    warning_count: accessCheck.user?.warningCount || 0,
    unread_warning_count: accessCheck.user?.unreadWarningCount || 0,
    created_at: supabaseUser.created_at,
    preferences: undefined,
    two_factor_enabled: false,
  };
};

const extractTotpFactors = (factors: TotpFactorRecord[] | undefined): TotpFactor[] => (
  (factors || [])
    .filter((factor) => factor.factor_type === 'totp')
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name || undefined,
      status: factor.status,
      createdAt: factor.created_at,
      updatedAt: factor.updated_at,
    }))
);

// Convert Supabase user + Profile data to our User type
const mapSupabaseUserToUser = (supabaseUser: SupabaseUser, profile: UserProfileRow | null): User => {
  const cachedPreferences = getCachedPreferencesForUser(supabaseUser.id);

  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    username: profile?.username || supabaseUser.user_metadata?.username || supabaseUser.email?.split('@')[0] || 'user',
    usernameChangedAt: profile?.username_last_changed_at || undefined,
    avatar: profile?.avatar || supabaseUser.user_metadata?.avatar_url,
    role: profile?.role || 'user',
    createdAt: supabaseUser.created_at,
    isBanned: profile?.is_banned || false,
    banReason: profile?.ban_reason || undefined,
    bannedAt: profile?.banned_at || undefined,
    activeBanType: profile?.active_ban_type || null,
    banExpiresAt: profile?.ban_expires_at || null,
    warningCount: profile?.warning_count || 0,
    unreadWarningCount: profile?.unread_warning_count || 0,
    twoFactorEnabled: profile?.two_factor_enabled || false,
    preferences: normalizeUserPreferences(cachedPreferences || profile?.preferences),
  };
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaState, setMfaState] = useState<MfaState>(DEFAULT_MFA_STATE);
  const [accessState, setAccessState] = useState<UserAccessState>(DEFAULT_ACCESS_STATE);
  const accessStateRefreshInFlightRef = useRef(false);
  const accessStateRefreshFailureUntilRef = useRef(0);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (user) {
      writeHeaderShellUser(user);
      return;
    }

    clearHeaderShellSnapshot();
  }, [isLoading, user]);

  const fetchProfile = useCallback(async (id: string): Promise<UserProfileRow | null> => {
    // Add a 5s timeout to prevent infinite hangs on DB calls during initialization
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
    );

    try {
      const fetchReq = supabase
        .from('users')
        .select(PROFILE_SELECT_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      const { data, error } = await Promise.race([
        fetchReq,
        timeout,
      ]) as PostgrestSingleResponse<UserProfileRow>;

      if (error) {
        if (!isExpectedAccessControlError(error)) {
          console.error('Error fetching profile:', error);
        }
        return null;
      }
      return data;
    } catch (err) {
      if (!isExpectedAccessControlError(err)) {
        console.error('Profile fetch failed:', err);
      }
      return null;
    }
  }, []);

  const syncCurrentAuthProfile = useCallback(async (
    currentUser: SupabaseUser,
    preferredUsername?: string
  ): Promise<UserProfileRow | null> => {
    try {
      const baseUsername =
        preferredUsername?.trim() ||
        currentUser.user_metadata?.username ||
        currentUser.user_metadata?.full_name ||
        currentUser.email?.split('@')[0] ||
        'user';

      const { data, error } = await supabase.rpc('sync_current_auth_profile', {
        p_avatar: currentUser.user_metadata?.avatar_url || null,
        p_base_username: baseUsername,
      });

      if (error) {
        if (!isExpectedAccessControlError(error)) {
          console.error('Profile sync failed:', error);
        }
        return null;
      }

      const profileRow = Array.isArray(data) ? data[0] : data;
      if (profileRow) {
        return profileRow;
      }

      return await fetchProfile(currentUser.id);
    } catch (error) {
      if (!isExpectedAccessControlError(error)) {
        console.error('Profile sync exception:', error);
      }
      return null;
    }
  }, [fetchProfile]);

  const ensureProfile = useCallback(async (
    currentUser: SupabaseUser,
    preferredUsername?: string
  ): Promise<UserProfileRow | null> => {
    const syncedProfile = await syncCurrentAuthProfile(currentUser, preferredUsername);
    if (syncedProfile) {
      return syncedProfile;
    }

    return await fetchProfile(currentUser.id);
  }, [fetchProfile, syncCurrentAuthProfile]);

  const updateLocalTwoFactorState = useCallback((enabled: boolean) => {
    setUser((prev) => (prev ? { ...prev, twoFactorEnabled: enabled } : prev));
  }, []);

  const applyCurrentUserAccessSnapshot = useCallback((snapshot: CurrentUserAccessSnapshot) => {
    const nextAccessState: UserAccessState = {
      reason: snapshot.ban.active ? 'user_banned' : 'ok',
      blockedMessage: snapshot.ban.active ? snapshot.ban.reason || null : null,
      supportOnly: false,
      warning: snapshot.warning,
      ban: snapshot.ban,
    };

    setAccessState((prev) => (
      JSON.stringify(prev) === JSON.stringify(nextAccessState)
        ? prev
        : nextAccessState
    ));

    setUser((prev) => {
      if (!prev) {
        return prev;
      }

      const nextUser = {
        ...prev,
        isBanned: snapshot.ban.active,
        banReason: snapshot.ban.reason || undefined,
        bannedAt: snapshot.ban.bannedAt || undefined,
        activeBanType: snapshot.ban.type || null,
        banExpiresAt: snapshot.ban.expiresAt || null,
        warningCount: snapshot.warningCount,
        unreadWarningCount: snapshot.unreadWarningCount,
      };

      return JSON.stringify(prev) === JSON.stringify(nextUser)
        ? prev
        : nextUser;
    });
  }, []);

  const refreshAccessState = useCallback(async (): Promise<void> => {
    if (!isEffectivelyOnline()) {
      return;
    }

    if (accessStateRefreshInFlightRef.current || Date.now() < accessStateRefreshFailureUntilRef.current) {
      return;
    }

    const activeSession = await waitForUsableSupabaseSession({
      preferredSession: session,
      required: false,
      maxWaitMs: 2000,
    }).catch(() => session);
    const activeUser = activeSession?.user || supabaseUser;

    if (!activeUser || !activeSession?.access_token) {
      setAccessState(DEFAULT_ACCESS_STATE);
      return;
    }

    accessStateRefreshInFlightRef.current = true;

    try {
      const snapshot = await getCurrentUserAccessSnapshot({
        preferredAccessToken: activeSession.access_token,
        maxAttempts: 2,
        bypassBackoff: true,
      });
      applyCurrentUserAccessSnapshot(snapshot);
      accessStateRefreshFailureUntilRef.current = 0;
    } catch (error) {
      if (isExpectedAccessControlError(error)) {
        setAccessState(DEFAULT_ACCESS_STATE);
      }
      accessStateRefreshFailureUntilRef.current = Date.now() + (
        isAuthSessionUnavailableError(error)
          ? USER_ACCESS_STATE_AUTH_FAILURE_BACKOFF_MS
          : USER_ACCESS_STATE_FAILURE_BACKOFF_MS
      );
    } finally {
      accessStateRefreshInFlightRef.current = false;
    }
  }, [applyCurrentUserAccessSnapshot, session, supabaseUser]);

  useEffect(() => {
    accessStateRefreshInFlightRef.current = false;
    accessStateRefreshFailureUntilRef.current = 0;
  }, [supabaseUser?.id]);

  const acknowledgeWarning = useCallback(async (warningId: string) => {
    try {
      const snapshot = await acknowledgeCurrentUserWarning(warningId);
      applyCurrentUserAccessSnapshot(snapshot);

      return { success: true, banActive: snapshot.ban.active };
    } catch (error: unknown) {
      console.error('Acknowledge warning error:', error);
      return { success: false, error: getErrorMessage(error), banActive: false };
    }
  }, [applyCurrentUserAccessSnapshot]);

  const getPrimaryVerifiedTotpFactor = async (preferredFactorId?: string): Promise<TotpFactor | null> => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      throw error;
    }

    const factors = extractTotpFactors(data.all as TotpFactorRecord[] | undefined);
    const verifiedFactors = factors.filter((factor) => factor.status === 'verified');

    if (preferredFactorId) {
      return verifiedFactors.find((factor) => factor.id === preferredFactorId) || null;
    }

    return verifiedFactors[0] || null;
  };

  const refreshMfaState = useCallback(async (): Promise<void> => {
    const activeSession = (await supabase.auth.getSession()).data.session;

    if (!activeSession?.user) {
      setMfaState(DEFAULT_MFA_STATE);
      updateLocalTwoFactorState(false);
      return;
    }

    if (!isEffectivelyOnline()) {
      setMfaState((prev) => ({
        ...prev,
        isLoading: false,
      }));
      return;
    }

    setMfaState((prev) => ({ ...prev, isLoading: true }));

    try {
      const [{ data: assuranceData, error: assuranceError }, { data: factorData, error: factorError }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);

      if (assuranceError) {
        throw assuranceError;
      }

      if (factorError) {
        throw factorError;
      }

      const factors = extractTotpFactors(factorData.all as TotpFactorRecord[] | undefined);
      const verifiedFactorCount = factors.filter((factor) => factor.status === 'verified').length;
      const nextState: MfaState = {
        isLoading: false,
        currentLevel: assuranceData.currentLevel,
        nextLevel: assuranceData.nextLevel,
        needsVerification: verifiedFactorCount > 0
          && assuranceData.nextLevel === 'aal2'
          && assuranceData.currentLevel !== 'aal2',
        verifiedFactorCount,
        factors,
      };

      setMfaState(nextState);
      updateLocalTwoFactorState(verifiedFactorCount > 0);
    } catch (error) {
      console.error('MFA state refresh failed:', error);
      setMfaState({
        ...DEFAULT_MFA_STATE,
        isLoading: false,
      });
    }
  }, [updateLocalTwoFactorState]);

  useEffect(() => {
    let mounted = true;
    let authSyncQueue = Promise.resolve();
    let latestSessionSnapshot: Session | null = null;
    let lastQueuedAuthSyncKey = '';
    let lastQueuedAuthSyncAt = 0;

    const getAuthSyncKey = (currentSession: Session | null) => {
      if (!currentSession?.user) {
        return 'signed-out';
      }

      const tokenFragment = currentSession.access_token
        ? currentSession.access_token.slice(-16)
        : 'no-token';

      return `${currentSession.user.id}:${tokenFragment}`;
    };

    const syncAuthState = async (currentSession: Session | null) => {
      if (!mounted) return;

      try {
        if (currentSession?.user) {
          const stabilizedSession = await waitForUsableSupabaseSession({
            preferredSession: currentSession,
            required: false,
          }).catch(() => currentSession);
          const activeSession = stabilizedSession?.user ? stabilizedSession : currentSession;

          if (!isEffectivelyOnline()) {
            const fallbackUser = mapSupabaseUserToUser(activeSession.user, null);
            setSession(prev => JSON.stringify(prev) === JSON.stringify(activeSession) ? prev : activeSession);
            setSupabaseUser(prev => JSON.stringify(prev) === JSON.stringify(activeSession.user) ? prev : activeSession.user);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(fallbackUser) ? prev : fallbackUser);
            setMfaState((prev) => ({ ...prev, isLoading: false }));
            return;
          }

          const currentPath = typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search}`
            : '/';
          let accessCheck = await checkCurrentAccess(currentPath, {
            preferredAccessToken: activeSession.access_token,
          }).catch((error) =>
            allowAccessOnFailure(error, 'Access gate check failed during auth sync:')
          );
          if (!mounted) return;

          if (shouldHydrateAccessSnapshot(accessCheck)) {
            try {
              const snapshot = await getCurrentUserAccessSnapshot({
                preferredAccessToken: activeSession.access_token,
                maxAttempts: 2,
                bypassBackoff: true,
              });
              accessCheck = mergeAccessCheckWithSnapshot(accessCheck, snapshot);
            } catch (snapshotError) {
              if (
                !isExpectedAccessControlError(snapshotError)
                && !(snapshotError instanceof Error && snapshotError.message === 'USER_ACCESS_STATE_BACKOFF_ACTIVE')
              ) {
                console.warn('Immediate access snapshot hydration failed:', snapshotError);
              }
            }

            if (!mounted) return;
          }

          setAccessState(mapAccessCheckToAccessState(accessCheck));

          const shouldBlockCurrentSession = (
            isConcreteAccessDenial(accessCheck)
            && accessCheck.reason !== 'user_banned'
          );
          if (shouldBlockCurrentSession) {
            const blockedUser = mapSupabaseUserToUser(activeSession.user, null);
            setSession(prev => JSON.stringify(prev) === JSON.stringify(activeSession) ? prev : activeSession);
            setSupabaseUser(prev => JSON.stringify(prev) === JSON.stringify(activeSession.user) ? prev : activeSession.user);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(blockedUser) ? prev : blockedUser);
            setMfaState((prev) => ({ ...prev, isLoading: false }));
            return;
          }

          const shouldBypassProfileFetch = Boolean(
            accessCheck.supportOnly
            || accessCheck.ban?.active
            || accessCheck.reason === 'user_banned'
          );
          const profile = shouldBypassProfileFetch
            ? buildProfileFromAccessCheck(activeSession.user, accessCheck)
            : await ensureProfile(activeSession.user);

          if (!mounted) return;

          setSession(prev => JSON.stringify(prev) === JSON.stringify(activeSession) ? prev : activeSession);
          setSupabaseUser(prev => JSON.stringify(prev) === JSON.stringify(activeSession.user) ? prev : activeSession.user);

          if (profile) {
            const newUser = mapSupabaseUserToUser(activeSession.user, profile);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(newUser) ? prev : newUser);
            if (
              !accessCheck.supportOnly
              && !accessCheck.ban?.active
              && accessCheck.reason !== 'user_banned'
            ) {
              void syncLocalChapterReadFallbackToRemote(activeSession.user.id);
            }
          } else {
            if (
              !accessCheck.supportOnly
              && !accessCheck.ban?.active
              && accessCheck.reason !== 'user_banned'
            ) {
              console.error('Critical: Could not establish a user profile.');
            }
            const fallbackUser = mapSupabaseUserToUser(activeSession.user, null);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(fallbackUser) ? prev : fallbackUser);
            if (
              !accessCheck.supportOnly
              && !accessCheck.ban?.active
              && accessCheck.reason !== 'user_banned'
            ) {
              void syncLocalChapterReadFallbackToRemote(activeSession.user.id);
            }
          }

          if (
            accessCheck.supportOnly
            || accessCheck.ban?.active
            || accessCheck.reason === 'user_banned'
          ) {
            setMfaState((prev) => ({ ...prev, isLoading: false }));
          } else {
            await refreshMfaState();
          }
        } else {
          setSession(null);
          setSupabaseUser(null);
          setUser(null);
          setMfaState(DEFAULT_MFA_STATE);
          setAccessState(DEFAULT_ACCESS_STATE);
        }
      } catch (err) {
        if (!isExpectedAccessControlError(err)) {
          console.error('Failed to sync auth state:', err);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    const pushPresenceHeartbeat = async () => {
      if (!isEffectivelyOnline() || !isDocumentVisible()) {
        return;
      }

      const activeSession = latestSessionSnapshot;
      if (!activeSession?.user || !activeSession.access_token) {
        return;
      }

      try {
        await supabase.rpc('update_user_presence', { p_user_id: activeSession.user.id });
      } catch (error) {
        if (!isExpectedAccessControlError(error)) {
          console.error('Presence heartbeat failed:', error);
        }
      }
    };

    const enqueueAuthStateSync = (currentSession: Session | null) => {
      latestSessionSnapshot = currentSession;
      const syncKey = getAuthSyncKey(currentSession);
      const now = Date.now();

      if (syncKey === lastQueuedAuthSyncKey && now - lastQueuedAuthSyncAt < 1500) {
        return authSyncQueue;
      }

      lastQueuedAuthSyncKey = syncKey;
      lastQueuedAuthSyncAt = now;

      authSyncQueue = authSyncQueue
        .catch(() => undefined)
        .then(() => syncAuthState(currentSession));

      return authSyncQueue;
    };

    const presenceInterval = window.setInterval(() => {
      void pushPresenceHeartbeat();
    }, 30000);

    // Initial check
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      latestSessionSnapshot = s;
      void enqueueAuthStateSync(s);
      void pushPresenceHeartbeat();
    }).catch(err => {
      if (!isExpectedAccessControlError(err)) {
        console.error('Initial session check failed:', err);
      }
      if (mounted) setIsLoading(false);
    });

    // 2. Continuous listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        latestSessionSnapshot = currentSession;
        // We only trigger re-sync for significant events to avoid loops
        if (
          event === 'SIGNED_IN'
          || event === 'SIGNED_OUT'
          || event === 'USER_UPDATED'
          || event === 'TOKEN_REFRESHED'
          || event === 'INITIAL_SESSION'
          || event === 'MFA_CHALLENGE_VERIFIED'
        ) {
          void enqueueAuthStateSync(currentSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.clearInterval(presenceInterval);
    };
  }, [ensureProfile, refreshMfaState]);

  useEffect(() => {
    if (!supabaseUser?.id || !session?.access_token || isLoading || !isEffectivelyOnline()) {
      return;
    }

    const syncCurrentAccessState = () => {
      if (isDocumentVisible()) {
        void refreshAccessState();
      }
    };

    syncCurrentAccessState();
    const bootstrapRetryTimeoutId = window.setTimeout(syncCurrentAccessState, ACCESS_STATE_BOOTSTRAP_RETRY_DELAY_MS);
    const intervalId = window.setInterval(syncCurrentAccessState, WARNING_BAN_SYNC_INTERVAL_MS);
    window.addEventListener('focus', syncCurrentAccessState);
    document.addEventListener('visibilitychange', syncCurrentAccessState);

    return () => {
      window.clearTimeout(bootstrapRetryTimeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncCurrentAccessState);
      document.removeEventListener('visibilitychange', syncCurrentAccessState);
    };
  }, [isLoading, refreshAccessState, session?.access_token, supabaseUser?.id]);

  const login = async (email: string, password: string): Promise<{
    success: boolean;
    error?: string;
    email?: string;
    requiresTwoFactor?: boolean;
    accessRestricted?: boolean;
    retryAfterSeconds?: number;
  }> => {
    try {
      setIsLoading(true);

      const identifier = email.trim();
      const deviceIdentity = await getDeviceIdentity();
      const { data, error } = await supabase.functions.invoke<{
        success?: boolean;
        message?: string;
        retryAfterSeconds?: number;
        resolvedEmail?: string;
        session?: {
          access_token?: string;
          refresh_token?: string;
        };
      }>('password-login', {
        body: {
          identifier,
          password,
          ...deviceIdentity,
        },
      });

      if (error) {
        console.error('Login function error:', error);
        return { success: false, error: 'Giriş sırasında bir hata oluştu' };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.message || 'E-posta/kullanıcı adı veya şifre hatalı',
          retryAfterSeconds: data?.retryAfterSeconds,
        };
      }

      const resolvedEmailFromToken = (() => {
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          return '';
        }

        try {
          const [, payload] = accessToken.split('.');
          if (!payload) {
            return '';
          }

          const normalizedPayload = payload
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(payload.length / 4) * 4, '=');
          const parsed = JSON.parse(atob(normalizedPayload)) as { email?: string };
          return parsed.email?.trim().toLowerCase() || '';
        } catch {
          return '';
        }
      })();

      const resolvedEmail = (
        data.resolvedEmail
        || resolvedEmailFromToken
        || (identifier.includes('@') ? identifier : '')
      ).trim().toLowerCase();

      if (!resolvedEmail) {
        return { success: false, error: 'Kullanıcı adı ile girişte hesap e-postası çözümlenemedi' };
      }

      const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password,
      });

      if (signInError || !sessionData.user || !sessionData.session) {
        console.error('Client sign-in error after password-login check:', signInError);
        return { success: false, error: 'Oturum oluşturulamadı' };
      }

      const stabilizedSession = await waitForUsableSupabaseSession({
        preferredSession: sessionData.session,
        required: false,
      }).catch(() => sessionData.session);
      const activeSession = stabilizedSession?.user ? stabilizedSession : sessionData.session;

      const currentPath = typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/';
      let accessCheck = await checkCurrentAccess(currentPath, {
        preferredAccessToken: activeSession.access_token,
      }).catch((error) =>
        allowAccessOnFailure(error, 'Access check error during login:')
      );

      if (shouldHydrateAccessSnapshot(accessCheck)) {
        try {
          const snapshot = await getCurrentUserAccessSnapshot({
            preferredAccessToken: activeSession.access_token,
            maxAttempts: 2,
            bypassBackoff: true,
          });
          accessCheck = mergeAccessCheckWithSnapshot(accessCheck, snapshot);
        } catch (snapshotError) {
          if (
            !isExpectedAccessControlError(snapshotError)
            && !(snapshotError instanceof Error && snapshotError.message === 'USER_ACCESS_STATE_BACKOFF_ACTIVE')
          ) {
            console.warn('Immediate login access snapshot hydration failed:', snapshotError);
          }
        }
      }

      setAccessState(mapAccessCheckToAccessState(accessCheck));

      if (isConcreteAccessDenial(accessCheck) && accessCheck.reason !== 'user_banned') {
        await supabase.auth.signOut({ scope: 'local' });
        return {
          success: false,
          error: accessCheck.message || 'Bu cihaz veya bağlantı için giriş engellendi',
        };
      }

      const profile = (
        accessCheck.supportOnly
        || accessCheck.ban?.active
        || accessCheck.reason === 'user_banned'
      )
        ? buildProfileFromAccessCheck(activeSession.user, accessCheck)
        : await ensureProfile(activeSession.user);

      setSession(activeSession);
      setSupabaseUser(activeSession.user);
      setUser(mapSupabaseUserToUser(activeSession.user, profile));

      if (accessCheck.ban?.active || accessCheck.reason === 'user_banned' || accessCheck.supportOnly) {
        setMfaState((prev) => ({ ...prev, isLoading: false }));
        return {
          success: true,
          email: sessionData.user.email || undefined,
          requiresTwoFactor: false,
          accessRestricted: true,
        };
      }

      const { data: assuranceData, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) {
        throw assuranceError;
      }

      await refreshMfaState();

      return {
        success: true,
        email: sessionData.user.email || undefined,
        requiresTwoFactor: assuranceData.nextLevel === 'aal2' && assuranceData.currentLevel !== 'aal2',
        accessRestricted: false,
      };
    } catch (error: unknown) {
      console.error('Login error:', error);
      return { success: false, error: getErrorMessage(error) };
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (username: string, email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);

      const accessCheck = await checkCurrentAccess().catch((error) =>
        allowAccessOnFailure(error, 'Access check error during register:')
      );

      if (isConcreteAccessDenial(accessCheck)) {
        return { success: false, error: accessCheck.message || 'Bu cihaz veya bağlantı için kayıt engellendi' };
      }

      // Check if username is already taken
      const { data: existingUser } = await supabase
        .from('users')
        .select('username')
        .eq('username', username)
        .maybeSingle();

      if (existingUser) {
        return { success: false, error: 'Bu kullanıcı adı zaten kullanılıyor' };
      }

      // Sign up with Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            role: 'user',
          },
        },
      });

      if (error) {
        console.error('Register error:', error);
        if (error.message.includes('already registered')) {
          return { success: false, error: 'Bu e-posta adresi zaten kayıtlı' };
        }
        return { success: false, error: translatePasswordPolicyError(error.message, PASSWORD_MIN_LENGTH) };
      }

      if (data.user) {
        if (data.session) {
          const profile = await ensureProfile(data.user, username);
          setSession(data.session);
          setSupabaseUser(data.user);
          setUser(mapSupabaseUserToUser(data.user, profile));
          await refreshMfaState();
        }

        return { success: true };
      }

      return { success: false, error: 'Kayıt başarısız' };
    } catch (error: unknown) {
      console.error('Register error:', error);
      return { success: false, error: getErrorMessage(error) };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
      setUser(null);
      setSupabaseUser(null);
      setSession(null);
      setMfaState(DEFAULT_MFA_STATE);
      setAccessState(DEFAULT_ACCESS_STATE);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const updateProfile = async (updates: { username?: string, avatar?: string }): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Oturum açılmamış' };

    try {
      const nextUsername = updates.username?.trim();
      const usernameChanged = Boolean(nextUsername) && nextUsername !== user.username;
      const avatarChanged = updates.avatar !== undefined && updates.avatar !== user.avatar;

      if (usernameChanged && user.usernameChangedAt) {
        const nextAllowedAt = new Date(user.usernameChangedAt);
        nextAllowedAt.setDate(nextAllowedAt.getDate() + 7);

        if (nextAllowedAt.getTime() > Date.now()) {
          return {
            success: false,
            error: `Kullanıcı adını tekrar ${nextAllowedAt.toLocaleString('tr-TR')} tarihinde değiştirebilirsiniz`,
          };
        }
      }

      const currentAuthUser = supabaseUser || (await supabase.auth.getUser()).data.user;
      if (!currentAuthUser) {
        return { success: false, error: 'Oturum bulunamadı' };
      }

      const normalizedAvatar = avatarChanged
        ? (updates.avatar?.trim() || null)
        : (user.avatar?.trim() || null);
      const targetUsername = nextUsername || user.username;
      const usernameMetadataNeedsSync = (currentAuthUser.user_metadata?.username ?? null) !== (targetUsername || null);
      const avatarMetadataNeedsSync = (currentAuthUser.user_metadata?.avatar_url ?? null) !== normalizedAvatar;

      if (!usernameChanged && !avatarChanged && !usernameMetadataNeedsSync && !avatarMetadataNeedsSync) {
        return { success: true };
      }

      await ensureProfile(currentAuthUser, user.username);

      let nextAuthUser = currentAuthUser;
      let updatedUsername = user.username;
      let updatedProfile: UserProfileRow | null = null;

      if (avatarChanged || avatarMetadataNeedsSync) {
        const { data: avatarAuthUpdateData, error: avatarAuthError } = await supabase.auth.updateUser({
          data: {
            avatar_url: normalizedAvatar,
          },
        });

        if (avatarAuthError) throw avatarAuthError;

        if (avatarAuthUpdateData?.user) {
          nextAuthUser = avatarAuthUpdateData.user;
          setSupabaseUser(avatarAuthUpdateData.user);
        }
      }

      if (usernameChanged && nextUsername) {
        const { data, error } = await supabase.rpc('update_current_user_username', {
          p_username: nextUsername,
        });

        if (error) throw error;

        const profile = Array.isArray(data) ? data[0] : data;
        if (profile?.username) {
          updatedUsername = profile.username;
        }
        updatedProfile = profile ?? null;
      }

      if (usernameChanged || usernameMetadataNeedsSync) {
        const { data: authUpdateData, error: authError } = await supabase.auth.updateUser({
          data: {
            username: updatedUsername,
          },
        });

        if (authError) {
          console.warn('Auth username metadata update failed:', authError);
        }

        if (authUpdateData?.user) {
          nextAuthUser = authUpdateData.user;
          setSupabaseUser(authUpdateData.user);
        }
      }

      if (usernameChanged || avatarChanged) {
        const { data: syncData, error: syncError } = await supabase.rpc('sync_current_auth_profile', {
          p_avatar: normalizedAvatar,
          p_base_username: updatedUsername,
        });

        if (syncError) throw syncError;

        const syncedProfile = Array.isArray(syncData) ? syncData[0] : syncData;
        if (syncedProfile) {
          updatedProfile = syncedProfile;
        }
      }

      // Refresh local state
      const refreshedAuthUser = (await supabase.auth.getUser()).data.user || nextAuthUser;
      const profile = updatedProfile || await ensureProfile(refreshedAuthUser, updatedUsername);
      setSupabaseUser(refreshedAuthUser);
      setUser(mapSupabaseUserToUser(refreshedAuthUser, profile));

      return { success: true };
    } catch (error: unknown) {
      console.error('Update profile error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  };

  const updatePassword = async (
    newPassword: string,
    verification?: {
      currentPassword?: string;
      mfaCode?: string;
      skipVerification?: boolean;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const currentAuthUser = supabaseUser || (await supabase.auth.getUser()).data.user;
      if (!currentAuthUser) {
        return { success: false, error: 'Oturum bulunamadı' };
      }

      if (!verification?.skipVerification) {
        if (user?.twoFactorEnabled || mfaState.verifiedFactorCount > 0) {
          const result = await challengeTwoFactor(verification?.mfaCode || '');
          if (!result.success) {
            return result;
          }
        } else {
          const currentPassword = verification?.currentPassword?.trim();
          if (!currentPassword) {
            return { success: false, error: 'Mevcut şifrenizi girin.' };
          }

          const identifier = currentAuthUser.email || user?.email;
          if (!identifier) {
            return { success: false, error: 'E-posta adresi bulunamadı.' };
          }

          const deviceIdentity = await getDeviceIdentity();
          const { data, error: loginError } = await supabase.functions.invoke('password-login', {
            body: {
              identifier,
              password: currentPassword,
              ...deviceIdentity,
            },
          });

          if (loginError) {
            console.error('Current password verification error:', loginError);
            return { success: false, error: 'Mevcut şifre doğrulanamadı.' };
          }

          if (!data?.success) {
            return { success: false, error: data?.message || 'Mevcut şifre hatalı.' };
          }
        }
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (error) throw error;
      return { success: true };
    } catch (error: unknown) {
      console.error('Update password error:', error);
      return {
        success: false,
        error: translatePasswordPolicyError(getErrorMessage(error), PASSWORD_MIN_LENGTH),
      };
    }
  };

  const updateEmail = async (newEmail: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.updateUser({
        email: newEmail
      });
      if (error) throw error;
      return { success: true, error: 'E-posta güncelleme onayı gönderildi. Lütfen yeni e-postanızı kontrol edin.' };
    } catch (error: unknown) {
      console.error('Update email error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  };

  const updatePreferences = async (newPreferences: User['preferences']): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Oturum açılmamış' };

    const normalizedPreferences = normalizeUserPreferences(newPreferences);
    const previousAdultModeEnabled = user.preferences?.content?.adult_mode === true;
    const nextAdultModeEnabled = normalizedPreferences.content?.adult_mode === true;
    const adultModeChanged = previousAdultModeEnabled !== nextAdultModeEnabled;
    setCachedPreferencesForUser(user.id, normalizedPreferences);
    setUser((prev) => (prev ? { ...prev, preferences: normalizedPreferences } : prev));

    if (adultModeChanged) {
      void import('@/lib/database')
        .then(({ invalidateMangaVisibilityCaches }) => {
          invalidateMangaVisibilityCaches();
          dispatchAdultModeChanged({ enabled: nextAdultModeEnabled });
        })
        .catch((error: unknown) => {
          console.error('Adult mode cache invalidation error:', error);
        });
    }

    if (!isEffectivelyOnline()) {
      queuePreferencesUpdate(user.id, normalizedPreferences);
      return { success: true };
    }

    try {
      const currentAuthUser = supabaseUser || (await supabase.auth.getUser()).data.user;
      if (!currentAuthUser) {
        return { success: false, error: 'Oturum bulunamadı' };
      }

      await ensureProfile(currentAuthUser, user.username);

      const { data, error } = await supabase.rpc('update_current_user_preferences', {
        p_preferences: normalizedPreferences,
      });

      if (error) throw error;
      const profile = Array.isArray(data) ? data[0] : data;

      if (!profile) {
        return { success: false, error: 'Ayarlar kaydedildi ama doğrulanamadı' };
      }

      setSupabaseUser(currentAuthUser);
      setUser(mapSupabaseUserToUser(currentAuthUser, profile));

      return { success: true };
    } catch (error: unknown) {
      console.error('Update preferences error:', error);
      queuePreferencesUpdate(user.id, normalizedPreferences);
      return { success: true };
    }
  };

  const resetPassword = async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });
      if (error) throw error;
      return { success: true };
    } catch (error: unknown) {
      console.error('Reset password error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  };

  const verifyOtp = async (email: string, token: string, type: 'signup' | 'recovery' | 'email'): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: type as EmailOtpType,
      });
      if (error) throw error;
      if (data.session) {
        setSession(data.session);
        setSupabaseUser(data.session.user);
        const profile = await ensureProfile(data.session.user);
        setUser(mapSupabaseUserToUser(data.session.user, profile));
        await refreshMfaState();
      }
      return { success: true };
    } catch (error: unknown) {
      console.error('Verify OTP error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  };

  const enrollTwoFactor = async (): Promise<{ success: boolean; error?: string; enrollment?: TotpEnrollment }> => {
    if (!user) {
      return { success: false, error: 'Oturum açılmamış' };
    }

    try {
      const accountLabel = user.email?.trim() || user.username?.trim() || 'user';

      const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) {
        throw factorError;
      }

      const existingFactors = extractTotpFactors(factorData.all as TotpFactorRecord[] | undefined);
      const verifiedFactor = existingFactors.find((factor) => factor.status === 'verified');
      if (verifiedFactor) {
        return { success: false, error: 'Google Authenticator zaten etkin.' };
      }

      const unverifiedFactors = existingFactors.filter((factor) => factor.status === 'unverified');
      for (const factor of unverifiedFactors) {
        const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (error) {
          throw error;
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: accountLabel,
        issuer: 'ToonParrot',
      });

      if (error) {
        throw error;
      }

      await refreshMfaState();

      return {
        success: true,
        enrollment: {
          factorId: data.id,
          friendlyName: data.friendly_name || undefined,
          qrCodeSvg: data.totp.qr_code,
          secret: data.totp.secret,
          uri: data.totp.uri,
        },
      };
    } catch (error: unknown) {
      console.error('Enroll 2FA error:', error);
      return { success: false, error: getErrorMessage(error, '2FA kurulumu başlatılamadı') };
    }
  };

  const cancelTwoFactorEnrollment = async (factorId: string): Promise<void> => {
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        throw error;
      }
      await refreshMfaState();
    } catch (error) {
      console.error('Cancel 2FA enrollment error:', error);
    }
  };

  const verifyTwoFactorEnrollment = async (factorId: string, code: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Oturum açılmamış' };
    }

    try {
      const verificationCode = code.trim();
      if (!/^\d{6}$/.test(verificationCode)) {
        return { success: false, error: '6 haneli doğrulama kodu girin.' };
      }

      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) {
        throw challenge.error;
      }

      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: verificationCode,
      });

      if (verify.error) {
        throw verify.error;
      }

      const currentSession = (await supabase.auth.getSession()).data.session;
      const stabilizedSession = await waitForUsableSupabaseSession({
        preferredSession: currentSession,
        required: false,
      }).catch(() => currentSession);
      const activeSession = stabilizedSession?.user ? stabilizedSession : currentSession;

      if (activeSession?.user) {
        const profile = await ensureProfile(activeSession.user);
        setSession(activeSession);
        setSupabaseUser(activeSession.user);
        setUser(mapSupabaseUserToUser(activeSession.user, profile));
      }

      await refreshMfaState();
      return { success: true };
    } catch (error: unknown) {
      console.error('Verify 2FA enrollment error:', error);
      return { success: false, error: getErrorMessage(error, 'Doğrulama başarısız oldu') };
    }
  };

  const challengeTwoFactor = async (code: string, factorId?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const verificationCode = code.trim();
      if (!/^\d{6}$/.test(verificationCode)) {
        return { success: false, error: '6 haneli doğrulama kodu girin.' };
      }

      const factor = await getPrimaryVerifiedTotpFactor(factorId);
      if (!factor) {
        return { success: false, error: 'Doğrulanmış bir TOTP faktörü bulunamadı.' };
      }

      const verify = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: verificationCode,
      });

      if (verify.error) {
        throw verify.error;
      }

      const activeSession = (await supabase.auth.getSession()).data.session;
      if (activeSession?.user) {
        const profile = await ensureProfile(activeSession.user);
        setSession(activeSession);
        setSupabaseUser(activeSession.user);
        setUser(mapSupabaseUserToUser(activeSession.user, profile));
      }

      await refreshMfaState();
      return { success: true };
    } catch (error: unknown) {
      console.error('2FA challenge error:', error);
      return { success: false, error: getErrorMessage(error, 'Doğrulama başarısız oldu') };
    }
  };

  const disableTwoFactor = async (code: string, factorId?: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Oturum açılmamış' };
    }

    try {
      const factor = await getPrimaryVerifiedTotpFactor(factorId);
      if (!factor) {
        return { success: false, error: 'Kapatılacak TOTP faktörü bulunamadı.' };
      }

      const verification = await challengeTwoFactor(code, factor.id);
      if (!verification.success) {
        return verification;
      }

      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (error) {
        throw error;
      }

      await refreshMfaState();
      return { success: true };
    } catch (error: unknown) {
      console.error('Disable 2FA error:', error);
      return { success: false, error: getErrorMessage(error, '2FA kapatılamadı') };
    }
  };

  const loginWithGoogle = async (redirectTo?: string) => {
    try {
      const accessCheck = await checkCurrentAccess().catch((error) =>
        allowAccessOnFailure(error, 'Access check error during Google login:')
      );

      if (isConcreteAccessDenial(accessCheck)) {
        toast.error(accessCheck.message || 'Bu cihaz veya bağlantı için bu işleme izin verilmiyor');
        return;
      }

      const resolvedRedirectTo = redirectTo || `${window.location.origin}/auth?provider=google`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: resolvedRedirectTo,
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      console.error('Google login error:', error);
      toast.error('Google ile giriş yapılırken hata oluştu');
    }
  };

  const resendEmail = async (email: string, type: 'signup' | 'recovery'): Promise<{ success: boolean; error?: string }> => {
    try {
      if (type === 'signup') {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth?type=recovery`,
        });
        if (error) throw error;
      }
      return { success: true };
    } catch (error: unknown) {
      console.error('Resend email error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      supabaseUser,
      session,
      isLoading,
      mfaState,
      accessState,
      login,
      register,
      logout,
      updateProfile,
      updatePassword,
      updateEmail,
      updatePreferences,
      resetPassword,
      verifyOtp,
      refreshMfaState,
      enrollTwoFactor,
      cancelTwoFactorEnrollment,
      verifyTwoFactorEnrollment,
      challengeTwoFactor,
      disableTwoFactor,
      loginWithGoogle,
      resendEmail,
      refreshAccessState,
      acknowledgeWarning,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// This hook intentionally lives next to the provider for a single auth public API.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
