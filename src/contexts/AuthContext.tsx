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
    const savedUser = getUser();
    if (savedUser) {
      setUser(savedUser);
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    // Simulated login - in production, this would call an API
    await new Promise(resolve => setTimeout(resolve, 500));

    if (email && password.length >= 6) {
      // Check if user exists in our global DB
      let existingUser = getAllUsers().find(u => u.email === email);

      if (!existingUser) {
        // If they don't exist (e.g. they were only in local session), add them now
        existingUser = {
          id: `user-${Date.now()}`,
          username: email.split('@')[0],
          email,
          createdAt: new Date().toISOString(),
          role: 'user'
        };
        saveToDB(existingUser);
      }

      setUser(existingUser);
      saveSession(existingUser);
      return true;
    }
    return false;
  };

  const register = async (username: string, email: string, password: string): Promise<boolean> => {
    // Simulated registration
    await new Promise(resolve => setTimeout(resolve, 500));

    if (username && email && password.length >= 6) {
      // Check if user already exists in DB
      const existingUser = getAllUsers().find(u => u.email === email);

      const newUser: User = existingUser || {
        id: `user-${Date.now()}`,
        username,
        email,
        createdAt: new Date().toISOString(),
        role: 'user'
      };

      setUser(newUser);
      saveSession(newUser);
      saveToDB(newUser); // Save to the global admin-visible list
      return true;
    }
    return false;
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
