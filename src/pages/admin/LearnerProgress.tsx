import React, { useMemo, useState } from 'react';
import { CheckCircle2, Search, BookOpen, ClipboardList, Upload, TrendingUp } from 'lucide-react';

interface Props {
  learners: any[];
  courses: any[];
  courseQuestions: any[];
  studentCourses: any[];
  studentTasks: any[];
  attempts: any[];
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
 * One place to answer "how is this learner actually doing?".
 *
 * Pick a learner, see every course they were given, how much of each one is done,
 * every task with its status and whether it was uploaded, and a course can be
 * assigned from here without leaving the page.
 */
export const LearnerProgress: React.FC<Props> = ({
  learners,
  courses,
  courseQuestions,
  studentCourses,
  studentTasks,
  attempts,
  authFetch,
  onChanged
}) => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [assignCourseId, setAssignCourseId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMessage, setAssignMessage] = useState('');

  const rows = useMemo(() => {
    return learners.map((learner) => {
      const myCourses = studentCourses.filter((sc) => sc.learner_id === learner.id);
      const myTasks = studentTasks.filter((t) => t.learner_id === learner.id);
      const submitted = myTasks.filter((t) => Boolean(t.learner_submission)).length;
      const reviewed = myTasks.filter((t) => t.status === 'REVIEWED' || t.status === 'APPROVED').length;
      const myAttempts = attempts.filter((a) => a.learner_id === learner.id);
      const lastTouched = myTasks
        .map((t) => t.submitted_at || t.assigned_at || t.created_at)
        .filter(Boolean)
        .sort()
        .reverse()[0];
      return { learner, myCourses, myTasks, submitted, reviewed, myAttempts, lastTouched };
    });
  }, [learners, studentCourses, studentTasks, attempts]);

