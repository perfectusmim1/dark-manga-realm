import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { User } from '@/lib/types';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateProfile: (updates: { username?: string, avatar?: string }) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  updateEmail: (newEmail: string) => Promise<{ success: boolean; error?: string }>;
  updatePreferences: (newPreferences: any) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (email: string, token: string, type: 'signup' | 'recovery' | 'email') => Promise<{ success: boolean; error?: string }>;
  toggle2FA: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<void>;
}



const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Convert Supabase user + Profile data to our User type
const mapSupabaseUserToUser = (supabaseUser: SupabaseUser, profile: any): User => {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    username: profile?.username || supabaseUser.user_metadata?.username || supabaseUser.email?.split('@')[0] || 'user',
    avatar: profile?.avatar || supabaseUser.user_metadata?.avatar_url,
    role: profile?.role || 'user',
    createdAt: supabaseUser.created_at,
    twoFactorEnabled: profile?.two_factor_enabled || false,
    preferences: profile?.preferences || {
      notifications: {
        new_chapter: true,
        replies: true,
        likes: true
      }
    }
  };
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async (id: string) => {
    // Add a 5s timeout to prevent infinite hangs on DB calls during initialization
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
    );

    try {
      const fetchReq = supabase
        .from('users')
        .select('*')
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

  useEffect(() => {
    let mounted = true;

    const syncAuthState = async (currentSession: Session | null) => {
      if (!mounted) return;

      try {
        if (currentSession?.user) {
          let profile = await fetchProfile(currentSession.user.id);

          // 1. If profile doesn't exist by ID, check by Email (Linking strategy)
          if (!profile && currentSession.user.email && mounted) {
            console.log('Profile not found by ID, searching by email:', currentSession.user.email);
            const { data: existingByEmail } = await supabase
              .from('users')
              .select('*')
              .eq('email', currentSession.user.email)
              .maybeSingle();

            if (existingByEmail) {
              console.log('Found profile by email, attempting to link IDs...');
              // If ID is different, we must update it to allow RLS to work
              const { data: updatedProfile, error: updateError } = await supabase
                .from('users')
                .update({ id: currentSession.user.id })
                .eq('email', currentSession.user.email)
                .select()
                .maybeSingle();

              if (!updateError && updatedProfile) {
                profile = updatedProfile;
                console.log('Profile linked successfully!');
              } else {
                console.warn('Could not link profile (likely RLS policy restriction):', updateError);
                // Fallback: use existing profile even if ID update failed (for now)
                profile = existingByEmail;
              }
            }
          }

          // 2. If still no profile, create a new one (First time register)
          if (!profile && mounted) {
            console.log('No profile found anywhere, creating new one...');
            let baseUsername = currentSession.user.user_metadata?.full_name ||
              currentSession.user.user_metadata?.username ||
              currentSession.user.email?.split('@')[0] ||
              'user';

            baseUsername = baseUsername.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').substring(0, 15);

            // Try to insert with username, if conflict, add suffix
            const { data: newProfile, error: insertError } = await supabase
              .from('users')
              .insert([{
                id: currentSession.user.id,
                username: baseUsername,
                email: currentSession.user.email,
                avatar: currentSession.user.user_metadata?.avatar_url,
                role: 'user',
                password_hash: 'oauth_user'
              }])
              .select()
              .maybeSingle();

            if (insertError) {
              if (insertError.code === '23505') { // Conflict (username or email)
                const randomSuffix = Math.floor(1000 + Math.random() * 9000);
                const { data: retryProfile } = await supabase
                  .from('users')
                  .insert([{
                    id: currentSession.user.id,
                    username: `${baseUsername}${randomSuffix}`,
                    email: currentSession.user.email,
                    avatar: currentSession.user.user_metadata?.avatar_url,
                    role: 'user',
                    password_hash: 'oauth_user'
                  }])
                  .select()
                  .maybeSingle();
                profile = retryProfile;
              } else {
                console.error('Final insert failed:', insertError);
              }
            } else {
              profile = newProfile;
            }
          }

          if (!mounted) return;

          // 3. Final safety check: set state
          if (profile) {
            const newUser = mapSupabaseUserToUser(currentSession.user, profile);
            setSession(currentSession);
            setSupabaseUser(currentSession.user);
            setUser(newUser);
          } else {
            console.error('Critical: Could not establish a user profile.');
            // Even if DB profile fails, let's at least let them see they are logged in via Auth
            const fallbackUser = mapSupabaseUserToUser(currentSession.user, null);
            setUser(fallbackUser);
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

    // 1. Initial manual check
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      syncAuthState(initialSession);
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
    };
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);

      // Supabase auth only works with email, not username
      let loginEmail = email;

      if (!email.includes('@')) {
        const { data: userData, error: lookupError } = await supabase
          .from('users')
          .select('email')
          .eq('username', email)
          .maybeSingle();

        if (lookupError || !userData) {
          return { success: false, error: 'Kullanıcı bulunamadı' };
        }
        loginEmail = userData.email;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (error) {
        console.error('Login error:', error);
        if (error.message.includes('Invalid login credentials')) {
          return { success: false, error: 'E-posta veya şifre hatalı' };
        }
        return { success: false, error: error.message };
      }

      if (data.user) {
        const profile = await fetchProfile(data.user.id);
        setSession(data.session);
        setSupabaseUser(data.user);
        setUser(mapSupabaseUserToUser(data.user, profile));
        return { success: true };
      }

      return { success: false, error: 'Giriş başarısız' };
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
        // Also save to our users table for profile data
        const { error: insertError } = await supabase
          .from('users')
          .insert([{
            id: data.user.id,
            username,
            email,
            password_hash: 'managed_by_supabase_auth',
            role: 'user',
          }]);

        if (insertError) {
          console.error('Error saving user profile:', insertError);
        }

        if (data.session) {
          const profile = await fetchProfile(data.user.id);
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
      // Update our users table
      const { error: dbError } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id);

      if (dbError) throw dbError;

      // Update Auth metadata if username changed
      if (updates.username) {
        const { error: authError } = await supabase.auth.updateUser({
          data: { username: updates.username }
        });
        if (authError) console.warn('Auth metadata update failed:', authError);
      }

      // Refresh local state
      const profile = await fetchProfile(user.id);
      setUser(mapSupabaseUserToUser(supabaseUser!, profile));

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
      const { error } = await supabase
        .from('users')
        .update({ preferences: newPreferences })
        .eq('id', user.id);

      if (error) throw error;

      // Refresh local state
      const profile = await fetchProfile(user.id);
      setUser(mapSupabaseUserToUser(supabaseUser!, profile));

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
        const profile = await fetchProfile(data.session.user.id);
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
      const { error } = await supabase
        .from('users')
        .update({ two_factor_enabled: enabled })
        .eq('id', user.id);
      if (error) throw error;

      setUser(prev => prev ? { ...prev, twoFactorEnabled: enabled } : null);
      return { success: true };
    } catch (error: any) {
      console.error('Toggle 2FA error:', error);
      return { success: false, error: error.message };
    }
  };

  const loginWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth`,
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
