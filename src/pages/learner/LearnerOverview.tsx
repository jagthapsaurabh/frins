import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  MessageSquareQuote,
  PhoneCall,
  RefreshCw,
  UsersRound
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatDate, timeAgo } from '../../utils/dates';

interface Summary {
  learner: any;
  courses: any[];
  tasks: any[];
  calls: any[];
  communities: any[];
  latestFeedback: any;
}

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'To start',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'With your mentor',
  REVIEWED: 'Reviewed',
  PASSED: 'Passed',
  NEEDS_REVISION: 'Sent back'
};

const statusTone = (status: string) => {
  if (status === 'SUBMITTED') return 'warn';
  if (status === 'REVIEWED' || status === 'PASSED') return 'approved';
  if (status === 'NEEDS_REVISION') return 'danger';
  return 'info';
};

/**
 * The learner home. What is due, where each course stands, and the last thing a
 * mentor wrote. No marketing copy, no decorative cards.
 */
export const LearnerOverview: React.FC = () => {
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/learner/summary');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load your dashboard.');
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const tasks = data?.tasks || [];
  const openTasks = tasks.filter((task) => task.status !== 'REVIEWED' && task.status !== 'PASSED');
  const submitted = tasks.filter((task) => task.status === 'SUBMITTED').length;
  const reviewed = tasks.filter((task) => task.status === 'REVIEWED' || task.status === 'PASSED').length;
  const unread = (data?.communities || []).reduce((sum, row) => sum + Number(row.unread || 0), 0);

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
          <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard/tasks')}>
            <ClipboardList size={14} /> Open tasks
          </button>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <div className="kpi-grid">
        <Link className="kpi" to="/dashboard/courses">
          <span className="kpi-icon"><BookOpen size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Courses</span>
            <span className="kpi-value">{data?.courses.length ?? '—'}</span>
            <span className="kpi-hint">On your plan</span>
          </span>
        </Link>
        <Link className="kpi" to="/dashboard/tasks">
          <span className="kpi-icon"><ClipboardList size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Tasks open</span>
            <span className="kpi-value">{openTasks.length}</span>
            <span className="kpi-hint">{submitted} with your mentor</span>
          </span>
        </Link>
        <Link className="kpi" to="/dashboard/tasks">
          <span className="kpi-icon"><ClipboardList size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Reviewed</span>
            <span className="kpi-value">{reviewed}</span>
            <span className="kpi-hint">Checked by the team</span>
          </span>
        </Link>
        <Link className="kpi" to="/dashboard/communities">
          <span className="kpi-icon"><UsersRound size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Communities</span>
            <span className="kpi-value">{data?.communities.length ?? '—'}</span>
            <span className="kpi-hint">{unread > 0 ? `${unread} unread` : 'Nothing unread'}</span>
          </span>
        </Link>
        <Link className="kpi" to="/dashboard/calls">
          <span className="kpi-icon"><CalendarClock size={15} /></span>
          <span className="kpi-body">
            <span className="kpi-label">Next call</span>
            <span className="kpi-value" style={{ fontSize: 15 }}>
              {data?.calls && data.calls.length > 0
                ? formatDate(data.calls[0].preferred_date) || 'To confirm'
                : 'None'}
            </span>
            <span className="kpi-hint">{data?.learner?.guide_name || 'Your mentor'}</span>
          </span>
        </Link>
      </div>

      <div className="overview-split">
        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Next up</h2>
              <p>Work set by {data?.learner?.guide_name || 'your mentor'}.</p>
            </div>
            <Link to="/dashboard/tasks" className="link-button" style={{ fontSize: 12 }}>
              All tasks
            </Link>
          </div>

          {openTasks.length > 0 ? (
            <div className="list-stack">
              {openTasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className="list-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate('/dashboard/tasks')}
                >
                  <div className="list-row-main">
                    <span className="list-row-title">{task.title}</span>
                    <span className="list-row-sub">
                      {task.course_title || 'General task'}
                      {task.due_date ? ` · due ${formatDate(task.due_date)}` : ''}
                    </span>
                  </div>
                  <span className={`status-pill ${statusTone(task.status)}`}>
                    {STATUS_LABEL[task.status] || task.status}
                  </span>
                  <ChevronRight size={14} color="#98A2B3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>Nothing due</strong>
              You are up to date. New work from your mentor shows up here.
            </div>
          )}

          {data?.latestFeedback && (
            <div style={{ marginTop: 18 }}>
              <div className="panel-head">
                <div>
                  <h2>Last feedback</h2>
                </div>
                <Link to="/dashboard/progress" className="link-button" style={{ fontSize: 12 }}>
                  Progress
                </Link>
              </div>
              <div className="feedback-note">
                <MessageSquareQuote size={16} />
                <div>
                  <strong>{data.latestFeedback.title}</strong>
                  <p>{data.latestFeedback.guide_feedback}</p>
                  <span>{timeAgo(data.latestFeedback.reviewed_at)}</span>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="overview-side">
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Courses</h2>
              </div>
              <Link to="/dashboard/courses" className="link-button" style={{ fontSize: 12 }}>
                All
              </Link>
            </div>
            {data && data.courses.length > 0 ? (
              <div className="list-stack">
                {data.courses.map((course) => {
                  const total = Number(course.step_count) || 0;
                  const done = Number(course.steps_done) || 0;
                  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
                  return (
                    <div
                      key={course.id}
                      className="list-row"
                      style={{ alignItems: 'flex-start', cursor: 'pointer' }}
                      onClick={() => navigate(`/dashboard/courses/${course.id}`)}
                    >
                      <div className="list-row-main">
                        <span className="list-row-title">{course.title}</span>
                        <span className="list-row-sub">
                          {course.level} · {done} of {total} steps
                        </span>
                        <div className="progress-track" style={{ marginTop: 6 }}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="list-row-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="section-note">No course on your plan yet.</p>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Your team</h2>
              </div>
              <button type="button" className="link-button" style={{ fontSize: 12 }} onClick={() => navigate('/dashboard/messages')}>
                Message
              </button>
            </div>
            <div className="list-stack">
              <div className="list-row">
                <span className="kpi-icon"><PhoneCall size={14} /></span>
                <div className="list-row-main">
                  <span className="list-row-title">{data?.learner?.guide_name || 'Learning guide'}</span>
                  <span className="list-row-sub">Reviews your work and your calls</span>
                </div>
              </div>
              <div className="list-row">
                <span className="kpi-icon"><UsersRound size={14} /></span>
                <div className="list-row-main">
                  <span className="list-row-title">
                    {data?.communities.length ? `${data.communities.length} communities` : 'No community yet'}
                  </span>
                  <span className="list-row-sub">
                    {unread > 0 ? `${unread} new messages` : 'Group conversations'}
                  </span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard/communities')}>
                  Open
                </button>
              </div>
            </div>
            <p className="form-hint" style={{ marginTop: 8 }}>
              Signed in as {user?.email}.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
