import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Film,
  Link2,
  ListChecks,
  Lock,
  PlayCircle,
  Star
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime, youtubeEmbedUrl } from '../../utils/dates';

const kindLabel: Record<string, string> = {
  TEXT: 'Reading',
  VIDEO: 'Video',
  PDF: 'PDF',
  DOC: 'Word file',
  LINK: 'Link',
  TASK: 'Task'
};

const kindIcon = (kind: string) => {
  switch (kind) {
    case 'VIDEO':
      return <Film size={14} />;
    case 'PDF':
    case 'DOC':
      return <FileText size={14} />;
    case 'LINK':
      return <Link2 size={14} />;
    case 'TASK':
      return <ListChecks size={14} />;
    default:
      return <FileText size={14} />;
  }
};

export const CoursePlayerPage: React.FC = () => {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [answer, setAnswer] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/learner/courses/${courseId}`);
      if (!res.ok) {
        setError(res.status === 403 ? 'This course is not assigned to you.' : 'Could not open this course.');
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setActiveStepId((current) => {
        const existing = (json.steps || []).find((step: any) => step.id === current);
        if (existing) return current;
        const next = (json.steps || []).find((step: any) => step.unlocked && step.status !== 'COMPLETED');
        return next?.id || json.steps?.[json.steps.length - 1]?.id || null;
      });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const steps: any[] = data?.steps || [];
  const activeStep = useMemo(() => steps.find((step) => step.id === activeStepId) || null, [steps, activeStepId]);
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);

  useEffect(() => {
    setAnswer('');
    setFileName('');
    setFileData('');
    setSubmitError(null);
  }, [activeStepId]);

  const markComplete = async () => {
    if (!activeStep) return;
    setBusy(true);
    setBanner(null);
    const res = await authFetch(`/api/learner/courses/${courseId}/steps/${activeStep.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setBanner(json.error || 'Could not mark this step done.');
      return;
    }
    const nextStep = steps[activeIndex + 1];
    await load();
    setBanner(
      nextStep ? `Step done. ${nextStep.title} is open.` : 'Step done. Every step in this course is finished.'
    );
    if (nextStep) {
      setActiveStepId(nextStep.id);
      const panel = document.querySelector('.player-content');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('That file is over 5 MB. Upload a smaller one, or describe your work in the box.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFileName(file.name);
        setFileData(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const submitTaskStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStep) return;
    setBusy(true);
    setSubmitError(null);
    const res = await authFetch(`/api/learner/courses/${courseId}/steps/${activeStep.id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ submissionText: answer, uploadedFileName: fileName, uploadedFileData: fileData })
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setSubmitError(json.error || 'Could not send your work.');
      return;
    }
    setBanner('Sent to your mentor. You will get a notification when it is reviewed.');
    setAnswer('');
    setFileName('');
    setFileData('');
    load();
  };

  const downloadFile = async (stepId: string) => {
    const res = await authFetch(`/api/learner/course-steps/${stepId}/file`);
    if (!res.ok) return;
    const json = await res.json();
    const link = document.createElement('a');
    link.href = json.fileData;
    link.download = json.fileName || 'course-file';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (loading && !data) {
    return (
      <div className="workspace-shell">
        <div className="container-wide">
          <p className="admin-muted">Opening your course…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="workspace-shell">
        <div className="container-wide">
          <Link to="/dashboard/courses" className="back-link">
            <ArrowLeft size={15} /> My courses
          </Link>
          <div className="panel-card">
            <p className="admin-muted">{error || 'Course not found.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const embed = activeStep?.kind === 'VIDEO' ? youtubeEmbedUrl(activeStep.resource_url) : null;

  return (
    <div className="workspace-shell course-player-shell">
      <div className="container-wide">
        <Link to="/dashboard/courses" className="back-link">
          <ArrowLeft size={15} /> My courses
        </Link>

        <header className="player-head panel-card">
          <div>
            <span className="admin-page-eyebrow">Your course</span>
            <h1>{data.course.title}</h1>
            <p>{data.course.description}</p>
          </div>
          <div className="player-progress">
            <div className="player-progress-top">
              <strong>
                {data.completedCount} of {data.totalSteps} steps
              </strong>
              <span>{data.progressPct}%</span>
            </div>
            <div className="progress-track">
              <span style={{ width: `${data.progressPct}%` }} />
            </div>
            {data.enrollment?.custom_notes && <p className="player-note">Note from your mentor: {data.enrollment.custom_notes}</p>}
          </div>
        </header>

        {banner && <div className="governance-alert success">{banner}</div>}

        <div className="player-grid">
          <aside className="panel-card player-steps">
            <span className="micro-tag accent">Steps</span>
            <ol>
              {steps.map((step, index) => {
                const isActive = step.id === activeStepId;
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      className={`player-step ${isActive ? 'active' : ''} ${step.status === 'COMPLETED' ? 'done' : ''}`}
                      onClick={() => step.unlocked && setActiveStepId(step.id)}
                      disabled={!step.unlocked}
                      aria-current={isActive ? 'step' : undefined}
                    >
                      <span className={`player-step-icon ${step.status === 'COMPLETED' ? 'done' : !step.unlocked ? 'locked' : ''}`}>
                        {step.status === 'COMPLETED' ? (
                          <Check size={14} />
                        ) : !step.unlocked ? (
                          <Lock size={13} />
                        ) : (
                          String(index + 1).padStart(2, '0')
                        )}
                      </span>
                      <span className="player-step-text">
                        <strong>{step.title}</strong>
                        <small>
                          {kindLabel[step.kind] || step.kind}
                          {step.estimated_minutes ? ` · ${step.estimated_minutes} min` : ''}
                          {step.status === 'SUBMITTED' ? ' · in review' : ''}
                        </small>
                      </span>
                      {Boolean(step.is_milestone) && <Star size={13} className="player-star" />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <section className="panel-card player-content">
            {!activeStep && <p className="admin-muted">Pick a step to start.</p>}

            {activeStep && (
              <>
                <div className="player-content-head">
                  <span className="player-kind-chip">
                    {kindIcon(activeStep.kind)} {kindLabel[activeStep.kind] || activeStep.kind}
                  </span>
                  {Boolean(activeStep.is_milestone) && (
                    <span className="player-kind-chip milestone">
                      <Star size={12} /> Milestone
                    </span>
                  )}
                  <span className="admin-muted small">
                    Step {activeIndex + 1} of {steps.length}
                    {activeStep.estimated_minutes ? ` · about ${activeStep.estimated_minutes} min` : ''}
                  </span>
                </div>

                <h2>{activeStep.title}</h2>
                {activeStep.summary && <p className="player-lede">{activeStep.summary}</p>}

                {!activeStep.unlocked && (
                  <div className="player-locked">
                    <Lock size={20} />
                    <div>
                      <strong>This step is locked</strong>
                      <p>Finish step {activeIndex} first and it opens on its own.</p>
                    </div>
                  </div>
                )}

                {activeStep.unlocked && activeStep.kind === 'TEXT' && (
                  <div className="lesson-text">
                    {String(activeStep.content || '').split(/\n{2,}/).map((para, index) => (
                      <p key={index}>{para}</p>
                    ))}
                  </div>
                )}

                {activeStep.unlocked && activeStep.kind === 'VIDEO' && (
                  <div className="lesson-video">
                    {embed ? (
                      <div className="video-frame">
                        <iframe
                          src={embed}
                          title={activeStep.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <a className="lesson-link-card" href={activeStep.resource_url} target="_blank" rel="noreferrer">
                        <PlayCircle size={22} />
                        <span>
                          <strong>Open the video</strong>
                          <small>{activeStep.resource_url}</small>
                        </span>
                        <ExternalLink size={15} />
                      </a>
                    )}
                    {activeStep.content && <p className="lesson-note">{activeStep.content}</p>}
                  </div>
                )}

                {activeStep.unlocked && activeStep.kind === 'LINK' && (
                  <div className="lesson-link-wrap">
                    {activeStep.content && <p className="lesson-note">{activeStep.content}</p>}
                    <a className="lesson-link-card" href={activeStep.resource_url} target="_blank" rel="noreferrer">
                      <Link2 size={20} />
                      <span>
                        <strong>Open the link</strong>
                        <small>{activeStep.resource_url}</small>
                      </span>
                      <ExternalLink size={15} />
                    </a>
                  </div>
                )}

                {activeStep.unlocked && (activeStep.kind === 'PDF' || activeStep.kind === 'DOC') && (
                  <div className="lesson-file-wrap">
                    {activeStep.content && <p className="lesson-note">{activeStep.content}</p>}
                    {activeStep.hasFile ? (
                      <button type="button" className="lesson-file-card" onClick={() => downloadFile(activeStep.id)}>
                        <FileText size={22} />
                        <span>
                          <strong>{activeStep.file_name || 'Course file'}</strong>
                          <small>Download to open on your device</small>
                        </span>
                        <Download size={16} />
                      </button>
                    ) : (
                      <a className="lesson-link-card" href={activeStep.resource_url} target="_blank" rel="noreferrer">
                        <FileText size={20} />
                        <span>
                          <strong>Open the file</strong>
                          <small>{activeStep.resource_url}</small>
                        </span>
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>
                )}

                {activeStep.unlocked && activeStep.kind === 'TASK' && (
                  <div className="lesson-task">
                    <div className="lesson-brief">
                      <strong>What to do</strong>
                      <p>{activeStep.content}</p>
                      <span className="admin-muted small">
                        <Clock size={13} /> Send it within {activeStep.due_days} days of starting the step.
                      </span>
                    </div>

                    {activeStep.status === 'COMPLETED' && (
                      <div className="lesson-status done">
                        <CheckCircle2 size={18} />
                        <div>
                          <strong>Reviewed and done</strong>
                          <p>
                            Your mentor passed this milestone on {formatDateTime(activeStep.completed_at)}. The next
                            step is open.
                          </p>
                        </div>
                      </div>
                    )}

                    {activeStep.status === 'SUBMITTED' && (
                      <div className="lesson-status waiting">
                        <Clock size={18} />
                        <div>
                          <strong>Waiting for your mentor</strong>
                          <p>You sent your work. You will get a notification after the review.</p>
                        </div>
                      </div>
                    )}

                    {(activeStep.status === 'OPEN' || activeStep.status === 'IN_PROGRESS' || activeStep.status === 'LOCKED') && (
                      <form onSubmit={submitTaskStep} className="lesson-submit">
                        {submitError && <div className="governance-alert danger">{submitError}</div>}
                        <div className="form-group">
                          <label className="form-label" htmlFor="step-answer">
                            Your work *
                          </label>
                          <textarea
                            id="step-answer"
                            className="form-textarea"
                            rows={5}
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                            placeholder="Write what you did, what you found, and what you would change."
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="step-file">
                            Attach a screenshot or file
                          </label>
                          <input id="step-file" className="form-input" type="file" onChange={handleFile} />
                          {fileName && (
                            <p className="form-hint">
                              <Check size={13} /> {fileName}
                            </p>
                          )}
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={busy}>
                          {busy ? 'Sending…' : 'Send to your mentor'}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                <div className="player-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={activeIndex <= 0}
                    onClick={() => setActiveStepId(steps[activeIndex - 1]?.id || null)}
                  >
                    <ArrowLeft size={15} /> Previous
                  </button>

                  {activeStep.unlocked && activeStep.status !== 'COMPLETED' && activeStep.kind !== 'TASK' && (
                    <button type="button" className="btn btn-primary" onClick={markComplete} disabled={busy}>
                      {busy ? 'Saving…' : 'Mark this step done'} <Check size={15} />
                    </button>
                  )}

                  {activeStep.status === 'COMPLETED' && activeIndex < steps.length - 1 && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setActiveStepId(steps[activeIndex + 1]?.id || null)}
                    >
                      Next step <ArrowRight size={15} />
                    </button>
                  )}

                  {activeStep.status === 'COMPLETED' && activeIndex === steps.length - 1 && (
                    <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard/progress')}>
                      See your progress <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
