import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PublicSiteHeader, PublicSiteFooter } from './PublicWebsitePage';

/* ------------------------------------------------------------------ types */

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

type Track = 'student_concepts' | 'strategy_learner' | 'trader' | 'investor' | 'both' | 'other';
type View = 'details' | 'questions' | 'review' | 'result';

const TRACK_OPTIONS: Array<{ value: Track; label: string }> = [
  { value: 'student_concepts', label: 'Student or beginner, learning the basics' },
  { value: 'strategy_learner', label: 'Learning how market strategies work' },
  { value: 'trader', label: 'Active trader (intraday or swing)' },
  { value: 'investor', label: 'Long-term investor' },
  { value: 'both', label: 'A bit of both, trading and investing' },
  { value: 'other', label: 'Something else, I will describe it' }
];

const EXPERIENCE_OPTIONS = [
  { value: 'under_1y', label: 'Less than 1 year, or just starting' },
  { value: '1_to_3y', label: '1 to 3 years' },
  { value: '3_to_7y', label: '3 to 7 years' },
  { value: 'over_7y', label: 'More than 7 years' }
];

const TIME_SLOTS = [
  '10:00 AM IST',
  '11:30 AM IST',
  '02:30 PM IST',
  '04:30 PM IST',
  '06:00 PM IST'
];

const SESSION_KEY = 'frins_active_discovery_session';

const tomorrowIso = () => new Date(Date.now() + 86400000).toISOString().split('T')[0];

/* --------------------------------------------------------------- helpers */

const statusLabel = (status: CandidateResultPillar['status']) =>
  status === 'STRONG' ? 'Strong' : status === 'DEVELOPING' ? 'Developing' : 'Focus needed';

const answerLabelFor = (question: DiscoveryQuestion | undefined, value: string) => {
  if (!question) return value;
  if (question.inputType === 'single_choice' && question.options) {
    return question.options.find((o) => o.value === value)?.label || value;
  }
  return value;
};

/* -------------------------------------------------------------- page root */

