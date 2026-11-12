import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export type LearnerOrientationTrack =
  | 'student_concepts'
  | 'strategy_learner'
  | 'trader'
  | 'investor'
  | 'both'
  | 'other';

interface Pathway {
  number: string;
  kicker: string;
  title: string;
  intro: string;
  points: Array<{ title: string; body: string }>;
  startLabel: string;
  track: LearnerOrientationTrack;
}

/** The four starting points. Copy lives here so the cards stay one shape. */
export const PATHWAYS: Pathway[] = [
  {
    number: '01',
    kicker: 'Students & Concept Learners',
    title: 'Understand how the market works before you risk money',
    intro:
      'For students and complete beginners. You want the basics to actually make sense before anyone talks to you about strategies.',
    points: [
      {
        title: 'The basics, explained properly.',
        body: 'Who moves prices, what liquidity means, and why timeframes change the whole picture.'
      },
      {
        title: 'Risk from day one.',
        body: 'How much you can lose per idea, why drawdowns compound, and how to protect capital while learning.'
      },
      {
        title: 'A plan that starts where you are.',
        body: 'No skipped steps and no jargon you are expected to already know.'
      }
    ],
    startLabel: 'Start Student Discovery',
    track: 'student_concepts'
  },
  {
    number: '02',
    kicker: 'Strategy Understanding & Design',
    title: 'Build rules you can explain out loud',
    intro:
      'For anyone testing an idea or trying to understand why some strategies work for a while and then stop. We work on the logic, not the signals.',
    points: [
      {
        title: 'Anatomy of a setup.',
        body: 'What qualifies, when you enter, where you are wrong, and how you exit.'
      },
      {
        title: 'Knowing when to sit out.',
        body: 'Every strategy works in some conditions and bleeds in others. Learn to tell them apart.'
      },
      {
        title: 'Work on your own idea.',
        body: 'Bring the strategy you care about and stress-test it with a mentor instead of a generic example.'
      }
    ],
    startLabel: 'Start Strategy Discovery',
    track: 'strategy_learner'
  },
  {
    number: '03',
    kicker: 'Active Traders',
    title: 'Fix the part that costs you money: execution',
    intro:
      'For intraday and swing traders who know the setups but keep breaking their own rules when money is on the line.',
    points: [
      {
        title: 'Plan before the open.',
        body: 'Decide levels, size and invalidation while you are calm, not mid-candle.'
      },
      {
        title: 'Stops that stay put.',
        body: 'The plan is made in advance. At the stop you act. You do not renegotiate.'
      },
      {
        title: 'A rule for red days.',
        body: 'A set point where you stop trading, so one bad morning does not become a bad month.'
      }
    ],
    startLabel: 'Start Trader Discovery',
    track: 'trader'
  },
  {
    number: '04',
    kicker: 'Long-Term Investors',
    title: 'Own things for reasons you wrote down',
    intro:
      'For longer-term investors who want a checklist before buying, a sizing rule they trust, and less reaction to daily headlines.',
    points: [
      {
        title: 'Write it before you buy.',
        body: 'What has to go right, what would prove you wrong, and when you sell.'
      },
      {
        title: 'Size by downside.',
        body: 'Position size comes from how much you can lose, not from how confident you feel.'
      },
      {
        title: 'Review on a schedule.',
        body: 'Look at holdings quarterly, not every time the market dips.'
      }
    ],
    startLabel: 'Start Investor Discovery',
    track: 'investor'
  }
];

/**
 * One starting point. Number and audience name sit above the promise, the
 * promises read as a short list, and the two actions close the card.
 */
export const PathwayCard: React.FC<{
  pathway: Pathway;
  onStart: () => void;
  onCall: () => void;
}> = ({ pathway, onStart, onCall }) => (
  <article className="pathway-card">
    <header className="pathway-head">
      <span className="pathway-number">{pathway.number}</span>
      <span className="pathway-kicker">{pathway.kicker}</span>
    </header>

    <h3>{pathway.title}</h3>
    <p className="pathway-intro">{pathway.intro}</p>

    <div className="pathway-body">
      <span className="pathway-label">What you work on</span>
      <ul className="pathway-list">
        {pathway.points.map((point) => (
          <li key={point.title}>
            <strong>{point.title}</strong> {point.body}
          </li>
        ))}
      </ul>
    </div>

    <footer className="pathway-actions">
      <button type="button" className="btn btn-primary" onClick={onStart}>
        {pathway.startLabel}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onCall}>
        Book a Call
      </button>
    </footer>
  </article>
);

export interface PublicSiteNavProps {
  onOpenSignIn?: () => void;
  onStartDiscovery?: () => void;
  onBookCallDirect?: () => void;
}

