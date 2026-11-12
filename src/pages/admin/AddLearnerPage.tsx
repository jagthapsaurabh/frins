import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { TRACK_LABEL } from './LearnersDirectory';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  email: string;
}

interface CourseRow {
  id: string;
  title: string;
  level: string;
  step_count: number;
}

export const AddLearnerPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [track, setTrack] = useState('student_concepts');
  const [guideId, setGuideId] = useState('');
  const [password, setPassword] = useState('');
  const [courseId, setCourseId] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('NOT_APPLICABLE');
  const [notes, setNotes] = useState('');

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ learnerId: string; temporaryPassword: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [staffRes, courseRes] = await Promise.all([
          authFetch('/api/directory/staff'),
          authFetch('/api/admin/courses')
        ]);
        if (staffRes.ok) {
          const json = await staffRes.json();
          if (alive) setStaff(json.rows || []);
        }
        if (courseRes.ok) {
          const json = await courseRes.json();
          if (alive) setCourses(json.rows || []);
        }
      } catch {
        /* the form still works without the pickers */
      }
    })();
    return () => {
      alive = false;
    };
  }, [authFetch]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/learners', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          phone,
          city,
          track,
          guideId: guideId || undefined,
          password: password || undefined,
          courseId: courseId || undefined,
          amountPaid: amountPaid ? Number(amountPaid) : 0,
          paymentStatus: courseId ? paymentStatus : 'NOT_APPLICABLE',
          notes
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not add this learner.');
        return;
      }
      setCreated({ learnerId: json.learnerId, temporaryPassword: json.temporaryPassword });
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="workspace-shell">
        <div className="container-wide" style={{ maxWidth: 760 }}>
          <div className="panel-card add-learner-done">
            <span className="done-badge">
              <CheckCircle2 size={26} />
            </span>
            <h2 className="admin-card-title">Learner added</h2>
            <p className="admin-card-copy">
              {name || 'The learner'} can sign in at <strong>/login</strong> with their email.
              {created.temporaryPassword
                ? ' A password was generated for them. It is shown only once.'
                : ' Use the password you set.'}
            </p>

            {created.temporaryPassword && (
              <div className="temp-password-box">
                <span>Temporary password</span>
                <strong>{created.temporaryPassword}</strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(created.temporaryPassword || '');
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(`/admin/learners/${created.learnerId}`)}
              >
                Open learner file
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/learners')}>
                Back to all learners
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <div className="container-wide" style={{ maxWidth: 940 }}>
        <Link to="/admin/learners" className="back-link">
          <ArrowLeft size={15} /> All learners
        </Link>

        <header className="admin-page-head">
          <span className="admin-page-eyebrow">People</span>
          <h1>Add a learner</h1>
          <p>
            Create the account, put them on a track, hand them a guide and optionally enrol them in a course in
            one go.
          </p>
        </header>

        <form onSubmit={submit} className="panel-card add-learner-form">
          {error && <div className="governance-alert danger">{error}</div>}

          <h3 className="form-section-title">Who they are</h3>
          <div className="admin-form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="al-name">
                Full name *
              </label>
              <input
                id="al-name"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ananya Deshmukh"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="al-email">
                Email *
              </label>
              <input
                id="al-email"
                className="form-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>
          </div>

          <div className="admin-form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="al-phone">
                Phone
              </label>
              <input
                id="al-phone"
                className="form-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 …"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="al-city">
                City
              </label>
              <input
                id="al-city"
                className="form-input"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Nagpur"
              />
            </div>
          </div>

          <h3 className="form-section-title">Their learning</h3>
          <div className="admin-form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="al-track">
                Track
              </label>
              <select id="al-track" className="form-select" value={track} onChange={(e) => setTrack(e.target.value)}>
                {Object.entries(TRACK_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="al-guide">
                Guide
              </label>
              <select id="al-guide" className="form-select" value={guideId} onChange={(e) => setGuideId(e.target.value)}>
                <option value="">Default guide</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.role === 'GUIDE' ? 'Guide' : person.role === 'ADMIN' ? 'Admin' : 'Curriculum'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h3 className="form-section-title">Course and payment</h3>
          <div className="admin-form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="al-course">
                Enrol in a course
              </label>
              <select
                id="al-course"
                className="form-select"
                value={courseId}
                onChange={(e) => {
                  setCourseId(e.target.value);
                  if (!e.target.value) {
                    setAmountPaid('');
                    setPaymentStatus('NOT_APPLICABLE');
                  }
                }}
              >
                <option value="">No course yet</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} · {course.step_count} steps
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="al-amount">
                Amount paid (₹)
              </label>
              <input
                id="al-amount"
                className="form-input"
                type="number"
                min={0}
                value={amountPaid}
                onChange={(e) => {
                  setAmountPaid(e.target.value);
                  setPaymentStatus(Number(e.target.value) > 0 ? 'PAID' : 'NOT_APPLICABLE');
                }}
                placeholder="0"
                disabled={!courseId}
              />
            </div>
          </div>

          <div className="admin-form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="al-payment">
                Payment status
              </label>
              <select
                id="al-payment"
                className="form-select"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                disabled={!courseId}
              >
                <option value="NOT_APPLICABLE">No payment</option>
                <option value="PAID">Paid</option>
                <option value="PENDING">Payment pending</option>
                <option value="WAIVED">Waived</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="al-password">
                Password
              </label>
              <input
                id="al-password"
                className="form-input"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to generate one"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="al-notes">
              Notes for the team
            </label>
            <textarea
              id="al-notes"
              className="form-textarea"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Background, goals, who referred them…"
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <UserPlus size={16} /> {busy ? 'Adding…' : 'Add learner'}
            </button>
            <Link to="/admin/learners" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};
