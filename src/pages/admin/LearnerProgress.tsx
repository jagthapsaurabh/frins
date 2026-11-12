import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Search, BookOpen, ClipboardList, Upload, TrendingUp } from 'lucide-react';
import { usePagedList } from '../../hooks/usePagedList';
import { Pager } from '../../components/Pager';

interface Props {
  courses: any[];
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onChanged: () => void;
}

const STATUS_CLASS: Record<string, string> = {
  ASSIGNED: 'pending',
  SUBMITTED: 'info',
  REVIEWED: 'approved',
  APPROVED: 'approved'
};

const pct = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100));

/**
 * How one learner is doing, and what they were given.
 *
 * The roster is paged and searched on the server, so a thousand learners is
 * twenty pages, not one wall of names. Picking a name loads just that person.
 */
export const LearnerProgress: React.FC<Props> = ({ courses, authFetch, onChanged }) => {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  // The top-bar search can deep-link straight to one learner.
  const [params] = useSearchParams();
  const linkedLearner = params.get('learner') || '';
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignCourseId, setAssignCourseId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMessage, setAssignMessage] = useState('');

  // Debounce typing so the list does not refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = usePagedList(authFetch, '/api/admin/learners', { q: query, page, limit: 20 });

  // A learner picked in the top-bar search wins over the first row.
  useEffect(() => {
    if (linkedLearner && linkedLearner !== selectedId) setSelectedId(linkedLearner);
  }, [linkedLearner]);

  // Pick the first row of the page when nothing is selected.
  useEffect(() => {
    if (list.rows.length === 0) {
      // Keep a learner that came in from the top-bar search; only clear an
      // empty roster when nothing was asked for.
      if (!linkedLearner) {
        setSelectedId('');
        setDetail(null);
      }
      return;
    }
    if (!list.rows.some((row: any) => row.id === selectedId) && !linkedLearner) {
      setSelectedId(list.rows[0].id);
    }
  }, [list.rows, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const res = await authFetch(`/api/admin/learners/${selectedId}/progress`);
        const json = await res.json();
        if (!cancelled && json.success) setDetail(json);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, authFetch]);

  const handleAssign = async () => {
    if (!assignCourseId) {
      setAssignMessage('Pick a course first.');
      return;
    }
    setAssignBusy(true);
    setAssignMessage('');
    try {
      const res = await authFetch('/api/admin/courses/assign', {
        method: 'POST',
        body: JSON.stringify({ courseId: assignCourseId, learnerId: selectedId, customNotes: assignNotes.trim() })
      });
      const out = await res.json();
      if (res.ok && out.success) {
        setAssignMessage('Course assigned.');
        setAssignNotes('');
        onChanged();
        // Refresh just this learner, no full page reload.
        const refreshed = await authFetch(`/api/admin/learners/${selectedId}/progress`);
        const json = await refreshed.json();
        if (json.success) setDetail(json);
        list.reload();
      } else {
        setAssignMessage(out.error || 'Could not assign the course.');
      }
    } finally {
      setAssignBusy(false);
    }
  };

  const learner = detail?.learner;
  const learnerCourses: any[] = detail?.courses || [];
  const learnerTasks: any[] = detail?.tasks || [];
  const reviewed = learnerTasks.filter((t) => t.status === 'REVIEWED' || t.status === 'APPROVED').length;
  const uploaded = learnerTasks.filter((t) => t.submitted_at).length;

  return (
    <div className="progress-layout">
      <aside className="panel-card progress-roster">
        <div className="progress-roster-head">
          <span className="micro-tag accent">Learners ({list.total.toLocaleString()})</span>
          <div className="progress-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              aria-label="Search learners"
            />
          </div>
        </div>

        <div className="progress-roster-list">
          {list.loading && list.rows.length === 0 && <p className="admin-muted">Loading learners...</p>}
          {!list.loading && list.rows.length === 0 && (
            <p className="admin-muted">Nobody matches that search.</p>
          )}
          {list.rows.map((row: any) => {
            const done = pct(row.reviewed_count, row.task_count);
            return (
              <button
                key={row.id}
                type="button"
                className={`progress-roster-item ${selectedId === row.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(row.id);
                  setAssignCourseId('');
                  setAssignMessage('');
                }}
              >
                <span className="progress-avatar">
                  {row.name
                    .split(' ')
                    .map((p: string) => p[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <span className="progress-roster-text">
                  <strong>{row.name}</strong>
                  <small>
                    {row.course_count} course{row.course_count === 1 ? '' : 's'} &middot; {row.task_count} task
                    {row.task_count === 1 ? '' : 's'}
                  </small>
                </span>
                <span className="progress-roster-pct">{done}%</span>
              </button>
            );
          })}
        </div>

        <Pager
          page={list.page}
          pages={list.pages}
          total={list.total}
          limit={20}
          onChange={setPage}
          noun="learners"
        />
      </aside>

      <div className="progress-detail">
        {!learner && (
          <section className="panel-card">
            <p className="admin-muted">
              {list.loading ? 'Loading this learner...' : 'Pick a learner to see their courses and tasks.'}
            </p>
          </section>
        )}

        {learner && (
          <>
            <section className="panel-card progress-person">
              <div>
                <span className="micro-tag accent">{learner.track || 'Learner'}</span>
                <h3 className="admin-card-title">{learner.name}</h3>
                <p className="admin-card-copy">
                  {learner.email} &middot; joined {new Date(learner.created_at).toLocaleDateString()} &middot;{' '}
                  {learner.account_status === 'ACTIVE' ? 'Active' : learner.account_status}
                </p>
              </div>
              <span className="micro-tag">
                {learnerTasks.length === 0
                  ? 'No tasks yet'
                  : `Last upload ${new Date(
                      learnerTasks
                        .map((t: any) => t.submitted_at)
                        .filter(Boolean)
                        .sort()
                        .reverse()[0] || learnerTasks[0].due_date || new Date().toISOString()
                    ).toLocaleDateString()}`}
              </span>
            </section>

            <div className="progress-stats">
              <div>
                <BookOpen size={16} />
                <strong>{learnerCourses.length}</strong>
                <span>Courses assigned</span>
              </div>
              <div>
                <ClipboardList size={16} />
                <strong>{learnerTasks.length}</strong>
                <span>Tasks given</span>
              </div>
              <div>
                <Upload size={16} />
                <strong>{uploaded}</strong>
                <span>Uploaded</span>
              </div>
              <div>
                <CheckCircle2 size={16} />
                <strong>{reviewed}</strong>
                <span>Reviewed</span>
              </div>
              <div>
                <TrendingUp size={16} />
                <strong>{pct(reviewed, learnerTasks.length)}%</strong>
                <span>Task completion</span>
              </div>
            </div>

            <section className="panel-card">
              <span className="micro-tag accent">Course progress</span>
              <h3 className="admin-card-title">Courses and how far along they are</h3>
              <p className="admin-card-copy">
                A course counts a task as done when it was uploaded or reviewed. Questions count when they
                were answered once.
              </p>

              {learnerCourses.length === 0 ? (
                <p className="admin-muted">No course assigned yet. Use the box below to give one.</p>
              ) : (
                <div className="progress-course-list">
                  {learnerCourses.map((sc: any) => {
                    const taskPct = pct(sc.tasks_started, sc.task_count);
                    const questionPct = pct(sc.answered_count, sc.question_count);
                    const complete = sc.task_count > 0 && sc.tasks_started === sc.task_count;
                    return (
                      <div key={sc.id} className="progress-course">
                        <div className="progress-course-top">
                          <div>
                            <strong>{sc.course_title}</strong>
                            <small>
                              Assigned {new Date(sc.assigned_at).toLocaleDateString()}
                              {sc.custom_notes ? ` · ${sc.custom_notes}` : ''}
                            </small>
                          </div>
                          <span className={`status-pill ${complete ? 'approved' : 'pending'}`}>
                            {complete ? 'Complete' : 'In progress'}
                          </span>
                        </div>

                        <div className="progress-bar-row">
                          <span>Tasks</span>
                          <div className="progress-bar">
                            <span style={{ width: `${taskPct}%` }} />
                          </div>
                          <small>
                            {sc.tasks_started}/{sc.task_count}
                          </small>
                        </div>
                        <div className="progress-bar-row">
                          <span>Questions</span>
                          <div className="progress-bar">
                            <span style={{ width: `${questionPct}%` }} />
                          </div>
                          <small>
                            {sc.answered_count}/{sc.question_count}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="progress-assign">
                <div className="form-group">
                  <label className="form-label" htmlFor="assignCourse">
                    Assign another course
                  </label>
                  <select
                    id="assignCourse"
                    className="form-select"
                    value={assignCourseId}
                    onChange={(e) => setAssignCourseId(e.target.value)}
                  >
                    <option value="">Pick a course</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.level})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="assignNotes">
                    Note for this learner
                  </label>
                  <input
                    id="assignNotes"
                    className="form-input"
                    value={assignNotes}
                    onChange={(e) => setAssignNotes(e.target.value)}
                    placeholder="Optional. Why this course, what to focus on."
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={assignBusy}
                  onClick={handleAssign}
                >
                  {assignBusy ? 'Assigning...' : 'Assign course'}
                </button>
                {assignMessage && <span className="progress-assign-msg">{assignMessage}</span>}
              </div>
            </section>

            <section className="panel-card">
              <span className="micro-tag accent">Task history</span>
              <h3 className="admin-card-title">Every task given to this learner</h3>
              <p className="admin-card-copy">
                Uploaded means the learner sent something. Reviewed means the team has looked at it.
              </p>

              {learnerTasks.length === 0 ? (
                <p className="admin-muted">No task given yet. Give one from Courses &amp; tasks.</p>
              ) : (
                <div className="progress-table-wrap">
                  <table className="progress-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Course</th>
                        <th>Status</th>
                        <th>AI pre-check</th>
                        <th>Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {learnerTasks.map((t: any) => (
                        <tr key={t.id}>
                          <td>
                            <strong>{t.title}</strong>
                          </td>
                          <td>{t.course_title || '—'}</td>
                          <td>
                            <span className={`status-pill ${STATUS_CLASS[t.status] || 'pending'}`}>
                              {String(t.status).toLowerCase()}
                            </span>
                          </td>
                          <td>
                            {t.aiVerdict
                              ? `${String(t.aiVerdict).replaceAll('_', ' ').toLowerCase()}${
                                  t.aiConfidence != null ? ` (${t.aiConfidence}%)` : ''
                                }`
                              : '—'}
                          </td>
                          <td>{t.submitted_at ? new Date(t.submitted_at).toLocaleDateString() : 'Not yet'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {detailLoading && <p className="admin-muted">Updating...</p>}
          </>
        )}
      </div>
    </div>
  );
};
