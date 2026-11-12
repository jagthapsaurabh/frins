import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Save,
  UserRound,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatDate, formatDateTime } from '../../utils/dates';
import { TRACK_LABEL } from './LearnersDirectory';

interface StaffRow {
  id: string;
  name: string;
  role: string;
}

const statusTone = (status: string) =>
  status === 'REVIEWED' || status === 'APPROVED' || status === 'COMPLETED'
    ? 'approved'
    : status === 'SUBMITTED' || status === 'REQUESTED' || status === 'CONFIRMED'
      ? 'info'
      : status === 'CANCELLED' || status === 'SUSPENDED'
        ? 'danger'
        : 'pending';

/**
 * One learner, everything about them: contact details, what they bought,
 * how far they got, their tasks with all the timestamps, and their calls.
 */
const statusLabel = (value: string) => {
  const words = String(value || '').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const LearnerDossierPage: React.FC = () => {
  const { learnerId = '' } = useParams<{ learnerId: string }>();
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<any>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    city: '',
    track: 'student_concepts',
    accountStatus: 'ACTIVE',
    guideId: '',
    notes: ''
  });
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { amountPaid: string; paymentStatus: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/learners/${learnerId}/dossier`);
      if (!res.ok) {
        setError(res.status === 404 ? 'This learner no longer exists.' : 'Could not load this learner.');
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setForm({
        name: json.learner?.name || '',
        email: json.learner?.email || '',
        phone: json.learner?.phone || '',
        city: json.learner?.city || '',
        track: json.learner?.track || 'student_concepts',
        accountStatus: json.learner?.account_status || 'ACTIVE',
        guideId: json.learner?.assigned_guide_id || '',
        notes: json.learner?.notes || ''
      });
      const drafts: Record<string, { amountPaid: string; paymentStatus: string }> = {};
      (json.enrollments || []).forEach((enrollment: any) => {
        drafts[enrollment.id] = {
          amountPaid: String(enrollment.amount_paid ?? 0),
          paymentStatus: enrollment.payment_status || 'NOT_APPLICABLE'
        };
      });
      setPaymentDrafts(drafts);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, learnerId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/directory/staff');
        if (res.ok) {
          const json = await res.json();
          setStaff(json.rows || []);
        }
      } catch {
        /* fine without the guide picker */
      }
    })();
  }, [authFetch]);

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const res = await authFetch(`/api/admin/learners/${learnerId}`, {
      method: 'PATCH',
      body: JSON.stringify(form)
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setBanner(json.error || 'Could not save the details.');
      return;
    }
    setEditing(false);
    setBanner('Learner details saved.');
    load();
  };

  const savePayment = async (enrollmentId: string) => {
    const draft = paymentDrafts[enrollmentId];
    if (!draft) return;
    const res = await authFetch(`/api/admin/enrollments/${enrollmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        amountPaid: Number(draft.amountPaid) || 0,
        paymentStatus: draft.paymentStatus
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setBanner(json.error || 'Could not update the payment.');
      return;
    }
    setBanner('Payment updated.');
    load();
  };

  if (loading && !data) {
    return (
      <div className="workspace-shell">
        <div className="container-wide">
          <p className="admin-muted">Loading learner…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="workspace-shell">
        <div className="container-wide">
          <Link to="/admin/learners" className="back-link">
            <ArrowLeft size={15} /> All learners
          </Link>
          <div className="panel-card">
            <p className="admin-muted">{error || 'Learner not found.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const { learner, guide, profile, enrollments = [], tasks = [], calls = [], reflections = [], stats } = data;
  const initials = String(learner.name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="workspace-shell">
      <div className="container-wide">
        <Link to="/admin/learners" className="back-link">
          <ArrowLeft size={15} /> All learners
        </Link>

        {banner && <div className="governance-alert success">{banner}</div>}

        <header className="dossier-head panel-card">
          <div className="dossier-identity">
            <span className="dossier-avatar">{initials}</span>
            <div>
              <h1>{learner.name}</h1>
              <div className="dossier-meta">
                <span>
                  <Mail size={14} /> {learner.email}
                </span>
                {learner.phone && (
                  <span>
                    <Phone size={14} /> {learner.phone}
                  </span>
                )}
                {learner.city && (
                  <span>
                    <MapPin size={14} /> {learner.city}
                  </span>
                )}
                <span>
                  <UserRound size={14} /> Added {formatDate(learner.created_at)}
                </span>
              </div>
              <div className="dossier-chips">
                <span className="micro-tag accent">{TRACK_LABEL[learner.track] || learner.track}</span>
                <span className={`micro-tag ${learner.account_status === 'ACTIVE' ? 'success' : 'danger'}`}>
                  {learner.account_status === 'ACTIVE' ? 'Active' : 'Suspended'}
                </span>
                <span className="micro-tag">Level {profile?.approved_level || 'L1'}</span>
                <span className="micro-tag">Guide: {guide?.name || 'Not assigned'}</span>
              </div>
            </div>
          </div>

          <div className="dossier-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing((v) => !v)}>
              <Pencil size={15} /> {editing ? 'Close editor' : 'Edit details'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/courses')}>
              <BookOpen size={15} /> Courses
            </button>
          </div>
        </header>

        <div className="dossier-stats">
          <div>
            <span>Courses</span>
            <strong>{stats.courseCount}</strong>
          </div>
          <div>
            <span>Completed</span>
            <strong>{stats.completedCourses}</strong>
          </div>
          <div>
            <span>Steps done</span>
            <strong>
              {stats.stepsDone}/{stats.stepsTotal}
            </strong>
          </div>
          <div>
            <span>Tasks reviewed</span>
            <strong>
              {stats.reviewed}/{stats.taskCount}
            </strong>
          </div>
          <div>
            <span>Awaiting review</span>
            <strong>{stats.submitted}</strong>
          </div>
          <div>
            <span>Paid</span>
            <strong>₹{Number(stats.totalPaid || 0).toLocaleString('en-IN')}</strong>
          </div>
        </div>

        {editing && (
          <form className="panel-card" onSubmit={saveDetails}>
            <div className="form-head">
              <h3 className="admin-card-title">Edit details</h3>
              <button type="button" className="icon-button" onClick={() => setEditing(false)} aria-label="Close editor">
                <X size={16} />
              </button>
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="d-name">
                  Name
                </label>
                <input
                  id="d-name"
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="d-email">
                  Email
                </label>
                <input
                  id="d-email"
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="d-phone">
                  Phone
                </label>
                <input
                  id="d-phone"
                  className="form-input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="d-city">
                  City
                </label>
                <input
                  id="d-city"
                  className="form-input"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="d-track">
                  Track
                </label>
                <select
                  id="d-track"
                  className="form-select"
                  value={form.track}
                  onChange={(e) => setForm({ ...form, track: e.target.value })}
                >
                  {Object.entries(TRACK_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="d-guide">
                  Guide
                </label>
                <select
                  id="d-guide"
                  className="form-select"
                  value={form.guideId}
                  onChange={(e) => setForm({ ...form, guideId: e.target.value })}
                >
                  <option value="">Not assigned</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {person.role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="d-status">
                  Account
                </label>
                <select
                  id="d-status"
                  className="form-select"
                  value={form.accountStatus}
                  onChange={(e) => setForm({ ...form, accountStatus: e.target.value })}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="d-notes">
                  Notes for the team
                </label>
                <input
                  id="d-notes"
                  className="form-input"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                <Save size={15} /> Save details
              </button>
            </div>
          </form>
        )}

        <div className="dossier-grid">
          <div>
            <section className="panel-card">
              <span className="micro-tag accent">Courses &amp; payments</span>
              <h3 className="admin-card-title">What they bought</h3>
              <p className="admin-card-copy">Every course on their account, how far they got, and what was paid.</p>

              {enrollments.length === 0 && <p className="admin-muted">No course enrolled yet.</p>}

              <div className="enrollment-list">
                {enrollments.map((enrollment: any) => {
                  const draft = paymentDrafts[enrollment.id] || {
                    amountPaid: '0',
                    paymentStatus: 'NOT_APPLICABLE'
                  };
                  const pct = enrollment.step_count
                    ? Math.round((Number(enrollment.steps_done) / Number(enrollment.step_count)) * 100)
                    : enrollment.progress_pct || 0;
                  return (
                    <article key={enrollment.id} className="enrollment-card">
                      <div className="enrollment-top">
                        <div>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => navigate(`/admin/courses/${enrollment.course_id}`)}
                          >
                            {enrollment.course_title}
                          </button>
                          <div className="admin-muted small">
                            {enrollment.course_level} · enrolled {formatDate(enrollment.assigned_at)}
                          </div>
                        </div>
                        <span className={`status-pill ${statusTone(enrollment.status)}`}>{statusLabel(enrollment.status)}</span>
                      </div>

                      <div className="progress-line">
                        <div className="progress-track">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <span className="admin-muted small">
                          {pct}% · {enrollment.steps_done}/{enrollment.step_count} steps
                        </span>
                      </div>

                      {enrollment.custom_notes && <p className="enrollment-note">{enrollment.custom_notes}</p>}

                      <div className="payment-row">
                        <CreditCard size={15} />
                        <input
                          className="form-input payment-amount"
                          type="number"
                          min={0}
                          value={draft.amountPaid}
                          aria-label={`Amount paid for ${enrollment.course_title}`}
                          onChange={(e) =>
                            setPaymentDrafts({
                              ...paymentDrafts,
                              [enrollment.id]: { ...draft, amountPaid: e.target.value }
                            })
                          }
                        />
                        <select
                          className="form-select payment-status"
                          value={draft.paymentStatus}
                          aria-label={`Payment status for ${enrollment.course_title}`}
                          onChange={(e) =>
                            setPaymentDrafts({
                              ...paymentDrafts,
                              [enrollment.id]: { ...draft, paymentStatus: e.target.value }
                            })
                          }
                        >
                          <option value="NOT_APPLICABLE">No payment</option>
                          <option value="PAID">Paid</option>
                          <option value="PENDING">Pending</option>
                          <option value="WAIVED">Waived</option>
                        </select>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => savePayment(enrollment.id)}>
                          Save
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="panel-card">
              <span className="micro-tag accent">About</span>
              <h3 className="admin-card-title">Personal details</h3>
              <dl className="detail-list">
                <div>
                  <dt>Full name</dt>
                  <dd>{learner.name}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{learner.email}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{learner.phone || 'Not given'}</dd>
                </div>
                <div>
                  <dt>City</dt>
                  <dd>{learner.city || 'Not given'}</dd>
                </div>
                <div>
                  <dt>Track</dt>
                  <dd>{TRACK_LABEL[learner.track] || learner.track}</dd>
                </div>
                <div>
                  <dt>Level</dt>
                  <dd>{profile?.approved_level || 'L1'}</dd>
                </div>
                <div>
                  <dt>Guide</dt>
                  <dd>{guide?.name || 'Not assigned'}</dd>
                </div>
                <div>
                  <dt>Joined</dt>
                  <dd>{formatDate(learner.created_at)}</dd>
                </div>
              </dl>
              {learner.notes && <p className="dossier-note">{learner.notes}</p>}
            </section>

            <section className="panel-card">
              <span className="micro-tag accent">Reports</span>
              <h3 className="admin-card-title">Reflection log</h3>
              <p className="admin-card-copy">
                The learner's own notes after a session. Useful before a call.
              </p>

              {reflections.length === 0 ? (
                <p className="admin-muted">Nothing logged yet.</p>
              ) : (
                <div className="reflection-report">
                  {reflections.map((reflection: any) => (
                    <div key={reflection.id} className="reflection-report-row">
                      <div>
                        <strong>{reflection.title}</strong>
                        <span className="admin-muted small"> · {formatDate(reflection.created_at)}</span>
                      </div>
                      <div className="admin-muted small">{reflection.market_context}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div>
            <section className="panel-card">
              <span className="micro-tag accent">
                <ClipboardList size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                Tasks &amp; reviews
              </span>
              <h3 className="admin-card-title">Work history</h3>
              <p className="admin-card-copy">When each task was given, uploaded and reviewed.</p>

              {tasks.length === 0 && <p className="admin-muted">No task given yet.</p>}

              <div className="dossier-task-list">
                {tasks.map((task: any) => (
                  <article key={task.id} className="dossier-task">
                    <div className="dossier-task-top">
                      <strong>{task.title}</strong>
                      <span className={`status-pill ${statusTone(task.status)}`}>{statusLabel(task.status)}</span>
                    </div>
                    <div className="admin-muted small">{task.course_title || 'General task'}</div>
                    <div className="task-timeline">
                      <span>
                        <em>Given</em>
                        {formatDateTime(task.assigned_at)}
                      </span>
                      <span>
                        <em>Due</em>
                        {formatDateTime(task.due_date)}
                      </span>
                      <span>
                        <em>Uploaded</em>
                        {task.submitted_at ? formatDateTime(task.submitted_at) : 'Not yet'}
                      </span>
                      <span>
                        <em>Reviewed</em>
                        {task.reviewed_at ? formatDateTime(task.reviewed_at) : 'Not yet'}
                      </span>
                    </div>
                    {task.submission_preview && (
                      <p className="dossier-task-preview">{task.submission_preview}…</p>
                    )}
                    {task.guide_feedback && (
                      <p className="dossier-task-feedback">
                        <CheckCircle2 size={13} /> {task.guide_feedback}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section className="panel-card">
              <span className="micro-tag accent">
                <CalendarClock size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                Calls
              </span>
              <h3 className="admin-card-title">Booked calls</h3>
              <p className="admin-card-copy">Calls this learner booked from their dashboard.</p>

              {calls.length === 0 && <p className="admin-muted">No call booked yet.</p>}

              <div className="call-history">
                {calls.map((call: any) => (
                  <div key={call.id} className="call-history-row">
                    <div>
                      <strong>{formatDate(call.preferred_date)}</strong>
                      <span className="admin-muted small"> · {call.preferred_time}</span>
                      <div className="admin-muted small">{call.topic || call.recommended_focus || 'General call'}</div>
                    </div>
                    <div className="call-history-side">
                      <span className={`status-pill ${statusTone(call.status)}`}>{statusLabel(call.status)}</span>
                      <span className="admin-muted small">{call.staff_name || 'Any mentor'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
