import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  ImagePlus,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  Trash2,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PageHead, labelFor, toneFor } from '../../components/console/ConsoleUI';
import { formatDateTime, timeAgo } from '../../utils/dates';
import { MAX_FILES_PER_SEND, PreparedFile, formatBytes, openStoredFile, prepareFile } from '../../utils/files';

/**
 * One task, from the learner's side.
 *
 * The page answers three questions in order: what am I meant to do, where is my
 * work now, and what did my guide say. Sending work is one clear act, labelled
 * the way the team talks about it. The learner can send as many times as the
 * guide asks; only the guide can mark the task complete.
 */
export const LearnerTaskPage: React.FC = () => {
  const { taskId = '' } = useParams();
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [note, setNote] = useState('');
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const workRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/learner/dashboard');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not open this task.');
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not open this task.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const node = chatRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [data?.tasks]);

  useEffect(() => {
    const node = workRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [data?.tasks, files.length]);

  const task = (data?.tasks || []).find((row: any) => row.id === taskId);
  const course = (data?.assignedCourses || []).find((row: any) => row.course_id === task?.course_id);

  const pickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    setSendError(null);
    const room = MAX_FILES_PER_SEND - files.length;
    if (picked.length > room) {
      setSendError(`You can attach ${MAX_FILES_PER_SEND} files at a time. ${room > 0 ? `Room for ${room} more.` : ''}`);
    }
    setPreparing(true);
    const prepared: PreparedFile[] = [];
    for (const file of picked.slice(0, Math.max(0, room))) {
      try {
        prepared.push(await prepareFile(file));
      } catch (err: any) {
        setSendError(err?.message || 'That file could not be read.');
      }
    }
    setFiles((current) => [...current, ...prepared]);
    setPreparing(false);
  };

  const askToSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() && files.length === 0) {
      setSendError('Write something or attach a file first.');
      return;
    }
    setSendError(null);
    setConfirmSend(true);
  };

  const sendWork = async () => {
    if (!task) return;
    setBusy(true);
    setSendError(null);
    const res = await authFetch(`/api/learner/tasks/${task.id}/entries`, {
      method: 'POST',
      body: JSON.stringify({
        text: note.trim(),
        files: files.map((file) => ({ name: file.name, mime: file.mime, data: file.data }))
      })
    });
    setBusy(false);
    setConfirmSend(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setSendError(json.error || 'Could not send your work.');
      return;
    }
    setNote('');
    setFiles([]);
    setBanner('Sent. Your guide will read it and mark it complete or send it back with notes.');
    await load();
  };

  const removeEntry = async (entryId: string) => {
    if (!task) return;
    const res = await authFetch(`/api/learner/tasks/${task.id}/entries/${entryId}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setSendError(json.error || 'Could not remove that.');
      return;
    }
    load();
  };

  const sendChat = async (e: React.FormEvent) => {
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
  const entries: any[] = task.entries || [];
  const sent = entries.filter((entry) => entry.kind === 'NOTE' || entry.kind === 'IMAGE' || entry.kind === 'FILE');
  const complete = ['REVIEWED', 'APPROVED'].includes(task.status);
  const sentBack = task.status === 'CHANGES_REQUESTED';
  const waiting = task.status === 'SUBMITTED';
  const hasSent = entries.length > 0;

  const state = complete
    ? {
        tone: 'approved',
        icon: <CheckCircle2 size={15} />,
        title: 'Completed by your guide',
        body: task.reviewed_at
          ? `Your guide marked this complete ${timeAgo(task.reviewed_at)}. Nothing else is needed.`
          : 'Your guide marked this complete. Nothing else is needed.'
      }
    : sentBack
      ? {
          tone: 'danger',
          icon: <AlertCircle size={15} />,
          title: 'Your guide asked for changes',
          body: 'Read their note, update your work and send it again. The task stays open until your guide is happy with it.'
        }
      : waiting
        ? {
            tone: 'warn',
            icon: <Clock size={15} />,
            title: 'With your guide',
            body: `You sent this ${task.submitted_at ? timeAgo(task.submitted_at) : 'recently'}. Your guide reads it, then marks it complete or sends it back with notes. You can still add more work below.`
          }
        : {
            tone: 'info',
            icon: <FileText size={15} />,
            title: 'To do',
            body: 'Read the brief, do the work and send it when you are ready. Your guide reviews everything before it counts as complete.'
          };

  const stepState = (step: 1 | 2 | 3) => {
    if (step === 1) return hasSent ? 'done' : 'current';
    if (step === 2) return task.submitted_at && !sentBack ? 'done' : 'current';
    return complete ? 'done' : waiting || sentBack ? 'current' : '';
  };

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

      <div className={`state-card ${state.tone}`}>
        <span className="state-icon">{state.icon}</span>
        <div>
          <strong>{state.title}</strong>
          <p>{state.body}</p>
        </div>
      </div>

      <div className="review-steps">
        <div className={`review-step ${stepState(1)}`}>
          <span className="step-dot">{hasSent ? '✓' : '1'}</span>
          <div>
            <strong>Do the work</strong>
            <span className="step-hint">Notes, photos and PDFs go below.</span>
          </div>
        </div>
        <div className={`review-step ${stepState(2)}`}>
          <span className="step-dot">{task.submitted_at ? '✓' : '2'}</span>
          <div>
            <strong>Complete and send</strong>
            <span className="step-hint">It lands in your guide's queue.</span>
          </div>
        </div>
        <div className={`review-step ${stepState(3)}`}>
          <span className="step-dot">{complete ? '✓' : '3'}</span>
          <div>
            <strong>Guide marks it complete</strong>
            <span className="step-hint">Only your guide can close it.</span>
          </div>
        </div>
      </div>

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
          <span>Your guide</span>
          <strong>{data?.assignedGuide?.name || data?.learner?.guide_name || 'Your guide'}</strong>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <h2>What to do</h2>
            </div>
            <p className="prose-block">{task.instructions || 'No instructions were added.'}</p>

            {task.expected_criteria && (
              <>
                <div className="panel-head" style={{ marginTop: 16 }}>
                  <h2>What a complete answer covers</h2>
                </div>
                <p className="prose-block muted">{task.expected_criteria}</p>
              </>
            )}
          </section>

          {task.guide_feedback && (
            <section className={`panel-card decision-card ${sentBack ? 'sent-back' : ''}`}>
              <div className="panel-head">
                <h2>{sentBack ? 'Changes your guide asked for' : 'Your guide\u2019s note'}</h2>
                {task.reviewed_at && <span className="section-note">{timeAgo(task.reviewed_at)}</span>}
              </div>
              <p className="decision-quote">{task.guide_feedback}</p>
              {sentBack && (
                <p className="section-note" style={{ marginTop: 10 }}>
                  Make the changes, then send the task again below.
                </p>
              )}
            </section>
          )}

          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Your work</h2>
                <p>
                  {complete
                    ? 'Everything you sent, kept together.'
                    : 'Send as many notes, photos and PDFs as the task needs. Sending again puts it back in your guide\u2019s queue.'}
                </p>
              </div>
              {task.submitted_at && <span className="section-note">Sent {timeAgo(task.submitted_at)}</span>}
            </div>

            {sent.length > 0 ? (
              <div className="work-stream" ref={workRef}>
                {sent.map((entry) => (
                  <div key={entry.id} className={`work-item ${entry.kind === 'NOTE' ? 'note' : 'file'}`}>
                    <div className="work-item-head">
                      {entry.kind === 'NOTE' ? <MessageSquare size={13} /> : <FileText size={13} />}
                      <span>{entry.kind === 'NOTE' ? 'Note' : entry.kind === 'IMAGE' ? 'Photo' : 'File'}</span>
                      <small>{timeAgo(entry.created_at)}</small>
                      {!complete && (
                        <button
                          type="button"
                          className="icon-quiet"
                          title="Remove"
                          onClick={() => removeEntry(entry.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>

                    {entry.kind === 'NOTE' && <p className="work-note">{entry.body}</p>}

                    {entry.kind === 'IMAGE' && (
                      <button
                        type="button"
                        className="work-photo"
                        onClick={() => openStoredFile(entry.file_data, entry.file_name || 'photo', entry.file_mime)}
                        title="Open the full photo"
                      >
                        <img src={entry.file_data} alt={entry.file_name || 'Work you sent'} />
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
              <p className="section-note" style={{ marginBottom: 12 }}>
                Nothing sent yet. Your guide sees everything you add here.
              </p>
            )}

            {complete ? (
              <p className="section-note" style={{ marginTop: 10 }}>
                This task is closed. Send your guide a message if something still needs to change.
              </p>
            ) : (
              <form className="work-composer" onSubmit={askToSend}>
                <textarea
                  className="form-textarea"
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write what you did, what the chart shows, or what you are unsure about."
                  aria-label="Your note"
                />

                {files.length > 0 && (
                  <div className="work-pending">
                    {files.map((file, index) => (
                      <span key={`${file.name}-${index}`} className="work-pending-item">
                        {file.mime.startsWith('image/') ? (
                          <img src={file.data} alt="" />
                        ) : (
                          <FileText size={13} />
                        )}
                        <span className="work-pending-name">{file.name}</span>
                        <small>{formatBytes(file.size)}</small>
                        <button
                          type="button"
                          className="icon-quiet"
                          onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {sendError && <p className="form-error">{sendError}</p>}

                <div className="work-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => fileInput.current?.click()}
                    disabled={preparing || files.length >= MAX_FILES_PER_SEND}
                  >
                    {preparing ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />}
                    {preparing ? 'Reading' : 'Add photos or PDFs'}
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,.txt"
                    multiple
                    onChange={pickFiles}
                    hidden
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy || preparing}>
                    {busy ? 'Sending' : 'Complete task and send for review'} <Send size={14} />
                  </button>
                </div>
                <p className="form-hint">
                  Up to {MAX_FILES_PER_SEND} files at once, 8 MB each. Your guide marks the task complete.
                </p>
              </form>
            )}
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="panel-head" style={{ padding: '12px 14px', margin: 0 }}>
              <h2>Message your guide</h2>
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
            <form className="chat-composer" onSubmit={sendChat}>
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

          <section className="panel-card">
            <div className="panel-head">
              <h2>How review works</h2>
            </div>
            <ul className="capability-list">
              <li>You send the work whenever you are ready.</li>
              <li>Your guide reads it and either marks it complete or sends it back with notes.</li>
              <li>If it comes back, update it and send again. It stays open until your guide is satisfied.</li>
              <li>Only your guide can mark a task complete.</li>
            </ul>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSend}
        title="Send this task for review?"
        message={
          <>
            Your guide will read everything in <strong>Your work</strong> and either mark the task complete
            or send it back with notes.
          </>
        }
        confirmLabel="Send for review"
        busy={busy}
        onConfirm={sendWork}
        onCancel={() => setConfirmSend(false)}
      />
    </div>
  );
};
