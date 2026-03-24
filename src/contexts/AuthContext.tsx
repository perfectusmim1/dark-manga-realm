import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { User } from '@/lib/types';
import { checkCurrentAccess, getDeviceIdentity } from '@/lib/security/deviceIdentity';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  isLoading: boolean;
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
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  updateEmail: (newEmail: string) => Promise<{ success: boolean; error?: string }>;
  updatePreferences: (newPreferences: any) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (email: string, token: string, type: 'signup' | 'recovery' | 'email') => Promise<{ success: boolean; error?: string }>;
  toggle2FA: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: (redirectTo?: string) => Promise<void>;
}



const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface UserProfileRow {
  id: string;
  username: string;
  avatar: string | null;
  role: User['role'];
  is_banned?: boolean;
  ban_reason?: string | null;
  banned_at?: string | null;
  created_at: string;
  preferences?: User['preferences'];
  two_factor_enabled?: boolean;
}

const PROFILE_SELECT_COLUMNS = 'id, username, avatar, role, created_at, preferences, two_factor_enabled';
const DEFAULT_USER_PREFERENCES: NonNullable<User['preferences']> = {
  notifications: {
    new_chapter: true,
    replies: true,
    likes: true,
  },
  comments: {
    auto_show_media: false,
    auto_show_gifs: false,
    auto_show_replies: false,
  },
  privacy: {
    visibility: 'public',
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

// Convert Supabase user + Profile data to our User type
const mapSupabaseUserToUser = (supabaseUser: SupabaseUser, profile: UserProfileRow | null): User => {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    username: profile?.username || supabaseUser.user_metadata?.username || supabaseUser.email?.split('@')[0] || 'user',
    avatar: profile?.avatar || supabaseUser.user_metadata?.avatar_url,
    role: profile?.role || 'user',
    createdAt: supabaseUser.created_at,
    isBanned: profile?.is_banned || false,
    banReason: profile?.ban_reason || undefined,
    bannedAt: profile?.banned_at || undefined,
    twoFactorEnabled: profile?.two_factor_enabled || false,
    preferences: normalizeUserPreferences(profile?.preferences),
  };
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async (id: string): Promise<UserProfileRow | null> => {
    // Add a 5s timeout to prevent infinite hangs on DB calls during initialization
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
    );

    try {
      const fetchReq = supabase
        .from('users')
        .select(PROFILE_SELECT_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      const { data, error } = (await Promise.race([fetchReq, timeout])) as any;

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
    const existingProfile = await fetchProfile(currentUser.id);
    if (existingProfile) {
      return existingProfile;
    }

    return await syncCurrentAuthProfile(currentUser, preferredUsername);
  };

  useEffect(() => {
    let mounted = true;

    const syncAuthState = async (currentSession: Session | null) => {
      if (!mounted) return;

      try {
        if (currentSession?.user) {
          const accessCheck = await checkCurrentAccess().catch(() => ({ allowed: true }));
          if (!mounted) return;

          if (!accessCheck.allowed) {
            await supabase.auth.signOut();
            setSession(null);
            setSupabaseUser(null);
            setUser(null);
            toast.error(accessCheck.message || 'Bu cihaz veya bağlantı için erişim engellendi');
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
          } else {
            console.error('Critical: Could not establish a user profile.');
            // Even if DB profile fails, let's at least let them see they are logged in via Auth
            const fallbackUser = mapSupabaseUserToUser(currentSession.user, null);
            setUser(prev => JSON.stringify(prev) === JSON.stringify(fallbackUser) ? prev : fallbackUser);
          }
        } else {
          setSession(null);
          setSupabaseUser(null);
          setUser(null);
        }
      } catch (err) {
        console.error('Failed to sync auth state:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    // Presence heartbeat
    const presenceInterval = setInterval(async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user) await supabase.rpc('update_user_presence', { p_user_id: s.user.id });
    }, 30000);

    // Initial check
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      syncAuthState(s);
      if (s?.user) supabase.rpc('update_user_presence', { p_user_id: s.user.id });
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

      return {
        success: true,
        email: sessionData.user.email || undefined,
        requiresTwoFactor: Boolean(profile?.two_factor_enabled),
      };
    } catch (error: any) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Bir hata oluştu' };
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
      });

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
        return { success: false, error: error.message };
      }

      if (data.user) {
        if (data.session) {
          const profile = await ensureProfile(data.user, username);
          setSession(data.session);
          setSupabaseUser(data.user);
          setUser(mapSupabaseUserToUser(data.user, profile));
        }

        return { success: true };
      }

      return { success: false, error: 'Kayıt başarısız' };
    } catch (error: any) {
      console.error('Register error:', error);
      return { success: false, error: error.message || 'Bir hata oluştu' };
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
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const updateProfile = async (updates: { username?: string, avatar?: string }): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Oturum açılmamış' };

    try {
      if (updates.username && updates.username.trim() !== user.username) {
        return { success: false, error: 'Kullanıcı adı değiştirilemez' };
      }

      const currentAuthUser = supabaseUser || (await supabase.auth.getUser()).data.user;
      if (!currentAuthUser) {
        return { success: false, error: 'Oturum bulunamadı' };
      }

      await ensureProfile(currentAuthUser, user.username);

      // Update our users table
      const { error: dbError } = await supabase
        .from('users')
        .update({ avatar: updates.avatar })
        .select(PROFILE_SELECT_COLUMNS)
        .eq('id', user.id);

      if (dbError) throw dbError;

      // Update Auth metadata if username changed
      if (updates.avatar !== undefined) {
        const { data: authUpdateData, error: authError } = await supabase.auth.updateUser({
          data: {
            ...(updates.avatar !== undefined ? { avatar_url: updates.avatar } : {}),
          }
        });
        if (authError) console.warn('Auth metadata update failed:', authError);
        if (authUpdateData?.user) {
          setSupabaseUser(authUpdateData.user);
        }
      }

      // Refresh local state
      const refreshedAuthUser = (await supabase.auth.getUser()).data.user || currentAuthUser;
      const profile = await ensureProfile(refreshedAuthUser, user.username);
      setSupabaseUser(refreshedAuthUser);
      setUser(mapSupabaseUserToUser(refreshedAuthUser, profile));

      return { success: true };
    } catch (error: any) {
      console.error('Update profile error:', error);
      return { success: false, error: error.message };
    }
  };

  const updatePassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (error) throw error;
      return { success: true };
    } catch (error: any) {
      console.error('Update password error:', error);
      return { success: false, error: error.message };
    }
  };

  const updateEmail = async (newEmail: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.updateUser({
        email: newEmail
      });
      if (error) throw error;
      return { success: true, error: 'E-posta güncelleme onayı gönderildi. Lütfen yeni e-postanızı kontrol edin.' };
    } catch (error: any) {
      console.error('Update email error:', error);
      return { success: false, error: error.message };
    }
  };

  const updatePreferences = async (newPreferences: any): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Oturum açılmamış' };

    try {
      const currentAuthUser = supabaseUser || (await supabase.auth.getUser()).data.user;
      if (!currentAuthUser) {
        return { success: false, error: 'Oturum bulunamadı' };
      }

      const { data, error } = await supabase
        .from('users')
        .update({ preferences: newPreferences })
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
    } catch (error: any) {
      console.error('Update preferences error:', error);
      return { success: false, error: error.message };
    }
  };

  const resetPassword = async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });
      if (error) throw error;
      return { success: true };
    } catch (error: any) {
      console.error('Reset password error:', error);
      return { success: false, error: error.message };
    }
  };

  const verifyOtp = async (email: string, token: string, type: 'signup' | 'recovery' | 'email'): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: type as any,
      });
      if (error) throw error;
      if (data.session) {
        setSession(data.session);
        setSupabaseUser(data.session.user);
        const profile = await ensureProfile(data.session.user);
        setUser(mapSupabaseUserToUser(data.session.user, profile));
      }
      return { success: true };
    } catch (error: any) {
      console.error('Verify OTP error:', error);
      return { success: false, error: error.message };
    }
  };

  const toggle2FA = async (enabled: boolean): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Oturum açılmamış' };
    try {
      const currentAuthUser = supabaseUser || (await supabase.auth.getUser()).data.user;
      if (!currentAuthUser) {
        return { success: false, error: 'Oturum bulunamadı' };
      }

      const { data, error } = await supabase
        .from('users')
        .update({ two_factor_enabled: enabled })
        .select(PROFILE_SELECT_COLUMNS)
        .eq('id', user.id);
      if (error) throw error;

      const profile = Array.isArray(data) ? data[0] : data;
      if (!profile) {
        return { success: false, error: '2FA durumu doğrulanamadı' };
      }

      setSupabaseUser(currentAuthUser);
      setUser(mapSupabaseUserToUser(currentAuthUser, profile));
      return { success: true };
    } catch (error: any) {
      console.error('Toggle 2FA error:', error);
      return { success: false, error: error.message };
    }
  };

  const loginWithGoogle = async (redirectTo?: string) => {
    try {
      const accessCheck = await checkCurrentAccess().catch((error) => {
        console.error('Access check error during Google login:', error);
        return { allowed: true };
      });

      if (!accessCheck.allowed) {
        toast.error(accessCheck.message || 'Bu cihaz veya bağlantı için erişim engellendi');
        return;
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo || `${window.location.origin}/auth`,
        }
      });
      if (error) throw error;
    } catch (error: any) {
      console.error('Google login error:', error);
      toast.error('Google ile giriş yapılırken hata oluştu');
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      supabaseUser,
      session,
      isLoading,
      login,
      register,
      logout,
      updateProfile,
      updatePassword,
      updateEmail,
      updatePreferences,
      resetPassword,
      verifyOtp,
      toggle2FA,
      loginWithGoogle
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