export const PublicSiteHeader: React.FC<PublicSiteNavProps> = ({
  onOpenSignIn,
  onStartDiscovery,
  onBookCallDirect
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const openAccount = () => {
    if (user) navigate('/dashboard');
    else if (onOpenSignIn) onOpenSignIn();
  };

  const accountLabel = user ? 'My Learning' : 'Student Login';

  const navItems = [
    { path: '/', label: 'Home' },
    { path: '/why-frins', label: 'Why Us' },
    { path: '/how-it-works', label: 'Process' },
    { path: '/tracks', label: 'Programs' },
    { path: '/discovery', label: 'Discovery' }
  ];

  const handleGo = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  return (
    <header className="site-header">
      <div className="container header-inner">
        {/* Left: Precision-Aligned Brand Logo & Wordmark */}
        <div
          className="brand-group"
          role="button"
          tabIndex={0}
          onClick={() => handleGo('/')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleGo('/');
          }}
        >
          <img
            className="site-brand-logo"
            src="/brand/frins-lockup.png"
            alt="FRINS — Market Learning, Taught Properly"
          />
        </div>

        {/* Center: All Multi-Page Tabs Shown Directly on Laptop & Large Screens */}
        <nav className="nav-pill-shell" aria-label="Main Website Navigation">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                type="button"
                className={`nav-pill-link ${isActive ? 'active' : ''}`}
                onClick={() => handleGo(item.path)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right: Direct "Book a Call", "Start Discovery", Sign In, and Mobile Hamburger Icon */}
        <div className="header-cta-group">
          {(onOpenSignIn || user) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={openAccount}>
              {accountLabel}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (onBookCallDirect) {
                onBookCallDirect();
              } else {
                navigate('/?bookCall=1');
              }
            }}
          >
            Book a Call
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm desktop-only-btn"
            onClick={() => {
              if (onStartDiscovery) {
                onStartDiscovery();
              } else {
                navigate('/discovery');
              }
            }}
          >
            Start Discovery &rarr;
          </button>
          {/* Hamburger Icon Button (No "Menu" Text) */}
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      <div className={`mobile-drawer ${mobileMenuOpen ? 'open' : ''}`}>
        {navItems.map((item) => (
          <button
            key={item.path}
            type="button"
            className={`nav-pill-link ${location.pathname === item.path ? 'active' : ''}`}
            style={{ textAlign: 'left', width: '100%' }}
            onClick={() => handleGo(item.path)}
          >
            {item.label}
          </button>
        ))}
        <div style={{ display: 'flex', gap: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1 }}
            onClick={() => {
              setMobileMenuOpen(false);
              if (onBookCallDirect) onBookCallDirect();
              else navigate('/?bookCall=1');
            }}
          >
            Book a Call Directly
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ flex: 1 }}
            onClick={() => {
              setMobileMenuOpen(false);
              if (onStartDiscovery) onStartDiscovery();
              else navigate('/discovery');
            }}
          >
            Start Discovery &rarr;
          </button>
          {(onOpenSignIn || user) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ width: '100%' }}
              onClick={() => {
                setMobileMenuOpen(false);
                openAccount();
              }}
            >
              {accountLabel}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export const PublicSiteFooter: React.FC<{
  onStartDiscovery?: () => void;
  onBookCallDirect?: () => void;
  onOpenSignIn?: () => void;
}> = ({ onStartDiscovery, onBookCallDirect, onOpenSignIn }) => {
  const navigate = useNavigate();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <img
              className="footer-brand-logo"
              src="/brand/frins-lockup-white.png"
              alt="FRINS — Market Learning, Taught Properly"
            />
            <p>
              Market education built around you. Concepts, strategy work and 1-on-1 mentorship for students, strategy learners, traders and investors.
            </p>
          </div>

          <div className="footer-nav">
            <div className="footer-nav-col">
              <span className="footer-col-title">Website Pages</span>
              <button type="button" onClick={() => navigate('/')}>
                Home
              </button>
              <button type="button" onClick={() => navigate('/why-frins')}>
                Why FRINS &amp; Boundaries
              </button>
              <button type="button" onClick={() => navigate('/how-it-works')}>
                How It Works
              </button>
              <button type="button" onClick={() => navigate('/tracks')}>
                Who Can Join &amp; Tracks
              </button>
              <button
                type="button"
                onClick={() => (onBookCallDirect ? onBookCallDirect() : navigate('/?bookCall=1'))}
              >
                Book a Call Directly
              </button>
              <button
                type="button"
                onClick={() => (onStartDiscovery ? onStartDiscovery() : navigate('/discovery'))}
              >
                Start Discovery
              </button>
            </div>

            <div className="footer-nav-col">
              <span className="footer-col-title">For Learners</span>
              <button type="button" onClick={() => (onOpenSignIn ? onOpenSignIn() : navigate('/login'))}>
                Student Login
              </button>
              <button type="button" onClick={() => (onStartDiscovery ? onStartDiscovery() : navigate('/discovery'))}>
                Start Discovery
              </button>
              <button type="button" onClick={() => (onBookCallDirect ? onBookCallDirect() : navigate('/?bookCall=1'))}>
                Book a Call
              </button>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>&copy; 2026 FRINS. All rights reserved.</span>
          <span>Strictly Educational &amp; Custom-Built Per Learner &middot; Non-Advisory</span>
        </div>
      </div>
    </footer>
  );
};

interface PublicWebsiteProps {
  onOpenSignIn?: () => void;
}