  const filtered = rows.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      row.learner.name.toLowerCase().includes(q) || row.learner.email.toLowerCase().includes(q)
    );
  });

  const selected = rows.find((row) => row.learner.id === selectedId) || filtered[0] || null;

  if (learners.length === 0) {
    return <p className="admin-muted">No learners on the platform yet. Create one in Staff &amp; access.</p>;
  }

  const handleAssign = async (learnerId: string) => {
    if (!assignCourseId) {
      setAssignMessage('Pick a course first.');
      return;
    }
    setAssignBusy(true);
    setAssignMessage('');
    try {
      const res = await authFetch('/api/admin/courses/assign', {
        method: 'POST',
        body: JSON.stringify({ courseId: assignCourseId, learnerId, customNotes: assignNotes.trim() })
      });
      const out = await res.json();
      if (res.ok && out.success) {
        setAssignMessage('Course assigned.');
        setAssignNotes('');
        onChanged();
      } else {
        setAssignMessage(out.error || 'Could not assign the course.');
      }
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <div className="progress-layout">
      <aside className="panel-card progress-roster">
        <div className="progress-roster-head">
          <span className="micro-tag accent">Learners</span>
          <div className="progress-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email"
              aria-label="Search learners"
            />
          </div>
        </div>

        <div className="progress-roster-list">
          {filtered.map((row) => {
            const isSel = selected?.learner.id === row.learner.id;
            return (
              <button
                key={row.learner.id}
                type="button"
                className={`progress-roster-item ${isSel ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(row.learner.id);
                  setAssignCourseId('');
                  setAssignMessage('');
                }}
              >
                <span className="progress-avatar">
                  {row.learner.name
                    .split(' ')
                    .map((p: string) => p[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <span className="progress-roster-text">
                  <strong>{row.learner.name}</strong>
                  <small>
                    {row.myCourses.length} course{row.myCourses.length === 1 ? '' : 's'} &middot;{' '}
                    {row.myTasks.length} task{row.myTasks.length === 1 ? '' : 's'}
                  </small>
                </span>
                <span className="progress-roster-pct">{pct(row.reviewed, row.myTasks.length)}%</span>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="admin-muted">Nobody matches that search.</p>}
        </div>
      </aside>

      {selected && (
        <div className="progress-detail">
          <section className="panel-card progress-person">
            <div>
              <span className="micro-tag accent">{selected.learner.track || 'Learner'}</span>
              <h3 className="admin-card-title">{selected.learner.name}</h3>
              <p className="admin-card-copy">
                {selected.learner.email} &middot; joined{' '}
                {new Date(selected.learner.created_at).toLocaleDateString()} &middot;{' '}
                {selected.learner.account_status === 'ACTIVE' ? 'Active' : selected.learner.account_status}
              </p>
            </div>
            <span className="micro-tag">
              {selected.lastTouched
                ? `Last activity ${new Date(selected.lastTouched).toLocaleDateString()}`
                : 'No activity yet'}
            </span>
          </section>

          <div className="progress-stats">
            <div>
              <BookOpen size={16} />
              <strong>{selected.myCourses.length}</strong>
              <span>Courses assigned</span>
            </div>
            <div>
              <ClipboardList size={16} />
              <strong>{selected.myTasks.length}</strong>
              <span>Tasks given</span>
            </div>
            <div>
              <Upload size={16} />
              <strong>{selected.submitted}</strong>
              <span>Uploaded</span>
            </div>
            <div>
              <CheckCircle2 size={16} />
              <strong>{selected.reviewed}</strong>
              <span>Reviewed</span>
            </div>
            <div>
              <TrendingUp size={16} />
              <strong>{pct(selected.reviewed, selected.myTasks.length)}%</strong>
              <span>Task completion</span>
            </div>
          </div>

          <section className="panel-card">
            <span className="micro-tag accent">Course progress</span>
            <h3 className="admin-card-title">Courses and how far along they are</h3>
            <p className="admin-card-copy">
              A course counts a task as done when it has been uploaded or reviewed. Questions count when they
              were answered once.
            </p>

            {selected.myCourses.length === 0 ? (
              <p className="admin-muted">No course assigned yet. Use the box below to give one.</p>
            ) : (
              <div className="progress-course-list">
                {selected.myCourses.map((sc) => {
                  const course = courses.find((c) => c.id === sc.course_id);
                  const courseTasks = selected.myTasks.filter((t) => t.course_id === sc.course_id);
                  const doneTasks = courseTasks.filter(
                    (t) => t.status === 'SUBMITTED' || t.status === 'REVIEWED' || t.status === 'APPROVED'
                  ).length;
                  const questions = courseQuestions.filter((q) => q.course_id === sc.course_id);
                  const answeredIds = new Set(
                    selected.myAttempts
                      .filter((a) => questions.some((q) => q.id === a.question_id))
                      .map((a) => a.question_id)
                  );
                  const taskPct = pct(doneTasks, courseTasks.length);
                  const questionPct = pct(answeredIds.size, questions.length);

                  return (
                    <div key={sc.id} className="progress-course">
                      <div className="progress-course-top">
                        <div>
                          <strong>{sc.course_title || course?.title}</strong>
                          <small>
                            Assigned {new Date(sc.assigned_at).toLocaleDateString()}
                            {sc.custom_notes ? ` · ${sc.custom_notes}` : ''}
                          </small>
                        </div>
                        <span className={`status-pill ${taskPct === 100 && courseTasks.length > 0 ? 'approved' : 'pending'}`}>
                          {taskPct === 100 && courseTasks.length > 0 ? 'Complete' : 'In progress'}
                        </span>
                      </div>

                      <div className="progress-bar-row">
                        <span>Tasks</span>
                        <div className="progress-bar">
                          <span style={{ width: `${taskPct}%` }} />
                        </div>
                        <small>
                          {doneTasks}/{courseTasks.length}
                        </small>
                      </div>
                      <div className="progress-bar-row">
                        <span>Questions</span>
                        <div className="progress-bar">
                          <span style={{ width: `${questionPct}%` }} />
                        </div>
                        <small>
                          {answeredIds.size}/{questions.length}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="progress-assign">
              <div className="form-group">
                <label className="form-label" htmlFor="assignCourse">Assign another course</label>
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
                <label className="form-label" htmlFor="assignNotes">Note for this learner</label>
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
                onClick={() => handleAssign(selected.learner.id)}
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

            {selected.myTasks.length === 0 ? (
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
                    {selected.myTasks.map((t) => (
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
                          {t.ai_review?.verdict
                            ? `${t.ai_review.verdict.replaceAll('_', ' ')} (${t.ai_review.confidence ?? 0}%)`
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
        </div>
      )}
    </div>
  );
};
