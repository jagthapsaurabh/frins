import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHead } from '../../components/console/ConsoleUI';

const todayPlus = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Giving a task is a job of its own, so it lives on its own page. The list
 * behind it stays a list.
 */
export const AssignTaskPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [learners, setLearners] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);

  const [learnerId, setLearnerId] = useState(params.get('learner') || '');
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [criteria, setCriteria] = useState('');
  const [dueDate, setDueDate] = useState(todayPlus(3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/admin/learners?limit=200')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((json) => {
        setLearners(json.rows || []);
        if (!params.get('learner') && json.rows?.[0]) setLearnerId(json.rows[0].id);
      })
      .catch(() => setLearners([]));

    authFetch('/api/admin/courses')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((json) => setCourses(json.rows || []))
      .catch(() => setCourses([]));
  }, [authFetch, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!learnerId) {
      setError('Pick who this task is for.');
      return;
    }
    if (!title.trim() || !instructions.trim()) {
      setError('A title and the instructions are both needed.');
      return;
    }
    setBusy(true);
    const res = await authFetch('/api/admin/tasks', {
      method: 'POST',
      body: JSON.stringify({
        learnerId,
        courseId: courseId || null,
        title: title.trim(),
        instructions: instructions.trim(),
        expectedCriteria: criteria.trim() || instructions.trim(),
        dueDate,
        category: 'CHART_CONCEPT_LAB'
      })
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not give this task.');
      return;
    }
    navigate(`/admin/tasks/${json.taskId}`);
  };

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/tasks')}>
        <ArrowLeft size={14} /> Tasks
      </button>

      <PageHead title="Give a task" />

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <h2>
                <ClipboardList size={13} /> The work
              </h2>
              <span className="section-note">The learner sees this as soon as you save</span>
            </div>

            <form onSubmit={submit}>
              <div className="form-group">
                <label className="form-label" htmlFor="taskLearner">
                  Who is it for
                </label>
                <select
                  id="taskLearner"
                  className="form-select"
                  value={learnerId}
                  onChange={(e) => setLearnerId(e.target.value)}
                  required
                >
                  <option value="">Pick a learner</option>
                  {learners.map((learner) => (
                    <option key={learner.id} value={learner.id}>
                      {learner.name} ({learner.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="taskCourse">
                    Linked course
                  </label>
                  <select
                    id="taskCourse"
                    className="form-select"
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                  >
                    <option value="">No course</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="taskDue">
                    Due
                  </label>
                  <input
                    id="taskDue"
                    type="date"
                    className="form-input"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="taskTitle">
                  Title
                </label>
                <input
                  id="taskTitle"
                  className="form-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Mark the Heikin Ashi entry on a 15 minute chart"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="taskInstructions">
                  Instructions
                </label>
                <textarea
                  id="taskInstructions"
                  className="form-textarea"
                  rows={5}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="What to do, which chart, what to mark, what to write."
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="taskCriteria">
                  What a correct answer covers
                </label>
                <textarea
                  id="taskCriteria"
                  className="form-textarea"
                  rows={3}
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  placeholder="The points you will check when you review it."
                />
              </div>

              {error && <p className="form-error">{error}</p>}

              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving' : 'Give this task'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/tasks')}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card">
            <div className="panel-head">
              <h2>How it works</h2>
            </div>
            <ol className="steps-list">
              <li>The learner gets a notification with the brief and the due date.</li>
              <li>They send their answer back to you.</li>
              <li>The AI pre-check reads it and flags gaps for you, never for them.</li>
              <li>You approve it or send it back with notes.</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
};
