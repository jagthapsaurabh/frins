import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Change your own password. The current password is required, and every other
 * signed-in device is dropped once it changes.
 */
export const ChangePasswordDialog: React.FC<Props> = ({ open, onClose }) => {
  const { authFetch } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setDone(false);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (next.length < 8) {
      setError('Use at least 8 characters for the new password.');
      return;
    }
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not update your password.');
        return;
      }
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={close}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="change-password-title" className="modal-title">
          Update your password
        </h2>

        {done ? (
          <>
            <p className="modal-copy">
              Your password is updated. Any other device that was signed in has been signed out.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="modal-copy">
              Use at least 8 characters. You will stay signed in here, and other devices will be signed out.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="cpCurrent">
                Current password
              </label>
              <input
                id="cpCurrent"
                type="password"
                className="form-input"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="cpNew">
                New password
              </label>
              <input
                id="cpNew"
                type="password"
                className="form-input"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="cpConfirm">
                New password again
              </label>
              <input
                id="cpConfirm"
                type="password"
                className="form-input"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {error && <div className="modal-error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Updating...' : 'Update password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