export const PublicWebsitePage: React.FC<PublicWebsiteProps> = ({ onOpenSignIn }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const openAccount = () => {
    if (user) navigate('/dashboard');
    else if (onOpenSignIn) onOpenSignIn();
  };

  const accountLabel = user ? 'My Learning' : 'Student Login';
  const [activeTab, setActiveTab] = useState<'architecture' | 'sequence'>('architecture');
  const [activeStepPreview, setActiveStepPreview] = useState<number>(0);

  // Modal 1: Basic Details -> Discovery Onboarding Modal
  const [bookingModalOpen, setBookingModalOpen] = useState(false);

  // Modal 2: Direct Call Booking Modal (Book a Call Directly Without Discovery)
  const [directCallModalOpen, setDirectCallModalOpen] = useState(false);

  // Basic Details Form State (for Discovery)
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [track, setTrack] = useState<LearnerOrientationTrack>('student_concepts');
  const [experienceYears, setExperienceYears] = useState('under_1y');
  const [context, setContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Direct Call Booking Form State (Without Discovery)
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [callName, setCallName] = useState('');
  const [callEmail, setCallEmail] = useState('');
  const [callPhone, setCallPhone] = useState('+91 ');
  const [callTrack, setCallTrack] = useState<LearnerOrientationTrack>('student_concepts');
  const [callCustomTrack, setCallCustomTrack] = useState('');
  const [customTrack, setCustomTrack] = useState('');
  const [callDate, setCallDate] = useState(tomorrowIso);
  const [callSlot, setCallSlot] = useState('11:30 AM IST');
  const [callNotes, setCallNotes] = useState('');
  const [callSubmitting, setCallSubmitting] = useState(false);
  const [confirmedDirectCall, setConfirmedDirectCall] = useState<any | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  const tabArchRef = useRef<HTMLButtonElement>(null);
  const tabSeqRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const params = new URLSearchParams(location.search);
    if (params.get('bookCall') === '1') {
      setConfirmedDirectCall(null);
      setCallError(null);
      setDirectCallModalOpen(true);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBookingModalOpen(false);
        setDirectCallModalOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    document.body.style.overflow = bookingModalOpen || directCallModalOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [bookingModalOpen, directCallModalOpen]);

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (activeTab === 'architecture') {
        setActiveTab('sequence');
        tabSeqRef.current?.focus();
      } else {
        setActiveTab('architecture');
        tabArchRef.current?.focus();
      }
    }
  };

  const openModalWithTrack = (preselectedTrack?: LearnerOrientationTrack) => {
    if (preselectedTrack) setTrack(preselectedTrack);
    setSubmitResult(null);
    setBookingModalOpen(true);
  };

  const openDirectCallModal = (preselectedTrack?: LearnerOrientationTrack) => {
    if (preselectedTrack) setCallTrack(preselectedTrack);
    setConfirmedDirectCall(null);
    setCallError(null);
    setDirectCallModalOpen(true);
  };

  const handleBasicDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) return;
    if (track === 'other' && customTrack.trim().length < 3) {
      setSubmitResult({ ok: false, message: 'Please tell us what describes you best (at least 3 characters).' });
      return;
    }
    setSubmitting(true);
    setSubmitResult(null);
    try {
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName.trim(),
          email: email.trim(),
          track,
          customTrack: track === 'other' ? customTrack.trim() : undefined,
          context: context.trim() || `Experience: ${experienceYears}`
        })
      });

      const discRes = await fetch('/api/discovery/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantName: fullName.trim(),
          participantEmail: email.trim(),
          track
        })
      });
      const discData = await discRes.json();
      const sessionId = discData?.session?.id;

      if (sessionId) {
        await fetch('/api/discovery/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            answersBatch: {
              Q01: track,
              Q03: experienceYears,
              ...(context.trim() ? { Q33: context.trim() } : {})
            }
          })
        });
        sessionStorage.setItem('frins_active_discovery_session', sessionId);
        setBookingModalOpen(false);
        navigate(`/discovery?session=${sessionId}`);
        return;
      }
    } catch {
      setSubmitResult({
        ok: false,
        message: 'Network error while saving your details. Please try again.'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callName.trim() || !callEmail.trim() || !callDate) return;
    if (callTrack === 'other' && callCustomTrack.trim().length < 3) {
      setCallError('Please tell us what describes you best (at least 3 characters).');
      return;
    }
    setCallSubmitting(true);
    setCallError(null);
    try {
      const res = await fetch('/api/book-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: callName.trim(),
          email: callEmail.trim(),
          phone: callPhone.trim(),
          track: callTrack,
          customTrack: callTrack === 'other' ? callCustomTrack.trim() : undefined,
          preferredDate: callDate,
          preferredTimeSlot: callSlot,
          notes: callNotes.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfirmedDirectCall(data.booking);
      } else {
        setCallError(data.error || 'Could not schedule your call. Please try again.');
      }
    } catch {
      setCallError('Network error while booking your call. Please try again.');
    } finally {
      setCallSubmitting(false);
    }
  };

  const journeySteps = [
    {
      num: '01',
      shortTitle: 'Choose Discovery or Direct Call',
      shortDesc: 'Take the short Discovery questions, or just book a call with our team.',
      tag: 'Flexible Starting Point',
      headline: 'Start with questions, or start with a conversation',
      body: 'The Discovery questions take a few minutes and give you a result straight away. If you would rather just talk, book a call and skip them entirely. Both are free.',
      bullets: [
        'Open to students, beginners, strategy learners, traders, and investors',
        'Book a 1-on-1 call from the Home page anytime. No questionnaire needed.',
        'Or answer our guided Discovery questions first to see an instant readiness breakdown'
      ]
    },
    {
      num: '02',
      shortTitle: 'Understand Your Learning Needs',
      shortDesc: 'We work out what you already know and what is actually missing.',
      tag: 'Short Assessment',
      headline: 'We find the real gap',
      body: 'Sometimes it is basic concepts. Sometimes it is position sizing. Sometimes it is staying calm when a trade goes against you. We find the actual blocker before writing the plan.',
      bullets: [
        'Identifies your current conceptual clarity, strategy understanding, and process habits',
        'Highlights the exact areas our mentors and team will work on with you',
        'Gives you a transparent roadmap before your course even begins'
      ]
    },
    {
      num: '03',
      shortTitle: '1-on-1 Session With Our Team',
      shortDesc: 'Talk to a mentor on a 1-on-1 call about what you want to achieve.',
      tag: '1-on-1 Human Mentorship',
      headline: 'We meet you on a call',
      body: 'You and a mentor go through your background, what you want to learn, and how much time you can give each week. No sales pitch. You leave knowing what the course will cover.',
      bullets: [
        'A friendly 1-on-1 chat about your goals. Never a sales pitch.',
        'Tailored for students learning concepts, strategy builders, traders, and investors',
        'Agrees on your starting level and custom module sequence'
      ]
    },
    {
      num: '04',
      shortTitle: 'Your Custom-Built Course & Plan',
      shortDesc: 'Your modules are written after that call, not before it.',
      tag: 'Custom-Built For Every Learner',
      headline: 'Then you get your own course',
      body: 'Modules, exercises and calls are built around what came up in that conversation. As you improve, we move the plan forward instead of leaving you on the same chapter.',
      bullets: [
        'Every learner gets a custom-built course matched to their background and goals',
        'Combines conceptual clarity, practical strategy exercises, and real-world reflection',
        'Verified progression from L1 Foundational Understanding to L4 Adaptive Mastery'
      ]
    }
  ];

  const currentPath = location.pathname;

  return (
    <div className="public-page-shell">
      <PublicSiteHeader
        onOpenSignIn={onOpenSignIn}
        onStartDiscovery={() => openModalWithTrack()}
        onBookCallDirect={() => openDirectCallModal()}
      />

      <main style={{ flex: 1 }}>
        {/* =================================================================
            PAGE 1: HOME PAGE (/)
           ================================================================= */}
        {currentPath === '/' && (
          <>
            <section className="hero-section">
              <div className="container hero-grid">
                <div className="hero-content">
                  <p className="hero-eyebrow">
                    For students, strategy learners, traders and investors
                  </p>

                  <h1 className="hero-title">
                    Learn the market with a course <span className="text-gradient">built around you</span>.
                  </h1>

                  <p className="hero-lead">
                    Start from zero, test a strategy, or fix the execution that keeps costing you. Your
                    course starts where you are, not at page one of a template.
                  </p>

                  {/* Primary CTA Bar with BOTH "Begin Discovery" AND Direct "Book a Call" */}
                  <div className="hero-cta-bar">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={() => openModalWithTrack()}
                    >
                      Start Discovery &rarr;
                    </button>
                    <button
                      type="button"
                      className="btn btn-dark btn-lg"
                      onClick={() => openDirectCallModal()}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <span>Book a Call Directly</span>
                    </button>
                  </div>
                  <p className="hero-note">
                    Rather talk to a person first? <strong>Book a Call Directly</strong>. No questionnaire
                    needed.
                  </p>

                  <ul className="hero-points">
                    <li>Anyone can join, from a first question to ten years in.</li>
                    <li>Your course is built from your goals, not a template.</li>
                    <li>Real mentors on 1-on-1 calls, whenever you need one.</li>
                  </ul>
                </div>

                {/* Right: 2-Tab Interactive Preview Card */}
                <div className="hero-artifact square" aria-label="Interactive FRINS System Preview">
                  <div className="artifact-header" role="tablist" aria-label="FRINS Learning Views">
                    <div className="artifact-tab-group">
                      <button
                        ref={tabArchRef}
                        type="button"
                        className={`artifact-tab-btn ${activeTab === 'architecture' ? 'active' : ''}`}
                        id="tab-architecture"
                        role="tab"
                        aria-selected={activeTab === 'architecture'}
                        aria-controls="panel-architecture"
                        tabIndex={activeTab === 'architecture' ? 0 : -1}
                        onClick={() => setActiveTab('architecture')}
                        onKeyDown={handleTabKeyDown}
                      >
                        Custom Course
                      </button>
                      <button
                        ref={tabSeqRef}
                        type="button"
                        className={`artifact-tab-btn ${activeTab === 'sequence' ? 'active' : ''}`}
                        id="tab-sequence"
                        role="tab"
                        aria-selected={activeTab === 'sequence'}
                        aria-controls="panel-sequence"
                        tabIndex={activeTab === 'sequence' ? 0 : -1}
                        onClick={() => setActiveTab('sequence')}
                        onKeyDown={handleTabKeyDown}
                      >
                        Who Joins
                      </button>
                    </div>
                  </div>

                  <div
                    id="panel-architecture"
                    role="tabpanel"
                    aria-labelledby="tab-architecture"
                    className={`artifact-panel ${activeTab === 'architecture' ? 'active' : ''}`}
                  >
                    {/* Each step is a real button: 1 and 4 book a call, 2 and 3
                        open Discovery. The chevron says it is clickable. */}
                    <div className="artifact-stages">
                      <button
                        type="button"
                        className="stage-row"
                        onClick={() => openDirectCallModal()}
                        aria-label="Step 1: book a call"
                      >
                        <div className="stage-num">01</div>
                        <div className="stage-info">
                          <div className="stage-name">Book a Call Directly or Take Guided Discovery</div>
                          <div className="stage-desc">
                            Speak with our team right away, or answer focused Discovery questions first to map your learning goals.
                          </div>
                        </div>
                        <span className="stage-go">Book a call &rarr;</span>
                      </button>

                      <button
                        type="button"
                        className="stage-row highlight"
                        onClick={() => navigate('/discovery')}
                        aria-label="Step 2: start Discovery"
                      >
                        <div className="stage-num">02</div>
                        <div className="stage-info">
                          <div className="stage-name">Identify Your Concepts &amp; Strategy Goals</div>
                          <div className="stage-desc">
                            Whether you want market concepts, strategy understanding, or execution discipline, we pinpoint what to build.
                          </div>
                        </div>
                        <span className="stage-go">Start Discovery &rarr;</span>
                      </button>

                      <button
                        type="button"
                        className="stage-row human"
                        onClick={() => navigate('/discovery')}
                        aria-label="Step 3: start Discovery"
                      >
                        <div className="stage-num">03</div>
                        <div className="stage-info">
                          <div className="stage-name">1-on-1 Session With Our Learning Guide Team</div>
                          <div className="stage-desc">
                            Meet 1-on-1 with our mentors to align on your custom course syllabus and practical milestones.
                          </div>
                        </div>
                        <span className="stage-go">Start Discovery &rarr;</span>
                      </button>

                      <button
                        type="button"
                        className="stage-row"
                        onClick={() => openDirectCallModal()}
                        aria-label="Step 4: book a call"
                      >
                        <div className="stage-num">04</div>
                        <div className="stage-info">
                          <div className="stage-name">Your Custom-Built Course (Never One-for-All)</div>
                          <div className="stage-desc">
                            Work through a course that matches your level, your strategy goals and your pace.
                          </div>
                        </div>
                        <span className="stage-go">Book a call &rarr;</span>
                      </button>
                    </div>
                  </div>

                  <div
                    id="panel-sequence"
                    role="tabpanel"
                    aria-labelledby="tab-sequence"
                    className={`artifact-panel ${activeTab === 'sequence' ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {[
                        {
                          badge: 'Students',
                          title: 'Market concepts from the ground up',
                          desc: 'How markets work, why prices move, what liquidity means, and where risk actually sits.'
                        },
                        {
                          badge: 'Strategy learners',
                          title: 'How strategies actually work',
                          desc: 'What makes a setup valid, why some ideas fail in live conditions, and how to test your own rules.'
                        },
                        {
                          badge: 'Traders',
                          title: 'Calm, repeatable execution',
                          desc: 'Stop moving your stops. Stop entering on impulse. Learn to sit out when the setup is not there.'
                        },
                        {
                          badge: 'Investors',
                          title: 'Thesis first, position second',
                          desc: 'Write down why you own something, how much you can lose, and when the idea is no longer true.'
                        }
                      ].map((item) => (
                        <div
                          key={item.title}
                          style={{
                            background: 'var(--bg-canvas)',
                            padding: '12px 16px',
                            borderRadius: 0,
                            border: '1px solid var(--border-subtle)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <strong style={{ fontSize: 13.5, color: 'var(--text-main)' }}>{item.title}</strong>
                            <span className="micro-tag accent" style={{ fontSize: 10, padding: '2px 8px' }}>{item.badge}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                            {item.desc}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Dedicated "Built for Every Learner, Not One Course for All" + Direct Call Booking Section */}
            <section className="problem-section section-pad">
              <div className="container">
                <div className="section-header center">
                  <span className="micro-tag accent">Who this is for</span>
                  <h2>Anyone can learn here. And your course is built for you.</h2>
                  <p>
                    You do not need years of trading behind you to start. Tell us what you want to understand, and we build the course around that. Same platform, different syllabus for every person.
                  </p>
                </div>

                <div className="problem-grid">
                  <div className="problem-card">
                    <div className="icon-badge-box">01</div>
                    <h3>Still learning the basics</h3>
                    <p>
                      If market talk sounds like jargon right now, start here. We explain how markets work, how prices move, and why risk matters, in plain language with real charts.
                    </p>
                    <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openDirectCallModal('student_concepts')}
                      >
                        Book a Call &rarr;
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openModalWithTrack('student_concepts')}
                      >
                        Start Discovery
                      </button>
                    </div>
                  </div>

                  <div className="problem-card">
                    <div className="icon-badge-box">02</div>
                    <h3>Working on a strategy</h3>
                    <p>
                      Bring whatever idea you are testing. We break it into entry rules, exit rules and risk limits, then look at where it holds up and where it breaks.
                    </p>
                    <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openDirectCallModal('strategy_learner')}
                      >
                        Book a Call &rarr;
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openModalWithTrack('strategy_learner')}
                      >
                        Start Discovery
                      </button>
                    </div>
                  </div>

                  <div className="problem-card">
                    <div className="icon-badge-box">03</div>
                    <h3>Already trading or investing</h3>
                    <p>
                      You know the theory. The gap is usually in the doing: sizing, stops that stay put, and reviewing trades without excuses. That is what we work on.
                    </p>
                    <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openDirectCallModal('trader')}
                      >
                        Book a Call &rarr;
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openModalWithTrack('trader')}
                      >
                        Start Discovery
                      </button>
                    </div>
                  </div>
                </div>

                {/* High-Visibility Direct Call Booking Spotlight Banner on Home Page */}
                <div
                  className="panel-card"
                  style={{
                    marginTop: 40,
                    marginBottom: 0,
                    padding: '32px 36px',
                    background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)',
                    color: '#FFFFFF',
                    borderRadius: 20,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 24
                  }}
                >
                  <div style={{ maxWidth: 640 }}>
                    <span className="micro-tag dark" style={{ marginBottom: 10, display: 'inline-block' }}>
                      Skip the questionnaire
                    </span>
                    <h3 style={{ color: '#FFFFFF', fontSize: 'clamp(1.4rem, 2.3vw, 1.9rem)', marginBottom: 8 }}>
                      Want to talk it through before signing up?
                    </h3>
                    <p style={{ color: '#CBD5E1', fontSize: 15, lineHeight: 1.6 }}>
                      Book a 1-on-1 call with our team and skip the Discovery questions. Tell us what you want to learn and we will map out a starting point on the call.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-lg"
                      style={{ background: '#FFFFFF', color: '#0F172A', fontWeight: 700 }}
                      onClick={() => openDirectCallModal()}
                    >
                      Book a 1-on-1 Call &rarr;
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-lg"
                      style={{ background: 'rgba(255,255,255,0.1)', color: '#FFFFFF', borderColor: 'rgba(255,255,255,0.25)' }}
                      onClick={() => openModalWithTrack()}
                    >
                      Or Take Discovery First
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* =================================================================
            PAGE 2: WHY FRINS (/why-frins)
           ================================================================= */}
        {currentPath === '/why-frins' && (
          <>
            <section className="page-hero-banner">
              <div className="container">
                <span className="micro-tag accent">Why we exist</span>
                <h1>A beginner and a full-time trader do not need the same course.</h1>
                <p>
                  Most courses sell one set of videos to everyone. A college student and someone managing a live book end up watching the same lesson 3 and skipping lesson 14. We build the syllabus per person instead.
                </p>
              </div>
            </section>

            <section className="section-pad">
              <div className="container">
                <div className="problem-grid">
                  <div className="problem-card">
                    <div className="icon-badge-box">01</div>
                    <h3>One syllabus cannot fit everyone</h3>
                    <p>
                      A student needs time on how markets work. A trader needs work on execution under pressure. Give both the same videos and one gets bored while the other stays confused.
                    </p>
                  </div>

                  <div className="problem-card">
                    <div className="icon-badge-box">02</div>
                    <h3>Copying calls teaches you nothing</h3>
                    <p>
                      If you follow a tip or copy a pattern without knowing why it works, you are stuck the moment conditions change. We teach the reasoning, not the trick.
                    </p>
                  </div>

                  <div className="problem-card">
                    <div className="icon-badge-box">03</div>
                    <h3>Built after we meet you</h3>
                    <p>
                      We look at where you are, then write the modules, exercises and calls around that. Your plan changes as you improve.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="problem-section section-pad">
              <div className="container">
                <div className="section-header center">
                  <span className="micro-tag">What we will not do</span>
                  <h2>Clear limits. No grey areas.</h2>
                  <p>
                    Market education has a trust problem. Here is where we draw the line.
                  </p>
                </div>

                <div className="not-grid">
                  <div className="not-card">
                    <div className="not-mark">&times;</div>
                    <div className="not-body">
                      <h4>We will not sell you a fixed syllabus</h4>
                      <p>No two learners get the same plan. If your goals change, the plan changes.</p>
                    </div>
                  </div>
                  <div className="not-card">
                    <div className="not-mark">&times;</div>
                    <div className="not-body">
                      <h4>Not a Tip or Signal Service</h4>
                      <p>We never issue buy/sell calls, stock tips, option alerts, or price targets. We teach you how to think and understand.</p>
                    </div>
                  </div>
                  <div className="not-card">
                    <div className="not-mark">&times;</div>
                    <div className="not-body">
                      <h4>No Profit Guarantees</h4>
                      <p>We never promise returns, fast wealth, or risk-free market outcomes.</p>
                    </div>
                  </div>
                  <div className="not-card">
                    <div className="not-mark">&times;</div>
                    <div className="not-body">
                      <h4>Not a Passive Video Dump</h4>
                      <p>You learn with structured exercises, concept walkthroughs, strategy breakdowns, and human mentor feedback.</p>
                    </div>
                  </div>
                  <div className="not-card">
                    <div className="not-mark">&times;</div>
                    <div className="not-body">
                      <h4>No Prerequisite Barrier</h4>
                      <p>You do not have to be an active trader already. Students learning market concepts and strategy learners are equally welcome.</p>
                    </div>
                  </div>
                  <div className="not-card">
                    <div className="not-mark">&times;</div>
                    <div className="not-body">
                      <h4>No Manufactured Complexity</h4>
                      <p>We teach concepts and strategy mechanics in clear, practical language tailored to your pace.</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* =================================================================
            PAGE 3: HOW IT WORKS (/how-it-works)
           ================================================================= */}
        {currentPath === '/how-it-works' && (
          <>
            <section className="page-hero-banner">
              <div className="container">
                <span className="micro-tag accent">How it works</span>
                <h1>Four steps from signing up to a course that fits you.</h1>
                <p>
                  Either book a call right away or answer a few Discovery questions. Both routes end in the same place: a plan written for you.
                </p>
              </div>
            </section>

            <section className="section-pad">
              <div className="container">
                <div className="journey-split-layout">
                  <div className="journey-step-list">
                    {journeySteps.map((st, idx) => (
                      <button
                        key={st.num}
                        type="button"
                        className={`journey-step-item ${activeStepPreview === idx ? 'active' : ''}`}
                        onClick={() => setActiveStepPreview(idx)}
                      >
                        <div className="journey-step-num">{st.num}</div>
                        <div>
                          <h3 style={{ fontSize: 18, marginBottom: 4 }}>{st.shortTitle}</h3>
                          <p style={{ fontSize: 14, lineHeight: 1.5 }}>{st.shortDesc}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="journey-spotlight-card">
                    <div>
                      <span className="micro-tag accent" style={{ marginBottom: 16 }}>
                        Stage {journeySteps[activeStepPreview].num} &middot; {journeySteps[activeStepPreview].tag}
                      </span>
                      <h3 style={{ fontSize: 'clamp(1.45rem, 2.2vw, 1.85rem)', marginBottom: 14 }}>
                        {journeySteps[activeStepPreview].headline}
                      </h3>
                      <p style={{ fontSize: 15.5, marginBottom: 24 }}>
                        {journeySteps[activeStepPreview].body}
                      </p>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 22, background: 'var(--bg-canvas)', borderRadius: 16, border: '1px solid var(--border-subtle)' }}>
                        {journeySteps[activeStepPreview].bullets.map((b, i) => (
                          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14.5, color: 'var(--text-main)' }}>
                            <span
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                background: 'var(--accent-soft)',
                                color: 'var(--accent)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 800,
                                flexShrink: 0,
                                marginTop: 1
                              }}
                            >
                              ✓
                            </span>
                            <span>{b}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-light-muted)' }}>
                        Book a call or take Discovery first
                      </span>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => openDirectCallModal()}
                        >
                          Book a Call Directly
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => openModalWithTrack()}
                        >
                          Start Discovery &rarr;
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* =================================================================
            PAGE 4: WHO CAN JOIN & TRACKS (/tracks)
           ================================================================= */}
        {currentPath === '/tracks' && (
          <>
            <section className="page-hero-banner">
              <div className="container">
                <span className="micro-tag accent">Who can join</span>
                <h1>Four starting points. One platform.</h1>
                <p>
                  Pick the one that sounds most like you. It only sets your starting point, not your ceiling. You can move between tracks later as your goals change.
                </p>
              </div>
            </section>

            <section className="section-pad">
              <div className="container">
                <div className="pathway-grid">
                  {PATHWAYS.map((pathway) => (
                    <PathwayCard
                      key={pathway.number}
                      pathway={pathway}
                      onStart={() => openModalWithTrack(pathway.track)}
                      onCall={() => openDirectCallModal(pathway.track)}
                    />
                  ))}
                </div>
              </div>
            </section>

            <section className="problem-section section-pad">
              <div className="container">
                <div className="section-header center">
                  <span className="micro-tag accent">Your progress</span>
                  <h2>Four levels, and you only move up when you can show it</h2>
                  <p>
                    Levels are not attendance badges. You move to the next one when your work shows you are ready, and your mentor signs off.
                  </p>
                </div>

                <div className="steps-grid">
                  {[
                    {
                      lvl: 'L1',
                      name: 'Foundational Understanding',
                      desc: 'You can explain how the market works, what a strategy is doing, and why position size matters.'
                    },
                    {
                      lvl: 'L2',
                      name: 'Guided Application',
                      desc: 'You apply your rules with a checklist and write down decisions, with a mentor reviewing the work.'
                    },
                    {
                      lvl: 'L3',
                      name: 'Independent Application',
                      desc: 'You follow your own rules under live conditions, without needing someone to remind you.'
                    },
                    {
                      lvl: 'L4',
                      name: 'Adaptive Mastery',
                      desc: 'You adapt the plan when conditions change and review your own work honestly.'
                    }
                  ].map((item, idx) => (
                    <div key={item.lvl} className="panel-card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <span
                        style={{
                          fontSize: 18,
                          fontWeight: 800,
                          color: 'var(--accent)',
                          background: 'var(--accent-soft)',
                          padding: '4px 12px',
                          borderRadius: 8,
                          width: 'fit-content'
                        }}
                      >
                        Level {item.lvl}
                      </span>
                      <h3 style={{ fontSize: 19 }}>{item.name}</h3>
                      <p style={{ fontSize: 14.5 }}>{item.desc}</p>
                      <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                        <div style={{ height: 5, background: 'var(--bg-canvas-subtle)', borderRadius: 999 }}>
                          <div
                            style={{
                              width: `${(idx + 1) * 25}%`,
                              height: '100%',
                              background: 'var(--accent)',
                              borderRadius: 999
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {/* Shared Final Call to Action Banner */}
        <section className="final-cta-section">
          <div className="container">
            <div className="final-cta-content">
              <span className="micro-tag dark">Ready when you are</span>
              <h2>Book a call, or start with the Discovery questions.</h2>
              <p>
                Either way it is free, and either way you end up with a plan built for your level. Pick whichever feels easier today.
              </p>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => openDirectCallModal()}
                >
                  Book a Call Directly &rarr;
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-lg"
                  onClick={() => openModalWithTrack()}
                >
                  Start Discovery Questions &rarr;
                </button>
                {(onOpenSignIn || user) && (
                  <button type="button" className="btn btn-secondary btn-lg" onClick={openAccount}>
                    {accountLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter
        onStartDiscovery={() => openModalWithTrack()}
        onBookCallDirect={() => openDirectCallModal()}
        onOpenSignIn={onOpenSignIn}
      />

      {/* =====================================================================
          MODAL 1: DIRECT CALL BOOKING MODAL (BOOK A CALL WITHOUT DISCOVERY)
         ===================================================================== */}
      {directCallModalOpen && (
        <div
          className="modal-overlay active"
          id="directCallModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="directCallModalTitle"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDirectCallModalOpen(false);
          }}
        >
          <div className="modal-card">
            <button
              type="button"
              className="modal-close-btn"
              aria-label="Close Direct Call Modal"
              onClick={() => setDirectCallModalOpen(false)}
            >
              &times;
            </button>

            <div className="modal-header">
              <span className="micro-tag accent">Direct 1-on-1 Consultation &middot; No Discovery Required</span>
              <h3 id="directCallModalTitle">Book a Call With Our Team</h3>
              <p>
                Schedule a 1-on-1 call directly with our team to discuss your goals and how we will build a custom course around you.
              </p>
            </div>

            {confirmedDirectCall ? (
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
                  <strong style={{ fontSize: 17 }}>Your 1-on-1 Call Is Confirmed!</strong>
                </div>
                <p style={{ fontSize: 14, marginBottom: 14 }}>
                  Our team has received your booking and will meet with you to design your custom learning path.
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
                    <strong>Name:</strong> {confirmedDirectCall.participantName} ({confirmedDirectCall.participantEmail})
                  </div>
                  <div>
                    <strong>Focus / Background:</strong> {confirmedDirectCall.trackLabel}
                  </div>
                  <div>
                    <strong>Scheduled Date &amp; Time:</strong> {confirmedDirectCall.preferredDate} at {confirmedDirectCall.preferredTimeSlot}
                  </div>
                  <div>
                    <strong>Booking ID:</strong> <code>{confirmedDirectCall.id}</code>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setDirectCallModalOpen(false)}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setDirectCallModalOpen(false);
                      openModalWithTrack(callTrack);
                    }}
                  >
                    Optional: Answer Discovery Questions Too &rarr;
                  </button>
                </div>
              </div>
            ) : (
              <form className="modal-form call-form" onSubmit={handleDirectCallSubmit}>
                {/* Section 1: contact details */}
                <div className="call-step">
                  <div className="call-step-head">
                    <span className="call-step-num">1</span>
                    <div>
                      <strong>Your details</strong>
                      <small>We will confirm your slot on this email and phone.</small>
                    </div>
                  </div>
                  <div className="call-form-grid">
                    <div className="form-group">
                      <label className="form-label" htmlFor="directCallName">Full Name *</label>
                      <input
                        type="text"
                        id="directCallName"
                        className="form-input"
                        placeholder="Enter your full name"
                        autoComplete="name"
                        value={callName}
                        onChange={(e) => setCallName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="directCallEmail">Email Address *</label>
                      <input
                        type="email"
                        id="directCallEmail"
                        className="form-input"
                        placeholder="name@example.com"
                        autoComplete="email"
                        value={callEmail}
                        onChange={(e) => setCallEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group full">
                      <label className="form-label" htmlFor="directCallPhone">Phone / WhatsApp Number *</label>
                      <input
                        type="tel"
                        id="directCallPhone"
                        className="form-input"
                        placeholder="+91 98765 43210"
                        autoComplete="tel"
                        value={callPhone}
                        onChange={(e) => setCallPhone(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: who they are */}
                <div className="call-step">
                  <div className="call-step-head">
                    <span className="call-step-num">2</span>
                    <div>
                      <strong>What describes you best?</strong>
                      <small>Choose the closest match, or pick Other and tell us in your own words.</small>
                    </div>
                  </div>
                  <div className="call-form-grid">
                    <div className="form-group full">
                      <label className="form-label" htmlFor="directCallTrack">Your background / focus *</label>
                      <select
                        id="directCallTrack"
                        className="form-select"
                        value={callTrack}
                        onChange={(e) => setCallTrack(e.target.value as LearnerOrientationTrack)}
                        required
                      >
                        <option value="student_concepts">Student / Beginner learning market concepts</option>
                        <option value="strategy_learner">Working on / wanting to understand market strategies</option>
                        <option value="trader">Active trader (intraday / swing)</option>
                        <option value="investor">Long-term investor</option>
                        <option value="both">Exploring concepts, strategies &amp; investing</option>
                        <option value="other">Other (I&rsquo;ll describe it myself)</option>
                      </select>
                    </div>

                    {callTrack === 'other' && (
                      <div className="form-group full call-custom-reveal">
                        <label className="form-label" htmlFor="directCallCustomTrack">Tell us in your own words *</label>
                        <input
                          type="text"
                          id="directCallCustomTrack"
                          className="form-input"
                          placeholder="e.g. Business owner wanting to understand market risk for treasury decisions"
                          value={callCustomTrack}
                          onChange={(e) => setCallCustomTrack(e.target.value)}
                          maxLength={160}
                          required
                        />
                        <span className="form-hint">
                          We use this to match you with the right mentor. There is no wrong answer.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 3: timing */}
                <div className="call-step">
                  <div className="call-step-head">
                    <span className="call-step-num">3</span>
                    <div>
                      <strong>Preferred time</strong>
                      <small>All slots are in IST. We will send a confirmation with the meeting link.</small>
                    </div>
                  </div>
                  <div className="call-form-grid">
                    <div className="form-group">
                      <label className="form-label" htmlFor="directCallDate">Preferred call date *</label>
                      <input
                        type="date"
                        id="directCallDate"
                        className="form-input"
                        min={tomorrowIso}
                        value={callDate}
                        onChange={(e) => setCallDate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="directCallSlot">Preferred time slot *</label>
                      <select
                        id="directCallSlot"
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
                    <div className="form-group full">
                      <label className="form-label" htmlFor="directCallNotes">
                        What would you like to discuss? <span className="optional-tag">Optional</span>
                      </label>
                      <textarea
                        id="directCallNotes"
                        className="form-textarea"
                        rows={3}
                        placeholder="Share your goals, experience or the questions you want answered on the call."
                        value={callNotes}
                        onChange={(e) => setCallNotes(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {callError && (
                  <div className="call-error" role="alert">{callError}</div>
                )}

                <div className="call-submit-row">
                  <div className="call-submit-copy">
                    <strong>1-on-1 call with our team</strong>
                    <span>No payment required. No Discovery needed.</span>
                  </div>
                  <button type="submit" className="btn btn-primary btn-lg" disabled={callSubmitting}>
                    {callSubmitting ? 'Scheduling your call…' : 'Confirm & Book My Call →'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: BASIC DETAILS -> DISCOVERY ONBOARDING MODAL
         ===================================================================== */}
      {bookingModalOpen && (
        <div
          className="modal-overlay active"
          id="bookingModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modalTitle"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBookingModalOpen(false);
          }}
        >
          <div className="modal-card">
            <button
              type="button"
              className="modal-close-btn"
              aria-label="Close Modal"
              onClick={() => setBookingModalOpen(false)}
            >
              &times;
            </button>

            <div className="modal-header">
              <span className="micro-tag accent">Step 1 of 3 &middot; Basic Details</span>
              <h3 id="modalTitle">Tell us a bit about yourself first</h3>
              <p>
                Add a few details first. That unlocks the Discovery questions, your result, and the course we would build for you.
              </p>
            </div>

            <form className="modal-form" onSubmit={handleBasicDetailsSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="fullName">
                  Full Name *
                </label>
                <input
                  type="text"
                  id="fullName"
                  className="form-input"
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="email">
                  Email Address *
                </label>
                <input
                  type="email"
                  id="email"
                  className="form-input"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="workspace-grid-2" style={{ gap: 12 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="track">
                    Who You Are / Learning Focus *
                  </label>
                  <select
                    id="track"
                    className="form-select"
                    value={track}
                    onChange={(e) => setTrack(e.target.value as LearnerOrientationTrack)}
                    required
                  >
                    <option value="student_concepts">Student / Beginner Learning Market Concepts</option>
                    <option value="strategy_learner">Working on / Understanding Market Strategies</option>
                    <option value="trader">Active Trader (Intraday / Swing)</option>
                    <option value="investor">Long-Term Investor</option>
                    <option value="both">Exploring Both Concepts &amp; Market Participation</option>
                    <option value="other">Other (I&rsquo;ll describe it myself)</option>
                  </select>
                </div>

                {track === 'other' && (
                  <div className="form-group call-custom-reveal" style={{ marginTop: -6 }}>
                    <label className="form-label" htmlFor="discoveryCustomTrack">
                      What describes you best? *
                    </label>
                    <input
                      type="text"
                      id="discoveryCustomTrack"
                      className="form-input"
                      placeholder="e.g. Homemaker learning long-term investing basics"
                      value={customTrack}
                      onChange={(e) => setCustomTrack(e.target.value)}
                      maxLength={160}
                      required
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="experienceYears">
                    Current Experience Level
                  </label>
                  <select
                    id="experienceYears"
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

              <div className="form-group">
                <label className="form-label" htmlFor="context">
                  What do you most want to learn or build in your custom course? (Optional)
                </label>
                <textarea
                  id="context"
                  className="form-textarea"
                  placeholder="e.g. Understanding market concepts from scratch, learning how strategies work, or improving execution discipline..."
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </div>

              {submitResult && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: submitResult.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
                    color: submitResult.ok ? 'var(--success-text)' : 'var(--danger-text)',
                    border: `1px solid ${submitResult.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
                    fontSize: 13,
                    fontWeight: 600
                  }}
                >
                  <div>{submitResult.message}</div>
                </div>
              )}

              <div className="modal-actions" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  style={{ width: '100%' }}
                  disabled={submitting}
                >
                  {submitting ? 'Starting Your Discovery...' : 'Continue to Discovery Questions →'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setBookingModalOpen(false);
                    setCallName(fullName);
                    setCallEmail(email);
                    setCallTrack(track);
                    openDirectCallModal(track);
                  }}
                >
                  Prefer to skip Discovery? Book a Call Directly Instead &rarr;
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
