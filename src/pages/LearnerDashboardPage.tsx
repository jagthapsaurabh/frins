import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen,
  ClipboardList,
  CheckCircle2,
  HelpCircle,
  BadgeCheck,
  TrendingUp,
  MessageSquare,
  ArrowRight,
  FileText
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type LearnerSection = 'overview' | 'courses' | 'tasks' | 'progress';

const SECTION_COPY: Record<LearnerSection, { title: string; blurb: string }> = {
  overview: { title: 'Overview', blurb: 'Where you are and what is waiting for you.' },
  courses: { title: 'My courses', blurb: 'The courses built for you, and the questions inside them.' },
  tasks: { title: 'Tasks and uploads', blurb: 'Your practical tasks, the work you sent, and the mentor chat.' },
  progress: { title: 'Progress', blurb: 'Your plan, reflections and the evidence behind your level.' }
};

export const LearnerDashboardPage: React.FC = () => {
  const { user, authFetch, loginWithEmail } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();
  const section: LearnerSection =
    params.section === 'courses' || params.section === 'tasks' || params.section === 'progress'
      ? params.section
      : 'overview';
  const unknownSection = Boolean(params.section) && section === 'overview';

  // Guest gate state
  const [guestEmail, setGuestEmail] = useState<string>('');
  const [guestPassword, setGuestPassword] = useState<string>('');
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState<boolean>(false);

  // Task Result Upload State
  const [selectedTaskId, setSelectedTaskId] = useState<string>('tsk_heikin_ashi_01');
  const [taskAnswerText, setTaskAnswerText] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedFileData, setUploadedFileData] = useState<string>('');
  const [taskUploadBanner, setTaskUploadBanner] = useState<string | null>(null);

  // Direct Chat on Task State
  const [studentChatText, setStudentChatText] = useState<string>('');

  // Course question answering state
  const [courseAnswers, setCourseAnswers] = useState<Record<string, number>>({});
  const [courseResults, setCourseResults] = useState<Record<string, any>>({});

  // Reflection form state
  const [refComp, setRefComp] = useState('COMP-EXEC-03');
  const [refTitle, setRefTitle] = useState('');
  const [refText, setRefText] = useState('');
  const [refTrigger, setRefTrigger] = useState('');
  const [refAdherence, setRefAdherence] = useState('4');
  const [refStatus, setRefStatus] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/learner/dashboard');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.tasks?.length > 0) {
          const ha = json.tasks.find((t: any) => t.id === 'tsk_heikin_ashi_01') || json.tasks[0];
          if (!selectedTaskId || !json.tasks.some((t: any) => t.id === selectedTaskId)) {
            setSelectedTaskId(ha.id);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [user]);

  useEffect(() => {
    if (unknownSection) navigate('/dashboard', { replace: true });
  }, [unknownSection, navigate]);

  useEffect(() => {
    if (!data?.tasks) return;
    const curr = data.tasks.find((t: any) => t.id === selectedTaskId);
    if (curr) {
      setTaskAnswerText(curr.learner_submission || '');
      setUploadedFileName(curr.uploaded_file_name || '');
      setUploadedFileData(curr.uploaded_file_data || '');
    }
  }, [selectedTaskId, data?.tasks]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadedFileData(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLoadSampleHeikinAshiSubmission = () => {
    setTaskAnswerText(
      '1. Heikin-Ashi Formula: HA Close = (Open + High + Low + Close) / 4 and HA Open = midpoint of prior HA candle body.\n' +
        '2. Strong Uptrend: Identified 5 consecutive green Heikin-Ashi candles with no lower wicks (zero lower shadows).\n' +
        '3. Reversal Signal: Marked the small-bodied Heikin-Ashi Doji with upper and lower shadows signaling momentum exhaustion before the bearish shift.\n' +
        '4. Execution Note: Since Heikin-Ashi values are synthetic averaged prices, my actual stop-loss order is placed using the real market price (LTP).'
    );
    setUploadedFileName('Heikin_Ashi_Chart_Upload.svg');
  };

  const handleUploadTaskResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskId || !taskAnswerText.trim()) return;
    setTaskUploadBanner('Uploading your task result...');
    const res = await authFetch(`/api/learner/tasks/${selectedTaskId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        submissionText: taskAnswerText.trim(),
        uploadedFileName: uploadedFileName || 'Student_Task_Result.svg',
        uploadedFileData: uploadedFileData || undefined
      })
    });
    if (res.ok) {
      setTaskUploadBanner(
        '✓ Task uploaded. Your mentor can see it now, and you can find it below with the chat.'
      );
      await loadDashboard();
    } else {
      const err = await res.json();
      setTaskUploadBanner(`⚠ ${err.error || 'Could not upload task result.'}`);
    }
  };

  const handleSendStudentChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentChatText.trim() || !selectedTaskId) return;
    const res = await authFetch(`/api/tasks/${selectedTaskId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: studentChatText.trim() })
    });
    if (res.ok) {
      setStudentChatText('');
      await loadDashboard();
    }
  };

  const handleAnswerCourseQuestion = async (questionId: string) => {
    const selectedOptionIndex = courseAnswers[questionId];
    if (selectedOptionIndex === undefined) return;
    const res = await authFetch(`/api/learner/course-questions/${questionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ selectedOptionIndex })
    });
    if (res.ok) {
      const out = await res.json();
      setCourseResults((prev) => ({ ...prev, [questionId]: out }));
      await loadDashboard();
    }
  };

  const handleReflectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refText.trim()) return;
    setRefStatus('Saving structured reflection...');
    const res = await authFetch('/api/learner/reflections', {
      method: 'POST',
      body: JSON.stringify({
        competencyCode: refComp,
        title: refTitle || 'Structured Post-Session Reflection',
        reflectionText: refText,
        emotionalStateTrigger: refTrigger || 'Session review',
        processAdherenceSelfRating: Number(refAdherence)
      })
    });
    if (res.ok) {
      setRefTitle('');
      setRefText('');
      setRefTrigger('');
      setRefStatus('✓ Structured reflection logged (LOW_REFLECTION weight. It cannot trigger a level promotion on its own).');
      await loadDashboard();
    } else {
      setRefStatus('Could not save reflection.');
    }
  };

  if (!user) {
    return (
      <div className="workspace-shell">
        <div className="container">
          <div className="panel-card" style={{ maxWidth: 520, margin: '0 auto' }}>
            <span className="micro-tag accent">Student Portal</span>
            <h2 style={{ fontSize: 24, margin: '10px 0 6px' }}>Student Login</h2>
            <p style={{ fontSize: 13.5, marginBottom: 16 }}>
              Sign in to see your courses, tasks and messages.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setGuestError(null);
                setGuestBusy(true);
                const res = await loginWithEmail(guestEmail.trim(), guestPassword);
                setGuestBusy(false);
                if (!res.ok) setGuestError(res.error || 'Could not sign in.');
              }}
            >
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  required
                />
              </div>
              {guestError && (
                <div style={{ color: 'var(--danger-text)', fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>
                  {guestError}
                </div>
              )}
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={guestBusy}>
                {guestBusy ? 'Signing in...' : 'Sign In to My Learning'}
              </button>
            </form>
            <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--text-muted)' }}>
              Don&rsquo;t have an account yet? <a href="/discovery">Start Discovery</a> or{' '}
              <a href="/">book a call</a> with our team.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="workspace-shell">
        <div className="container">
          <div className="panel-card">Loading Student Learning Profile, Courses &amp; Tasks...</div>
        </div>
      </div>
    );
  }

  const profile = data?.profile;
  const activePDP = data?.activeApprovedPDP;
  const pendingPDP = data?.pendingDraftPDP;
  const suffEval = data?.sufficiencyEvaluation;
  const assignedCourses: any[] = data?.assignedCourses || [];
  const courseQuestions: any[] = data?.courseQuestions || [];
  const tasksList: any[] = data?.tasks || [];
  const reflections: any[] = data?.reflections || [];
  const evidenceItems: any[] = data?.evidenceItems || [];
  const selectedTask = tasksList.find((t) => t.id === selectedTaskId) || tasksList[0] || null;

  const courseTitleFor = (task: any) =>
    assignedCourses.find((c: any) => c.course_id === task.course_id)?.course_title || 'General task';

  const todoTasks = tasksList.filter((t) => t.status !== 'REVIEWED' && t.status !== 'APPROVED');
  const reviewedCount = tasksList.filter((t) => t.status === 'REVIEWED' || t.status === 'APPROVED').length;
  const answeredQuestions = courseQuestions.filter((q) => Boolean(q.lastAttempt)).length;
  const latestFeedbackTask = tasksList.find((t) => Boolean(t.guide_feedback)) || null;
  const progressPct =
    tasksList.length === 0 ? 0 : Math.round((reviewedCount / tasksList.length) * 100);

  const statusClass = (status: string) =>
    status === 'REVIEWED' || status === 'APPROVED'
      ? 'approved'
      : status === 'SUBMITTED'
        ? 'info'
        : 'pending';

  return (
    <div className="workspace-shell">
      <div className="container-wide">
        {section !== 'overview' && (
          <header className="admin-page-head">
            <span className="admin-page-eyebrow">Student workspace</span>
            <h1>{SECTION_COPY[section].title}</h1>
            <p>{SECTION_COPY[section].blurb}</p>
          </header>
        )}

        {taskUploadBanner && (
          <div className="governance-alert success" style={{ marginBottom: 20 }}>
            {taskUploadBanner}
          </div>
        )}

        {/* =================== OVERVIEW =================== */}
        {section === 'overview' && (
          <>
            <div className="dash-hero">
              <div className="dash-hero-tags">
                <span className="micro-tag accent">Student workspace</span>
                <span className="micro-tag success">Level {profile?.approved_level || 'L1'}</span>
                {profile?.proposed_level && profile?.level_review_state === 'PENDING_GUIDE_REVIEW' && (
                  <span className="micro-tag warn">Level {profile.proposed_level} pending review</span>
                )}
                {tasksList.filter((t) => t.status === 'SUBMITTED').length > 0 && (
                  <span className="micro-tag">
                    Awaiting mentor review: {tasksList.filter((t) => t.status === 'SUBMITTED').length}
                  </span>
                )}
              </div>
              <h1>Welcome back, {data?.learner?.name?.split(' ')[0] || 'there'}</h1>
              <p>
                Your courses and tasks are here. Upload your work when it is done, and ask your mentor
                anything in the chat.
              </p>
            </div>

            <div className="dash-stats">
              <div className="dash-stat">
                <span className="dash-stat-icon"><BookOpen size={17} /></span>
                <div className="dash-stat-body">
                  <span className="dash-stat-label">My courses</span>
                  <span className="dash-stat-value">{assignedCourses.length}</span>
                  <span className="dash-stat-hint">Built around your goals</span>
                </div>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-icon amber"><ClipboardList size={17} /></span>
                <div className="dash-stat-body">
                  <span className="dash-stat-label">Tasks to do</span>
                  <span className="dash-stat-value">{todoTasks.length}</span>
                  <span className="dash-stat-hint">{tasksList.length} given in total</span>
                </div>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-icon green"><CheckCircle2 size={17} /></span>
                <div className="dash-stat-body">
                  <span className="dash-stat-label">Reviewed</span>
                  <span className="dash-stat-value">{reviewedCount}</span>
                  <span className="dash-stat-hint">Checked by your mentor</span>
                </div>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-icon slate"><HelpCircle size={17} /></span>
                <div className="dash-stat-body">
                  <span className="dash-stat-label">Course questions</span>
                  <span className="dash-stat-value">
                    {answeredQuestions}/{courseQuestions.length}
                  </span>
                  <span className="dash-stat-hint">Answered so far</span>
                </div>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-icon rose"><BadgeCheck size={17} /></span>
                <div className="dash-stat-body">
                  <span className="dash-stat-label">Evidence status</span>
                  <span className="dash-stat-value" style={{ fontSize: 16 }}>
                    {suffEval?.evidenceStatus || profile?.evidence_status || 'SUFFICIENT'}
                  </span>
                  <span className="dash-stat-hint">Multi-source sufficiency</span>
                </div>
              </div>
            </div>

            <div className="learner-overview-grid">
              <section className="panel-card">
                <span className="micro-tag accent">Next up</span>
                <h3 className="admin-card-title">What is waiting for you</h3>
                <p className="admin-card-copy">Open a task to write your answer and upload your chart.</p>

                {todoTasks.length === 0 ? (
                  <p className="admin-muted">Nothing is waiting. Everything assigned has been reviewed.</p>
                ) : (
                  <div className="learner-list">
                    {todoTasks.slice(0, 4).map((t: any) => (
                      <button
                        key={t.id}
                        type="button"
                        className="learner-list-row"
                        onClick={() => {
                          setSelectedTaskId(t.id);
                          navigate('/dashboard/tasks');
                        }}
                      >
                        <span className="learner-list-text">
                          <strong>{t.title}</strong>
                          <small>{courseTitleFor(t)} &middot; {t.status.toLowerCase()}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))}
                  </div>
                )}

                <button type="button" className="admin-link-button" onClick={() => navigate('/dashboard/tasks')}>
                  Go to tasks and uploads
                </button>
              </section>

              <section className="panel-card">
                <span className="micro-tag accent">My courses</span>
                <h3 className="admin-card-title">Courses you are on</h3>
                <p className="admin-card-copy">Each one comes with modules and questions set by your team.</p>

                {assignedCourses.length === 0 ? (
                  <p className="admin-muted">No course assigned yet. Your mentor will add one.</p>
                ) : (
                  <div className="learner-list">
                    {assignedCourses.slice(0, 4).map((sc: any) => {
                      const qs = courseQuestions.filter((q) => q.course_id === sc.course_id);
                      const done = qs.filter((q) => Boolean(q.lastAttempt)).length;
                      return (
                        <button
                          key={sc.id}
                          type="button"
                          className="learner-list-row"
                          onClick={() => navigate('/dashboard/courses')}
                        >
                          <span className="learner-list-text">
                            <strong>{sc.course_title}</strong>
                            <small>
                              {sc.course_level} &middot; {qs.length} question{qs.length === 1 ? '' : 's'}
                              {qs.length > 0 ? ` · ${done} answered` : ''}
                            </small>
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      );
                    })}
                  </div>
                )}

                <button type="button" className="admin-link-button" onClick={() => navigate('/dashboard/courses')}>
                  See all courses
                </button>
              </section>
            </div>

            {latestFeedbackTask && (
              <section className="panel-card" style={{ marginTop: 16 }}>
                <span className="micro-tag success">Latest mentor feedback</span>
                <h3 className="admin-card-title">{latestFeedbackTask.title}</h3>
                <p className="admin-card-copy">{latestFeedbackTask.guide_feedback}</p>
                <button type="button" className="admin-link-button" onClick={() => navigate('/dashboard/tasks')}>
                  Open the task
                </button>
              </section>
            )}

            <div className="learner-quick-grid">
              <button type="button" className="learner-quick" onClick={() => navigate('/dashboard/courses')}>
                <BookOpen size={18} />
                <strong>Courses</strong>
                <span>{assignedCourses.length} assigned</span>
              </button>
              <button type="button" className="learner-quick" onClick={() => navigate('/dashboard/tasks')}>
                <ClipboardList size={18} />
                <strong>Tasks &amp; uploads</strong>
                <span>{todoTasks.length} to do</span>
              </button>
              <button type="button" className="learner-quick" onClick={() => navigate('/dashboard/progress')}>
                <TrendingUp size={18} />
                <strong>Progress</strong>
                <span>{progressPct}% of tasks reviewed</span>
              </button>
            </div>
          </>
        )}

        {/* =================== COURSES =================== */}
        {section === 'courses' && (
          <div className="panel-card">
            <span className="micro-tag accent">Built around you</span>
            <h3 className="admin-card-title">My courses ({assignedCourses.length})</h3>
            <p className="admin-card-copy">
              Read the modules, then answer the questions. You get one attempt per question.
            </p>

            {assignedCourses.length === 0 ? (
              <p className="admin-muted">No course assigned yet. Your mentor will add one.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {assignedCourses.map((sc: any) => (
                  <div
                    key={sc.id}
                    style={{
                      padding: 16,
                      background: 'var(--bg-canvas)',
                      borderRadius: 12,
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 16 }}>{sc.course_title}</strong>
                      <span className="status-pill approved">{sc.course_level}</span>
                    </div>
                    <p style={{ fontSize: 13.5, marginBottom: 10 }}>{sc.course_description}</p>
                    {sc.custom_notes && (
                      <div
                        style={{
                          padding: '8px 12px',
                          background: 'var(--accent-soft)',
                          color: 'var(--accent)',
                          borderRadius: 8,
                          fontSize: 12.5,
                          fontWeight: 600,
                          marginBottom: 10
                        }}
                      >
                        Note from your mentor: {sc.custom_notes}
                      </div>
                    )}
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Course modules</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(sc.modules || []).map((m: string, idx: number) => (
                        <li key={idx}>{m}</li>
                      ))}
                    </ul>

                    {(() => {
                      const qs = courseQuestions.filter((q) => q.course_id === sc.course_id);
                      if (qs.length === 0) return null;
                      return (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                            Course questions ({qs.length})
                          </div>
                          {qs.map((q: any, qi: number) => {
                            const live = courseResults[q.id];
                            const answered = Boolean(live) || Boolean(q.lastAttempt);
                            const correctIndex =
                              live?.correctOptionIndex ?? q.correctOptionIndex ?? q.lastAttempt?.selectedOptionIndex ?? 0;
                            const correctText = live?.correctAnswer ?? (q.options || [])[correctIndex];
                            const selectedIndex = live
                              ? courseAnswers[q.id]
                              : q.lastAttempt?.selectedOptionIndex ?? courseAnswers[q.id];
                            const showExplanation = live?.explanation || q.explanation;
                            return (
                              <div
                                key={q.id}
                                style={{
                                  padding: 12,
                                  background: '#FFFFFF',
                                  borderRadius: 8,
                                  border: '1px solid var(--border-subtle)',
                                  marginBottom: 8,
                                  fontSize: 13
                                }}
                              >
                                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                                  {qi + 1}. {q.prompt}
                                </div>
                                {(q.options || []).map((opt: string, i: number) => (
                                  <label
                                    key={`${q.id}-${i}`}
                                    style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', cursor: answered ? 'default' : 'pointer' }}
                                  >
                                    <input
                                      type="radio"
                                      name={`cq-${q.id}`}
                                      checked={selectedIndex === i}
                                      disabled={answered}
                                      onChange={() => setCourseAnswers((prev) => ({ ...prev, [q.id]: i }))}
                                    />
                                    <span>
                                      {String.fromCharCode(65 + i)}. {opt}
                                    </span>
                                  </label>
                                ))}
                                {!answered && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ marginTop: 6 }}
                                    disabled={courseAnswers[q.id] === undefined}
                                    onClick={() => handleAnswerCourseQuestion(q.id)}
                                  >
                                    Check answer
                                  </button>
                                )}
                                {answered && (
                                  <div
                                    style={{
                                      marginTop: 8,
                                      padding: '8px 10px',
                                      borderRadius: 6,
                                      background: (live ? live.isCorrect : q.lastAttempt?.isCorrect) ? '#ECFDF5' : '#FEF2F2',
                                      color: (live ? live.isCorrect : q.lastAttempt?.isCorrect) ? '#047857' : '#B91C1C',
                                      fontWeight: 600
                                    }}
                                  >
                                    {(live ? live.isCorrect : q.lastAttempt?.isCorrect)
                                      ? 'Correct.'
                                      : `Not quite. Correct answer: ${String.fromCharCode(65 + Number(correctIndex))}. ${correctText}`}
                                    {showExplanation && (
                                      <div style={{ fontWeight: 400, marginTop: 4, color: 'var(--text-muted)' }}>
                                        {showExplanation}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =================== TASKS =================== */}
        {section === 'tasks' && (
          <div className="workspace-sidebar-layout">
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent">My tasks</span>
              <h3 className="admin-card-title">Pick a task</h3>
              {tasksList.length === 0 ? (
                <p className="admin-muted">No task assigned yet.</p>
              ) : (
                <div className="learner-task-list">
                  {tasksList.map((t: any) => {
                    const isSel = selectedTask?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`learner-task-item ${isSel ? 'active' : ''}`}
                        onClick={() => setSelectedTaskId(t.id)}
                      >
                        <span className="learner-task-text">
                          <strong>{t.title}</strong>
                          <small>{courseTitleFor(t)}</small>
                        </span>
                        <span className={`status-pill ${statusClass(t.status)}`}>{t.status}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedTask ? (
              <div className="learner-task-detail">
                <section className="panel-card" style={{ marginBottom: 0 }}>
                  <div className="learner-task-head">
                    <div>
                      <span className="micro-tag accent">Task</span>
                      <h3 className="admin-card-title">{selectedTask.title}</h3>
                      <p className="admin-card-copy">{courseTitleFor(selectedTask)}</p>
                    </div>
                    <span className={`status-pill ${statusClass(selectedTask.status)}`}>{selectedTask.status}</span>
                  </div>

                  <div className="learner-instructions">
                    <strong>What to do</strong>
                    <div>{selectedTask.instructions}</div>
                  </div>

                  {selectedTask.guide_feedback && (
                    <div className="learner-feedback">
                      <strong>Mentor feedback</strong>
                      <div>{selectedTask.guide_feedback}</div>
                    </div>
                  )}

                  {selectedTask.learner_submission && (
                    <div className="learner-submission">
                      <strong>What you sent</strong>
                      <div>{selectedTask.learner_submission}</div>
                      {selectedTask.uploaded_file_data && (
                        <div className="learner-file-preview">
                          <img
                            src={selectedTask.uploaded_file_data}
                            alt={selectedTask.uploaded_file_name || 'Uploaded chart'}
                          />
                        </div>
                      )}
                      {!selectedTask.uploaded_file_data && selectedTask.uploaded_file_name && (
                        <small>File attached: {selectedTask.uploaded_file_name}</small>
                      )}
                    </div>
                  )}

                  {selectedTask.status === 'REVIEWED' || selectedTask.status === 'APPROVED' ? (
                    <p className="admin-muted" style={{ marginTop: 14 }}>
                      This task is finished. Ask your mentor in the chat if you want to redo it.
                    </p>
                  ) : (
                    <form onSubmit={handleUploadTaskResult} style={{ marginTop: 16 }}>
                      <div className="learner-form-row">
                        <label className="form-label" style={{ marginBottom: 0 }}>
                          Your answer / analysis
                        </label>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 10px', fontSize: 11.5 }}
                          onClick={handleLoadSampleHeikinAshiSubmission}
                        >
                          Fill a sample answer
                        </button>
                      </div>

                      <div className="form-group">
                        <textarea
                          className="form-textarea"
                          rows={5}
                          placeholder="Write what you found, the formula you used, and what the chart shows."
                          value={taskAnswerText}
                          onChange={(e) => setTaskAnswerText(e.target.value)}
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Chart screenshot or result file</label>
                        <input type="file" accept="image/*,.svg" className="form-input" onChange={handleFileChange} />
                        {uploadedFileName && (
                          <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                            Attached: {uploadedFileName}
                          </div>
                        )}
                      </div>

                      <button type="submit" className="btn btn-primary">
                        Upload result &amp; submit
                      </button>
                    </form>
                  )}
                </section>

                <section className="panel-card" style={{ marginBottom: 0 }}>
                  <div className="learner-task-head">
                    <div>
                      <span className="micro-tag accent">
                        <MessageSquare size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                        Mentor chat
                      </span>
                      <h3 className="admin-card-title">Ask about this task</h3>
                    </div>
                  </div>

                  <div className="learner-chat">
                    {(selectedTask.messages || []).length === 0 && (
                      <p className="admin-muted">No messages yet. Ask a question below.</p>
                    )}
                    {(selectedTask.messages || []).map((m: any) => {
                      const isMe = m.sender_role === 'LEARNER';
                      return (
                        <div key={m.id} className={`learner-bubble ${isMe ? 'mine' : ''}`}>
                          <div className="learner-bubble-meta">
                            {m.sender_name} &middot; {new Date(m.created_at).toLocaleString()}
                          </div>
                          <div>{m.message}</div>
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={handleSendStudentChat} className="learner-chat-form">
                    <input
                      className="form-input"
                      placeholder="Write a message to your mentor"
                      value={studentChatText}
                      onChange={(e) => setStudentChatText(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary btn-sm">
                      Send
                    </button>
                  </form>
                </section>
              </div>
            ) : (
              <div className="panel-card">
                <p className="admin-muted">No task selected.</p>
              </div>
            )}
          </div>
        )}

        {/* =================== PROGRESS =================== */}
        {section === 'progress' && (
          <>
            {pendingPDP && (
              <div className="governance-alert warn">
                <strong>Waiting for your guide:</strong> a new plan (<strong>v{pendingPDP.version_number}.0, {pendingPDP.title}</strong>)
                is in review. Your approved plan (<strong>v{activePDP?.version_number || 1}.0</strong>) stays active
                until your Learning Guide approves the new one.
              </div>
            )}

            <div className="progress-stats" style={{ marginBottom: 16 }}>
              <div>
                <ClipboardList size={16} />
                <strong>{reviewedCount}/{tasksList.length}</strong>
                <span>Tasks reviewed</span>
              </div>
              <div>
                <FileText size={16} />
                <strong>{reflections.length}</strong>
                <span>Reflections logged</span>
              </div>
              <div>
                <BadgeCheck size={16} />
                <strong>{evidenceItems.length}</strong>
                <span>Evidence items</span>
              </div>
              <div>
                <TrendingUp size={16} />
                <strong>{progressPct}%</strong>
                <span>Overall task progress</span>
              </div>
            </div>

            <div className="workspace-grid-2">
              <div className="panel-card" style={{ border: '2px solid var(--success-border)', marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <span className="micro-tag success">Approved plan &middot; v{activePDP?.version_number || 1}.0</span>
                  <span style={{ fontSize: 12, color: 'var(--text-light-muted)' }}>
                    Approved by your guide
                  </span>
                </div>

                {activePDP ? (
                  <>
                    <h2 style={{ fontSize: 22, marginBottom: 8 }}>{activePDP.title}</h2>
                    <p style={{ fontSize: 14, marginBottom: 16 }}>{activePDP.summary}</p>
                    <div style={{ padding: 14, background: 'var(--bg-canvas)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', marginBottom: 4 }}>
                        Practice routine
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{activePDP.routine_schedule}</div>
                    </div>
                  </>
                ) : (
                  <p>No approved plan yet.</p>
                )}
              </div>

              <div className="panel-card" style={{ marginBottom: 0 }}>
                <span className="micro-tag accent">Reflection</span>
                <h3 className="admin-card-title">Log what you learned</h3>
                <p className="admin-card-copy">
                  Short and honest beats long. Your guide reads these before your next conversation.
                </p>
                <form onSubmit={handleReflectionSubmit}>
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <input
                      className="form-input"
                      placeholder="e.g. Post-session process check"
                      value={refTitle}
                      onChange={(e) => setRefTitle(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">What did you notice?</label>
                    <textarea
                      className="form-textarea"
                      placeholder="What did you do, and what would you change next time?"
                      value={refText}
                      onChange={(e) => setRefText(e.target.value)}
                      required
                    />
                  </div>
                  {refStatus && (
                    <div style={{ fontSize: 12.5, color: 'var(--accent)', marginBottom: 10, fontWeight: 600 }}>
                      {refStatus}
                    </div>
                  )}
                  <button type="submit" className="btn btn-secondary">
                    Save reflection
                  </button>
                </form>
              </div>
            </div>

            <section className="panel-card" style={{ marginTop: 16 }}>
              <span className="micro-tag accent">History</span>
              <h3 className="admin-card-title">Reflections you have logged ({reflections.length})</h3>
              {reflections.length === 0 ? (
                <p className="admin-muted">Nothing yet. The box above is a good start.</p>
              ) : (
                <div className="learner-list">
                  {reflections.slice(0, 8).map((r: any) => (
                    <div key={r.id} className="learner-reflect-row">
                      <strong>{r.title}</strong>
                      <small>{new Date(r.created_at).toLocaleDateString()} &middot; {r.evidence_weight.replaceAll('_', ' ').toLowerCase()}</small>
                      <p>{r.reflection_notes}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};
