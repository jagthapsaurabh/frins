import React, { useState } from 'react';
import { CalendarClock, PhoneCall, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { BookCallDialog } from '../../components/BookCallDialog';
import { PageHead, TableShell, labelFor, toneFor } from '../../components/console/ConsoleUI';
import { formatDate } from '../../utils/dates';

/**
 * The learner's calls: what is booked, what happened before, and one button to
 * book another.
 */
export const LearnerCalls: React.FC<{ calls: any[]; onReload: () => void }> = ({ calls, onReload }) => {
  const { authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upcoming = calls.filter((call) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(call.status));
  const past = calls.filter((call) => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(call.status));

  const cancel = async (id: string) => {
    setError(null);
    const res = await authFetch(`/api/learner/calls/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || 'Could not cancel this call.');
      return;
    }
    setBanner('Call cancelled.');
    onReload();
  };

  return (
    <div>
      <PageHead
        title="Calls"
        meta={upcoming.length > 0 ? `${upcoming.length} coming up` : 'No call booked'}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            <PhoneCall size={14} /> Book a call
          </button>
        }
      />

      {banner && <div className="governance-alert success">{banner}</div>}
      {error && <div className="governance-alert danger">{error}</div>}

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h2>Coming up</h2>
            <p>Your mentor or the FRINS team confirms each call.</p>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <div className="empty-state">
            <CalendarClock size={18} />
            <strong>No call booked</strong>
            <span>Book a slot when you want to go through a chart, a lesson or your plan.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
              Book a call
            </button>
          </div>
        ) : (
          <div className="list-stack">
            {upcoming.map((call) => (
              <div key={call.id} className="list-row">
                <span className="kpi-icon"><CalendarClock size={14} /></span>
                <div className="list-row-main">
                  <span className="list-row-title">
                    {formatDate(call.preferred_date)} · {call.preferred_time}
                  </span>
                  <span className="list-row-sub">
                    {call.topic || 'General call'} · with {call.staff_name || 'your mentor'}
                  </span>
                </div>
                <span className={`status-pill ${toneFor(call.status)}`}>{labelFor(call.status)}</span>
                <button type="button" className="icon-quiet" title="Cancel this call" onClick={() => cancel(call.id)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <PageHead title="Earlier calls" meta={`${past.length} in total`} />
          <TableShell
            columns={[
              { label: 'When', width: 200 },
              { label: 'Topic' },
              { label: 'With', width: 180 },
              { label: 'Status', width: 140 }
            ]}
          >
            {past.map((call) => (
              <tr key={call.id}>
                <td data-label="When" style={{ whiteSpace: 'nowrap' }}>{formatDate(call.preferred_date)} · {call.preferred_time}</td>
                <td data-label="Topic">{call.topic || 'General call'}</td>
                <td data-label="With" className="row-sub">{call.staff_name || 'FRINS team'}</td>
                <td data-label="Status">
                  <span className={`status-pill ${toneFor(call.status)}`}>{labelFor(call.status)}</span>
                </td>
              </tr>
            ))}
          </TableShell>
        </div>
      )}

      <BookCallDialog
        open={open}
        onClose={() => setOpen(false)}
        onBooked={() => {
          setOpen(false);
          setBanner('Call requested. It shows here once confirmed.');
          onReload();
        }}
      />
    </div>
  );
};
