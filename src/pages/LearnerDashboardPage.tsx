import React, { useEffect, useState } from 'react';
import { BookOpen, ClipboardList, CheckCircle2, HelpCircle, BadgeCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type LearnerTabKey = 'courses_tasks' | 'uploaded_results' | 'pdp_and_evidence';

export const LearnerDashboardPage: React.FC = () => {
  const { user, authFetch, loginWithEmail } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<LearnerTabKey>('courses_tasks');

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

  // Practice submission form state
  const [practiceComp, setPracticeComp] = useState('COMP-PROC-01');
  const [practiceTitle, setPracticeTitle] = useState('');
  const [practiceScenario, setPracticeScenario] = useState('');
  const [practiceResponse, setPracticeResponse] = useState('');
  const [practiceStatus, setPracticeStatus] = useState<string | null>(null);

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
        '✓ Your task result and chart have been uploaded! You can view your uploaded result and chat with your mentor in the "Uploaded Results & Mentor Chat" tab.'
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

  const handlePracticeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!practiceTitle.trim() || !practiceResponse.trim()) return;
    setPracticeStatus('Saving practice artefact...');
    const res = await authFetch('/api/learner/practice', {
      method: 'POST',
      body: JSON.stringify({
        competencyCode: practiceComp,
        taskTitle: practiceTitle,
        scenarioContext: practiceScenario || 'Deliberate routine practice check',
        submittedResponse: practiceResponse
      })
    });
    if (res.ok) {
      setPracticeTitle('');
      setPracticeScenario('');
      setPracticeResponse('');
      setPracticeStatus('✓ Practice artefact saved with MEDIUM_PRACTICE evidence weight.');
      await loadDashboard();
    } else {
      setPracticeStatus('Could not save practice artefact.');
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
  const selectedTask = tasksList.find((t) => t.id === selectedTaskId) || tasksList[0] || null;

  return (
    <div className="workspace-shell">
      <div className="container-wide">
        {/* Learner Workspace Header */}
        <div className="dash-hero">
          <div className="dash-hero-tags">
            <span className="micro-tag accent">Student Workspace</span>
            <span className="micro-tag success">Level {profile?.approved_level || 'L1'}</span>
            {profile?.proposed_level && profile?.level_review_state === 'PENDING_GUIDE_REVIEW' && (
              <span className="micro-tag warn">Level {profile.proposed_level} pending review</span>
            )}
            {tasksList.filter((t) => t.status === 'SUBMITTED').length > 0 && (
              <span className="micro-tag">Awaiting mentor review: {tasksList.filter((t) => t.status === 'SUBMITTED').length}</span>
            )}
          </div>
          <h1>Welcome back, {data?.learner?.name?.split(' ')[0] || 'there'}</h1>
          <p>
            Here are your courses and tasks. Upload your work when you are done, and ask your mentor anything
            in the chat.
          </p>
        </div>

        <div className="dash-stats">
          <div className="dash-stat">
            <span className="dash-stat-icon"><BookOpen size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Assigned Courses</span>
              <span className="dash-stat-value">{assignedCourses.length}</span>
              <span className="dash-stat-hint">Built around your goals</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon amber"><ClipboardList size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Tasks In Progress</span>
              <span className="dash-stat-value">
                {tasksList.filter((t) => t.status !== 'REVIEWED' && t.status !== 'APPROVED').length}
              </span>
              <span className="dash-stat-hint">{tasksList.length} total assigned</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon green"><CheckCircle2 size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Submitted</span>
              <span className="dash-stat-value">{tasksList.filter((t) => t.learner_submission).length}</span>
              <span className="dash-stat-hint">Uploaded for review</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon slate"><HelpCircle size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Course Questions</span>
              <span className="dash-stat-value">
                {courseQuestions.filter((q) => q.lastAttempt).length}/{courseQuestions.length}
              </span>
              <span className="dash-stat-hint">Answered</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon rose"><BadgeCheck size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Evidence Status</span>
              <span className="dash-stat-value" style={{ fontSize: 16 }}>
                {suffEval?.evidenceStatus || profile?.evidence_status || 'SUFFICIENT'}
              </span>
              <span className="dash-stat-hint">Multi-source sufficiency</span>
            </div>
          </div>
        </div>

        {/* Flat Underline Student Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 24,
            borderBottom: '2px solid var(--border-subtle)',
            marginBottom: 24,
            overflowX: 'auto',
            background: '#FFFFFF',
            padding: '0 20px'
          }}
          role="tablist"
        >
          {[
            {
              key: 'courses_tasks',
              label: `My Custom Courses & Tasks (${assignedCourses.length} Courses · ${tasksList.length} Tasks)`
            },
            {
              key: 'uploaded_results',
              label: `Uploaded Results & Mentor Chat (${tasksList.filter((t) => t.learner_submission).length})`
            },
            {
              key: 'pdp_and_evidence',
              label: 'Development Plan (PDP), Reflections & Evidence'
            }
          ].map((tab) => {
            const isAct = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isAct}
                onClick={() => setActiveTab(tab.key as LearnerTabKey)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: isAct ? '3px solid var(--accent)' : '3px solid transparent',
                  borderRadius: 0,
                  padding: '14px 4px',
                  fontSize: 14,
                  fontWeight: isAct ? 700 : 500,
                  color: isAct ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  marginBottom: -2
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {taskUploadBanner && (
          <div className="governance-alert success" style={{ marginBottom: 20 }}>
            {taskUploadBanner}
          </div>
        )}

        {/* ===================================================================
            TAB 1: ASSIGNED CUSTOM COURSES & SOLVE / UPLOAD STUDENT TASKS
           =================================================================== */}
        {activeTab === 'courses_tasks' && (
          <div className="workspace-grid-2" style={{ alignItems: 'start' }}>
            {/* Left: Assigned Custom Courses */}
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent">Built Around You &middot; Custom Curriculum</span>
              <h3 style={{ fontSize: 20, margin: '6px 0 12px' }}>
                My Assigned Custom Courses ({assignedCourses.length})
              </h3>

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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
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
                        Mentor Note: {sc.custom_notes}
                      </div>
                    )}
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Course Modules:</div>
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
                            Course Questions set by your Admin ({qs.length}):
                          </div>
                          {qs.map((q: any, qi: number) => {
                            const live = courseResults[q.id];
                            const answered = Boolean(live) || Boolean(q.lastAttempt);
                            const correctIndex =
                              live?.correctOptionIndex ?? q.correctOptionIndex ?? q.lastAttempt?.selectedOptionIndex ?? 0;
                            const correctText =
                              live?.correctAnswer ?? (q.options || [])[correctIndex];
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
                                    Check Answer
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
                                      ? '✓ Correct!'
                                      : `✗ Not quite. Correct answer: ${String.fromCharCode(65 + Number(correctIndex))}. ${correctText}`}
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
            </div>

            {/* Right: Assigned Tasks & Upload Result Form */}
            <div className="panel-card" style={{ marginBottom: 0, border: '2px solid var(--accent)' }}>
              <span className="micro-tag accent">Practical Student Tasks</span>
              <h3 style={{ fontSize: 20, margin: '6px 0 8px' }}>
                Complete Task &amp; Upload Your Result
              </h3>
              <p style={{ fontSize: 13, marginBottom: 14 }}>
                Select an assigned task below, write your findings, and upload your chart/result for mentor review.
              </p>

              {/* Task Selector Buttons */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {tasksList.map((t: any) => {
                  const isSel = selectedTask?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`btn btn-sm ${isSel ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setSelectedTaskId(t.id)}
                    >
                      {t.title.slice(0, 34)}... ({t.status})
                    </button>
                  );
                })}
              </div>

              {selectedTask && (
                <form onSubmit={handleUploadTaskResult}>
                  <div
                    style={{
                      padding: 14,
                      background: 'var(--bg-canvas)',
                      borderRadius: 10,
                      border: '1px solid var(--border-subtle)',
                      marginBottom: 14
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong style={{ fontSize: 15 }}>{selectedTask.title}</strong>
                      <span
                        className={`status-pill ${
                          selectedTask.status === 'REVIEWED'
                            ? 'approved'
                            : selectedTask.status === 'SUBMITTED'
                              ? 'info'
                              : 'pending'
                        }`}
                      >
                        {selectedTask.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-line', color: 'var(--text-muted)' }}>
                      {selectedTask.instructions}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>
                      Your Answer / Analysis *
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 10px', fontSize: 11.5 }}
                      onClick={handleLoadSampleHeikinAshiSubmission}
                    >
                      ⚡ Auto-Fill Heikin-Ashi Answer
                    </button>
                  </div>

                  <div className="form-group">
                    <textarea
                      className="form-textarea"
                      rows={5}
                      placeholder="Write your findings, formula explanation, and chart observations..."
                      value={taskAnswerText}
                      onChange={(e) => setTaskAnswerText(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Upload Chart Screenshot / Result File (PNG, JPG, SVG)
                    </label>
                    <input
                      type="file"
                      accept="image/*,.svg"
                      className="form-input"
                      onChange={handleFileChange}
                    />
                    {uploadedFileName && (
                      <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                        Attached File: {uploadedFileName}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button type="submit" className="btn btn-primary">
                      Upload Result &amp; Submit Task &rarr;
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setActiveTab('uploaded_results')}
                    >
                      View Uploaded Result &amp; Chat With Mentor &rarr;
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 2: SEPARATE TAB FOR UPLOADED RESULTS, MENTOR REVIEW & DIRECT CHAT
           =================================================================== */}
        {activeTab === 'uploaded_results' && (
          <div className="workspace-sidebar-layout">
            {/* Left Sidebar: Student Tasks */}
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent">My Task Submissions</span>
              <h3 style={{ fontSize: 18, margin: '6px 0 12px' }}>Select Task to View Result &amp; Chat</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {tasksList.map((t: any) => {
                  const isSel = selectedTask?.id === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTaskId(t.id)}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        border: isSel ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                        background: isSel ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <strong style={{ fontSize: 13 }}>{t.title}</strong>
                      </div>
                      <span
                        className={`status-pill ${
                          t.status === 'REVIEWED'
                            ? 'approved'
                            : t.status === 'SUBMITTED'
                              ? 'info'
                              : 'pending'
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Uploaded Result Preview + Official Mentor Review + Direct Chat */}
            {selectedTask && (
              <div className="workspace-grid-2" style={{ alignItems: 'start' }}>
                <div className="panel-card" style={{ marginBottom: 0 }}>
                  <span className="micro-tag accent">Uploaded Result</span>
                  <h3 style={{ fontSize: 19, margin: '6px 0 10px' }}>{selectedTask.title}</h3>

                  {selectedTask.guide_feedback && (
                    <div
                      style={{
                        padding: 14,
                        background: 'var(--success-bg)',
                        border: '1px solid var(--success-border)',
                        borderRadius: 10,
                        color: 'var(--success-text)',
                        fontSize: 13.5,
                        marginBottom: 14
                      }}
                    >
                      <strong>✓ Official Mentor / Admin Review Feedback:</strong>
                      <div style={{ marginTop: 4 }}>{selectedTask.guide_feedback}</div>
                    </div>
                  )}

                  <div
                    style={{
                      padding: 14,
                      background: 'var(--bg-canvas)',
                      borderRadius: 10,
                      border: '1px solid var(--border-subtle)',
                      whiteSpace: 'pre-line',
                      fontSize: 13.5,
                      marginBottom: 14
                    }}
                  >
                    <strong>Your Submitted Answer:</strong>
                    <div style={{ marginTop: 6 }}>
                      {selectedTask.learner_submission || 'No result uploaded yet.'}
                    </div>
                  </div>

                  {selectedTask.uploaded_file_data && (
                    <div
                      style={{
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: '1px solid var(--border-subtle)',
                        background: '#0F172A',
                        padding: 8
                      }}
                    >
                      <img
                        src={selectedTask.uploaded_file_data}
                        alt={selectedTask.uploaded_file_name || 'Uploaded Chart'}
                        style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
                      />
                    </div>
                  )}
                </div>

                {/* Direct Chat With Admin / Mentor */}
                <div className="panel-card" style={{ marginBottom: 0 }}>
                  <span className="micro-tag accent">Direct Mentor &amp; Admin Chat</span>
                  <h3 style={{ fontSize: 19, margin: '6px 0 10px' }}>
                    Discuss This Task Result With Your Mentor
                  </h3>

                  <div
                    style={{
                      maxHeight: 320,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      padding: 12,
                      background: 'var(--bg-canvas)',
                      borderRadius: 10,
                      border: '1px solid var(--border-subtle)',
                      marginBottom: 12
                    }}
                  >
                    {(selectedTask.messages || []).map((m: any) => {
                      const isMe = m.sender_role === 'LEARNER';
                      return (
                        <div
                          key={m.id}
                          style={{
                            alignSelf: isMe ? 'flex-end' : 'flex-start',
                            maxWidth: '88%',
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: isMe ? 'var(--accent)' : '#FFFFFF',
                            color: isMe ? '#FFFFFF' : 'var(--text-main)',
                            border: isMe ? 'none' : '1px solid var(--border-subtle)',
                            fontSize: 13
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, marginBottom: 3 }}>
                            {m.sender_name} &middot; {new Date(m.created_at).toLocaleTimeString()}
                          </div>
                          <div>{m.message}</div>
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={handleSendStudentChat} style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input"
                      placeholder="Ask a question or reply to your mentor..."
                      value={studentChatText}
                      onChange={(e) => setStudentChatText(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary btn-sm">
                      Send
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 3: ACTIVE PDP, REFLECTIONS & MULTI-SOURCE EVIDENCE TIMELINE
           =================================================================== */}
        {activeTab === 'pdp_and_evidence' && (
          <>
            {pendingPDP && (
              <div className="governance-alert warn">
                <strong>Governance Rule Active (Requirement 10):</strong> A new candidate PDP revision (
                <strong>v{pendingPDP.version_number}.0, {pendingPDP.title}</strong>) is currently in{' '}
                <code>PENDING_GUIDE_REVIEW</code>. Your previously approved PDP (
                <strong>v{activePDP?.version_number || 1}.0</strong>) remains your active operating plan until your Learning Guide explicitly approves the revision.
              </div>
            )}

            <div className="workspace-grid-2">
              <div className="panel-card" style={{ border: '2px solid var(--success-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <span className="micro-tag success">ACTIVE APPROVED PDP &middot; v{activePDP?.version_number || 1}.0</span>
                  <span style={{ fontSize: 12, color: 'var(--text-light-muted)' }}>
                    Approved by Guide ({activePDP?.reviewed_by_guide_id || 'usr_guide_vikram'})
                  </span>
                </div>

                {activePDP ? (
                  <>
                    <h2 style={{ fontSize: 22, marginBottom: 8 }}>{activePDP.title}</h2>
                    <p style={{ fontSize: 14, marginBottom: 16 }}>{activePDP.summary}</p>
                    <div style={{ padding: 14, background: 'var(--bg-canvas)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', marginBottom: 4 }}>
                        Approved Practice Routine Cadence
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{activePDP.routine_schedule}</div>
                    </div>
                  </>
                ) : (
                  <p>No Approved PDP yet.</p>
                )}
              </div>

              <div className="panel-card">
                <span className="micro-tag accent">Post-Decision Reflection</span>
                <h3 style={{ fontSize: 19, margin: '6px 0 8px' }}>Log Structured Decision Reflection</h3>
                <form onSubmit={handleReflectionSubmit}>
                  <div className="form-group">
                    <label className="form-label">Reflection Title</label>
                    <input
                      className="form-input"
                      placeholder="e.g. Post-Session Process Check"
                      value={refTitle}
                      onChange={(e) => setRefTitle(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reflection Narrative</label>
                    <textarea
                      className="form-textarea"
                      placeholder="What did you observe about your process execution?"
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
                    Save Structured Reflection
                  </button>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
