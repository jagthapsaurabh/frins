import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Clock, FileText, MessageSquare, Paperclip, Send, Sparkles, Undo2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PageHead, StatusPill, labelFor, toneFor } from '../../components/console/ConsoleUI';
import { formatDateTime, timeAgo } from '../../utils/dates';
import { openStoredFile } from '../../utils/files';

const humanLabel = (value?: string) => {
  const words = (value || 'No verdict').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const initials = (name?: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/**
 * One task, from the brief to the review. Everything a mentor needs sits on the
 * left and the conversation with the learner runs down the right.
 */
export const TaskDetailPage: React.FC = () => {
  const { taskId = '' } = useParams();
  const { authFetch, user } = useAuth();
  const isGuide = user?.role === 'GUIDE';
  const navigate = useNavigate();

  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState<'approve' | 'changes' | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/tasks/${taskId}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not open this task.');
      setTask(json.task);
      setFeedback(json.task.guide_feedback || '');
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
  }, [task?.messages?.length]);

  const review = async () => {
    if (!pending) return;
    if (!feedback.trim()) {
      setFeedbackError('Write what the learner needs to hear.');
      setPending(null);
      return;
    }
    setBusy(true);
    const res = await authFetch(`/api/admin/tasks/${taskId}/review`, {
      method: 'POST',
      body: JSON.stringify({ status: pending === 'approve' ? 'REVIEWED' : 'CHANGES_REQUESTED', guideFeedback: feedback.trim() })
    });
    const json = await res.json();
    setBusy(false);
    setPending(null);
    if (!res.ok || !json.success) {
      setFeedbackError(json.error || 'Could not save the review.');
      return;
    }
    setFeedbackError(null);
    setBanner(
      pending === 'approve'
        ? 'Task marked complete. The learner has been notified.'
        : 'Sent back. The learner has your note and can send it again.'
    );
    load();
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    const res = await authFetch(`/api/tasks/${taskId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: draft.trim() })
    });
    setSending(false);
    if (res.ok) {
      setDraft('');
      load();
    }
  };

  if (loading && !task) return <p className="section-note">Loading the task.</p>;
  if (!task) return <div className="governance-alert danger">{error || 'Task not found.'}</div>;

  const ai = task.aiReview;
  const messages: any[] = task.messages || [];

  return (
    <div>
      <button
        type="button"
        className="back-link"
        onClick={() => navigate(isGuide ? '/guide/reviews' : '/admin/tasks')}
      >
        <ArrowLeft size={14} /> {isGuide ? 'Task reviews' : 'Tasks'}
      </button>

      <PageHead
        title={task.title}
        actions={
          <>
            <StatusPill status={labelFor(task.status)} tone={toneFor(task.status) as any} />
            <Link className="btn btn-secondary" to={`/admin/learners/${task.learner_id}`}>
              Open learner
            </Link>
          </>
        }
      />

      {banner && <div className="governance-alert success">{banner}</div>}
      {error && <div className="governance-alert danger">{error}</div>}

      <div className={`state-card ${task.status === 'SUBMITTED' ? 'warn' : task.status === 'CHANGES_REQUESTED' ? 'danger' : task.status === 'REVIEWED' || task.status === 'APPROVED' ? 'approved' : 'info'}`}>
        <span className="state-icon">
          {task.status === 'SUBMITTED' ? <Clock size={15} /> : task.status === 'CHANGES_REQUESTED' ? <Undo2 size={15} /> : task.status === 'REVIEWED' || task.status === 'APPROVED' ? <Check size={15} /> : <FileText size={15} />}
        </span>
        <div>
          <strong>
            {task.status === 'SUBMITTED'
              ? 'Waiting for your review'
              : task.status === 'CHANGES_REQUESTED'
                ? 'Sent back to the learner'
                : task.status === 'REVIEWED' || task.status === 'APPROVED'
                  ? 'Completed'
                  : 'Not sent yet'}
          </strong>
          <p>
            {task.status === 'SUBMITTED'
              ? `The learner sent this ${task.submitted_at ? timeAgo(task.submitted_at) : 'recently'}. Read the work, then mark it complete or send it back with notes.`
              : task.status === 'CHANGES_REQUESTED'
                ? 'The learner has your note. They can update the work and send it again.'
                : task.status === 'REVIEWED' || task.status === 'APPROVED'
                  ? `Closed${task.reviewed_at ? ` ${timeAgo(task.reviewed_at)}` : ''}. Only a guide or admin can reopen it by sending it back.`
                  : 'The learner has not sent anything yet. You can still message them below.'}
          </p>
        </div>
      </div>

      <div className="fact-list" style={{ marginBottom: 14 }}>
        <div className="fact">
          <span>Learner</span>
          <strong>{task.learner_name}</strong>
        </div>
        <div className="fact">
          <span>Course</span>
          <strong>{task.course_title || 'General task'}</strong>
        </div>
        <div className="fact">
          <span>Given</span>
          <strong>{formatDateTime(task.assigned_at)}</strong>
        </div>
        <div className="fact">
          <span>Due</span>
          <strong>{task.due_date ? formatDateTime(task.due_date) : 'Not set'}</strong>
        </div>
        <div className="fact">
          <span>Sent</span>
          <strong>{task.submitted_at ? formatDateTime(task.submitted_at) : 'Not yet'}</strong>
        </div>
        <div className="fact">
          <span>Reviewed</span>
          <strong>{task.reviewed_at ? formatDateTime(task.reviewed_at) : 'Not yet'}</strong>
        </div>
        <div className="fact">
          <span>Learner email</span>
          <strong style={{ fontSize: 12 }}>{task.learner_email}</strong>
        </div>
        <div className="fact">
          <span>Track</span>
          <strong>{task.learner_track || '—'}</strong>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <h2>Brief</h2>
            </div>
            <p className="prose-block">{task.instructions || 'No instructions were written for this task.'}</p>
            {task.expected_criteria && (
              <>
                <div className="panel-head" style={{ marginTop: 16 }}>
                  <h2>What a correct answer covers</h2>
                </div>
                <p className="prose-block muted">{task.expected_criteria}</p>
              </>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Submission</h2>
              {task.submitted_at && <span className="section-note">{timeAgo(task.submitted_at)}</span>}
            </div>

            {(task.entries || []).length > 0 ? (
              <div className="work-stream">
                {(task.entries || []).map((entry: any) => (
                  <div key={entry.id} className={`work-item ${entry.kind === 'NOTE' ? 'note' : 'file'}`}>
                    <div className="work-item-head">
                      {entry.kind === 'NOTE' ? <MessageSquare size={13} /> : <FileText size={13} />}
                      <span>{entry.kind === 'NOTE' ? 'Note' : entry.kind === 'IMAGE' ? 'Photo' : 'File'}</span>
                      <small>{timeAgo(entry.created_at)}</small>
                    </div>

                    {entry.kind === 'NOTE' && <p className="work-note">{entry.body}</p>}

                    {entry.kind === 'IMAGE' && (
                      <button
                        type="button"
                        className="work-photo"
                        onClick={() => openStoredFile(entry.file_data, entry.file_name || 'photo', entry.file_mime)}
                        title="Open the full photo"
                      >
                        <img src={entry.file_data} alt={entry.file_name || 'Work the learner sent'} />
                      </button>
                    )}

                    {entry.kind === 'FILE' && (
                      <button
                        type="button"
                        className="work-file"
                        onClick={() => openStoredFile(entry.file_data, entry.file_name || 'file', entry.file_mime)}
                      >
                        <Paperclip size={13} />
                        <span>{entry.file_name || 'Attachment'}</span>
                        <small>Open</small>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="section-note">Nothing sent yet.</p>
            )}

          </section>

          {ai && (
            <section className="panel-card">
              <div className="panel-head">
                <h2>
                  <Sparkles size={13} /> AI pre-check
                </h2>
                <span className="section-note">Only the team sees this</span>
              </div>

              <div className="ai-verdict">
                <strong>{humanLabel(ai.verdict)}</strong>
                {typeof ai.accuracyScore === 'number' && <span>{ai.accuracyScore}% match</span>}
              </div>
              {ai.isCorrectSummary && <p className="prose-block" style={{ marginTop: 8 }}>{ai.isCorrectSummary}</p>}

              <div className="ai-two">
                {Array.isArray(ai.correctPoints) && ai.correctPoints.length > 0 && (
                  <div>
                    <h3>What they got right</h3>
                    <ul>
                      {ai.correctPoints.map((item: string, index: number) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(ai.issuesOrCorrections) && ai.issuesOrCorrections.length > 0 && (
                  <div>
                    <h3>What to check</h3>
                    <ul>
                      {ai.issuesOrCorrections.map((item: string, index: number) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {ai.suggestedAdminFeedback && (
                <button
                  type="button"
                  className="link-button"
                  style={{ marginTop: 12 }}
                  onClick={() => setFeedback(ai.suggestedAdminFeedback)}
                >
                  Use the suggested wording
                </button>
              )}
            </section>
          )}

          <section className="panel-card">
            <div className="panel-head">
              <h2>Your decision</h2>
              <span className="section-note">The learner sees this straight away</span>
            </div>

            <textarea
              className="form-textarea"
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Two sentences on what worked, one on what to change next time."
              aria-label="Review feedback"
            />
            {feedbackError && <p className="form-error">{feedbackError}</p>}

            <div className="page-head-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPending('approve')}
                disabled={busy || task.status === 'REVIEWED' || task.status === 'APPROVED' || !task.submitted_at}
              >
                <Check size={14} /> Mark completed
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPending('changes')}
                disabled={busy || task.status === 'REVIEWED' || task.status === 'APPROVED' || !task.submitted_at}
              >
                <Undo2 size={14} /> Send back for changes
              </button>
            </div>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="panel-head" style={{ padding: '12px 14px', margin: 0 }}>
              <h2>Chat with {task.learner_name.split(' ')[0]}</h2>
            </div>
            <div className="chat-bubbles task-chat" ref={chatRef}>
              {messages.length === 0 && <p className="section-note">No messages on this task yet.</p>}
              {messages.map((message) => {
                const mine = message.sender_role !== 'LEARNER';
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
                placeholder="Message the learner"
                aria-label="Message the learner"
              />
              <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
                <Send size={14} />
              </button>
            </form>
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Learner</h2>
            </div>
            <div className="list-row" style={{ paddingTop: 0 }}>
              <span className="pick-avatar">{initials(task.learner_name)}</span>
              <div className="list-row-main">
                <Link to={`/admin/learners/${task.learner_id}`} className="list-row-title">
                  {task.learner_name}
                </Link>
                <span className="list-row-sub">{task.learner_email}</span>
              </div>
            </div>
            <Link className="btn btn-secondary" style={{ marginTop: 10 }} to={`/admin/learners/${task.learner_id}`}>
              Open the learner file
            </Link>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending === 'approve' ? 'Mark this task complete?' : 'Send this back to the learner?'}
        message={
          pending === 'approve'
            ? 'The learner is notified, the task closes and any milestone step it unlocks opens.'
            : 'The learner is notified with your note, and can send the task again.'
        }
        confirmLabel={pending === 'approve' ? 'Mark completed' : 'Send back'}
        variant={pending === 'approve' ? 'primary' : 'danger'}
        busy={busy}
        onConfirm={review}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};
