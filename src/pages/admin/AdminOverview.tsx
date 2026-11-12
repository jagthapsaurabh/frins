import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Contact,
  MessageSquare,
  RefreshCw,
  Users,
  UsersRound
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatDate, formatDateTime, timeAgo } from '../../utils/dates';

interface Summary {
  counts: {
    learners: number;
    staff: number;
    courses: number;
    awaitingReview: number;
    openLeads: number;
    upcomingCalls: number;
    communities: number;
    unreadMessages: number;
  };
  queue: any[];
  recent: any[];
  calls: any[];
  leads: any[];
  courseGaps: any[];
}

const humanAction = (action: string) =>
  action
    .toLowerCase()
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');

/**
 * The admin home. Counts at the top, the review queue in the middle, and the
 * three lists that usually need a follow up on the right. Nothing else.
 */
export const AdminOverview: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/summary');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load the overview.');
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = data?.counts;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {loading ? 'Loading' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/tasks')}>
            <ClipboardCheck size={14} /> Review queue
          </button>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <div className="kpi-grid">
        <Link className="kpi" to="/admin/learners">
          <span className="kpi-icon"><Users size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Active learners</span>
            <span className="kpi-value">{counts?.learners ?? '—'}</span>
            <span className="kpi-hint">On the roster</span>
          </span>
        </Link>
        <Link className="kpi" to="/admin/tasks">
          <span className="kpi-icon"><ClipboardCheck size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Awaiting review</span>
            <span className="kpi-value">{counts?.awaitingReview ?? '—'}</span>
            <span className="kpi-hint">Uploads to check</span>
          </span>
        </Link>
        <Link className="kpi" to="/admin/leads">
          <span className="kpi-icon"><Contact size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Open leads</span>
            <span className="kpi-value">{counts?.openLeads ?? '—'}</span>
            <span className="kpi-hint">From the website</span>
          </span>
        </Link>
        <Link className="kpi" to="/admin/bookings">
          <span className="kpi-icon"><CalendarClock size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Upcoming calls</span>
            <span className="kpi-value">{counts?.upcomingCalls ?? '—'}</span>
            <span className="kpi-hint">Booked or requested</span>
          </span>
        </Link>
        <Link className="kpi" to="/admin/messages">
          <span className="kpi-icon"><MessageSquare size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Unread messages</span>
            <span className="kpi-value">{counts?.unreadMessages ?? '—'}</span>
            <span className="kpi-hint">Waiting on a reply</span>
          </span>
        </Link>
        <Link className="kpi" to="/admin/communities">
          <span className="kpi-icon"><UsersRound size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Communities</span>
            <span className="kpi-value">{counts?.communities ?? '—'}</span>
            <span className="kpi-hint">Open groups</span>
          </span>
        </Link>
      </div>

      <div className="overview-split">
        <section className="panel-card">
          <div className="panel-head">
            <h2>Waiting on a review</h2>
            <Link to="/admin/tasks" className="link-button" style={{ fontSize: 12 }}>
              Open queue
            </Link>
          </div>

          {loading && !data ? (
            <p className="section-note">Loading the queue.</p>
          ) : data && data.queue.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Task</th>
                    <th>Sent</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {data.queue.map((row) => (
                    <tr
                      key={row.id}
                      className="clickable-row"
                      onClick={() => navigate(`/admin/tasks/${row.id}`)}
                    >
                      <td>
                        <span className="row-title">{row.learner_name}</span>
                        <span className="row-sub">{row.course_title || 'General task'}</span>
                      </td>
                      <td>{row.title}</td>
                      <td className="row-sub" style={{ whiteSpace: 'nowrap' }}>
                {timeAgo(row.submitted_at)}
              </td>
                      <td style={{ width: 28 }}>
                        <ChevronRight size={14} color="#98A2B3" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>Nothing waiting</strong>
              Every upload has been reviewed.
            </div>
          )}

          <div className="panel-head" style={{ marginTop: 20 }}>
            <div>
              <h2>Recent activity</h2>
            </div>
          </div>
          <div className="list-stack">
            {(data?.recent || []).map((event, index) => (
              <div className="list-row" key={`${event.entity_id}-${index}`}>
                <div className="list-row-main">
                  <span className="list-row-title">{humanAction(event.action)}</span>
                  <span className="list-row-sub">
                    {event.actor_role} · {event.entity_type} {event.entity_id?.slice(0, 18)}
                  </span>
                </div>
                <span className="list-row-sub" style={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(event.created_at)}
                </span>
              </div>
            ))}
            {data && data.recent.length === 0 && <p className="section-note">No activity yet.</p>}
          </div>
        </section>

        <div className="overview-side">
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Calls</h2>
              </div>
              <Link to="/admin/bookings" className="link-button" style={{ fontSize: 12 }}>
                All bookings
              </Link>
            </div>
            {data && data.calls.length > 0 ? (
              <div className="list-stack">
                {data.calls.map((call) => (
                  <div className="list-row" key={call.id}>
                    <div className="list-row-main">
                      <span className="list-row-title">{call.participant_name}</span>
                      <span className="list-row-sub">
                        {call.preferred_date ? formatDate(call.preferred_date) : 'Date to confirm'}
                        {call.preferred_time ? ` · ${call.preferred_time}` : ''}
                      </span>
                    </div>
                    <span className="status-pill warn">{call.status.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="section-note">No calls booked.</p>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>New leads</h2>
              </div>
              <Link to="/admin/leads" className="link-button" style={{ fontSize: 12 }}>
                All leads
              </Link>
            </div>
            {data && data.leads.length > 0 ? (
              <div className="list-stack">
                {data.leads.map((lead) => (
                  <div className="list-row" key={lead.id}>
                    <div className="list-row-main">
                      <span className="list-row-title">{lead.name}</span>
                      <span className="list-row-sub">{lead.email}</span>
                    </div>
                    <span className="status-pill">{lead.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="section-note">No leads yet.</p>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Needs attention</h2>
              </div>
              <Link to="/admin/courses" className="link-button" style={{ fontSize: 12 }}>
                Courses
              </Link>
            </div>
            {data && data.courseGaps.length > 0 ? (
              <div className="list-stack">
                {data.courseGaps.map((course) => (
                  <div className="list-row" key={course.id}>
                    <span className="kpi-icon"><BookOpen size={14} /></span>
                    <div className="list-row-main">
                      <Link to={`/admin/courses/${course.id}`} className="list-row-title">
                        {course.title}
                      </Link>
                      <span className="list-row-sub">
                        {Number(course.is_active) === 0 ? 'Switched off' : 'No learners yet'}
                      </span>
                    </div>
                    {Number(course.is_active) === 0 && (
                      <span className="micro-tag danger">
                        <AlertCircle size={11} /> Off
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="section-note">Every course is live and has learners.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
