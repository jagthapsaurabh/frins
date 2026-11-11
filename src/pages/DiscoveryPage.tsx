import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PublicSiteHeader, PublicSiteFooter } from './PublicWebsitePage';

interface DiscoveryOption {
  value: string;
  label: string;
}

interface DiscoveryQuestion {
  id: string;
  number: number;
  domain: string;
  domainTitle: string;
  prompt: string;
  inputType: 'single_choice' | 'text';
  options?: DiscoveryOption[];
}

interface CandidateResultPillar {
  domain: string;
  title: string;
  score: number;
  status: 'STRONG' | 'DEVELOPING' | 'PRIORITY_FOCUS';
}

interface CandidateDiscoveryResult {
  answeredCount: number;
  totalConfiguredQuestions: number;
  readinessScore: number;
  readinessLabel: string;
  recommendedTrack: string;
  recommendedStartingLevel: string;
  headline: string;
  summary: string;
  strengths: string[];
  focusAreasForTeam: string[];
  pillarScores: CandidateResultPillar[];
  nextStepRecommendation: string;
}

export const DiscoveryPage: React.FC<{ onOpenSignIn?: () => void }> = ({ onOpenSignIn }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [questions, setQuestions] = useState<DiscoveryQuestion[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [participantName, setParticipantName] = useState<string>(user?.name || '');
  const [participantEmail, setParticipantEmail] = useState<string>(user?.email || '');
  const trackFromLink = searchParams.get('track');
  const [track, setTrack] = useState<'student_concepts' | 'strategy_learner' | 'trader' | 'investor' | 'both' | 'other'>(
    (['student_concepts', 'strategy_learner', 'trader', 'investor', 'both', 'other'].includes(trackFromLink || '')
      ? trackFromLink
      : (user?.track as any)) || 'student_concepts'
  );
  const [customTrack, setCustomTrack] = useState<string>('');
  const [experienceYears, setExperienceYears] = useState<string>('under_1y');
  const [primaryChallenge, setPrimaryChallenge] = useState<string>('');

  // Step 1 = Basic Details, Step 2 = Active Questions, Step 3 = Discovery Result + Book a Call
  const [basicDetailsCompleted, setBasicDetailsCompleted] = useState<boolean>(false);
  const [basicDetailsSubmitting, setBasicDetailsSubmitting] = useState<boolean>(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [saving, setSaving] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [synthesizing, setSynthesizing] = useState<boolean>(false);
  const [synthesisResult, setSynthesisResult] = useState<any | null>(null);
  const [candidateResult, setCandidateResult] = useState<CandidateDiscoveryResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Call Booking Form State
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [callPhone, setCallPhone] = useState<string>('+91 ');
  const [callDate, setCallDate] = useState<string>(tomorrowIso);
  const [callSlot, setCallSlot] = useState<string>('11:30 AM IST');
  const [callNotes, setCallNotes] = useState<string>('');
  const [bookingCall, setBookingCall] = useState<boolean>(false);
  const [bookedCallInfo, setBookedCallInfo] = useState<any | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const qRes = await fetch('/api/discovery/questions');
        const qData = await qRes.json();
        if (qData.success) {
          setQuestions(qData.questions);
        }

        const querySession = searchParams.get('session');
        const savedSessionId =
          querySession || sessionStorage.getItem('frins_active_discovery_session');

        if (savedSessionId) {
          const sRes = await fetch(`/api/discovery/${savedSessionId}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData.success && sData.session) {
              setSessionId(sData.session.id);
              setParticipantName(sData.session.participantName || user?.name || '');
              setParticipantEmail(sData.session.participantEmail || user?.email || '');
              setTrack(sData.session.track || 'trader');
              setCustomTrack(sData.session.custom_track || '');
              setAnswers(sData.session.answers || {});
              if (sData.session.participantName && sData.session.participantEmail) {
                setBasicDetailsCompleted(true);
              }
              if (sData.candidateResult) {
                setCandidateResult(sData.candidateResult);
              }
              if (sData.callBooking) {
                setBookedCallInfo(sData.callBooking);
              }
              if (sData.session.status === 'COMPLETED' && sData.aiRun) {
                setSynthesisResult(sData);
              }
              setLoading(false);
              return;
            }
          }
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to load Discovery questions.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [user?.id, searchParams]);

  const handleBasicDetailsGateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!participantName.trim() || !participantEmail.trim()) {
      setErrorMsg('Please enter your Full Name and Email Address before starting Discovery.');
      return;
    }
    if (track === 'other' && customTrack.trim().length < 3) {
      setErrorMsg('Tell us what describes you best, in a few words, so we can build the right course for you.');
      return;
    }
    setBasicDetailsSubmitting(true);
    setErrorMsg(null);
    try {
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: participantName.trim(),
          email: participantEmail.trim(),
          track,
          customTrack: track === 'other' ? customTrack.trim() : '',
          context: primaryChallenge.trim() || `Experience: ${experienceYears}`
        })
      });

      const startRes = await fetch('/api/discovery/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          participantName: participantName.trim(),
          participantEmail: participantEmail.trim(),
          track,
          customTrack: track === 'other' ? customTrack.trim() : ''
        })
      });
      const startData = await startRes.json();
      if (startData.success && startData.session) {
        const newSessionId = startData.session.id;
        setSessionId(newSessionId);
        sessionStorage.setItem('frins_active_discovery_session', newSessionId);

        const initialBatch: Record<string, string> = {};
        // Pre-populate matching canonical IDs if they are part of the active question set
        const canonicalOrientation =
          track === 'trader' || track === 'investor' || track === 'both'
            ? track
            : track === 'student_concepts' || track === 'strategy_learner'
              ? 'exploring'
              : '';
        if (canonicalOrientation && questions.some((q) => q.id === 'Q01')) {
          initialBatch.Q01 = canonicalOrientation;
        }
        if (questions.some((q) => q.id === 'Q03')) initialBatch.Q03 = experienceYears;
        if (primaryChallenge.trim() && questions.some((q) => q.id === 'Q33')) {
          initialBatch.Q33 = primaryChallenge.trim();
        }

        if (Object.keys(initialBatch).length > 0) {
          const ansRes = await fetch('/api/discovery/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: newSessionId,
              answersBatch: initialBatch
            })
          });
          const ansData = await ansRes.json();
          if (ansData.success) {
            setAnswers(ansData.answers || initialBatch);
            if (ansData.candidateResult) {
              setCandidateResult(ansData.candidateResult);
            }
          }
        }
        setBasicDetailsCompleted(true);
        setCurrentIndex(0);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not save basic details.');
    } finally {
      setBasicDetailsSubmitting(false);
    }
  };

  const handleSelectAnswer = async (questionId: string, value: string) => {
    const nextAnswers = { ...answers, [questionId]: value };
    setAnswers(nextAnswers);
    if (!sessionId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/discovery/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          questionId,
          answer: value
        })
      });
      const data = await res.json();
      if (data.candidateResult) {
        setCandidateResult(data.candidateResult);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLoadPersona = async (personaKey: 'trader' | 'investor' | 'no_concern') => {
    if (!sessionId) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/discovery/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          personaPreset: personaKey
        })
      });
      const data = await res.json();
      if (data.success) {
        setAnswers(data.answers);
        if (data.candidateResult) {
          setCandidateResult(data.candidateResult);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to populate sample answers');
    } finally {
      setSaving(false);
    }
  };

  const handleRunSynthesis = async () => {
    if (!sessionId) return;
    setSynthesizing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/discovery/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          userId: user?.id
        })
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.error || 'Failed to generate your Discovery result.');
      } else {
        setSynthesisResult(data);
        if (data.candidateResult) {
          setCandidateResult(data.candidateResult);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error while generating your Discovery result.');
    } finally {
      setSynthesizing(false);
    }
  };

  const handleBookCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;
    setBookingCall(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/discovery/${sessionId}/book-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantName,
          participantEmail,
          phone: callPhone.trim(),
          preferredDate: callDate,
          preferredTimeSlot: callSlot,
          notes: callNotes.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setBookedCallInfo(data.booking);
        if (data.candidateResult) {
          setCandidateResult(data.candidateResult);
        }
      } else {
        setErrorMsg(data.error || 'Could not complete call booking.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error while booking call.');
    } finally {
      setBookingCall(false);
    }
  };

  const handleStartFreshSession = () => {
    sessionStorage.removeItem('frins_active_discovery_session');
    setSessionId('');
    setAnswers({});
    setSynthesisResult(null);
    setCandidateResult(null);
    setBookedCallInfo(null);
    setBasicDetailsCompleted(false);
    setCurrentIndex(0);
  };

  const currentQuestion = questions[currentIndex];
  const answeredCount = questions.filter(
    (q) => answers[q.id] !== undefined && String(answers[q.id]).trim() !== ''
  ).length;
  const totalQuestionsCount = questions.length || 1;
  const progressPct = Math.round((answeredCount / totalQuestionsCount) * 100);

  const domainGroups = Array.from(new Set(questions.map((q) => q.domain)));

  if (loading) {
    return (
      <div className="public-page-shell">
        <PublicSiteHeader onOpenSignIn={onOpenSignIn} />
        <div className="workspace-container">
          <div className="panel-card">Loading FRINS Guided Discovery...</div>
        </div>
        <PublicSiteFooter />
      </div>
    );
  }

  const displayResult: CandidateDiscoveryResult | null =
    synthesisResult?.candidateResult || candidateResult;

  return (
    <div className="public-page-shell">
      <PublicSiteHeader onOpenSignIn={onOpenSignIn} />

      <div className="workspace-container" style={{ flex: 1 }}>
        {/* Step Progress Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 24,
            padding: '16px 24px',
            background: '#FFFFFF',
            borderRadius: 16,
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: basicDetailsCompleted ? 'var(--success-text)' : 'var(--accent)',
                  color: '#FFF',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700
                }}
              >
                {basicDetailsCompleted ? '✓' : '1'}
              </span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Step 1: Basic Details</span>
            </div>

            <span style={{ color: 'var(--border-focus)' }}>&rarr;</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: synthesisResult
                    ? 'var(--success-text)'
                    : basicDetailsCompleted
                      ? 'var(--accent)'
                      : 'var(--bg-canvas-subtle)',
                  color: basicDetailsCompleted || synthesisResult ? '#FFF' : 'var(--text-light-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700
                }}
              >
                {synthesisResult ? '✓' : '2'}
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: basicDetailsCompleted ? 'var(--text-main)' : 'var(--text-light-muted)'
                }}
              >
                Step 2: Discovery Questions ({questions.length} Questions)
              </span>
            </div>

            <span style={{ color: 'var(--border-focus)' }}>&rarr;</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: bookedCallInfo
                    ? 'var(--success-text)'
                    : synthesisResult
                      ? 'var(--accent)'
                      : 'var(--bg-canvas-subtle)',
                  color: synthesisResult || bookedCallInfo ? '#FFF' : 'var(--text-light-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700
                }}
              >
                {bookedCallInfo ? '✓' : '3'}
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: synthesisResult ? 'var(--text-main)' : 'var(--text-light-muted)'
                }}
              >
                Step 3: Your result and a call with our team
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER') && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/admin')}
              >
                Configure Question Count (N={questions.length}) &rarr;
              </button>
            )}
            {basicDetailsCompleted && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleStartFreshSession}
              >
                Start New Session
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div
            className="panel-card"
            style={{
              background: 'var(--danger-bg)',
              borderColor: 'var(--danger-border)',
              color: 'var(--danger-text)'
            }}
          >
            <strong>Notice:</strong> {errorMsg}
          </div>
        )}

        {/* ===================================================================
            STEP 1: BASIC DETAILS GATE
           =================================================================== */}
        {!basicDetailsCompleted ? (
          <div className="workspace-grid-2" style={{ alignItems: 'start' }}>
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent" style={{ marginBottom: 12 }}>
                Step 1 of 3
              </span>
              <h2 style={{ fontSize: 'clamp(1.6rem, 2.5vw, 2.15rem)', marginBottom: 12 }}>
                First, a few details about you
              </h2>
              <p style={{ marginBottom: 24, fontSize: 15 }}>
                Fill this in and the questions open. Answer them and you get your result straight away, plus the option to book a call with our team.
              </p>

              <form
                onSubmit={handleBasicDetailsGateSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <div className="form-group">
                  <label className="form-label" htmlFor="discName">
                    Full Name *
                  </label>
                  <input
                    id="discName"
                    type="text"
                    className="form-input"
                    placeholder="Enter your full name"
                    value={participantName}
                    onChange={(e) => setParticipantName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="discEmail">
                    Email Address *
                  </label>
                  <input
                    id="discEmail"
                    type="email"
                    className="form-input"
                    placeholder="you@example.com"
                    value={participantEmail}
                    onChange={(e) => setParticipantEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="workspace-grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="discTrack">
                      Who You Are / Learning Focus *
                    </label>
                    <select
                      id="discTrack"
                      className="form-select"
                      value={track}
                      onChange={(e) => setTrack(e.target.value as any)}
                    >
                      <option value="student_concepts">Student / Beginner Learning Market Concepts</option>
                      <option value="strategy_learner">Working on / Understanding Market Strategies</option>
                      <option value="trader">Active Trader (Intraday / Swing)</option>
                      <option value="investor">Long-Term Investor</option>
                      <option value="both">Exploring Concepts, Strategies &amp; Investing</option>
                      <option value="other">Other (I&rsquo;ll describe it myself)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="discExp">
                      Current Experience Level *
                    </label>
                    <select
                      id="discExp"
                      className="form-select"
                      value={experienceYears}
                      onChange={(e) => setExperienceYears(e.target.value)}
                    >
                      <option value="under_1y">Complete Beginner / Less than 1 year</option>
                      <option value="1_to_3y">1 to 3 years</option>
                      <option value="3_to_7y">3 to 7 years</option>
                      <option value="over_7y">More than 7 years</option>
                    </select>
                  </div>
                </div>

                {track === 'other' && (
                  <div className="form-group call-custom-reveal">
                    <label className="form-label" htmlFor="discCustomTrack">
                      Tell us what describes you best *
                    </label>
                    <input
                      id="discCustomTrack"
                      type="text"
                      className="form-input"
                      placeholder="e.g. Final-year student running a paper trading journal"
                      value={customTrack}
                      onChange={(e) => setCustomTrack(e.target.value)}
                      maxLength={160}
                      required
                    />
                    <p className="form-hint">
                      One line is enough. We use it to pick the right starting point for your course.
                    </p>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="discChallenge">
                    What do you most want to learn or build in your custom course? (Optional)
                  </label>
                  <textarea
                    id="discChallenge"
                    className="form-textarea"
                    placeholder="e.g. Learning market concepts from scratch, understanding how strategies work, or improving risk & execution discipline..."
                    value={primaryChallenge}
                    onChange={(e) => setPrimaryChallenge(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    style={{ width: '100%', marginTop: 6 }}
                    disabled={basicDetailsSubmitting}
                  >
                    {basicDetailsSubmitting
                      ? 'Unlocking Discovery Questions...'
                      : 'Continue to Discovery Questions →'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%' }}
                    onClick={() => navigate('/?bookCall=1')}
                  >
                    Prefer to Skip Discovery? Book a Call Directly With Our Team &rarr;
                  </button>
                </div>
              </form>
            </div>

            <div className="panel-card" style={{ background: 'var(--bg-canvas)', marginBottom: 0 }}>
              <span className="micro-tag">What happens next</span>
              <h3 style={{ fontSize: 22, marginTop: 10, marginBottom: 14 }}>
                What you get after filling this in
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    padding: 16,
                    background: '#FFFFFF',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)', marginBottom: 4 }}>
                    01 &middot; {questions.length} short questions
                  </div>
                  <p style={{ fontSize: 13.5 }}>
                    They cover how you prepare, how you size risk, how you handle live trades, and how you review them afterwards.
                  </p>
                </div>

                <div
                  style={{
                    padding: 16,
                    background: '#FFFFFF',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)', marginBottom: 4 }}>
                    02 &middot; See your result
                  </div>
                  <p style={{ fontSize: 13.5 }}>
                    You see your score right away, plus what you are already strong at and which areas we would focus on with you.
                  </p>
                </div>

                <div
                  style={{
                    padding: 16,
                    background: '#FFFFFF',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)', marginBottom: 4 }}>
                    03 &middot; Book a Call With Our Team for Next Steps
                  </div>
                  <p style={{ fontSize: 13.5 }}>
                    Schedule a 1-on-1 meeting with our team directly from your result page so we can review your profile together and proceed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : synthesisResult && displayResult ? (
          /* ===================================================================
              STEP 3: ANSWER-BASED DISCOVERY RESULT + BOOK A CALL WITH OUR TEAM
             =================================================================== */
          <div>
            {/* Top Banner: Discovery Result Headline & Readiness Score */}
            <div
              className="panel-card"
              style={{
                background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
                color: '#F8FAFC',
                padding: '32px',
                marginBottom: 24
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 1fr',
                  gap: 28,
                  alignItems: 'center'
                }}
              >
                <div>
                  <span
                    className="status-pill approved"
                    style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      color: '#6EE7B7',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      marginBottom: 14,
                      display: 'inline-block'
                    }}
                  >
                    Your result
                  </span>
                  <h2 style={{ color: '#FFFFFF', fontSize: 'clamp(1.55rem, 2.5vw, 2.15rem)', marginBottom: 12 }}>
                    {displayResult.headline}
                  </h2>
                  <p style={{ color: '#CBD5E1', fontSize: 15, lineHeight: 1.65, marginBottom: 16 }}>
                    {displayResult.summary}
                  </p>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '6px 14px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.1)',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#E2E8F0'
                      }}
                    >
                      Recommended Track: <strong>{displayResult.recommendedTrack}</strong>
                    </span>
                    <span
                      style={{
                        padding: '6px 14px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.1)',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#E2E8F0'
                      }}
                    >
                      Starting Level: <strong>{displayResult.recommendedStartingLevel}</strong>
                    </span>
                  </div>
                </div>

                {/* Readiness Score Gauge Card */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    borderRadius: 18,
                    padding: 24,
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', marginBottom: 8 }}>
                    Your Decision Process Score
                  </div>
                  <div
                    style={{
                      fontSize: 52,
                      fontWeight: 800,
                      fontFamily: 'var(--font-display)',
                      color:
                        displayResult.readinessScore >= 75
                          ? '#34D399'
                          : displayResult.readinessScore >= 52
                            ? '#60A5FA'
                            : '#FBBF24',
                      lineHeight: 1.05
                    }}
                  >
                    {displayResult.readinessScore}%
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#E2E8F0', marginTop: 6 }}>
                    {displayResult.readinessLabel}
                  </div>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>
                    Based on {displayResult.answeredCount} answered Discovery questions
                  </div>
                </div>
              </div>
            </div>

            {/* Main 2-Column Split: Left = Detailed Result Based on Answers, Right = Book a Call With Our Team */}
            <div className="workspace-grid-2" style={{ alignItems: 'start' }}>
              {/* LEFT COLUMN: Detailed Breakdown Based on Candidate's Answers */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Pillar Breakdown */}
                <div className="panel-card" style={{ marginBottom: 0 }}>
                  <span className="micro-tag accent">Capability Breakdown</span>
                  <h3 style={{ fontSize: 20, marginTop: 6, marginBottom: 16 }}>
                    Domain Scores From Your Answers
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {displayResult.pillarScores.map((p) => (
                      <div
                        key={p.domain}
                        style={{
                          padding: '12px 16px',
                          background: 'var(--bg-canvas)',
                          borderRadius: 12,
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <strong style={{ fontSize: 14 }}>{p.title}</strong>
                          <span
                            className={`status-pill ${
                              p.status === 'STRONG'
                                ? 'approved'
                                : p.status === 'DEVELOPING'
                                  ? 'info'
                                  : 'pending'
                            }`}
                          >
                            {p.score}% &middot;{' '}
                            {p.status === 'STRONG'
                              ? 'Strong Foundation'
                              : p.status === 'DEVELOPING'
                                ? 'Developing'
                                : 'Priority Focus'}
                          </span>
                        </div>
                        <div style={{ height: 8, background: 'var(--border-subtle)', borderRadius: 999, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${p.score}%`,
                              height: '100%',
                              background:
                                p.status === 'STRONG'
                                  ? '#059669'
                                  : p.status === 'DEVELOPING'
                                    ? '#1E40AF'
                                    : '#D97706',
                              borderRadius: 999
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Areas Our Team Will Work On With You */}
                <div className="panel-card" style={{ marginBottom: 0 }}>
                  <span className="micro-tag" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
                    What Our Team Will Work On With You
                  </span>
                  <h3 style={{ fontSize: 20, marginTop: 8, marginBottom: 12 }}>
                    Key Focus Areas Identified From Your Responses
                  </h3>
                  <p style={{ fontSize: 13.5, marginBottom: 14 }}>
                    Our team uses these insights from your answers to prepare for your 1-on-1 call and tailor your development roadmap:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {displayResult.focusAreasForTeam.map((area, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 12,
                          alignItems: 'flex-start',
                          padding: '12px 14px',
                          background: '#FFFBEB',
                          border: '1px solid #FDE68A',
                          borderRadius: 10,
                          fontSize: 13.5,
                          color: '#92400E'
                        }}
                      >
                        <span style={{ fontWeight: 800, fontSize: 15 }}>⚡</span>
                        <span>{area}</span>
                      </div>
                    ))}
                  </div>

                  <h4 style={{ fontSize: 15, marginTop: 22, marginBottom: 10 }}>
                    Current Strengths in Your Process
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {displayResult.strengths.map((str, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 12,
                          alignItems: 'flex-start',
                          padding: '12px 14px',
                          background: 'var(--success-bg)',
                          border: '1px solid var(--success-border)',
                          borderRadius: 10,
                          fontSize: 13.5,
                          color: 'var(--success-text)'
                        }}
                      >
                        <span style={{ fontWeight: 800 }}>✓</span>
                        <span>{str}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Book a Call With Our Team */}
              <div className="panel-card" style={{ marginBottom: 0, border: '2px solid var(--accent)' }}>
                <span className="micro-tag accent">Next step</span>
                <h3 style={{ fontSize: 22, marginTop: 8, marginBottom: 8 }}>
                  Book a 1-on-1 call with our team
                </h3>
                <p style={{ fontSize: 14, marginBottom: 20 }}>
                  {displayResult.nextStepRecommendation}
                </p>

                {bookedCallInfo ? (
                  <div
                    style={{
                      padding: 22,
                      background: 'var(--success-bg)',
                      border: '1px solid var(--success-border)',
                      borderRadius: 14,
                      color: 'var(--success-text)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: '#059669',
                          color: '#FFF',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800
                        }}
                      >
                        ✓
                      </span>
                      <strong style={{ fontSize: 17 }}>
                        Your Call With the FRINS Team Is Scheduled!
                      </strong>
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--success-text)', marginBottom: 14 }}>
                      We have shared your Discovery Result and answer summary with your Learning Guide so our team is ready to discuss your next steps.
                    </p>
                    <div
                      style={{
                        background: '#FFFFFF',
                        padding: 14,
                        borderRadius: 10,
                        border: '1px solid var(--success-border)',
                        fontSize: 13.5,
                        color: 'var(--text-main)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6
                      }}
                    >
                      <div>
                        <strong>Candidate:</strong> {bookedCallInfo.participantName} ({bookedCallInfo.participantEmail})
                      </div>
                      <div>
                        <strong>Scheduled Date:</strong> {bookedCallInfo.preferredDate}
                      </div>
                      <div>
                        <strong>Time Slot:</strong> {bookedCallInfo.preferredTimeSlot}
                      </div>
                      <div>
                        <strong>Your score:</strong> {displayResult.readinessScore}% ({displayResult.readinessLabel})
                      </div>
                      <div>
                        <strong>Booking Reference:</strong> <code>{bookedCallInfo.id}</code>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => navigate('/dashboard')}
                      >
                        Explore Learner Workspace &rarr;
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setBookedCallInfo(null)}
                      >
                        Reschedule Call
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleBookCallSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="workspace-grid-2" style={{ gap: 12 }}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="bookDate">
                          Preferred Date *
                        </label>
                        <input
                          id="bookDate"
                          type="date"
                          className="form-input"
                          min={tomorrowIso}
                          value={callDate}
                          onChange={(e) => setCallDate(e.target.value)}
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="bookSlot">
                          Preferred Time Slot *
                        </label>
                        <select
                          id="bookSlot"
                          className="form-select"
                          value={callSlot}
                          onChange={(e) => setCallSlot(e.target.value)}
                        >
                          <option value="10:00 AM IST">10:00 AM IST (Morning)</option>
                          <option value="11:30 AM IST">11:30 AM IST (Late Morning)</option>
                          <option value="02:30 PM IST">02:30 PM IST (Afternoon)</option>
                          <option value="04:30 PM IST">04:30 PM IST (Post-Market)</option>
                          <option value="06:00 PM IST">06:00 PM IST (Evening)</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="bookPhone">
                        Phone / WhatsApp Number (for call link &amp; reminder) *
                      </label>
                      <input
                        id="bookPhone"
                        type="tel"
                        className="form-input"
                        placeholder="+91 98765 43210"
                        value={callPhone}
                        onChange={(e) => setCallPhone(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="bookNotes">
                        Anything specific you want to discuss with our team on the call?
                      </label>
                      <textarea
                        id="bookNotes"
                        className="form-textarea"
                        placeholder="e.g. I want to fix my position sizing and work out which strategy fits me..."
                        value={callNotes}
                        onChange={(e) => setCallNotes(e.target.value)}
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary btn-lg"
                      style={{ width: '100%', marginTop: 4 }}
                      disabled={bookingCall}
                    >
                      {bookingCall
                        ? 'Scheduling Your Call...'
                        : 'Book a Call With Our Team to Proceed →'}
                    </button>
                  </form>
                )}

                <div
                  style={{
                    marginTop: 20,
                    paddingTop: 16,
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSynthesisResult(null)}
                  >
                    &larr; Review or Edit My Answers
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => navigate('/guide')}
                  >
                    View Team / Guide Queue &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ===================================================================
              STEP 2: DYNAMIC N DISCOVERY QUESTIONS
             =================================================================== */
          <>
            {/* Candidate Summary & Quick Demo Presets Bar */}
            <div className="panel-card" style={{ background: 'var(--bg-canvas)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12
                }}
              >
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)' }}>
                    Candidate Profile Unlocked &middot; {participantName} ({participantEmail})
                  </span>
                  <p style={{ fontSize: 13, marginTop: 4 }}>
                    Answer the {questions.length} questions below. Your answers decide your result and the course we suggest.
                  </p>
                </div>
                {(user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER') && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleLoadPersona('trader')}
                    disabled={saving}
                  >
                    Auto-Fill: Trader Profile
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleLoadPersona('investor')}
                    disabled={saving}
                  >
                    Auto-Fill: Investor Profile
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleLoadPersona('no_concern')}
                    disabled={saving}
                  >
                    Auto-Fill: Strong Process Profile
                  </button>
                </div>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="panel-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Progress: {answeredCount} of {questions.length} Questions Answered ({progressPct}%)
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-light-muted)' }}>
                  {saving ? 'Saving answer...' : 'All answers auto-saved'}
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--bg-canvas-subtle)', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    transition: 'width 0.25s ease'
                  }}
                />
              </div>

              {/* Domain Jump Pills */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                {domainGroups.map((dom) => {
                  const firstIdx = questions.findIndex((q) => q.domain === dom);
                  const domQuestions = questions.filter((q) => q.domain === dom);
                  const domAnswered = domQuestions.filter((q) => answers[q.id]).length;
                  const isCurrent = currentQuestion?.domain === dom;
                  return (
                    <button
                      key={dom}
                      type="button"
                      className={`role-pill-btn ${isCurrent ? 'active' : ''}`}
                      style={{
                        background: isCurrent ? 'var(--accent)' : 'var(--bg-canvas)',
                        color: isCurrent ? '#FFF' : 'var(--text-main)',
                        border: '1px solid var(--border-subtle)'
                      }}
                      onClick={() => setCurrentIndex(firstIdx)}
                    >
                      {domQuestions[0]?.domainTitle} ({domAnswered}/{domQuestions.length})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Question Card */}
            {currentQuestion && (
              <div className="panel-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span className="status-pill info">
                    Question {currentQuestion.number} of {questions.length} &middot; {currentQuestion.domainTitle}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-light-muted)' }}>
                    ID: {currentQuestion.id}
                  </span>
                </div>

                <h3 style={{ fontSize: 22, marginBottom: 20 }}>{currentQuestion.prompt}</h3>

                {currentQuestion.inputType === 'single_choice' && currentQuestion.options ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {currentQuestion.options.map((opt) => {
                      const selected = answers[currentQuestion.id] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleSelectAnswer(currentQuestion.id, opt.value)}
                          style={{
                            textAlign: 'left',
                            padding: '15px 18px',
                            borderRadius: 'var(--radius-sm)',
                            border: selected ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                            background: selected ? 'var(--accent-soft)' : '#FFF',
                            color: 'var(--text-main)',
                            fontWeight: selected ? 600 : 400,
                            fontSize: 15,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span>{opt.label}</span>
                          {selected && (
                            <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>
                              ✓ Selected
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="form-group">
                    <textarea
                      className="form-textarea"
                      rows={4}
                      placeholder="Share your reflection in your own words..."
                      value={answers[currentQuestion.id] || ''}
                      onChange={(e) => handleSelectAnswer(currentQuestion.id, e.target.value)}
                    />
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 24,
                    paddingTop: 16,
                    borderTop: '1px solid var(--border-subtle)'
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  >
                    &larr; Previous Question
                  </button>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '55%', justifyContent: 'center' }}>
                    {questions.map((q, idx) => {
                      const isAns = Boolean(answers[q.id]);
                      const isCurr = idx === currentIndex;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setCurrentIndex(idx)}
                          title={`${q.id}: ${q.prompt}`}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            border: isCurr ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                            background: isAns ? 'var(--accent)' : '#FFF',
                            color: isAns ? '#FFF' : 'var(--text-muted)'
                          }}
                        >
                          {q.number}
                        </button>
                      );
                    })}
                  </div>

                  {currentIndex < questions.length - 1 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                    >
                      Next Question &rarr;
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleRunSynthesis}
                      disabled={synthesizing || answeredCount === 0}
                    >
                      {synthesizing ? 'Calculating Your Result...' : 'View My Discovery Result →'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Submit & See Result Bar */}
            <div
              className="panel-card"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16,
                background: 'linear-gradient(135deg, #1E40AF 0%, #0F172A 100%)',
                color: '#FFF'
              }}
            >
              <div>
                <h3 style={{ color: '#FFF', marginBottom: 4 }}>
                  See your result
                </h3>
                <p style={{ color: '#CBD5E1', fontSize: 13.5 }}>
                  Answer {answeredCount} of {questions.length} so far. Finish the rest and we will show your result, with the option to book a call.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-lg"
                style={{ background: '#FFF', color: '#0F172A', fontWeight: 700 }}
                onClick={handleRunSynthesis}
                disabled={synthesizing || answeredCount === 0}
              >
                {synthesizing
                  ? 'Generating Your Discovery Result...'
                  : `See My Discovery Result & Book a Call (${answeredCount}/${questions.length}) →`}
              </button>
            </div>
          </>
        )}
      </div>

      <PublicSiteFooter />
    </div>
  );
};
