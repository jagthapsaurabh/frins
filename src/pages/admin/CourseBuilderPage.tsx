import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  FileText,
  Film,
  Link2,
  ListChecks,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../utils/dates';
import { ConfirmDialog } from '../../components/ConfirmDialog';

const KINDS = [
  { value: 'TEXT', label: 'Reading', hint: 'A page of text the learner reads', icon: <FileText size={15} /> },
  { value: 'VIDEO', label: 'YouTube video', hint: 'Embeds the video in the lesson', icon: <Film size={15} /> },
  { value: 'PDF', label: 'PDF file', hint: 'Upload a PDF to download', icon: <FileText size={15} /> },
  { value: 'DOC', label: 'Word file', hint: 'Upload a .doc or .docx', icon: <FileText size={15} /> },
  { value: 'LINK', label: 'Web link', hint: 'Sends them to another page', icon: <Link2 size={15} /> },
  { value: 'TASK', label: 'Task / milestone', hint: 'Needs a submission and a review', icon: <ListChecks size={15} /> }
];

const TRACKS = [
  { value: 'student_concepts', label: 'Student · market concepts' },
  { value: 'strategy_learner', label: 'Strategy learner' },
  { value: 'trader', label: 'Active trader' },
  { value: 'investor', label: 'Long-term investor' },
  { value: 'both', label: 'All-round' }
];

const kindMeta = (kind: string) => KINDS.find((k) => k.value === kind) || KINDS[0];

const emptyStep = {
  kind: 'TEXT',
  title: '',
  summary: '',
  content: '',
  resourceUrl: '',
  fileName: '',
  fileData: '',
  dueDays: '7',
  estimatedMinutes: '15',
  isMilestone: false
};

