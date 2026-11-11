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
  demoAccounts: UserAccount[];
  loading: boolean;
  loginWithEmail: (email: string, password?: string) => Promise<{ ok: boolean; error?: string; user?: UserAccount }>;
  switchAccount: (email: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('frins_token'));
  const [demoAccounts, setDemoAccounts] = useState<UserAccount[]>([]);
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

  const loadDemoAccounts = async (authToken?: string | null) => {
    try {
      const res = await fetch('/api/auth/demo-accounts', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setDemoAccounts(data.accounts || []);
      }
    } catch {
      /* directory is optional */
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const storedToken = localStorage.getItem('frins_token');
        await loadDemoAccounts(storedToken);

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

  const loginWithEmail = async (email: string, password = 'frins123') => {
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
      await loadDemoAccounts(data.token);
      return { ok: true, user: data.user as UserAccount };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Network error' };
    }
  };

  /**
   * Staff-only workspace switch (server enforces ADMIN / CURRICULUM_OWNER).
   * Returns an error for learners, who must sign in with credentials.
   */
  const switchAccount = async (email: string) => {
    try {
      const activeToken = localStorage.getItem('frins_token');
      const res = await fetch('/api/admin/session/switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {})
        },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { ok: false, error: data.error || 'Could not switch workspace.' };
      }
      localStorage.setItem('frins_token', data.token);
      setToken(data.token);
      setUser(data.user);
      await loadDemoAccounts(data.token);
      return { ok: true };
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
      await loadDemoAccounts(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, demoAccounts, loading, loginWithEmail, switchAccount, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
