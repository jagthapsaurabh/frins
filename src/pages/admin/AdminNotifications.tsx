import React, { useEffect, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface SentNotice {
  id: string;
  title: string;
  message: string;
  audience: string;
  targetUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  recipientCount: number;
  readCount: number;
}

const AUDIENCE_LABEL: Record<string, string> = {
  ALL: 'Everyone',
  LEARNERS: 'All learners',
  STAFF: 'All staff',
  USER: 'One person'
};

/**
 * Compose a notice and see what was sent. Recipients see it in the bell at the
 * top of their workspace.
 */
export const AdminNotifications: React.FC = () => {
  const { authFetch } = useAuth();
  const [items, setItems] = useState<SentNotice[]>([]);
  const [people, setPeople] = useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('ALL');
  const [targetUserId, setTargetUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SentNotice | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [listRes, overviewRes] = await Promise.all([
        authFetch('/api/admin/notifications'),
        authFetch('/api/admin/overview')
      ]);
      if (listRes.ok) {
        const data = await listRes.json();
        setItems(data.notifications || []);
      }
      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setPeople(
          (data.users || [])
            .filter((u: any) => u.account_status === 'ACTIVE')
            .map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!title.trim() || !message.trim()) {
      setError('Add a title and a message.');
      return;
    }
    if (audience === 'USER' && !targetUserId) {
      setError('Pick the person who should receive this.');
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/notifications', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), message: message.trim(), audience, targetUserId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not send that notice.');
        return;
      }
      setTitle('');
      setMessage('');
      setAudience('ALL');
      setTargetUserId('');
      setNotice('Sent. The people in that group will see it in their notifications.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    await authFetch(`/api/admin/notifications/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    load();
  };

  return (
    <>
      <div className="admin-split">
        <section className="panel-card">
          <span className="micro-tag accent">New notice</span>
          <h3 className="admin-card-title">Send a notification</h3>
          <p className="admin-card-copy">
            It appears in the bell at the top of the workspace for everyone you pick.
          </p>

          <form onSubmit={send} className="admin-form">
            <div className="form-group">
              <label className="form-label" htmlFor="ntfTitle">
                Title
              </label>
              <input
                id="ntfTitle"
                className="form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. No live session this Friday"
                maxLength={120}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ntfAudience">
                Who gets it
              </label>
              <select
                id="ntfAudience"
                className="form-select"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              >
                <option value="ALL">Everyone</option>
                <option value="LEARNERS">All learners</option>
                <option value="STAFF">All staff</option>
                <option value="USER">One person</option>
              </select>
            </div>

            {audience === 'USER' && (
              <div className="form-group">
                <label className="form-label" htmlFor="ntfPerson">
                  Person
                </label>
                <select
                  id="ntfPerson"
                  className="form-select"
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  required
                >
                  <option value="">Choose an account</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="ntfMessage">
                Message
              </label>
              <textarea
                id="ntfMessage"
                className="form-textarea"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Keep it short and say what the person needs to do."
                required
              />
            </div>

            {error && <div className="admin-inline-error">{error}</div>}
            {notice && <div className="admin-inline-ok">{notice}</div>}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Send size={15} /> {busy ? 'Sending...' : 'Send notification'}
            </button>
          </form>
        </section>

        <section className="panel-card">
          <span className="micro-tag accent">Sent</span>
          <h3 className="admin-card-title">Notification history</h3>
          <p className="admin-card-copy">Read counts update as people open each notice.</p>

          {loading ? (
            <p className="admin-muted">Loading...</p>
          ) : items.length === 0 ? (
            <p className="admin-muted">Nothing sent yet.</p>
          ) : (
            <ul className="admin-notice-list">
              {items.map((n) => (
                <li key={n.id}>
                  <div className="admin-notice-head">
                    <strong>{n.title}</strong>
                    <button
                      type="button"
                      className="admin-icon-btn"
                      onClick={() => setDeleteTarget(n)}
                      aria-label={`Delete ${n.title}`}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p>{n.message}</p>
                  <div className="admin-notice-meta">
                    <span>{AUDIENCE_LABEL[n.audience] || n.audience}</span>
                    <span>
                      {n.readCount} of {n.recipientCount} read
                    </span>
                    <span>{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this notification?"
        message={
          deleteTarget
            ? `"${deleteTarget.title}" will be removed from every inbox. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </>
  );
};
