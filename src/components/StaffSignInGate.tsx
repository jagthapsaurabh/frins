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
  /**
   * "panel" keeps the boxed card used inside the workspaces.
   * "plain" renders only the fields, for the standalone sign-in pages that
   * supply their own heading and layout.
   */
  layout?: 'panel' | 'plain';
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
  onSuccess,
  layout = 'panel'
}) => {
  const { user, loginWithEmail, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  const form = (
    <>
      {user && (
        <div className="gate-session">
          <p>
            You are signed in as <strong>{user.name}</strong> ({currentRole || user.role}). That role cannot
            open this page.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate={false}>
        <div className="gate-field">
          <label className="gate-label" htmlFor={`${consoleName}-email`}>
            Work email
          </label>
          <input
            id={`${consoleName}-email`}
            type="email"
            className="form-input gate-input"
            autoComplete="username"
            placeholder="you@frins.in"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div className="gate-field">
          <div className="gate-label-row">
            <label className="gate-label" htmlFor={`${consoleName}-password`}>
              Password
            </label>
            <button
              type="button"
              className="gate-reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id={`${consoleName}-password`}
            type={showPassword ? 'text' : 'password'}
            className="form-input gate-input"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <div className="gate-error">{error}</div>}

        <button type="submit" className="btn btn-primary gate-submit" disabled={busy}>
          {busy ? 'Checking credentials…' : `Sign in to ${consoleName}`}
        </button>
      </form>
    </>
  );

  if (layout === 'plain') {
    return <div className="gate-plain">{form}</div>;
  }

  return (
    <div className="workspace-shell">
      <div className="container">
        <div className="panel-card" style={{ maxWidth: 520, margin: '0 auto', border: '2px solid var(--border-subtle)' }}>
          <span className="micro-tag accent">Restricted Console</span>
          <h2 style={{ fontSize: 23, margin: '10px 0 6px' }}>{consoleName} Sign In</h2>
          <p style={{ fontSize: 13.5, marginBottom: 14 }}>
            This page is for FRINS staff only. Sign in with your work email to continue.
          </p>
          {form}
        </div>
      </div>
    </div>
  );
};
