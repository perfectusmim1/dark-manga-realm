import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { EmailOtpType, Factor, PostgrestSingleResponse } from '@supabase/supabase-js';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { User } from '@/lib/types';
import { checkCurrentAccess } from '@/lib/security/deviceIdentity';
import { getDeviceIdentity } from '@/lib/security/deviceFingerprint';
import { syncLocalChapterReadFallbackToRemote } from '@/lib/storage';
import {
  getCachedPreferencesForUser,
  isEffectivelyOnline,
  queuePreferencesUpdate,
  setCachedPreferencesForUser,
} from '@/lib/offline/userSync';
import { PASSWORD_MIN_LENGTH, translatePasswordPolicyError } from '@/lib/auth/passwordPolicy';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  isLoading: boolean;
  mfaState: MfaState;
  login: (email: string, password: string) => Promise<{
    success: boolean;
    error?: string;
    email?: string;
    requiresTwoFactor?: boolean;
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
  created_at: string;
  preferences?: User['preferences'];
  two_factor_enabled?: boolean;
}

type TotpFactorRecord = Factor<'totp', 'verified' | 'unverified'>;

const PROFILE_SELECT_COLUMNS = 'id, username, username_last_changed_at, avatar, role, created_at, preferences, two_factor_enabled';
const DEFAULT_USER_PREFERENCES: NonNullable<User['preferences']> = {
  notifications: {
    new_chapter: true,
    replies: true,
    likes: true,
    follows: true,
  },
  comments: {
    auto_show_media: false,
    auto_show_gifs: false,
    auto_show_replies: false,
    show_page_comments: false,
  },
  privacy: {
    visibility: 'public',
    reading_history_visibility: 'public',
    comments_visibility: 'public',
    reading_lists_visibility: 'public',
    tier_lists_visibility: 'public',
    followed_manga_visibility: 'public',
  },
};

const normalizeUserPreferences = (preferences?: User['preferences']): NonNullable<User['preferences']> => ({
  notifications: {
    ...DEFAULT_USER_PREFERENCES.notifications,
    ...preferences?.notifications,
  },
  comments: {
    ...DEFAULT_USER_PREFERENCES.comments,
    ...preferences?.comments,
  },
  privacy: {
    ...DEFAULT_USER_PREFERENCES.privacy,
    ...preferences?.privacy,
  },
});

