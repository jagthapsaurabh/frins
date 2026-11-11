import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Notice {
  id: string;
  title: string;
  message: string;
  audience: string;
  createdByName: string | null;
  createdAt: string;
  isRead: boolean;
}

const timeAgo = (iso: string) => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

/**
 * Bell in the app top bar. Reads notices the admin sent, shows an unread count,
 * and marks items read as they are opened.
 */
export const NotificationBell: React.FC = () => {
  const { authFetch, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const res = await authFetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications || []);
      setUnread(data.unreadCount || 0);
    } catch {
      /* the bell is not worth an error banner */
    }
  };

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnread(0);
      return;
    }
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markRead = async (id: string) => {
    setBusy(true);
    try {
      await authFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
    } finally {
      setBusy(false);
    }
  };

  const markAll = async () => {
    const unreadItems = items.filter((n) => !n.isRead);
    for (const item of unreadItems) {
      await authFetch(`/api/notifications/${item.id}/read`, { method: 'POST' });
    }
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
  };

  if (!user) return null;

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-trigger"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={17} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="notif-link" onClick={markAll} disabled={busy}>
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="notif-empty">Nothing here yet. Notices from the team show up here.</p>
          ) : (
            <ul className="notif-list">
              {items.map((item) => (
                <li key={item.id} className={item.isRead ? 'read' : 'unread'}>
                  <div className="notif-item-head">
                    <strong>{item.title}</strong>
                    <span className="notif-time">{timeAgo(item.createdAt)}</span>
                  </div>
                  <p>{item.message}</p>
                  <div className="notif-item-foot">
                    {item.createdByName && <span>from {item.createdByName}</span>}
                    {!item.isRead && (
                      <button type="button" className="notif-link" onClick={() => markRead(item.id)} disabled={busy}>
                        Mark read
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
