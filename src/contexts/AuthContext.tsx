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

// Convert Supabase user to our User type
const mapSupabaseUserToUser = (supabaseUser: SupabaseUser): User => {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    username: supabaseUser.user_metadata?.username || supabaseUser.email?.split('@')[0] || 'user',
    avatar: supabaseUser.user_metadata?.avatar_url,
    role: supabaseUser.user_metadata?.role || 'user',
    createdAt: supabaseUser.created_at,
  };
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (currentSession?.user) {
          setSession(currentSession);
          setSupabaseUser(currentSession.user);
          setUser(mapSupabaseUserToUser(currentSession.user));
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        console.log('Auth state changed:', event);

        if (currentSession?.user) {
          const newUser = mapSupabaseUserToUser(currentSession.user);

          setSession(currentSession);
          setSupabaseUser(currentSession.user);
          setUser(newUser);
        } else {
          setSession(null);
          setSupabaseUser(null);
          setUser(null);
        }

        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);

      // Supabase auth only works with email, not username
      // So we need to check if the input is an email or username
      let loginEmail = email;

      // If it doesn't look like an email, we assume it's a username
      // and we need to look up the email from the users table
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
        setSession(data.session);
        setSupabaseUser(data.user);
        setUser(mapSupabaseUserToUser(data.user));
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
            password_hash: 'managed_by_supabase_auth', // We don't store the actual password
            role: 'user',
          }]);

        if (insertError) {
          console.error('Error saving user profile:', insertError);
          // Continue anyway, the auth is successful
        }

        // If email confirmation is disabled, user is logged in immediately
        if (data.session) {
          setSession(data.session);
          setSupabaseUser(data.user);
          setUser(mapSupabaseUserToUser(data.user));
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