const getErrorMessage = (error: unknown, fallback = 'Bir hata oluştu') => (
  error instanceof Error ? error.message : fallback
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

  const fetchProfile = async (id: string): Promise<UserProfileRow | null> => {
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
        console.error('Error fetching profile:', error);
        return null;
      }
      return data;
    } catch (err) {
      console.error('Profile fetch failed:', err);
      return null;
    }
  };

  const syncCurrentAuthProfile = async (
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
        console.error('Profile sync failed:', error);
        return null;
      }

      const profileRow = Array.isArray(data) ? data[0] : data;
      if (profileRow) {
        return profileRow;
      }

      return await fetchProfile(currentUser.id);
    } catch (error) {
      console.error('Profile sync exception:', error);
      return null;
    }
  };

  const ensureProfile = async (
    currentUser: SupabaseUser,
    preferredUsername?: string
  ): Promise<UserProfileRow | null> => {
    const syncedProfile = await syncCurrentAuthProfile(currentUser, preferredUsername);
    if (syncedProfile) {
      return syncedProfile;
    }

    return await fetchProfile(currentUser.id);
  };

  const updateLocalTwoFactorState = (enabled: boolean) => {
    setUser((prev) => (prev ? { ...prev, twoFactorEnabled: enabled } : prev));
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

  const getPrimaryVerifiedTotpFactor = async (preferredFactorId?: string): Promise<TotpFactor | null> => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      throw error;
    }

    const factors = extractTotpFactors(data.all as any);
    const verifiedFactors = factors.filter((factor) => factor.status === 'verified');

    if (preferredFactorId) {
      return verifiedFactors.find((factor) => factor.id === preferredFactorId) || null;
    }

    return verifiedFactors[0] || null;
  };

  const refreshMfaState = async (): Promise<void> => {
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

      const factors = extractTotpFactors(factorData.all as any);
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
  };

  useEffect(() => {
    let mounted = true;

    const syncAuthState = async (currentSession: Session | null) => {
      if (!mounted) return;

      try {
        if (currentSession?.user) {
          if (!isEffectivelyOnline()) {
            const fallbackUser = mapSupabaseUserToUser(currentSession.user, null);
            setSession(prev => JSON.stringify(prev) === JSON.stringify(currentSession) ? prev : currentSession);
            setSupabaseUser(prev => JSON.stringify(prev) === JSON.stringify(currentSession.user) ? prev : currentSession.user);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(fallbackUser) ? prev : fallbackUser);
            setMfaState((prev) => ({ ...prev, isLoading: false }));
            return;
          }

          const accessCheck = await checkCurrentAccess().catch(() => ({ allowed: true }));
          if (!mounted) return;

          if (!(accessCheck as any).allowed) {
            await supabase.auth.signOut();
            setSession(null);
            setSupabaseUser(null);
            setUser(null);
            setMfaState(DEFAULT_MFA_STATE);
            toast.error((accessCheck as any).message || 'Bu cihaz veya bağlantı için erişim engellendi');
            return;
          }

          const profile = await ensureProfile(currentSession.user);

          if (!mounted) return;

          setSession(prev => JSON.stringify(prev) === JSON.stringify(currentSession) ? prev : currentSession);
          setSupabaseUser(prev => JSON.stringify(prev) === JSON.stringify(currentSession.user) ? prev : currentSession.user);

          // 3. Final safety check: set state
          if (profile) {
            const newUser = mapSupabaseUserToUser(currentSession.user, profile);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(newUser) ? prev : newUser);
            void syncLocalChapterReadFallbackToRemote(currentSession.user.id);
          } else {
            console.error('Critical: Could not establish a user profile.');
            // Even if DB profile fails, let's at least let them see they are logged in via Auth
            const fallbackUser = mapSupabaseUserToUser(currentSession.user, null);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(fallbackUser) ? prev : fallbackUser);
            void syncLocalChapterReadFallbackToRemote(currentSession.user.id);
          }

          await refreshMfaState();
        } else {
          setSession(null);
          setSupabaseUser(null);
          setUser(null);
          setMfaState(DEFAULT_MFA_STATE);
        }
      } catch (err) {
        console.error('Failed to sync auth state:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    // Presence heartbeat
    const presenceInterval = setInterval(async () => {
      if (!isEffectivelyOnline()) {
        return;
      }

      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user) await supabase.rpc('update_user_presence', { p_user_id: s.user.id });
    }, 30000);

    // Initial check
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      syncAuthState(s);
      if (s?.user && isEffectivelyOnline()) {
        supabase.rpc('update_user_presence', { p_user_id: s.user.id });
      }
    }).catch(err => {
      console.error('Initial session check failed:', err);
      if (mounted) setIsLoading(false);
    });

    // 2. Continuous listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        console.log('Auth event change detected:', event);
        // We only trigger re-sync for significant events to avoid loops
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
          syncAuthState(currentSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearInterval(presenceInterval);
    };
  }, []);

  const login = async (email: string, password: string): Promise<{
    success: boolean;
    error?: string;
    email?: string;
    requiresTwoFactor?: boolean;
    retryAfterSeconds?: number;
  }> => {
    try {
      setIsLoading(true);

      const identifier = email.trim();
      const deviceIdentity = await getDeviceIdentity();
      const { data, error } = await supabase.functions.invoke('password-login', {
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

      if (!data?.success || !data?.session?.access_token || !data?.session?.refresh_token) {
        return {
          success: false,
          error: data?.message || 'E-posta/kullanıcı adı veya şifre hatalı',
          retryAfterSeconds: data?.retryAfterSeconds,
        };
      }

      const { data: sessionData, error: setSessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      if (setSessionError || !sessionData.user || !sessionData.session) {
        console.error('Session set error:', setSessionError);
        return { success: false, error: 'Oturum oluşturulamadı' };
      }

      const profile = await ensureProfile(sessionData.user);

      setSession(sessionData.session);
      setSupabaseUser(sessionData.user);
      setUser(mapSupabaseUserToUser(sessionData.user, profile));

      const { data: assuranceData, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) {
        throw assuranceError;
      }

      await refreshMfaState();

      return {
        success: true,
        email: sessionData.user.email || undefined,
        requiresTwoFactor: assuranceData.nextLevel === 'aal2' && assuranceData.currentLevel !== 'aal2',
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

      const accessCheck = await checkCurrentAccess().catch((error) => {
        console.error('Access check error during register:', error);
        return { allowed: true };
      }) as any;

      if (!accessCheck.allowed) {
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
      await supabase.auth.signOut();
      setUser(null);
      setSupabaseUser(null);
      setSession(null);
      setMfaState(DEFAULT_MFA_STATE);
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

      if (!usernameChanged && !avatarChanged) {
        return { success: true };
      }

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

      await ensureProfile(currentAuthUser, user.username);

      let updatedUsername = user.username;

      if (usernameChanged && nextUsername) {
        const { data, error } = await supabase.rpc('update_current_user_username', {
          p_username: nextUsername,
        });

        if (error) throw error;

        const profile = Array.isArray(data) ? data[0] : data;
        if (profile?.username) {
          updatedUsername = profile.username;
        }
      }

      if (avatarChanged) {
        const { error: dbError } = await supabase
          .from('users')
          .update({ avatar: updates.avatar })
          .select(PROFILE_SELECT_COLUMNS)
          .eq('id', user.id);

        if (dbError) throw dbError;
      }

      if (usernameChanged || avatarChanged) {
        const authMetadata: Record<string, string | null> = {};

        if (usernameChanged) {
          authMetadata.username = updatedUsername;
        }

        if (avatarChanged) {
          authMetadata.avatar_url = updates.avatar || null;
        }

        if (Object.keys(authMetadata).length > 0) {
          const { data: authUpdateData, error: authError } = await supabase.auth.updateUser({
            data: authMetadata,
          });
          if (authError) console.warn('Auth metadata update failed:', authError);
          if (authUpdateData?.user) {
            setSupabaseUser(authUpdateData.user);
          }
        }
      }

      // Refresh local state
      const refreshedAuthUser = (await supabase.auth.getUser()).data.user || currentAuthUser;
      const profile = await fetchProfile(user.id) || await ensureProfile(refreshedAuthUser, updatedUsername);
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
    setCachedPreferencesForUser(user.id, normalizedPreferences);
    setUser((prev) => (prev ? { ...prev, preferences: normalizedPreferences } : prev));

    if (!isEffectivelyOnline()) {
      queuePreferencesUpdate(user.id, normalizedPreferences);
      return { success: true };
    }

    try {
      const currentAuthUser = supabaseUser || (await supabase.auth.getUser()).data.user;
      if (!currentAuthUser) {
        return { success: false, error: 'Oturum bulunamadı' };
      }

      const { data, error } = await supabase
        .from('users')
        .update({ preferences: normalizedPreferences })
        .select(PROFILE_SELECT_COLUMNS)
        .eq('id', user.id);

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

      const existingFactors = extractTotpFactors(factorData.all as any);
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
      const accessCheck = await checkCurrentAccess().catch((error) => {
        console.error('Access check error during Google login:', error);
        return { allowed: true };
      });

          if (!(accessCheck as any).allowed) {
            toast.error((accessCheck as any).message || 'Bu cihaz veya bağlantı için bu işleme izin verilmiyor');
            return;
          }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
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
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
