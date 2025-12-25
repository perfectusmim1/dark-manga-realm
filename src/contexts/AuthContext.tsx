import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { User } from '@/lib/types';

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
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
          const profile = await fetchProfile(currentSession.user.id);
          if (!mounted) return;

          const newUser = mapSupabaseUserToUser(currentSession.user, profile);

          setSession(prev => {
            if (JSON.stringify(prev) === JSON.stringify(currentSession)) return prev;
            return currentSession;
          });

          setSupabaseUser(prev => {
            if (JSON.stringify(prev) === JSON.stringify(currentSession.user)) return prev;
            return currentSession.user;
          });

          setUser(prev => {
            if (JSON.stringify(prev) === JSON.stringify(newUser)) return prev;
            return newUser;
          });
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

  return (
    <AuthContext.Provider value={{
      user,
      supabaseUser,
      session,
      isLoading,
      login,
      register,
      logout
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