export const DiscoveryPage: React.FC<{ onOpenSignIn?: () => void }> = ({ onOpenSignIn }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [questions, setQuestions] = useState<DiscoveryQuestion[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [view, setView] = useState<View>('details');

  const [participantName, setParticipantName] = useState(user?.name || '');
  const [participantEmail, setParticipantEmail] = useState(user?.email || '');
  const trackFromLink = searchParams.get('track') as Track | null;
  const [track, setTrack] = useState<Track>(
    trackFromLink && TRACK_OPTIONS.some((t) => t.value === trackFromLink)
      ? trackFromLink
      : ((user?.track as Track) || 'student_concepts')
  );
  const [customTrack, setCustomTrack] = useState('');
  const [experienceYears, setExperienceYears] = useState('under_1y');
  const [primaryChallenge, setPrimaryChallenge] = useState('');

  const [detailsSubmitting, setDetailsSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesisResult, setSynthesisResult] = useState<any | null>(null);
  const [candidateResult, setCandidateResult] = useState<CandidateDiscoveryResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [callPhone, setCallPhone] = useState('+91 ');
  const [callDate, setCallDate] = useState(tomorrowIso());
  const [callSlot, setCallSlot] = useState(TIME_SLOTS[1]);
  const [callNotes, setCallNotes] = useState('');
  const [bookingCall, setBookingCall] = useState(false);
  const [bookedCallInfo, setBookedCallInfo] = useState<any | null>(null);
  const [resuming, setResuming] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ questionId: string; value: string } | null>(null);

  /* ------------------------------------------------------------- loading */

  const loadQuestions = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/discovery/questions');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not load the questions.');
      setQuestions(data.questions || []);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load the questions.');
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await loadQuestions();

      const fromLink = searchParams.get('session');
      const stored = fromLink || sessionStorage.getItem(SESSION_KEY);
      if (!stored) {
        setLoading(false);
        return;
      }

      try {
        setResuming(true);
        const res = await fetch(`/api/discovery/${stored}`);
        if (!res.ok) {
          sessionStorage.removeItem(SESSION_KEY);
          return;
        }
        const data = await res.json();
        if (!data.success || !data.session) return;

        const session = data.session;
        setSessionId(session.id);
        sessionStorage.setItem(SESSION_KEY, session.id);
        setParticipantName(session.participant_name || user?.name || '');
        setParticipantEmail(session.participant_email || user?.email || '');
        if (session.track) setTrack(session.track);
        setCustomTrack(session.custom_track || '');
        setAnswers(session.answers || {});
        if (data.candidateResult) setCandidateResult(data.candidateResult);
        if (data.callBooking) setBookedCallInfo(data.callBooking);
        if (session.participant_name) setView('questions');
        if (session.status === 'COMPLETED' && data.latestAiRun) {
          setSynthesisResult(data);
          setView('result');
        }
      } catch {
        /* a stale session is not worth an error screen, start fresh instead */
        sessionStorage.removeItem(SESSION_KEY);
      } finally {
        setResuming(false);
        setLoading(false);
      }
    };
    init();
    // Questions load once. Re-running on user changes would reset answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  /* -------------------------------------------------------- step 1: form */

  const handleDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!participantName.trim() || !participantEmail.trim()) {
      setErrorMsg('Please add your name and email so we can save your result.');
      return;
    }
    if (track === 'other' && customTrack.trim().length < 3) {
      setErrorMsg('Tell us a few words about what describes you best.');
      return;
    }

    setDetailsSubmitting(true);
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
      if (!startData.success || !startData.session) {
        throw new Error(startData.error || 'Could not start Discovery.');
      }

      const newSessionId = startData.session.id;
      setSessionId(newSessionId);
      sessionStorage.setItem(SESSION_KEY, newSessionId);

      // Carry over the answers they already gave us, so nobody answers twice.
      const seed: Record<string, string> = {};
      const orientation =
        track === 'trader' || track === 'investor' || track === 'both'
          ? track
          : track === 'student_concepts' || track === 'strategy_learner'
            ? 'exploring'
            : '';
      if (orientation && questions.some((q) => q.id === 'Q01')) seed.Q01 = orientation;
      if (questions.some((q) => q.id === 'Q03')) seed.Q03 = experienceYears;
      if (primaryChallenge.trim() && questions.some((q) => q.id === 'Q33')) {
        seed.Q33 = primaryChallenge.trim();
      }

      if (Object.keys(seed).length > 0) {
        const ansRes = await fetch('/api/discovery/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: newSessionId, answersBatch: seed })
        });
        const ansData = await ansRes.json();
        if (ansData.success) {
          setAnswers(ansData.answers || seed);
          if (ansData.candidateResult) setCandidateResult(ansData.candidateResult);
        }
      }

      setCurrentIndex(0);
      setView('questions');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not save your details. Please try again.');
    } finally {
      setDetailsSubmitting(false);
    }
  };

  /* --------------------------------------------------- step 2: questions */

  const persistAnswer = async (questionId: string, value: string) => {
    if (!sessionId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/discovery/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, questionId, answer: value })
      });
      const data = await res.json();
      if (data.candidateResult) setCandidateResult(data.candidateResult);
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setErrorMsg('We could not save that answer. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAnswer = (question: DiscoveryQuestion, value: string, advance: boolean) => {
    setErrorMsg(null);
    setAnswers((prev) => ({ ...prev, [question.id]: value }));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Typed answers are debounced, taps are saved straight away.
    if (question.inputType === 'text') {
      pendingSave.current = { questionId: question.id, value };
      saveTimer.current = setTimeout(() => {
        pendingSave.current = null;
        persistAnswer(question.id, value);
      }, 600);
    } else {
      pendingSave.current = null;
      persistAnswer(question.id, value);
    }

    if (advance && currentIndex < questions.length - 1) {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => {
        setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
      }, 260);
    }
  };

  const goTo = (index: number) => {
    setCurrentIndex(Math.max(0, Math.min(questions.length - 1, index)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const answeredCount = useMemo(
    () => questions.filter((q) => String(answers[q.id] || '').trim() !== '').length,
    [questions, answers]
  );
  const progressPct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const firstUnanswered = questions.findIndex((q) => !String(answers[q.id] || '').trim());

  /* ------------------------------------------------------ step 2b: review */

  // A typed answer waits 600ms before it is sent. Flush it before leaving the
  // question so the result never misses the last thing someone wrote.
  const flushPendingAnswer = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pending = pendingSave.current;
    if (pending) {
      pendingSave.current = null;
      persistAnswer(pending.questionId, pending.value);
    }
  };

  const openReview = () => {
    flushPendingAnswer();
    setView('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ---------------------------------------------------- step 3: result */

  const runSynthesis = async () => {
    if (!sessionId) return;
    flushPendingAnswer();
    setSynthesizing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/discovery/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userId: user?.id })
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.error || 'We could not build your result. Please try again.');
        return;
      }
      setSynthesisResult(data);
      if (data.candidateResult) setCandidateResult(data.candidateResult);
      setView('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error while building your result.');
    } finally {
      setSynthesizing(false);
    }
  };

  const bookCall = async (e: React.FormEvent) => {
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
        if (data.candidateResult) setCandidateResult(data.candidateResult);
      } else {
        setErrorMsg(data.error || 'Could not book the call.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error while booking the call.');
    } finally {
      setBookingCall(false);
    }
  };

  const startFresh = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSessionId('');
    setAnswers({});
    setSynthesisResult(null);
    setCandidateResult(null);
    setBookedCallInfo(null);
    setCustomTrack('');
    setPrimaryChallenge('');
    setCurrentIndex(0);
    setSavedAt(null);
    setErrorMsg(null);
    setView('details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const displayResult: CandidateDiscoveryResult | null =
    synthesisResult?.candidateResult || candidateResult;

  const stepNumber = view === 'details' ? 1 : view === 'result' ? 3 : 2;

  /* ------------------------------------------------------------ render */

  if (loading || resuming) {
    return (
      <div className="public-page-shell">
        <PublicSiteHeader onOpenSignIn={onOpenSignIn} />
        <main className="discovery-shell">
          <div className="discovery-loading">
            <span className="discovery-spinner" aria-hidden="true" />
            <p>Loading Discovery...</p>
          </div>
        </main>
        <PublicSiteFooter />
      </div>
    );
  }

  return (
    <div className="public-page-shell">
      <PublicSiteHeader onOpenSignIn={onOpenSignIn} />

      <main className="discovery-shell">
        <nav className="discovery-steps" aria-label="Discovery progress">
          {[
            { n: 1, label: 'Your details' },
            { n: 2, label: 'Questions' },
            { n: 3, label: 'Your result' }
          ].map((step, i) => (
            <React.Fragment key={step.n}>
              {i > 0 && <span className="discovery-step-line" aria-hidden="true" />}
              <span
                className={`discovery-step ${stepNumber === step.n ? 'current' : ''} ${
                  stepNumber > step.n ? 'done' : ''
                }`}
                aria-current={stepNumber === step.n ? 'step' : undefined}
              >
                <span className="discovery-step-dot">{stepNumber > step.n ? '✓' : step.n}</span>
                {step.label}
              </span>
            </React.Fragment>
          ))}
        </nav>

        {errorMsg && (
          <div className="discovery-alert" role="alert">
            <strong>Something went wrong.</strong> {errorMsg}
          </div>
        )}

        {/* ----------------------------------------------------- STEP 1 */}
        {view === 'details' && (
          <div className="discovery-intro-grid">
            <section className="discovery-card">
              <span className="micro-tag accent">Step 1 of 3</span>
              <h1 className="discovery-title">Start with a few details about you</h1>
              <p className="discovery-lede">
                This takes about {Math.max(2, Math.ceil((questions.length || 6) / 3))} minutes. You get your
                result right away, and you can book a call with our team if you want to talk it through.
              </p>

              <form onSubmit={handleDetailsSubmit} className="discovery-form" noValidate>
                <div className="discovery-field-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="discName">
                      Full name
                    </label>
                    <input
                      id="discName"
                      type="text"
                      className="form-input"
                      placeholder="Enter your full name"
                      value={participantName}
                      onChange={(e) => setParticipantName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="discEmail">
                      Email
                    </label>
                    <input
                      id="discEmail"
                      type="email"
                      className="form-input"
                      placeholder="you@example.com"
                      value={participantEmail}
                      onChange={(e) => setParticipantEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="discTrack">
                    What describes you best?
                  </label>
                  <select
                    id="discTrack"
                    className="form-select"
                    value={track}
                    onChange={(e) => setTrack(e.target.value as Track)}
                  >
                    {TRACK_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="form-hint">This decides which questions you get and which course we suggest.</p>
                </div>

                {track === 'other' && (
                  <div className="form-group discovery-reveal">
                    <label className="form-label" htmlFor="discCustomTrack">
                      Tell us what describes you best
                    </label>
                    <input
                      id="discCustomTrack"
                      type="text"
                      className="form-input"
                      placeholder="e.g. Final-year student running a paper trading journal"
                      value={customTrack}
                      onChange={(e) => setCustomTrack(e.target.value)}
                      maxLength={160}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="discExp">
                    How long have you been in the markets?
                  </label>
                  <select
                    id="discExp"
                    className="form-select"
                    value={experienceYears}
                    onChange={(e) => setExperienceYears(e.target.value)}
                  >
                    {EXPERIENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="discChallenge">
                    What do you most want to learn or build? <span className="discovery-optional">Optional</span>
                  </label>
                  <textarea
                    id="discChallenge"
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. I want to stop moving my stop loss and learn how to size positions properly."
                    value={primaryChallenge}
                    onChange={(e) => setPrimaryChallenge(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-primary btn-lg discovery-submit" disabled={detailsSubmitting}>
                  {detailsSubmitting ? 'Preparing your questions...' : 'Start the questions'}
                </button>

                <button
                  type="button"
                  className="btn btn-secondary discovery-submit"
                  onClick={() => navigate('/?bookCall=1')}
                >
                  Skip this and book a call instead
                </button>
              </form>
            </section>

            <aside className="discovery-side">
              <div className="discovery-card discovery-side-card">
                <h2 className="discovery-side-title">What you get</h2>
                <ol className="discovery-timeline">
                  <li>
                    <span className="discovery-timeline-num">1</span>
                    <div>
                      <strong>{questions.length || 'A few'} short questions</strong>
                      <p>How you prepare, size your risk, handle a live position and review it afterwards.</p>
                    </div>
                  </li>
                  <li>
                    <span className="discovery-timeline-num">2</span>
                    <div>
                      <strong>A score and a clear breakdown</strong>
                      <p>You see what is already strong and which areas our team would work on with you.</p>
                    </div>
                  </li>
                  <li>
                    <span className="discovery-timeline-num">3</span>
                    <div>
                      <strong>A call if you want one</strong>
                      <p>Pick a date and time and we will review your result with you, one on one.</p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className="discovery-quiet-note">
                <strong>No payment, no obligation.</strong>
                <p>Answers save as you go, so you can close the tab and come back later.</p>
              </div>
            </aside>
          </div>
        )}

        {/* ----------------------------------------------------- STEP 2 */}
        {view === 'questions' && (
          <>
            {questions.length === 0 ? (
              <div className="discovery-card">
                <h2 className="discovery-title">Discovery is not open yet</h2>
                <p className="discovery-lede">
                  Our team is still setting the questions up. Please check back shortly, or book a call and we
                  will take it from there.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => navigate('/?bookCall=1')}>
                  Book a call
                </button>
              </div>
            ) : (
              <>
                <div className="discovery-progress-card">
                  <div className="discovery-progress-top">
                    <div>
                      <strong>
                        Question {currentIndex + 1} of {questions.length}
                      </strong>
                      <span className="discovery-muted">
                        {answeredCount} answered
                        {saving
                          ? ' · saving...'
                          : savedAt
                            ? ` · saved at ${savedAt}`
                            : ''}
                      </span>
                    </div>
                    <span className="discovery-pct">{progressPct}%</span>
                  </div>

                  <div
                    className="discovery-progress-track"
                    role="progressbar"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="discovery-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>

                  <div className="discovery-dots" aria-hidden="true">
                    {questions.map((q, idx) => {
                      const answered = Boolean(answers[q.id]);
                      return (
                        <button
                          key={q.id}
                          type="button"
                          className={`discovery-dot ${answered ? 'answered' : ''} ${
                            idx === currentIndex ? 'current' : ''
                          }`}
                          onClick={() => goTo(idx)}
                          title={`Question ${q.number}${answered ? ', answered' : ', not answered yet'}`}
                        >
                          {q.number}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="discovery-question-layout">
                  <section className="discovery-card discovery-question-card">
                    <span className="discovery-domain-tag">{questions[currentIndex].domainTitle}</span>
                    <h2 className="discovery-question-text">{questions[currentIndex].prompt}</h2>

                    {questions[currentIndex].inputType === 'single_choice' && questions[currentIndex].options ? (
                      <div
                        className="discovery-options"
                        role="radiogroup"
                        aria-label={questions[currentIndex].prompt}
                      >
                        {questions[currentIndex].options!.map((option) => {
                          const selected = answers[questions[currentIndex].id] === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              className={`discovery-option ${selected ? 'selected' : ''}`}
                              onClick={() => handleAnswer(questions[currentIndex], option.value, true)}
                            >
                              <span className="discovery-option-mark" aria-hidden="true" />
                              <span className="discovery-option-label">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="form-group">
                        <label className="form-label" htmlFor="discFreeText">
                          Your answer
                        </label>
                        <textarea
                          id="discFreeText"
                          className="form-textarea"
                          rows={5}
                          placeholder="A few sentences is enough. Write it the way you would say it."
                          value={answers[questions[currentIndex].id] || ''}
                          onChange={(e) => handleAnswer(questions[currentIndex], e.target.value, false)}
                        />
                        <p className="form-hint">Saved automatically as you type.</p>
                      </div>
                    )}

                    <div className="discovery-question-nav">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={currentIndex === 0}
                        onClick={() => goTo(currentIndex - 1)}
                      >
                        Back
                      </button>

                      {currentIndex < questions.length - 1 ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => goTo(currentIndex + 1)}
                          disabled={!answers[questions[currentIndex].id]}
                        >
                          Next question
                        </button>
                      ) : (
                        <button type="button" className="btn btn-primary" onClick={openReview}>
                          Review my answers
                        </button>
                      )}
                    </div>
                  </section>

                  <aside className="discovery-side">
                    <div className="discovery-card discovery-side-card">
                      <h3 className="discovery-side-title">Your details</h3>
                      <p className="discovery-side-line">{participantName}</p>
                      <p className="discovery-side-line discovery-muted">{participantEmail}</p>
                      <p className="discovery-side-line discovery-muted">
                        {TRACK_OPTIONS.find((t) => t.value === track)?.label}
                        {track === 'other' && customTrack ? `: ${customTrack}` : ''}
                      </p>
                      <button
                        type="button"
                        className="discovery-text-button"
                        onClick={() => {
                          const proceed = window.confirm(
                            'Changing your details starts a new set of questions and clears the answers you have given so far. Continue?'
                          );
                          if (proceed) startFresh();
                        }}
                      >
                        Change details
                      </button>
                    </div>

                    <div className="discovery-quiet-note">
                      <strong>Take your time.</strong>
                      <p>Every answer saves on its own. You can stop and pick up where you left off.</p>
                    </div>

                    <button type="button" className="btn btn-secondary" onClick={openReview}>
                      Skip to the end
                    </button>
                  </aside>
                </div>
              </>
            )}
          </>
        )}

        {/* ---------------------------------------------------- STEP 2b */}
        {view === 'review' && (
          <div className="discovery-review-grid">
            <section className="discovery-card">
              <span className="micro-tag accent">Almost there</span>
              <h2 className="discovery-title">Check your answers</h2>
              <p className="discovery-lede">
                {answeredCount} of {questions.length} answered. You can change any of them before you
                continue.
              </p>

              <ol className="discovery-review-list">
                {questions.map((q, idx) => {
                  const value = String(answers[q.id] || '').trim();
                  return (
                    <li key={q.id} className={value ? '' : 'missing'}>
                      <div className="discovery-review-head">
                        <span className="discovery-review-num">{q.number}</span>
                        <p className="discovery-review-prompt">{q.prompt}</p>
                        <button
                          type="button"
                          className="discovery-text-button"
                          onClick={() => {
                            setView('questions');
                            goTo(idx);
                          }}
                        >
                          {value ? 'Change' : 'Answer'}
                        </button>
                      </div>
                      <p className="discovery-review-answer">
                        {value ? answerLabelFor(q, value) : 'Not answered yet'}
                      </p>
                    </li>
                  );
                })}
              </ol>

              <div className="discovery-question-nav">
                <button type="button" className="btn btn-secondary" onClick={() => setView('questions')}>
                  Back to questions
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={runSynthesis}
                  disabled={synthesizing || answeredCount === 0}
                >
                  {synthesizing ? 'Building your result...' : 'Get my result'}
                </button>
              </div>
              {answeredCount === 0 && (
                <p className="form-hint">Answer at least one question and your result will build.</p>
              )}
            </section>

            <aside className="discovery-side">
              <div className="discovery-card discovery-side-card">
                <h3 className="discovery-side-title">Before you continue</h3>
                <p className="discovery-side-copy">
                  Your result is built from the answers you gave. If you leave something blank, we simply
                  have less to work with.
                </p>
                {firstUnanswered >= 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setView('questions');
                      goTo(firstUnanswered);
                    }}
                  >
                    Go to the first blank answer
                  </button>
                )}
              </div>
            </aside>
          </div>
        )}

        {/* ----------------------------------------------------- STEP 3 */}
        {view === 'result' && displayResult && (
          <div className="discovery-result">
            <section className="discovery-result-hero">
              <div className="discovery-result-hero-copy">
                <span className="discovery-result-eyebrow">Your Discovery result</span>
                <h2>{displayResult.headline}</h2>
                <p>{displayResult.summary}</p>

                <div className="discovery-chip-row">
                  <span className="discovery-chip">
                    Course we suggest
                    <strong>{displayResult.recommendedTrack}</strong>
                  </span>
                  <span className="discovery-chip">
                    Starting level
                    <strong>{displayResult.recommendedStartingLevel}</strong>
                  </span>
                  <span className="discovery-chip">
                    Answers used
                    <strong>
                      {displayResult.answeredCount} of {displayResult.totalConfiguredQuestions}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="discovery-score">
                <svg viewBox="0 0 140 140" className="discovery-score-ring" aria-hidden="true">
                  <circle cx="70" cy="70" r="58" className="discovery-score-track" />
                  <circle
                    cx="70"
                    cy="70"
                    r="58"
                    className="discovery-score-value"
                    style={{
                      strokeDasharray: 2 * Math.PI * 58,
                      strokeDashoffset: 2 * Math.PI * 58 * (1 - displayResult.readinessScore / 100)
                    }}
                  />
                </svg>
                <div className="discovery-score-inner">
                  <strong>{displayResult.readinessScore}%</strong>
                  <span>Decision process score</span>
                </div>
                <p className="discovery-score-label">{displayResult.readinessLabel}</p>
              </div>
            </section>

            <div className="discovery-result-grid">
              <div className="discovery-result-left">
                <section className="discovery-card">
                  <h3 className="discovery-section-title">Where you stand, area by area</h3>
                  <div className="discovery-pillars">
                    {displayResult.pillarScores.map((pillar) => (
                      <div key={pillar.domain} className="discovery-pillar">
                        <div className="discovery-pillar-head">
                          <strong>{pillar.title}</strong>
                          <span className={`discovery-badge ${pillar.status.toLowerCase()}`}>
                            {pillar.score}% · {statusLabel(pillar.status)}
                          </span>
                        </div>
                        <div className="discovery-bar">
                          <div
                            className={`discovery-bar-fill ${pillar.status.toLowerCase()}`}
                            style={{ width: `${pillar.score}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="discovery-card">
                  <h3 className="discovery-section-title">What our team will work on with you</h3>
                  <p className="discovery-muted discovery-section-copy">
                    We use these points to prepare for your call and to shape your course.
                  </p>
                  <ul className="discovery-list discovery-list-focus">
                    {displayResult.focusAreasForTeam.map((area, i) => (
                      <li key={`focus-${i}`}>{area}</li>
                    ))}
                  </ul>

                  <h4 className="discovery-subsection-title">What is already strong</h4>
                  <ul className="discovery-list discovery-list-strong">
                    {displayResult.strengths.map((strength, i) => (
                      <li key={`strength-${i}`}>{strength}</li>
                    ))}
                  </ul>
                </section>
              </div>

              <div className="discovery-result-right">
                <section className="discovery-card discovery-book-card">
                  <span className="micro-tag accent">Next step</span>
                  <h3 className="discovery-section-title">Book a call with our team</h3>
                  <p className="discovery-muted discovery-section-copy">{displayResult.nextStepRecommendation}</p>

                  {bookedCallInfo ? (
                    <div className="discovery-booked">
                      <div className="discovery-booked-head">
                        <span className="discovery-booked-tick" aria-hidden="true">✓</span>
                        <strong>Your call is booked</strong>
                      </div>
                      <dl className="discovery-booked-list">
                        <div>
                          <dt>Name</dt>
                          <dd>{bookedCallInfo.participantName}</dd>
                        </div>
                        <div>
                          <dt>Date</dt>
                          <dd>{bookedCallInfo.preferredDate}</dd>
                        </div>
                        <div>
                          <dt>Time</dt>
                          <dd>{bookedCallInfo.preferredTimeSlot}</dd>
                        </div>
                        <div>
                          <dt>Reference</dt>
                          <dd><code>{bookedCallInfo.id}</code></dd>
                        </div>
                      </dl>
                      <p className="discovery-booked-note">
                        We have shared your result with the team member who will call you.
                      </p>
                      <div className="discovery-booked-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBookedCallInfo(null)}>
                          Pick another time
                        </button>
                        {user && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/dashboard')}>
                            Go to my dashboard
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={bookCall} className="discovery-form">
                      <div className="discovery-field-row">
                        <div className="form-group">
                          <label className="form-label" htmlFor="bookDate">
                            Date
                          </label>
                          <input
                            id="bookDate"
                            type="date"
                            className="form-input"
                            min={tomorrowIso()}
                            value={callDate}
                            onChange={(e) => setCallDate(e.target.value)}
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="bookSlot">
                            Time
                          </label>
                          <select
                            id="bookSlot"
                            className="form-select"
                            value={callSlot}
                            onChange={(e) => setCallSlot(e.target.value)}
                          >
                            {TIME_SLOTS.map((slot) => (
                              <option key={slot} value={slot}>
                                {slot}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="bookPhone">
                          Phone or WhatsApp
                        </label>
                        <input
                          id="bookPhone"
                          type="tel"
                          className="form-input"
                          placeholder="+91 98765 43210"
                          value={callPhone}
                          onChange={(e) => setCallPhone(e.target.value)}
                          autoComplete="tel"
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="bookNotes">
                          Anything you want to cover? <span className="discovery-optional">Optional</span>
                        </label>
                        <textarea
                          id="bookNotes"
                          className="form-textarea"
                          rows={3}
                          placeholder="e.g. I want to fix my position sizing."
                          value={callNotes}
                          onChange={(e) => setCallNotes(e.target.value)}
                        />
                      </div>

                      <button type="submit" className="btn btn-primary btn-lg discovery-submit" disabled={bookingCall}>
                        {bookingCall ? 'Booking your call...' : 'Book my call'}
                      </button>
                    </form>
                  )}
                </section>

                <button type="button" className="btn btn-secondary discovery-full-button" onClick={startFresh}>
                  Start a new Discovery
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <PublicSiteFooter />
    </div>
  );
};
