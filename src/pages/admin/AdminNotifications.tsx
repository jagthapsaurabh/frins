import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatDateTime } from '../../utils/dates';

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
 * Notification history. Writing a new one is its own route, so the two jobs do
 * not share a screen.
 */
export const AdminNotifications: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<SentNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SentNotice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await authFetch('/api/admin/notifications');
    if (res.ok) {
      const data = await res.json();
      setItems(data.notifications || []);
    }
    setLoading(false);
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async () => {
    if (!deleteTarget) return;
    await authFetch(`/api/admin/notifications/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    load();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">Growth</span>
          <h1>Notifications</h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/notifications/new')}>
            <Plus size={14} /> New notice
          </button>
        </div>
      </div>

      <section className="panel-card" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '14px 16px', margin: 0 }}>
          <div>
            <h2>Sent notices</h2>
            <p>Read counts update as people open each one.</p>
          </div>
          <span className="section-note">{items.length} sent</span>
        </div>

        {loading ? (
          <p className="section-note" style={{ padding: 16 }}>Loading.</p>
        ) : items.length === 0 ? (
          <div style={{ padding: 16 }}>
            <div className="empty-state">
              <strong>Nothing sent yet</strong>
              A notice appears in the bell at the top of the workspace.
            </div>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Notice</th>
                  <th>Audience</th>
                  <th>Read</th>
                  <th>Sent</th>
                  <th aria-label="Delete" style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((notice) => (
                  <tr key={notice.id}>
                    <td>
                      <span className="row-title">{notice.title}</span>
                      <span className="row-sub">{notice.message}</span>
                    </td>
                    <td>{AUDIENCE_LABEL[notice.audience] || notice.audience}</td>
                    <td className="num">
                      {notice.readCount} / {notice.recipientCount}
                    </td>
                    <td className="row-sub" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(notice.createdAt)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setDeleteTarget(notice)}
                        aria-label={`Delete ${notice.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
    </div>
  );
};

/** The compose screen, on its own route. */
export const NewNotificationPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [people, setPeople] = useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('ALL');
  const [targetUserId, setTargetUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/admin/users?role=ALL&limit=200')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data) =>
        setPeople((data.rows || []).filter((u: any) => u.account_status === 'ACTIVE'))
      )
      .catch(() => setPeople([]));
  }, [authFetch]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !message.trim()) {
      setError('Add a title and a message.');
      return;
    }
    if (audience === 'USER' && !targetUserId) {
      setError('Pick the person who should receive this.');
      return;
    }
    setBusy(true);
    const res = await authFetch('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), message: message.trim(), audience, targetUserId })
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok || !data.success) {
      setError(data.error || 'Could not send that notice.');
      return;
    }
    navigate('/admin/notifications');
  };

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/notifications')}>
        <ArrowLeft size={14} /> Notifications
      </button>

      <div className="page-head">
        <div>
          <span className="page-eyebrow">New notice</span>
          <h1>Send a notification</h1>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <form onSubmit={send} className="form-layout">
        <section className="panel-card">
          <div className="form-group">
            <label className="form-label" htmlFor="ntf-title">Title</label>
            <input
              id="ntf-title"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Live session moved to Thursday"
              maxLength={120}
              required
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="ntf-audience">Who gets it</label>
              <select
                id="ntf-audience"
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
                <label className="form-label" htmlFor="ntf-person">Person</label>
                <select
                  id="ntf-person"
                  className="form-select"
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                >
                  <option value="">Pick someone</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} ({person.email})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ntf-message">Message</label>
            <textarea
              id="ntf-message"
              className="form-textarea"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Keep it short and say what they need to do."
              required
            />
          </div>

          <p className="form-hint">It shows in the bell at the top of the workspace for everyone you pick.</p>
        </section>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/notifications')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Send size={14} /> {busy ? 'Sending…' : 'Send notice'}
          </button>
        </div>
      </form>
    </div>
  );
};
