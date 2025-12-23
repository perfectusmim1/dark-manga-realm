import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/lib/types';
import { getUser, setUser as saveSession, removeUser } from '@/lib/storage';
import { getAllUsers, saveUser as saveToDB } from '@/lib/database';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (username: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkUserExistence = () => {
      const savedUser = getUser();
      if (savedUser) {
        // Veritabanındaki tüm kullanıcıları al ve mevcut kullanıcının hala var olup olmadığını kontrol et
        const allUsers = getAllUsers();
        const exists = allUsers.some(u => u.id === savedUser.id);

        if (!exists) {
          // Kullanıcı veritabanında yoksa oturumu kapat
          logout();
          return null;
        }
        return savedUser;
      }
      return null;
    };

    const initialUser = checkUserExistence();
    if (initialUser) {
      setUser(initialUser);
    }
    setIsLoading(false);

    // Veritabanı değişikliklerini veya oturum değişikliklerini izlemek için
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'db_users' || e.key === 'manga_user') {
        const currentUser = checkUserExistence();
        setUser(currentUser);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Periyodik kontrol - Admin panelinden silinme durumunda anında tepki vermek için
    const intervalId = setInterval(() => {
      if (user) {
        const allUsers = getAllUsers();
        const exists = allUsers.some(u => u.id === user.id);
        if (!exists) {
          logout();
        }
      }
    }, 2000); // Her 2 saniyede bir kontrol et

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(intervalId);
    };
  }, [user?.id]);

  const login = async (emailOrUsername: string, password: string): Promise<boolean> => {
    // Simulated login - in production, this would call an API
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!emailOrUsername || !password) {
      return false;
    }

    // Check if user exists in our global DB by email OR username
    const existingUser = getAllUsers().find(
      u => u.email === emailOrUsername || u.username === emailOrUsername
    );

    // If user doesn't exist, login fails - no auto-registration!
    if (!existingUser) {
      return false;
    }

    // Check password
    if (existingUser.password !== password) {
      return false;
    }

    // Success - user exists and password matches
    setUser(existingUser);
    saveSession(existingUser);
    return true;
  };

  const register = async (username: string, email: string, password: string): Promise<boolean> => {
    // Simulated registration
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!username || !email || password.length < 6) {
      return false;
    }

    // Check if user already exists in DB (by email or username)
    const allUsers = getAllUsers();
    const existingByEmail = allUsers.find(u => u.email === email);
    const existingByUsername = allUsers.find(u => u.username === username);

    // If already exists, registration fails
    if (existingByEmail || existingByUsername) {
      return false;
    }

    // Create new user WITH password
    const newUser: User = {
      id: `user-${Date.now()}`,
      username,
      email,
      password, // Store for authentication
      createdAt: new Date().toISOString(),
      role: 'user'
    };

    setUser(newUser);
    saveSession(newUser);
    saveToDB(newUser); // Save to the global admin-visible list
    return true;
  };

  const logout = () => {
    setUser(null);
    removeUser();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
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