export const CourseBuilderPage: React.FC = () => {
  const { courseId = 'new' } = useParams<{ courseId: string }>();
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const isNew = courseId === 'new';

  const [course, setCourse] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Course basics
  const [meta, setMeta] = useState({
    title: '',
    track: 'student_concepts',
    level: 'L1 → L2',
    description: '',
    modulesText: '',
    durationHours: '',
    price: '0',
    isActive: true
  });
  const [statusPrompt, setStatusPrompt] = useState<null | boolean>(null);
  const [editingMeta, setEditingMeta] = useState(isNew);
  const [savingMeta, setSavingMeta] = useState(false);

  // Step editor
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepForm, setStepForm] = useState({ ...emptyStep });
  const [savingStep, setSavingStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Enrol an existing learner from the course page.
  const [learners, setLearners] = useState<any[]>([]);
  const [enrolLearnerId, setEnrolLearnerId] = useState('');
  const [enrolAmount, setEnrolAmount] = useState('');
  const [enrolNotes, setEnrolNotes] = useState('');
  const [enrolBusy, setEnrolBusy] = useState(false);
  const [enrolBanner, setEnrolBanner] = useState<string | null>(null);

  const loadLearners = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/learners/directory');
      if (!res.ok) return;
      const json = await res.json();
      setLearners(json.rows || []);
      setEnrolLearnerId((current) => current || json.rows?.[0]?.id || '');
    } catch {
      /* the select stays empty */
    }
  }, [authFetch]);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/courses/${courseId}`);
      if (!res.ok) {
        setError('This course could not be loaded.');
        return;
      }
      const json = await res.json();
      setCourse(json.course);
      setSteps(json.steps || []);
      setEnrollments(json.enrollments || []);
      setEnrolledCount(Number(json.enrolled) || (json.enrollments || []).length);
      setMeta({
        title: json.course.title || '',
        track: json.course.track || 'student_concepts',
        level: json.course.level || 'L1 → L2',
        description: json.course.description || '',
        modulesText: (json.course.modules || []).join('\n'),
        durationHours: json.course.duration_hours ? String(json.course.duration_hours) : '',
        price: String(json.course.price ?? 0),
        isActive: Number(json.course.is_active) !== 0
      });
      setError(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, courseId, isNew]);

  useEffect(() => {
    load();
    loadLearners();
  }, [load, loadLearners]);

  const enrolLearner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolLearnerId) return;
    setEnrolBusy(true);
    setEnrolBanner(null);
    const res = await authFetch('/api/admin/courses/assign', {
      method: 'POST',
      body: JSON.stringify({
        courseId,
        learnerId: enrolLearnerId,
        customNotes: enrolNotes,
        amountPaid: Number(enrolAmount) || 0
      })
    });
    const json = await res.json();
    setEnrolBusy(false);
    if (!res.ok || !json.success) {
      setEnrolBanner(json.error || 'Could not enrol this learner.');
      return;
    }
    setEnrolNotes('');
    setEnrolAmount('');
    setEnrolBanner('Learner enrolled. They have been notified.');
    load();
  };

  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMeta(true);
    setBanner(null);
    const modules = meta.modulesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const body = JSON.stringify({
      title: meta.title,
      track: meta.track,
      level: meta.level,
      description: meta.description,
      modules,
      durationHours: meta.durationHours ? Number(meta.durationHours) : undefined,
      price: Number(meta.price) || 0,
      isActive: meta.isActive
    });

    const res = isNew
      ? await authFetch('/api/admin/courses', { method: 'POST', body })
      : await authFetch(`/api/admin/courses/${courseId}`, { method: 'PATCH', body });
    const json = await res.json();
    setSavingMeta(false);

    if (!res.ok || !json.success) {
      setBanner(json.error || 'Could not save the course.');
      return;
    }

    if (isNew) {
      navigate(`/admin/courses/${json.courseId}`, { replace: true });
      return;
    }

    setEditingMeta(false);
    setBanner('Course details saved.');
    load();
  };

  const startAddStep = () => {
    setEditingStepId('new');
    setStepForm({ ...emptyStep });
    setStepError(null);
    window.setTimeout(() => document.getElementById('step-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const startEditStep = (step: any) => {
    setEditingStepId(step.id);
    setStepError(null);
    setStepForm({
      kind: step.kind,
      title: step.title,
      summary: step.summary || '',
      content: step.content || '',
      resourceUrl: step.resource_url || '',
      fileName: step.file_name || '',
      fileData: '',
      dueDays: String(step.due_days ?? 7),
      estimatedMinutes: String(step.estimated_minutes ?? 15),
      isMilestone: Boolean(step.is_milestone)
    });
    window.setTimeout(() => document.getElementById('step-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const closeStepEditor = () => {
    setEditingStepId(null);
    setStepForm({ ...emptyStep });
    setStepError(null);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStepError('That file is over 5 MB. Compress it, or paste a link instead.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setStepForm((prev) => ({ ...prev, fileName: file.name, fileData: reader.result as string }));
        setStepError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingStep(true);
    setStepError(null);
    const payload: Record<string, unknown> = {
      kind: stepForm.kind,
      title: stepForm.title,
      summary: stepForm.summary,
      content: stepForm.content,
      resourceUrl: stepForm.resourceUrl,
      dueDays: Number(stepForm.dueDays) || 7,
      estimatedMinutes: Number(stepForm.estimatedMinutes) || 15,
      isMilestone: stepForm.isMilestone
    };
    if (stepForm.fileData) {
      payload.fileData = stepForm.fileData;
      payload.fileName = stepForm.fileName;
    }

    const res = editingStepId === 'new'
      ? await authFetch(`/api/admin/courses/${courseId}/steps`, { method: 'POST', body: JSON.stringify(payload) })
      : await authFetch(`/api/admin/course-steps/${editingStepId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    const json = await res.json();
    setSavingStep(false);

    if (!res.ok || !json.success) {
      setStepError(json.error || 'Could not save this step.');
      return;
    }

    closeStepEditor();
    setBanner(editingStepId === 'new' ? 'Step added.' : 'Step saved.');
    load();
  };

  const removeStep = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    const res = await authFetch(`/api/admin/course-steps/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteBusy(false);
    if (res.ok) {
      setBanner(`Step "${deleteTarget.title}" deleted.`);
      setDeleteTarget(null);
      load();
    } else {
      setBanner('Could not delete that step.');
      setDeleteTarget(null);
    }
  };

  const moveStep = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const ids = steps.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const res = await authFetch(`/api/admin/courses/${courseId}/steps/reorder`, {
      method: 'POST',
      body: JSON.stringify({ stepIds: ids })
    });
    if (res.ok) {
      const json = await res.json();
      setSteps(json.steps || []);
    }
  };

  if (isNew) {
    return (
      <div className="workspace-shell">
        <div className="container-wide" style={{ maxWidth: 860 }}>
          <Link to="/admin/courses" className="back-link">
            <ArrowLeft size={15} /> Courses
          </Link>
          <header className="admin-page-head">
            <span className="admin-page-eyebrow">Course builder</span>
            <h1>New course</h1>
            <p>Start with the basics. Steps, files and videos come next, on the same page.</p>
          </header>

          <form className="panel-card" onSubmit={saveMeta}>
            {banner && <div className="governance-alert danger">{banner}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="cb-title">
                Course title *
              </label>
              <input
                id="cb-title"
                className="form-input"
                value={meta.title}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                placeholder="e.g. Price Action Foundations"
                required
              />
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="cb-track">
                  Track
                </label>
                <select
                  id="cb-track"
                  className="form-select"
                  value={meta.track}
                  onChange={(e) => setMeta({ ...meta, track: e.target.value })}
                >
                  {TRACKS.map((track) => (
                    <option key={track.value} value={track.value}>
                      {track.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cb-level">
                  Level
                </label>
                <input
                  id="cb-level"
                  className="form-input"
                  value={meta.level}
                  onChange={(e) => setMeta({ ...meta, level: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="cb-duration">
                  Duration (hours)
                </label>
                <input
                  id="cb-duration"
                  className="form-input"
                  type="number"
                  min={0}
                  step={0.5}
                  value={meta.durationHours}
                  onChange={(e) => setMeta({ ...meta, durationHours: e.target.value })}
                  placeholder="Left blank, it adds up from the steps"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cb-price">
                  Price (₹)
                </label>
                <input
                  id="cb-price"
                  className="form-input"
                  type="number"
                  min={0}
                  value={meta.price}
                  onChange={(e) => setMeta({ ...meta, price: e.target.value })}
                  placeholder="0 makes it free"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="cb-desc">
                Short description *
              </label>
              <textarea
                id="cb-desc"
                className="form-textarea"
                rows={3}
                value={meta.description}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                placeholder="What the learner walks away knowing."
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="cb-modules">
                Module outline (one per line, optional)
              </label>
              <textarea
                id="cb-modules"
                className="form-textarea"
                rows={4}
                value={meta.modulesText}
                onChange={(e) => setMeta({ ...meta, modulesText: e.target.value })}
                placeholder={'Module 1: …\nModule 2: …'}
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={savingMeta}>
                <BookOpen size={16} /> {savingMeta ? 'Creating…' : 'Create course'}
              </button>
              <Link to="/admin/courses" className="btn btn-secondary">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (loading && !course) {
    return (
      <div className="workspace-shell">
        <div className="container-wide">
          <p className="admin-muted">Loading course…</p>
        </div>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="workspace-shell">
        <div className="container-wide">
          <Link to="/admin/courses" className="back-link">
            <ArrowLeft size={15} /> Courses
          </Link>
          <div className="panel-card">
            <p className="admin-muted">{error || 'Course not found.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const totalMinutes = steps.reduce((sum, step) => sum + (Number(step.estimated_minutes) || 0), 0);
  const milestones = steps.filter((step) => step.is_milestone).length;

  return (
    <div className="workspace-shell">
      <div className="container-wide">
        <Link to="/admin/courses" className="back-link">
          <ArrowLeft size={15} /> Courses
        </Link>

        {banner && <div className="governance-alert success">{banner}</div>}

        <header className="builder-head panel-card">
          <div>
            <span className="admin-page-eyebrow">Course builder</span>
            <h1>{course.title}</h1>
            <p>{course.description}</p>
            <div className="dossier-chips">
              <span className="micro-tag accent">{TRACKS.find((t) => t.value === course.track)?.label || course.track}</span>
              <span className="micro-tag">{course.level}</span>
              <span className="micro-tag">
                {steps.length} {steps.length === 1 ? 'step' : 'steps'}
              </span>
              <span className="micro-tag">
                {milestones} {milestones === 1 ? 'milestone' : 'milestones'}
              </span>
              <span className="micro-tag">
                {course.duration_hours
                  ? `${course.duration_hours} hr`
                  : totalMinutes
                    ? `~${Math.round(totalMinutes / 60) || 1} hr`
                    : 'Duration not set'}
              </span>
              <span className={`micro-tag ${Number(course.price) > 0 ? 'accent' : 'success'}`}>
                {Number(course.price) > 0 ? `₹${Number(course.price).toLocaleString('en-IN')}` : 'Free'}
              </span>
              <span className={`micro-tag ${Number(course.is_active) === 0 ? 'danger' : 'success'}`}>
                {Number(course.is_active) === 0 ? 'Inactive' : 'Active'}
              </span>
            </div>
          </div>
          <div className="dossier-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditingMeta((v) => !v)}>
              <Pencil size={15} /> {editingMeta ? 'Close' : 'Edit basics'}
            </button>
            <button type="button" className="btn btn-primary" onClick={startAddStep}>
              <Plus size={16} /> Add step
            </button>
          </div>
        </header>

        {editingMeta && (
          <form className="panel-card" onSubmit={saveMeta}>
            <div className="form-head">
              <h3 className="admin-card-title">Course basics</h3>
              <button type="button" className="icon-button" onClick={() => setEditingMeta(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="cb-title">
                Title
              </label>
              <input
                id="cb-title"
                className="form-input"
                value={meta.title}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                required
              />
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="cb-track">
                  Track
                </label>
                <select
                  id="cb-track"
                  className="form-select"
                  value={meta.track}
                  onChange={(e) => setMeta({ ...meta, track: e.target.value })}
                >
                  {TRACKS.map((track) => (
                    <option key={track.value} value={track.value}>
                      {track.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cb-level">
                  Level
                </label>
                <input
                  id="cb-level"
                  className="form-input"
                  value={meta.level}
                  onChange={(e) => setMeta({ ...meta, level: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="cb-duration">
                  Duration (hours)
                </label>
                <input
                  id="cb-duration"
                  className="form-input"
                  type="number"
                  min={0}
                  step={0.5}
                  value={meta.durationHours}
                  onChange={(e) => setMeta({ ...meta, durationHours: e.target.value })}
                  placeholder="Adds up from the steps when blank"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cb-price">
                  Price (₹)
                </label>
                <input
                  id="cb-price"
                  className="form-input"
                  type="number"
                  min={0}
                  value={meta.price}
                  onChange={(e) => setMeta({ ...meta, price: e.target.value })}
                  placeholder="0 makes it free"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="cb-desc">
                Description
              </label>
              <textarea
                id="cb-desc"
                className="form-textarea"
                rows={2}
                value={meta.description}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="cb-modules">
                Module outline (one per line)
              </label>
              <textarea
                id="cb-modules"
                className="form-textarea"
                rows={4}
                value={meta.modulesText}
                onChange={(e) => setMeta({ ...meta, modulesText: e.target.value })}
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={meta.isActive}
                onChange={(e) => setStatusPrompt(e.target.checked)}
              />
              <span>
                <strong>{meta.isActive ? 'Active' : 'Inactive'}</strong>
                <small>
                  Inactive courses stay on the list and keep their learners, but cannot be assigned to anyone new.
                </small>
              </span>
            </label>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={savingMeta}>
                <Save size={15} /> {savingMeta ? 'Saving…' : 'Save basics'}
              </button>
            </div>
          </form>
        )}

        <div className="dossier-stats course-stats">
          <div>
            <span>Duration</span>
            <strong>{course.duration_hours ? `${course.duration_hours} hr` : totalMinutes ? `${Math.max(1, Math.round(totalMinutes / 60))} hr` : '—'}</strong>
          </div>
          <div>
            <span>Price</span>
            <strong>{Number(course.price) > 0 ? `₹${Number(course.price).toLocaleString('en-IN')}` : 'Free'}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{Number(course.is_active) === 0 ? 'Inactive' : 'Active'}</strong>
          </div>
          <div>
            <span>Learners</span>
            <strong>{enrolledCount}</strong>
          </div>
          <div>
            <span>Steps</span>
            <strong>{steps.length}</strong>
          </div>
          <div>
            <span>Collected</span>
            <strong>₹{Number(course.revenue || 0).toLocaleString('en-IN')}</strong>
          </div>
        </div>

        <section className="panel-card">
          <div className="form-head">
            <div>
              <span className="micro-tag accent">Learners</span>
              <h3 className="admin-card-title">Enrol a learner</h3>
            </div>
            {Number(course.is_active) === 0 && (
              <span className="micro-tag danger">Switch the course on to assign it</span>
            )}
          </div>

          {enrolBanner && <div className="governance-alert success">{enrolBanner}</div>}

          <form onSubmit={enrolLearner} className="admin-form">
            <div className="admin-form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="enrol-learner">Learner</label>
                <select
                  id="enrol-learner"
                  className="form-select"
                  value={enrolLearnerId}
                  onChange={(e) => setEnrolLearnerId(e.target.value)}
                >
                  {learners.map((learner: any) => (
                    <option key={learner.id} value={learner.id}>
                      {learner.name} ({learner.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="enrol-amount">Amount paid (₹)</label>
                <input
                  id="enrol-amount"
                  className="form-input"
                  type="number"
                  min={0}
                  value={enrolAmount}
                  onChange={(e) => setEnrolAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="enrol-notes">Note for the learner</label>
              <input
                id="enrol-notes"
                className="form-input"
                value={enrolNotes}
                onChange={(e) => setEnrolNotes(e.target.value)}
                placeholder="Why this course, what to focus on."
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={enrolBusy || Number(course.is_active) === 0}
            >
              {enrolBusy ? 'Enrolling…' : 'Enrol learner'}
            </button>
          </form>

          {enrollments && enrollments.length > 0 && (
            <div className="enrol-list">
              {enrollments.map((row: any) => {
                const pct = steps.length ? Math.round((Number(row.steps_done) / steps.length) * 100) : row.progress_pct || 0;
                return (
                  <div key={row.id} className="enrol-row">
                    <div>
                      <Link to={`/admin/learners/${row.learner_id}`} className="link-button">
                        {row.learner_name}
                      </Link>
                      <div className="admin-muted small">
                        Since {formatDate(row.assigned_at)}
                        {Number(row.amount_paid) > 0 ? ` · ₹${Number(row.amount_paid).toLocaleString('en-IN')} paid` : ''}
                      </div>
                    </div>
                    <div className="enrol-progress">
                      <div className="progress-track">
                        <span style={{ width: `${pct}%` }} />
                      </div>
                      <small className="admin-muted">{pct}%</small>
                    </div>
                    <span className={`status-pill ${row.status === 'COMPLETED' ? 'approved' : 'info'}`}>
                      {row.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="form-hint" style={{ marginTop: 10 }}>
            {enrolledCount > 0 ? `${enrolledCount} learner${enrolledCount === 1 ? '' : 's'} on this course.` : 'Nobody on this course yet.'}
          </p>
        </section>

        <div className="builder-grid">
          <section className="panel-card builder-steps">
            <div className="form-head">
              <div>
                <span className="micro-tag accent">Steps in order</span>
                <h3 className="admin-card-title">The path through this course</h3>
              </div>
            </div>
            <p className="admin-card-copy">
              Learners work from top to bottom. Step 2 stays locked until step 1 is done. A task step opens the
              next one only when a mentor passes the upload.
            </p>

            {steps.length === 0 && (
              <div className="empty-state">
                <ListChecks size={26} />
                <p>No steps yet. Add the first one and the learner path starts here.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={startAddStep}>
                  <Plus size={15} /> Add the first step
                </button>
              </div>
            )}

            <ol className="step-editor-list">
              {steps.map((step, index) => {
                const metaInfo = kindMeta(step.kind);
                return (
                  <li key={step.id} className={`step-editor-item ${editingStepId === step.id ? 'active' : ''}`}>
                    <span className="step-editor-num">{String(index + 1).padStart(2, '0')}</span>
                    <div className="step-editor-body">
                      <div className="step-editor-title">
                        <span className="kind-chip">
                          {metaInfo.icon} {metaInfo.label}
                        </span>
                        {Boolean(step.is_milestone) && (
                          <span className="kind-chip milestone">
                            <Star size={12} /> Milestone
                          </span>
                        )}
                        {step.file_name && <span className="kind-chip">{step.file_name}</span>}
                      </div>
                      <strong>{step.title}</strong>
                      {step.summary && <p>{step.summary}</p>}
                      <div className="admin-muted small">
                        {step.estimated_minutes} min
                        {step.kind === 'TASK' && ` · submit within ${step.due_days} days`}
                      </div>
                    </div>
                    <div className="step-editor-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Move ${step.title} up`}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Move ${step.title} down`}
                        disabled={index === steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Edit ${step.title}`}
                        onClick={() => startEditStep(step)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Delete ${step.title}`}
                        onClick={() => setDeleteTarget(step)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="panel-card builder-editor" id="step-editor">
            <div className="form-head">
              <div>
                <span className="micro-tag accent">{editingStepId ? (editingStepId === 'new' ? 'New step' : 'Editing step') : 'Step editor'}</span>
                <h3 className="admin-card-title">
                  {editingStepId ? (editingStepId === 'new' ? 'Add a step' : stepForm.title || 'Edit step') : 'Build a step'}
                </h3>
              </div>
              {editingStepId && (
                <button type="button" className="icon-button" onClick={closeStepEditor} aria-label="Close editor">
                  <X size={16} />
                </button>
              )}
            </div>

            {!editingStepId && (
              <div className="builder-editor-idle">
                <BookOpen size={26} />
                <p>Pick a step to edit it, or add a new one. Reading, video, PDF, Word, link or a graded task.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={startAddStep}>
                  <Plus size={15} /> Add a step
                </button>
              </div>
            )}

            {editingStepId && (
              <form onSubmit={saveStep} className="builder-form">
                {stepError && <div className="governance-alert danger">{stepError}</div>}

                <div className="form-group">
                  <label className="form-label">What kind of step?</label>
                  <div className="kind-picker">
                    {KINDS.map((kind) => (
                      <button
                        key={kind.value}
                        type="button"
                        className={`kind-option ${stepForm.kind === kind.value ? 'selected' : ''}`}
                        onClick={() => setStepForm({ ...stepForm, kind: kind.value })}
                      >
                        {kind.icon}
                        <span>
                          <strong>{kind.label}</strong>
                          <small>{kind.hint}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="step-title">
                    Step title *
                  </label>
                  <input
                    id="step-title"
                    className="form-input"
                    value={stepForm.title}
                    onChange={(e) => setStepForm({ ...stepForm, title: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="step-summary">
                    One-line summary
                  </label>
                  <input
                    id="step-summary"
                    className="form-input"
                    value={stepForm.summary}
                    onChange={(e) => setStepForm({ ...stepForm, summary: e.target.value })}
                  />
                </div>

                {(stepForm.kind === 'TEXT' || stepForm.kind === 'TASK') && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="step-content">
                      {stepForm.kind === 'TASK' ? 'Task instructions *' : 'Lesson text *'}
                    </label>
                    <textarea
                      id="step-content"
                      className="form-textarea"
                      rows={stepForm.kind === 'TASK' ? 4 : 7}
                      value={stepForm.content}
                      onChange={(e) => setStepForm({ ...stepForm, content: e.target.value })}
                      placeholder={
                        stepForm.kind === 'TASK'
                          ? 'What the learner has to do, and what they should upload.'
                          : 'Write the lesson. Leave a blank line between paragraphs.'
                      }
                      required={stepForm.kind === 'TASK'}
                    />
                  </div>
                )}

                {(stepForm.kind === 'VIDEO' || stepForm.kind === 'LINK') && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="step-url">
                      {stepForm.kind === 'VIDEO' ? 'YouTube link *' : 'Page link *'}
                    </label>
                    <input
                      id="step-url"
                      className="form-input"
                      value={stepForm.resourceUrl}
                      onChange={(e) => setStepForm({ ...stepForm, resourceUrl: e.target.value })}
                      placeholder={stepForm.kind === 'VIDEO' ? 'https://www.youtube.com/watch?v=…' : 'https://…'}
                      required
                    />
                    <p className="form-hint">
                      {stepForm.kind === 'VIDEO'
                        ? 'The normal watch link works. Shorts and youtu.be links too.'
                        : 'Opens in a new tab for the learner.'}
                    </p>
                  </div>
                )}

                {(stepForm.kind === 'PDF' || stepForm.kind === 'DOC') && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="step-file">
                        Upload the file {stepForm.kind === 'PDF' ? '(.pdf)' : '(.doc or .docx)'}
                      </label>
                      <input
                        id="step-file"
                        className="form-input"
                        type="file"
                        accept={stepForm.kind === 'PDF' ? '.pdf,application/pdf' : '.doc,.docx,application/msword'}
                        onChange={handleFile}
                      />
                      {(stepForm.fileName || stepForm.fileData) && (
                        <p className="form-hint">
                          <Check size={13} /> {stepForm.fileData ? 'Ready to upload: ' : 'On file: '}
                          {stepForm.fileName}
                        </p>
                      )}
                      <p className="form-hint">Up to 5 MB. The learner gets a download button, not a viewer.</p>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="step-file-url">
                        Or paste a link to the file
                      </label>
                      <input
                        id="step-file-url"
                        className="form-input"
                        value={stepForm.resourceUrl}
                        onChange={(e) => setStepForm({ ...stepForm, resourceUrl: e.target.value })}
                        placeholder="https://…"
                      />
                    </div>
                  </>
                )}

                <div className="admin-form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="step-minutes">
                      Time to finish (minutes)
                    </label>
                    <input
                      id="step-minutes"
                      className="form-input"
                      type="number"
                      min={1}
                      value={stepForm.estimatedMinutes}
                      onChange={(e) => setStepForm({ ...stepForm, estimatedMinutes: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="step-due">
                      Submit within (days)
                    </label>
                    <input
                      id="step-due"
                      className="form-input"
                      type="number"
                      min={1}
                      value={stepForm.dueDays}
                      onChange={(e) => setStepForm({ ...stepForm, dueDays: e.target.value })}
                      disabled={stepForm.kind !== 'TASK'}
                    />
                  </div>
                </div>

                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={stepForm.isMilestone}
                    onChange={(e) => setStepForm({ ...stepForm, isMilestone: e.target.checked })}
                  />
                  <span>
                    <strong>Mark as a milestone</strong>
                    <small>Shown with a star, and worth a check-in with the learner.</small>
                  </span>
                </label>

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={savingStep}>
                    <Save size={15} /> {savingStep ? 'Saving…' : editingStepId === 'new' ? 'Add step' : 'Save step'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={closeStepEditor}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <ConfirmDialog
          open={statusPrompt !== null}
          title={statusPrompt ? 'Activate this course?' : 'Deactivate this course?'}
          message={
            statusPrompt ? (
              <>The course will be assignable again as soon as you save.</>
            ) : (
              <>
                Learners already on <strong>{course.title}</strong> keep their access and progress. The course
                will not be offered for new assignments until it is active again.
              </>
            )
          }
          confirmLabel={statusPrompt ? 'Activate' : 'Deactivate'}
          variant={statusPrompt ? 'primary' : 'danger'}
          onConfirm={() => {
            setMeta((prev) => ({ ...prev, isActive: Boolean(statusPrompt) }));
            setStatusPrompt(null);
          }}
          onCancel={() => setStatusPrompt(null)}
        />

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Delete this step?"
          message={
            <>
              <strong>{deleteTarget?.title}</strong> will be removed from the course, along with any learner
              progress on it. Learners who already finished it keep their task history.
            </>
          }
          confirmLabel="Delete step"
          busy={deleteBusy}
          onConfirm={removeStep}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </div>
  );
};
