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
