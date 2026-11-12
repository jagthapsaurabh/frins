import React, { useEffect, useState } from 'react';
import { CalendarClock, PhoneCall, Video, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDate, todayIso } from '../utils/dates';

interface StaffRow {
  id: string;
  name: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  GUIDE: 'Learning guide',
  ADMIN: 'Admin',
  CURRICULUM_OWNER: 'Curriculum owner'
};

const TIME_SLOTS = ['9:00 AM IST', '10:00 AM IST', '11:30 AM IST', '1:00 PM IST', '3:00 PM IST', '5:00 PM IST', '6:30 PM IST'];

/**
 * Book a call straight from the learner panel. The learner picks a mentor, a
 * date and a time, and says what they want to talk about.
 */
export const BookCallDialog: React.FC<{ open: boolean; onClose: () => void; onBooked?: () => void }> = ({
  open,
  onClose,
  onBooked
}) => {
  const { authFetch } = useAuth();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState(TIME_SLOTS[2]);
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    setTopic('');
    setNotes('');
    setDate(todayIso());
    setTime(TIME_SLOTS[2]);

    let alive = true;
    (async () => {
      try {
        const res = await authFetch('/api/directory/staff');
        if (!res.ok) return;
        const json = await res.json();
        if (!alive) return;
        const rows: StaffRow[] = json.rows || [];
        setStaff(rows);
        setStaffId((current) => current || rows[0]?.id || '');
      } catch {
        /* handled by the empty select */
      }
    })();
    return () => {
      alive = false;
    };
  }, [authFetch, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/learner/calls', {
        method: 'POST',
        body: JSON.stringify({ staffId, preferredDate: date, preferredTime: time, topic, notes })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not book the call.');
        return;
      }
      setDone(true);
      onBooked?.();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card book-call-card" role="dialog" aria-modal="true" aria-labelledby="book-call-title">
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        {done ? (
          <div className="book-call-done">
            <span className="done-badge">
              <CalendarClock size={26} />
            </span>
            <h3>Call requested</h3>
            <p>
              {staff.find((person) => person.id === staffId)?.name || 'Your mentor'} has your request for{' '}
              {formatDate(date)} at {time}. You will get a notification once it is confirmed. You can see it under
              Calls in your menu.
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <span className="micro-tag accent">
                <PhoneCall size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                Learner support
              </span>
              <h3 id="book-call-title">Book a call</h3>
              <p className="admin-muted" style={{ margin: 0 }}>
                Stuck on a chart, a lesson or your plan? Pick a mentor and a slot. No questionnaire needed.
              </p>
            </div>

            <form onSubmit={submit} className="modal-form">
              {error && <div className="governance-alert danger">{error}</div>}

              <div className="form-group">
                <label className="form-label" htmlFor="call-staff">
                  Who do you want to talk to?
                </label>
                <select
                  id="call-staff"
                  className="form-select"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  required
                >
                  {staff.length === 0 && <option value="">Loading the team…</option>}
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {ROLE_LABEL[person.role] || person.role}
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="call-date">
                    Date
                  </label>
                  <input
                    id="call-date"
                    className="form-input"
                    type="date"
                    min={todayIso()}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="call-time">
                    Time
                  </label>
                  <select
                    id="call-time"
                    className="form-select"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="call-topic">
                  What is it about? *
                </label>
                <input
                  id="call-topic"
                  className="form-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. My position size on the last trade"
                  required
                  minLength={3}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="call-notes">
                  Anything to read first?
                </label>
                <textarea
                  id="call-notes"
                  className="form-textarea"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Context, screenshots you already sent, what you tried."
                />
              </div>

              <p className="form-hint">
                <Video size={13} /> Calls happen on Google Meet or a phone call. The link comes with the confirmation.
              </p>

              <button type="submit" className="btn btn-primary" disabled={busy || !staffId}>
                {busy ? 'Requesting…' : 'Request this call'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
