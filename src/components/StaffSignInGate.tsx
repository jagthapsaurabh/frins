import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface StaffSignInGateProps {
  /** Human label for the protected console, e.g. "Admin Console". */
  consoleName: string;
  /** Roles allowed to open this console. */
  allowedRoles: string[];
  /** Optional signed-in user's current role, used to explain a 403. */
  currentRole?: string | null;
  /** Called after the credentials are accepted. Defaults to a full page reload. */
  onSuccess?: () => void;
}

/**
 * Gate for internal consoles (/admin, /guide, /ai-pipeline).
 *
 * Staff access is intentionally NOT advertised on the public website and there is
 * no one-click role switch: a valid staff email + password is always required.
 */
export const StaffSignInGate: React.FC<StaffSignInGateProps> = ({
  consoleName,
  allowedRoles,
  currentRole,
  onSuccess
}) => {
  const { user, loginWithEmail, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await loginWithEmail(email.trim(), password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Could not sign in with those credentials.');
      return;
    }
    // After a successful sign-in the page re-renders and re-checks the role.
    if (onSuccess) onSuccess();
    else window.location.reload();
  };

  return (
    <div className="workspace-shell">
      <div className="container">
        <div className="panel-card" style={{ maxWidth: 520, margin: '0 auto', border: '2px solid var(--border-subtle)' }}>
          <span className="micro-tag accent">Restricted Console</span>
          <h2 style={{ fontSize: 23, margin: '10px 0 6px' }}>{consoleName} Sign In</h2>
          <p style={{ fontSize: 13.5, marginBottom: 14 }}>
            This page is for FRINS staff only. Sign in with your work email to continue.
          </p>

          {user && (
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                fontSize: 12.5,
                marginBottom: 14
              }}
            >
              You are signed in as <strong>{user.name}</strong> ({currentRole || user.role}). That role cannot open
              this page.
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 8, display: 'block' }}
                onClick={() => logout()}
              >
                Sign out
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Staff Email</label>
              <input
                type="email"
                className="form-input"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div style={{ color: 'var(--danger-text)', fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Verifying credentials...' : `Sign In to ${consoleName}`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
