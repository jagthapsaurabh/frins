import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Send, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHead, labelFor, toneFor } from '../../components/console/ConsoleUI';
import { formatDateTime, timeAgo } from '../../utils/dates';

/**
 * One task, for the learner. Read the brief, send the work, talk to the mentor.
 */
export const LearnerTaskPage: React.FC = () => {
  const { taskId = '' } = useParams();
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [answer, setAnswer] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/learner/dashboard');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not open this task.');
      setData(json);
      const task = (json.tasks || []).find((row: any) => row.id === taskId);
      if (task) {
        setAnswer(task.learner_submission || '');
        setFileName(task.uploaded_file_name || '');
        setFileData(task.uploaded_file_data || '');
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not open this task.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const node = chatRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [data?.tasks]);

  const task = (data?.tasks || []).find((row: any) => row.id === taskId);
  const course = (data?.assignedCourses || []).find((row: any) => row.course_id === task?.course_id);

  const pickChart = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setSubmitError('That image is over 6 MB. A smaller screenshot is enough.');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setFileData(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || !answer.trim()) return;
    setBusy(true);
    setSubmitError(null);
    const res = await authFetch(`/api/learner/tasks/${task.id}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        submissionText: answer.trim(),
        uploadedFileName: fileName || undefined,
        uploadedFileData: fileData || undefined
      })
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setSubmitError(json.error || 'Could not send your work.');
      return;
    }
    setBanner('Sent. Your mentor can see it now.');
    load();
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !task) return;
    setSending(true);
    const res = await authFetch(`/api/tasks/${task.id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: draft.trim() })
    });
    setSending(false);
    if (res.ok) {
      setDraft('');
      load();
    }
  };

  if (loading && !data) return <p className="section-note">Loading the task.</p>;
  if (!task) return <div className="governance-alert danger">{error || 'Task not found.'}</div>;

  const messages: any[] = task.messages || [];
  const done = ['REVIEWED', 'APPROVED'].includes(task.status);

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/dashboard/tasks')}>
        <ArrowLeft size={14} /> Tasks
      </button>

      <PageHead
        title={task.title}
        actions={<span className={`status-pill ${toneFor(task.status)}`}>{labelFor(task.status)}</span>}
      />

      {banner && <div className="governance-alert success">{banner}</div>}
      {error && <div className="governance-alert danger">{error}</div>}

      <div className="fact-list" style={{ marginBottom: 14 }}>
        <div className="fact">
          <span>Course</span>
          <strong>{course?.course_title || 'General task'}</strong>
        </div>
        <div className="fact">
          <span>Given</span>
          <strong>{formatDateTime(task.assigned_at)}</strong>
        </div>
        <div className="fact">
          <span>Due</span>
          <strong>{task.due_date ? formatDateTime(task.due_date) : 'No date'}</strong>
        </div>
        <div className="fact">
          <span>Mentor</span>
          <strong>{data?.learner?.guide_name || 'Your guide'}</strong>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <h2>What to do</h2>
            </div>
            <p className="prose-block">{task.instructions || 'No instructions were added.'}</p>
          </section>

          {task.guide_feedback && (
            <section className="panel-card">
              <div className="panel-head">
                <h2>Mentor feedback</h2>
                <span className="section-note">{timeAgo(task.reviewed_at)}</span>
              </div>
              <p className="prose-block">{task.guide_feedback}</p>
            </section>
          )}

          <section className="panel-card">
            <div className="panel-head">
              <h2>Your work</h2>
              {task.submitted_at && <span className="section-note">Sent {timeAgo(task.submitted_at)}</span>}
            </div>

            {done ? (
              <>
                <p className="prose-block">{task.learner_submission || 'No written answer.'}</p>
                {task.uploaded_file_data?.startsWith('data:image') && (
                  <img className="submission-image" src={task.uploaded_file_data} alt="Chart you sent" />
                )}
              </>
            ) : (
              <form onSubmit={submit}>
                <div className="form-group">
                  <label className="form-label" htmlFor="taskAnswer">
                    Your answer
                  </label>
                  <textarea
                    id="taskAnswer"
                    className="form-textarea"
                    rows={6}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Write what you found, the steps you took, and what the chart or result shows."
                    required
                  />
                </div>

                {fileName && (
                  <p className="file-chip">
                    {fileName}
                    <button
                      type="button"
                      className="icon-quiet"
                      onClick={() => {
                        setFileName('');
                        setFileData('');
                      }}
                      aria-label="Remove the image"
                    >
                      <X size={12} />
                    </button>
                  </p>
                )}

                {submitError && <p className="form-error">{submitError}</p>}

                <label className="btn btn-secondary" htmlFor="taskChart" style={{ cursor: 'pointer' }}>
                  <ImagePlus size={14} /> {fileName ? 'Change chart' : 'Add your chart'}
                </label>
                <input
                  id="taskChart"
                  type="file"
                  accept="image/*"
                  onChange={pickChart}
                  hidden
                />

                <button type="submit" className="btn btn-primary" style={{ marginLeft: 8 }} disabled={busy || !answer.trim()}>
                  {busy ? 'Sending' : task.submitted_at ? 'Send again' : 'Send to my mentor'}
                </button>
              </form>
            )}
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="panel-head" style={{ padding: '12px 14px', margin: 0 }}>
              <h2>Ask your mentor</h2>
              <Link className="link-button" to="/dashboard/messages" style={{ fontSize: 12 }}>
                All messages
              </Link>
            </div>
            <div className="chat-bubbles task-chat" ref={chatRef}>
              {messages.length === 0 && <p className="section-note">No messages yet.</p>}
              {messages.map((message) => {
                const mine = message.sender_role === 'LEARNER';
                return (
                  <div key={message.id} className={`chat-bubble ${mine ? 'mine' : ''}`}>
                    <div className="chat-bubble-meta">
                      {mine ? 'You' : message.sender_name} · {timeAgo(message.created_at)}
                    </div>
                    <div className="chat-bubble-text">{message.message}</div>
                  </div>
                );
              })}
            </div>
            <form className="chat-composer" onSubmit={send}>
              <input
                className="form-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about this task"
                aria-label="Ask about this task"
              />
              <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
                <Send size={14} />
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
