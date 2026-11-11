import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeRouteForRole } from '../auth/guard';

/**
 * Standalone learner sign-in page at /login.
 * Staff have their own pages (/admin/login, /guide/login), so this form is for learners.
 */
export const SignInPage: React.FC = () => {
  const { user, loginWithEmail, logout } = useAuth();
  const navigate = useNavigate();
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
      setError(res.error || 'That email and password did not work.');
      return;
    }
    navigate(homeRouteForRole(res.user?.role), { replace: true });
  };

  return (
    <div className="auth-page">
      <div className="auth-topbar">
        <Link to="/" className="auth-brand">
          <span className="auth-brand-mark">F</span>
          <span className="auth-brand-text">
            <strong>FRINS</strong>
            <small>Market Learning</small>
          </span>
        </Link>
        <Link to="/" className="auth-back-link">
          Back to website
        </Link>
      </div>

      <div className="auth-split">
        <aside className="auth-brand-pane">
          <span className="auth-eyebrow">Student Portal</span>
          <h1>Sign in and pick up where you left off.</h1>
          <p className="auth-lede">
            Your courses, your tasks and your mentor chat are all waiting inside. Nothing to set up.
          </p>

          <ul className="auth-points">
            <li>
              <strong>Your course, your level.</strong>
              <span>Material built for the track and level you are on right now.</span>
            </li>
            <li>
              <strong>Tasks with real feedback.</strong>
              <span>Upload the work, then read what your mentor says about it.</span>
            </li>
            <li>
              <strong>Talk to a person.</strong>
              <span>Message your mentor inside the dashboard, not over email.</span>
            </li>
          </ul>
        </aside>

        <main className="auth-form-pane">
          <div className="auth-card">
            {user ? (
              <>
                <span className="micro-tag accent">Already signed in</span>
                <h2>You are signed in as {user.name}.</h2>
                <p className="auth-help">
                  Continue to your dashboard, or sign out if you want to use a different account.
                </p>
                <button
                  type="button"
                  className="btn btn-primary auth-submit"
                  onClick={() => navigate(homeRouteForRole(user.role))}
                >
                  {user.role === 'LEARNER' ? 'Continue to my dashboard' : 'Open my staff console'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary auth-submit"
                  style={{ marginTop: 10 }}
                  onClick={async () => {
                    await logout();
                    setPassword('');
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <span className="micro-tag accent">Sign In</span>
                <h2>Welcome back.</h2>
                <p className="auth-help">Use the email and password you signed up with.</p>

                <form onSubmit={handleSubmit} noValidate>
                  <div className="form-group">
                    <label className="form-label" htmlFor="signin-email">
                      Email
                    </label>
                    <input
                      id="signin-email"
                      type="email"
                      className="form-input"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="signin-password">
                      Password
                    </label>
                    <input
                      id="signin-password"
                      type="password"
                      className="form-input"
                      autoComplete="current-password"
                      placeholder="Your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>

                  {error && (
                    <div className="auth-error" role="alert">
                      {error}
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
                    {busy ? 'Signing you in...' : 'Sign in'}
                  </button>
                </form>

                <p className="auth-alt">
                  Not a student yet? <Link to="/discovery">Start with the Discovery questions</Link>, or{' '}
                  <Link to="/">book a call</Link>.
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default SignInPage;
