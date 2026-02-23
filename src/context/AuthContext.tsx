import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { User, Role } from '../types';
import apiClient, { setToken } from '../api/client';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  setCurrentUser: (nextUser: User | null) => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
  canAccessOrg: (orgId: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('uscis_auth_user');
    return stored ? JSON.parse(stored) : null;
  });

  const setCurrentUser = useCallback((nextUser: User | null) => {
    setUser(nextUser);
    if (nextUser) localStorage.setItem('uscis_auth_user', JSON.stringify(nextUser));
    else localStorage.removeItem('uscis_auth_user');
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const meResp = await apiClient.me();
      if (meResp) {
        setCurrentUser(meResp);
      }
    } catch {
      // ignore
    }
  }, [setCurrentUser]);

  useEffect(() => {
    // try to refresh user from backend if token exists
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiClient.login(email, password);
      const u: User = data.user;
      setToken(data.token);
      setCurrentUser(u);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Login failed' };
    }
  }, [setCurrentUser]);

  const logout = useCallback(() => {
    setCurrentUser(null);
    setToken(null);
  }, [setCurrentUser]);

  const hasRole = useCallback((...roles: Role[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  const canAccessOrg = useCallback((orgId: string) => {
    if (!user) return false;
    if (user.role === 'SuperAdmin') return true;
    return user.organization_id === orgId;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, login, logout, setCurrentUser, refreshUser, isAuthenticated: !!user, hasRole, canAccessOrg }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
