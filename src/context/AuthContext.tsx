import React, { createContext, useContext, useEffect, useState } from 'react';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: 'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER';
  track: string;
  assigned_guide_id?: string | null;
  approved_level?: string;
  proposed_level?: string;
  evidence_status?: string;
}

interface AuthContextValue {
  user: UserAccount | null;
  token: string | null;
  loading: boolean;
  loginWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string; user?: UserAccount }>;
  logout: () => Promise<void>;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('frins_token'));
  const [loading, setLoading] = useState<boolean>(true);

  const authFetch = async (url: string, options: RequestInit = {}) => {
    const activeToken = localStorage.getItem('frins_token');
    const headers = new Headers(options.headers || {});
    if (activeToken) {
      headers.set('Authorization', `Bearer ${activeToken}`);
    }
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...options, headers });
  };

  useEffect(() => {
    const init = async () => {
      try {
        const storedToken = localStorage.getItem('frins_token');

        if (storedToken) {
          const meRes = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${storedToken}` }
          });
          if (meRes.ok) {
            const meData = await meRes.json();
            setUser(meData.user);
            setLoading(false);
            return;
          }
        }

        // Visitors stay anonymous on the public website until they explicitly sign in
        // through the Student Login form. No silent auto-login.
        localStorage.removeItem('frins_token');
        setToken(null);
        setUser(null);
      } catch (err) {
        console.error('Auth init error:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const loginWithEmail = async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { ok: false, error: data.error || 'Login failed' };
      }
      localStorage.setItem('frins_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return { ok: true, user: data.user as UserAccount };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Network error' };
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } finally {
      localStorage.removeItem('frins_token');
      setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, loginWithEmail, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
