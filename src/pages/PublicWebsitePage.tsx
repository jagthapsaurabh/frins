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

/** The arrow that sits inside a primary action. */
const ArrowRight = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/**
 * The opener every inner page shares with Home: a photograph, the claim over
 * it, two ways in, and three short facts along the bottom rule.
 */
export const PageHero: React.FC<{
  label: string;
  title: React.ReactNode;
  lead: string;
  points: Array<{ head: string; body: string }>;
  image: string;
  imagePosition?: string;
  startLabel?: string;
  callLabel?: string;
  onStart: () => void;
  onCall: () => void;
}> = ({ label, title, lead, points, image, imagePosition, startLabel, callLabel, onStart, onCall }) => (
  <section className="page-hero">
    <div className="page-hero-media" aria-hidden="true">
      <img src={image} alt="" style={imagePosition ? { objectPosition: imagePosition } : undefined} />
    </div>
    <div className="page-hero-veil" aria-hidden="true" />

    <div className="container page-hero-inner">
      <p className="page-hero-label">{label}</p>
      <h1 className="page-hero-title">{title}</h1>
      <p className="page-hero-lead">{lead}</p>

      <div className="page-hero-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
          {startLabel || 'Start Discovery'}
          <ArrowRight />
        </button>
        <button type="button" className="btn btn-glass btn-lg" onClick={onCall}>
          {callLabel || 'Book a Call'}
        </button>
      </div>

      <ul className="page-hero-facts">
        {points.map((point, i) => (
          <li key={point.head}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <p>
              <strong>{point.head}</strong> {point.body}
            </p>
          </li>
        ))}
      </ul>
    </div>
  </section>
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
  const [navOpen, setNavOpen] = useState(false);

  const openAccount = () => {
    if (user) navigate('/dashboard');
    else if (onOpenSignIn) onOpenSignIn();
  };

  const requestCall = () => {
    if (onBookCallDirect) onBookCallDirect();
    else navigate('/?bookCall=1');
  };

  const accountLabel = user ? 'My Learning' : 'Student Login';

  const navItems = [
    { path: '/', label: 'Home' },
    { path: '/why-frins', label: 'Why Us' },
    { path: '/how-it-works', label: 'Process' },
    { path: '/tracks', label: 'Programs' }
  ];

  const go = (path: string) => {
    setNavOpen(false);
    navigate(path);
  };

  // A new page always closes the drawer, and an open drawer owns the keyboard.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  return (
    <header className="site-header">
      <div className="container header-inner">
        <div
          className="brand-group"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/');
          }}
        >
          <img
            className="site-brand-logo"
            src="/brand/frins-logo-white-tight.png"
            alt="FRINS, Fly on your own wings"
          />
        </div>

        {/* Desktop: the four pages, flat and in a row. */}
        <nav className="nav-pill-shell" aria-label="Main Website Navigation">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                type="button"
                className={`nav-pill-link ${isActive ? 'active' : ''}`}
                onClick={() => go(item.path)}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="header-cta-group">
          {(onOpenSignIn || user) && (
            <button type="button" className="btn btn-outline btn-sm header-login" onClick={openAccount}>
              {user ? 'My Learning' : 'Login'}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={requestCall}>
            Book a Call
          </button>
        </div>

        {/* Mobile: one button that opens the page list. No word on it. */}
        <button
          type="button"
          className={`nav-toggle ${navOpen ? 'is-open' : ''}`}
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="site-nav-drawer"
          onClick={() => setNavOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <div
        className={`nav-drawer-scrim ${navOpen ? 'is-open' : ''}`}
        aria-hidden="true"
        onClick={() => setNavOpen(false)}
      />

      <aside
        id="site-nav-drawer"
        className={`nav-drawer ${navOpen ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        aria-hidden={!navOpen}
      >
        <div className="nav-drawer-top">
          <img className="nav-drawer-logo" src="/brand/frins-logo-white.png" alt="FRINS" />
          <button
            type="button"
            className="nav-drawer-close"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="nav-drawer-links" aria-label="Pages">
          {navItems.map((item, index) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                type="button"
                className={`nav-drawer-link ${isActive ? 'active' : ''}`}
                onClick={() => go(item.path)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="nav-drawer-num">0{index + 1}</span>
                <span className="nav-drawer-word">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="nav-drawer-foot">
          {(onOpenSignIn || user) && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setNavOpen(false);
                openAccount();
              }}
            >
              {accountLabel}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setNavOpen(false);
              requestCall();
            }}
          >
            Book a Call
          </button>
          <p className="nav-drawer-note">Free to start. No card.</p>
        </div>
      </aside>
    </header>
  );
};

export const PublicSiteFooter: React.FC<{
  onStartDiscovery?: () => void;
  onBookCallDirect?: () => void;
  onOpenSignIn?: () => void;
}> = ({ onStartDiscovery, onBookCallDirect, onOpenSignIn }) => {
  const navigate = useNavigate();
  const start = () => (onStartDiscovery ? onStartDiscovery() : navigate('/discovery'));
  const call = () => (onBookCallDirect ? onBookCallDirect() : navigate('/?bookCall=1'));
  const login = () => (onOpenSignIn ? onOpenSignIn() : navigate('/login'));

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-ask">
            <img
              className="footer-logo"
              src="/brand/frins-logo-white.png"
              alt="FRINS, Fly on your own wings"
            />
            <h2>Fly on your own wings.</h2>
            <p>
              One learner at a time, written around where you actually are. Start with Discovery, or
              talk it through with a mentor first.
            </p>
            <div className="footer-ask-actions">
              <button type="button" className="btn btn-gold" onClick={start}>
                Start Discovery
              </button>
              <button type="button" className="btn btn-outline-light" onClick={call}>
                Book a Call
              </button>
            </div>
          </div>

          <div className="footer-cols">
            <div className="footer-col footer-col--contact">
              <span className="footer-col-title">Contact</span>
              <a className="footer-contact-row" href="tel:+918793885079">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
                </svg>
                <span className="footer-contact-value">+91 87938 85079</span>
              </a>
              <a className="footer-contact-row" href="mailto:support@frins.in">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
                  <path d="m3 6 9 7 9-7" />
                </svg>
                <span className="footer-contact-value">support@frins.in</span>
              </a>
              <span className="footer-contact-row">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 10c0 6-9 12-9 12S3 16 3 10a9 9 0 0 1 18 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="footer-contact-value footer-contact-value--wrap">Nagpur, Maharashtra, India</span>
              </span>
            </div>

            <div className="footer-col">
              <span className="footer-col-title">Pages</span>
              <button type="button" onClick={() => navigate('/')}>Home</button>
              <button type="button" onClick={() => navigate('/why-frins')}>Why Us</button>
              <button type="button" onClick={() => navigate('/how-it-works')}>How it works</button>
              <button type="button" onClick={() => navigate('/tracks')}>Programs</button>
            </div>

            <div className="footer-col">
              <span className="footer-col-title">For learners</span>
              <button type="button" onClick={login}>Student Login</button>
              <button type="button" onClick={start}>Start Discovery</button>
              <button type="button" onClick={call}>Book a Call</button>
            </div>
          </div>
        </div>

        <div className="footer-legal">
          <span>&copy; 2026 FRINS. All rights reserved.</span>
          <span>Strictly educational &middot; Custom-built per learner &middot; Non-advisory</span>
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

  /* Each step on the home page goes where that step actually happens. */
  const stepLinks = [
    { label: 'Compare both routes', go: () => navigate('/how-it-works#ways') },
    { label: 'Take the Discovery', go: () => navigate('/discovery') },
    { label: 'Book your call', go: () => openDirectCallModal() },
    { label: 'See the four tracks', go: () => navigate('/tracks') }
  ];

  /* Deep links from the old section pages land on the matching block. */
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, location.pathname]);

  /* Sections fade in as they arrive, once. Nothing bounces, nothing loops. */
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((n) => n.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    nodes.forEach((n) => io.observe(n));

    /* Safety net: anything still hidden after a few seconds is shown anyway,
       so a failed observer never leaves a section blank. */
    const fallback = window.setTimeout(() => {
      nodes.forEach((n) => n.classList.add('is-in'));
    }, 3500);

    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [currentPath]);

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
            {/* The opening screen is a photograph with the claim over it. */}
            <section className="hero-stage">
              <div className="hero-media" aria-hidden="true">
                <img src="/img/hero-desk.jpg" alt="" />
              </div>
              <div className="hero-veil" aria-hidden="true" />

              <div className="container hero-inner">
                <h1 className="hero-title">
                  Learn the market with a course <em>built around you.</em>
                </h1>

                <p className="hero-lead">
                  Start from zero, test a strategy, or fix the execution that keeps costing you. Your
                  course starts where you are, not at page one of a template.
                </p>

                <div className="hero-cta-bar">
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => openModalWithTrack()}>
                    Start Discovery
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                  <button type="button" className="btn btn-glass btn-lg" onClick={() => openDirectCallModal()}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    Book a Call
                  </button>
                </div>

                <p className="hero-note">
                  Rather talk to a person first? Book a Call directly. No questionnaire needed.
                </p>
              </div>

              <div className="container">
                <ul className="hero-facts">
                  <li>
                    <span>01</span>
                    <p>Anyone can join, from a first question to ten years in.</p>
                  </li>
                  <li>
                    <span>02</span>
                    <p>Your course is built from your goals, not a template.</p>
                  </li>
                  <li>
                    <span>03</span>
                    <p>Real mentors on 1-on-1 calls, whenever you need one.</p>
                  </li>
                </ul>
              </div>
            </section>

            {/* A thin band that moves, so the page has a pulse without a box. */}
            <div className="ticker" aria-hidden="true">
              <div className="ticker-track">
                {[0, 1].map((run) => (
                  <div className="ticker-run" key={run}>
                    <span>Students</span><i />
                    <span>Strategy learners</span><i />
                    <span>Active traders</span><i />
                    <span>Long-term investors</span><i />
                    <span>Custom syllabus</span><i />
                    <span>1-on-1 mentorship</span><i />
                    <span>L1 to L4</span><i />
                  </div>
                ))}
              </div>
            </div>

            <div id="who" />
            {/* Who this is for: three whole sections, each with its own shape.
                A learner photographed at work, the situation written out, and
                the two ways in as text links. No tiles, no three-up grid. */}
            <section className="who-section">
              <div className="container">
                <div className="who-head" data-reveal>
                  <span className="micro-tag accent">Who this is for</span>
                  <h2>Anyone can learn here. And your course is built for you.</h2>
                  <p>
                    You do not need years of trading behind you to start. Tell us what you want to
                    understand, and we build the course around that. Same platform, different syllabus
                    for every person.
                  </p>
                </div>

                <article className="who-row" data-reveal>
                  <div className="who-media">
                    <img src="/img/mentor.jpg" alt="A mentor going through a chart with a learner" loading="lazy" />
                    <span className="who-index">01</span>
                  </div>
                  <div className="who-copy">
                    <p className="who-kicker">Still learning the basics</p>
                    <h3>Start where the jargon stops making sense.</h3>
                    <p>
                      If market talk sounds like jargon right now, start here. We explain how markets
                      work, how prices move, and why risk matters, in plain language with real charts.
                    </p>
                    <ul className="who-points">
                      <li>How an order actually changes a price</li>
                      <li>What a spread, a stop and a position size really mean</li>
                      <li>Why most beginners lose before they learn</li>
                    </ul>
                    <div className="who-actions">
                      <button type="button" className="btn btn-gold btn-sm" onClick={() => openModalWithTrack('student_concepts')}>
                        Start Discovery
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openDirectCallModal('student_concepts')}>
                        Book a Call
                      </button>
                    </div>
                  </div>
                </article>

                <article className="who-row reverse" data-reveal>
                  <div className="who-media">
                    <img src="/img/hero-desk.jpg" alt="A trading desk with charts open on two screens" loading="lazy" />
                    <span className="who-index">02</span>
                  </div>
                  <div className="who-copy">
                    <p className="who-kicker">Working on a strategy</p>
                    <h3>Turn an idea you half trust into rules you can test.</h3>
                    <p>
                      Bring whatever idea you are testing. We break it into entry rules, exit rules and
                      risk limits, then look at where it holds up and where it breaks.
                    </p>
                    <ul className="who-points">
                      <li>What qualifies as a valid setup, and what is noise</li>
                      <li>Where the idea pays and where it bleeds</li>
                      <li>How to test it without risking real money first</li>
                    </ul>
                    <div className="who-actions">
                      <button type="button" className="btn btn-gold btn-sm" onClick={() => openModalWithTrack('strategy_learner')}>
                        Start Discovery
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openDirectCallModal('strategy_learner')}>
                        Book a Call
                      </button>
                    </div>
                  </div>
                </article>

                <article className="who-row" data-reveal>
                  <div className="who-media">
                    <img src="/img/mentor.jpg" alt="A learner and mentor reviewing a trade on a tablet" loading="lazy" style={{ objectPosition: '30% 50%' }} />
                    <span className="who-index">03</span>
                  </div>
                  <div className="who-copy">
                    <p className="who-kicker">Already trading or investing</p>
                    <h3>Fix the part that costs you money: execution.</h3>
                    <p>
                      You know the theory. The gap is usually in the doing: sizing, stops that stay put,
                      and reviewing trades without excuses. That is what we work on.
                    </p>
                    <ul className="who-points">
                      <li>A plan written before the open, not mid-candle</li>
                      <li>Position sizes you can defend on a bad day</li>
                      <li>A review you actually complete</li>
                    </ul>
                    <div className="who-actions">
                      <button type="button" className="btn btn-gold btn-sm" onClick={() => openModalWithTrack('trader')}>
                        Start Discovery
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openDirectCallModal('trader')}>
                        Book a Call
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            </section>

            {/* The claim the whole site rests on. What most courses do, set
                quiet, against what we do, set large. Then what that means. */}
            <section className="statement-section" id="why">
              <div className="container">
                <div className="statement-grid">
                  <div className="statement-copy" data-reveal>
                    <span className="micro-tag accent">The difference</span>

                    <p className="statement-against">
                      Most courses sell one set of videos to everyone.
                    </p>

                    <h2 className="statement-claim">
                      We write the syllabus for the person <em>sitting in front of us.</em>
                    </h2>

                    <div className="statement-stats">
                      <div>
                        <strong>4</strong>
                        <span>Starting points</span>
                      </div>
                      <div>
                        <strong>L1 to L4</strong>
                        <span>Levels</span>
                      </div>
                      <div>
                        <strong>1-on-1</strong>
                        <span>Mentorship</span>
                      </div>
                    </div>
                  </div>

                  <div className="statement-side" data-reveal>
                    <span className="statement-side-label">What that means in practice</span>

                    <ol className="statement-list">
                      <li>
                        <strong>The first module changes.</strong> A student starts on how markets
                        actually work. A trader starts on execution under pressure.
                      </li>
                      <li>
                        <strong>The order changes.</strong> If risk is already second nature, we skip
                        it and go straight to sizing and review.
                      </li>
                      <li>
                        <strong>The plan moves.</strong> When the work improves, the next module
                        changes with it instead of waiting for a calendar.
                      </li>
                    </ol>

                    <p className="statement-note">
                      Nothing is written before we meet you. That is the whole point.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* How it works: a sticky claim on the left, four numbered moves on
                the right. Each step reads as a paragraph, not a tile. */}
            <section className="process-section" id="process">
              <div className="container process-grid">
                <div className="process-intro" data-reveal>
                  <span className="micro-tag accent">How it works</span>
                  <h2>Four steps from a first question to your own course.</h2>
                  <p>
                    Nothing is decided before we talk. You bring where you are, and the plan is written
                    from that, not from a catalogue.
                  </p>
                  <div className="process-intro-actions">
                    <button type="button" className="btn btn-gold" onClick={() => openModalWithTrack()}>
                      Start Discovery
                    </button>
                    <button type="button" className="btn btn-outline" onClick={() => openDirectCallModal()}>
                      Book a Call
                    </button>
                  </div>
                  <button type="button" className="process-link" onClick={() => navigate('/how-it-works')}>
                    Read the full process
                  </button>
                </div>

                <ol className="process-steps">
                  {journeySteps.map((st, idx) => {
                    const step = stepLinks[idx];
                    return (
                      <li key={st.num} data-reveal>
                        <button type="button" className="process-step" onClick={step.go}>
                          <span className="process-step-num">{st.num}</span>
                          <span className="process-step-body">
                            <span className="process-step-tag">{st.tag}</span>
                            <span className="process-step-title">{st.shortTitle}</span>
                            <span className="process-step-copy">{st.shortDesc}</span>
                            <span className="process-step-go">
                              {step.label}
                              <span aria-hidden="true">&rarr;</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </section>

            {/* The dark band that offers the shortcut. */}
            <section className="band-section">
              <div className="container">
                <div className="band-cta" data-reveal>
                  <div className="band-cta-copy">
                    <p className="band-cta-kicker">Skip the questionnaire</p>
                    <h3>Want to talk it through before signing up?</h3>
                    <p>
                      Book a 1-on-1 call with our team and skip the Discovery questions. Tell us what you
                      want to learn and we will map out a starting point on the call.
                    </p>
                  </div>
                  <div className="band-cta-actions">
                    <button type="button" className="btn btn-gold btn-lg" onClick={() => openDirectCallModal()}>
                      Book a 1-on-1 Call
                    </button>
                    <button type="button" className="btn btn-glass btn-lg" onClick={() => openModalWithTrack()}>
                      Or Take Discovery First
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {currentPath === '/why-frins' && (
          <>
            <PageHero
              label="Why we exist"
              title={<>A beginner and a full-time trader do not need the same course.</>}
              lead="Most courses sell one set of videos to everyone. A student and someone running a live book end up watching the same lesson 3 and skipping lesson 14. We write the syllabus per person instead."
              points={[
                { head: 'Built after we meet you.', body: 'The modules, exercises and calls follow from where you actually are.' },
                { head: 'Reasoning, not tricks.', body: 'You learn why a setup works, so you can still decide when conditions change.' },
                { head: 'Yours to change.', body: 'The plan moves as you improve, not on a fixed calendar.' }
              ]}
              image="/img/study-night.jpg"
              imagePosition="72% 45%"
              onStart={() => openModalWithTrack()}
              onCall={() => openDirectCallModal()}
            />

            {/* One syllabus against one written for you. Two columns, hairline
                between, no card around it. */}
            <section className="compare-section">
              <div className="container">
                <div className="compare-head">
                  <h2>Same subject. Two very different starting points.</h2>
                  <p>
                    On the left is the course most people buy. On the right is what the same money gets
                    you here.
                  </p>
                </div>

                <div className="compare-columns">
                  <div className="compare-col muted">
                    <span className="compare-col-title">Most courses</span>
                    <ul>
                      <li>One set of videos for everyone</li>
                      <li>Same order, same pace</li>
                      <li>You skip what you already know</li>
                      <li>No one checks your work</li>
                    </ul>
                  </div>
                  <div className="compare-col">
                    <span className="compare-col-title">FRINS</span>
                    <ul>
                      <li>Modules written for your level</li>
                      <li>Pace set by what you can show</li>
                      <li>Gaps found by your guide</li>
                      <li>Every task read and marked</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            <section className="essay-section">
              <div className="container">
                <div className="essay-head">
                  <span className="micro-tag accent">What goes wrong</span>
                  <h2>Three reasons people stall.</h2>
                </div>

                <div className="essay-rows">
                  <article className="essay-row">
                    <span className="essay-num">01</span>
                    <div>
                      <h3>One syllabus cannot fit everyone</h3>
                      <p>
                        A student needs time on how markets work. A trader needs work on execution under
                        pressure. Give both the same videos and one gets bored while the other stays
                        confused.
                      </p>
                    </div>
                  </article>

                  <article className="essay-row">
                    <span className="essay-num">02</span>
                    <div>
                      <h3>Copying calls teaches you nothing</h3>
                      <p>
                        If you follow a tip or copy a pattern without knowing why it works, you are stuck
                        the moment conditions change. We teach the reasoning, not the trick.
                      </p>
                    </div>
                  </article>

                  <article className="essay-row">
                    <span className="essay-num">03</span>
                    <div>
                      <h3>Built after we meet you</h3>
                      <p>
                        We look at where you are, then write the modules, exercises and calls around that.
                        Your plan changes as you improve.
                      </p>
                    </div>
                  </article>
                </div>
              </div>
            </section>

            <section className="problem-section section-pad">
              <div className="container">
                <div className="section-header split">
                  <span className="micro-tag">What we will not do</span>
                  <h2>Clear limits. No grey areas.</h2>
                  <p>Market education has a trust problem. Here is where we draw the line.</p>
                </div>

                <div className="not-grid">
                  {[
                    {
                      title: 'We will not sell you a fixed syllabus',
                      body: 'No two learners get the same plan. If your goals change, the plan changes.'
                    },
                    {
                      title: 'Not a Tip or Signal Service',
                      body: 'We never issue buy/sell calls, stock tips, option alerts, or price targets. We teach you how to think and understand.'
                    },
                    {
                      title: 'No Profit Guarantees',
                      body: 'We never promise returns, fast wealth, or risk-free market outcomes.'
                    },
                    {
                      title: 'Not a Passive Video Dump',
                      body: 'You learn with structured exercises, concept walkthroughs, strategy breakdowns, and human mentor feedback.'
                    },
                    {
                      title: 'No Prerequisite Barrier',
                      body: 'You do not have to be an active trader already. Students learning market concepts and strategy learners are equally welcome.'
                    },
                    {
                      title: 'No Manufactured Complexity',
                      body: 'We teach concepts and strategy mechanics in clear, practical language tailored to your pace.'
                    }
                  ].map((item) => (
                    <div className="not-card" key={item.title}>
                      <span className="not-mark" aria-hidden="true">
                        &times;
                      </span>
                      <div className="not-body">
                        <h4>{item.title}</h4>
                        <p>{item.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
        {currentPath === '/how-it-works' && (
          <>
            <PageHero
              label="How it works"
              title={<>Four steps, and the first one is just a conversation.</>}
              lead="Book a call right away, or answer a few Discovery questions first. Both routes land in the same place: a plan written around what you already know."
              points={[
                { head: 'Nothing to pay to start.', body: 'The call and the questions are both free.' },
                { head: 'You speak to a person.', body: 'A mentor reads your answers before the call.' },
                { head: 'Written after we meet.', body: 'No module list exists until we know where you are.' }
              ]}
              image="/img/mentor.jpg"
              imagePosition="35% 40%"
              onStart={() => openModalWithTrack()}
              onCall={() => openDirectCallModal()}
            />

            {/* Two doors, one fourth step. Read as a route, not as cards. */}
            <section className="ways-section" id="ways">
              <div className="container">
                <div className="ways-head">
                  <span className="micro-tag accent">Two ways in</span>
                  <h2>Start with a call, or start with the questions.</h2>
                  <p>
                    Both are free and both end on the same call. Pick whichever feels less like paperwork.
                  </p>
                </div>

                <div className="ways-grid">
                  <button type="button" className="way-entry" onClick={() => openDirectCallModal()}>
                    <span className="way-letter">A</span>
                    <span className="way-body">
                      <strong>Book a call</strong>
                      <small>Skip the questions. Talk it through.</small>
                    </span>
                    <span className="way-arrow" aria-hidden="true">
                      &rarr;
                    </span>
                  </button>

                  <button type="button" className="way-entry" onClick={() => openModalWithTrack()}>
                    <span className="way-letter">B</span>
                    <span className="way-body">
                      <strong>Answer Discovery</strong>
                      <small>See your readiness, then we call.</small>
                    </span>
                    <span className="way-arrow" aria-hidden="true">
                      &rarr;
                    </span>
                  </button>
                </div>

                <div className="way-destination">
                  <span className="way-dest-label">Either way, step four</span>
                  <strong>Your own course</strong>
                  <p>Modules, exercises and calls built around your answers.</p>
                </div>
              </div>
            </section>

            {/* The same shape as the block on Home, with the detail open. */}
            <section className="process-section process-detail">
              <div className="container process-grid">
                <div className="process-intro">
                  <span className="micro-tag accent">The four steps</span>
                  <h2>What happens, in order.</h2>
                  <p>
                    Nothing is decided before we talk. Each step only exists because the one before it
                    answered something.
                  </p>
                  <div className="process-intro-actions">
                    <button type="button" className="btn btn-gold" onClick={() => openModalWithTrack()}>
                      Start Discovery
                    </button>
                    <button type="button" className="btn btn-outline" onClick={() => openDirectCallModal()}>
                      Book a Call
                    </button>
                  </div>
                </div>

                <ol className="process-steps process-steps-detail">
                  {journeySteps.map((st) => (
                    <li key={st.num}>
                      <span className="process-step-num">{st.num}</span>
                      <div className="process-step-body">
                        <span className="process-step-tag">{st.tag}</span>
                        <h3>{st.headline}</h3>
                        <p>{st.body}</p>
                        <ul className="step-notes">
                          {st.bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </>
        )}
        {currentPath === '/tracks' && (
          <>
            <PageHero
              label="Who can join"
              title={<>Four starting points. One platform.</>}
              lead="Pick the one that sounds most like you. It sets where you begin, not how far you can go."
              points={[
                { head: 'Nothing to qualify for.', body: 'No entrance test and no minimum experience.' },
                { head: 'The work sets your level.', body: 'You move up when your guide signs off, not on a calendar.' },
                { head: 'You can switch.', body: 'Change track later if your goal changes. Nothing is locked.' }
              ]}
              image="/img/hero-desk.jpg"
              imagePosition="68% 45%"
              callLabel="Not sure? Book a Call"
              onStart={() => openModalWithTrack()}
              onCall={() => openDirectCallModal()}
            />

            <section className="tracks-section">
              <div className="container">
                <div className="tracks-head">
                  <span className="micro-tag accent">The four starting points</span>
                  <h2>Find the one that sounds like you.</h2>
                  <p>
                    Each one sets your first module and your first call. It does not cap where you end up.
                  </p>
                </div>

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

            <section className="levels-section">
              <div className="container">
                <div className="levels-head">
                  <span className="micro-tag accent">Your progress</span>
                  <h2>Four levels, and you only move up when you can show it.</h2>
                  <p>
                    Levels are not attendance badges. You move to the next one when your work shows you
                    are ready, and your mentor signs off.
                  </p>
                </div>

                <ol className="level-ladder">
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
                  ].map((item) => (
                    <li key={item.lvl} className="level-step">
                      <span className="level-step-chip">{item.lvl}</span>
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </>
        )}
        {/* Shared final call to action. Two real buttons, one gold, so the
            section reads as a decision rather than a paragraph. */}
        <section className="closing-section">
          <div className="container closing-layout">
            <div className="closing-intro">
              <p className="closing-eyebrow">Ready when you are</p>
              <h2>Two ways to start. Both free.</h2>
              <p className="closing-lede">
                Talk to a mentor, or answer a few questions first. Either way you end up with a plan
                written for your level instead of a template.
              </p>

              <ul className="closing-facts">
                <li>No card, no commitment</li>
                <li>A person reads everything you send</li>
                <li>Nobody calls you unless you ask</li>
              </ul>

              {(onOpenSignIn || user) && (
                <button type="button" className="closing-account" onClick={openAccount}>
                  {accountLabel}
                  <span aria-hidden="true">&rarr;</span>
                </button>
              )}
            </div>

            <div className="closing-options">
              <article className="closing-option">
                <div className="closing-option-head">
                  <span className="closing-option-tag">Fastest</span>
                  <span className="closing-option-meta">One call, about 15 minutes</span>
                </div>
                <h3>Talk it through on a call</h3>
                <p>
                  Tell us where you are and what you want to fix. You leave the call knowing what the
                  first two modules would be.
                </p>
                <button type="button" className="btn btn-outline closing-option-btn" onClick={() => openDirectCallModal()}>
                  Book a Call
                </button>
              </article>

              <article className="closing-option closing-option--primary">
                <div className="closing-option-head">
                  <span className="closing-option-tag">Most useful</span>
                  <span className="closing-option-meta">A few minutes, on your own</span>
                </div>
                <h3>Answer the Discovery questions</h3>
                <p>
                  A short set of questions about how you work. You get a readiness read straight away,
                  and a mentor reads your answers before anyone calls.
                </p>
                <button type="button" className="btn btn-primary closing-option-btn" onClick={() => openModalWithTrack()}>
                  Start Discovery
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </article>
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
