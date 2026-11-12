import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { FilterSelect, PageHead, Toolbar } from '../../components/console/ConsoleUI';
import { timeAgo } from '../../utils/dates';

interface Notice {
  id: string;
  title: string;
  message: string;
  audience: string;
  createdByName: string | null;
  createdAt: string;
  isRead: boolean;
  linkUrl?: string | null;
}

/**
 * Everything the team has sent this learner, in one place.
 *
 * The bell in the top bar opens this page. Notices that point at a task or a
 * course open it in one click.
 */
export const LearnerNotifications: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/notifications');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load your notifications.');
      setItems(json.notifications || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load your notifications.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const unread = items.filter((item) => !item.isRead).length;

  const shown = useMemo(
    () => (filter === 'UNREAD' ? items.filter((item) => !item.isRead) : items),
    [items, filter]
  );

  const markRead = async (id: string) => {
    setBusy(true);
    try {
      await authFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    } finally {
      setBusy(false);
    }
  };

  const open = async (item: Notice) => {
    if (!item.isRead) await markRead(item.id);
    if (item.linkUrl) navigate(item.linkUrl);
  };

  const markAll = async () => {
    setBusy(true);
    try {
      for (const item of items.filter((row) => !row.isRead)) {
        await authFetch(`/api/notifications/${item.id}/read`, { method: 'POST' });
      }
      setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead
        title="Notifications"
        meta={unread > 0 ? `${unread} unread` : 'All read'}
        actions={
          unread > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={markAll} disabled={busy}>
              <CheckCheck size={14} /> Mark all read
            </button>
          ) : undefined
        }
      />

      {error && <div className="governance-alert danger">{error}</div>}

      <Toolbar>
        <FilterSelect
          label="Filter notifications"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: 'Every notification' },
            { value: 'UNREAD', label: 'Unread only' }
          ]}
        />
      </Toolbar>

      {loading ? (
        <p className="section-note">Loading your notifications.</p>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          <Bell size={18} />
          <strong>{items.length === 0 ? 'Nothing here yet' : 'Nothing unread'}</strong>
          <span>
            {items.length === 0
              ? 'When your guide reviews a task or the team sends you something, it shows up here.'
              : 'You have read everything. Switch the filter to see older notices.'}
          </span>
        </div>
      ) : (
        <div className="notice-list">
          {shown.map((item) => (
            <div
              key={item.id}
              className={`notice ${item.isRead ? '' : 'unread'} ${item.linkUrl ? 'clickable' : ''}`}
              onClick={() => (item.linkUrl ? open(item) : !item.isRead ? markRead(item.id) : undefined)}
              role={item.linkUrl ? 'button' : undefined}
              tabIndex={item.linkUrl ? 0 : undefined}
              onKeyDown={(e) => {
                if (item.linkUrl && (e.key === 'Enter' || e.key === ' ')) open(item);
              }}
            >
              <span className="notice-dot" />
              <div className="notice-main">
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <div className="notice-meta">
                  <span>{item.createdByName || 'FRINS team'}</span>
                  <span>·</span>
                  <span>{timeAgo(item.createdAt)}</span>
                  {item.linkUrl && (
                    <>
                      <span>·</span>
                      <span>Open</span>
                    </>
                  )}
                  {!item.isRead && (
                    <button
                      type="button"
                      className="notif-link"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead(item.id);
                      }}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
