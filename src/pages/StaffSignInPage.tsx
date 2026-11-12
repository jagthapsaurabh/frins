import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StaffSignInGate } from '../components/StaffSignInGate';

interface StaffSignInPageProps {
  consoleName: string;
  allowedRoles: string[];
  /** Console opened once the credentials are accepted. */
  destination: string;
}

interface ConsoleBlurb {
  eyebrow: string;
  heading: string;
  lede: string;
  points: Array<{ title: string; body: string }>;
  foot: string;
}

/** What sits behind each staff door. Written per console so the page explains itself. */
const CONSOLE_BLURBS: Record<string, ConsoleBlurb> = {
  'Admin Console': {
    eyebrow: 'Admin console',
    heading: 'Everything behind the course, in one place.',
    lede: 'Accounts, programmes, tasks, reviews and messages. Sign in to see the queue as it stands right now.',
    points: [
      {
        title: 'Every learner on one list',
        body: 'Track, level, progress and Discovery answers, without opening six screens.'
      },
      {
        title: 'Read the work, then reply',
        body: 'Task submissions arrive with the learner’s notes and files attached.'
      },
      {
        title: 'Nothing changes quietly',
        body: 'Approvals and edits are recorded, so you can see who changed what.'
      }
    ],
    foot: 'Admin access also opens the Guide console.'
  },
  'Guide Console': {
    eyebrow: 'Guide console',
    heading: 'The work your learners send you.',
    lede: 'Reviews, replies and the learners assigned to you. Sign in and pick up where the queue left off.',
    points: [
      {
        title: 'Submissions in one queue',
        body: 'Photos, PDFs and notes from every learner you look after.'
      },
      {
        title: 'Mark it, or ask for more',
        body: 'Send it back with a message, or mark it complete when it holds up.'
      },
      {
        title: 'A record of what you said',
        body: 'Every reply stays with the task, so nobody repeats the same note twice.'
      }
    ],
    foot: 'Guide accounts can message learners but cannot change the syllabus.'
  },
  'AI Engine': {
    eyebrow: 'AI engine',
    heading: 'The model settings behind the course build.',
    lede: 'Providers, prompts and the outline generator. Admin only, and never reachable from the public site.',
    points: [
      {
        title: 'Swap the provider',
        body: 'Point the engine at a different model without touching the course data.'
      },
      {
        title: 'Draft, never publish',
        body: 'Generated outlines land as drafts for a human to read and approve.'
      },
      {
        title: 'Admin only',
        body: 'No learner or guide account can open this page.'
      }
    ],
    foot: 'Changes here affect new drafts only, not published courses.'
  }
};

const FALLBACK: ConsoleBlurb = {
  eyebrow: 'Staff access',
  heading: 'This console is for FRINS staff.',
  lede: 'Sign in with your work email to continue.',
  points: [
    { title: 'Staff accounts only', body: 'Learner logins cannot open this console.' },
    { title: 'One console per role', body: 'Your account decides which console you land in.' }
  ],
  foot: 'Ask an admin if you need access.'
};

/**
 * Standalone staff sign-in page.
 *
 * /admin/login, /guide/login and /ai-pipeline/login each render this page on its own,
 * without the dashboard chrome. On success we send the person straight to their console.
 */
export const StaffSignInPage: React.FC<StaffSignInPageProps> = ({ consoleName, allowedRoles, destination }) => {
  const navigate = useNavigate();
  const blurb = CONSOLE_BLURBS[consoleName] || FALLBACK;

  return (
    <div className="auth-page staff-auth-page">
      <div className="auth-topbar">
        <Link to="/" className="auth-brand">
          <img className="auth-brand-mark" src="/brand/frins-mark.png" alt="" aria-hidden="true" />
          <span className="auth-brand-text">
            <strong>FRINS</strong>
            <small>Staff Access</small>
          </span>
        </Link>
        <Link to="/" className="auth-back-link">
          Back to website
        </Link>
      </div>

      <div className="staff-auth-split">
        <aside className="staff-auth-pane">
          <div className="staff-auth-pane-inner">
            <p className="staff-auth-eyebrow">{blurb.eyebrow}</p>
            <h1>{blurb.heading}</h1>
            <p className="staff-auth-lede">{blurb.lede}</p>

            <ul className="staff-auth-points">
              {blurb.points.map((p) => (
                <li key={p.title}>
                  <strong>{p.title}</strong>
                  <span>{p.body}</span>
                </li>
              ))}
            </ul>

            <p className="staff-auth-foot">{blurb.foot}</p>
          </div>
        </aside>

        <main className="staff-auth-form-pane">
          <div className="staff-auth-card">
            <p className="staff-auth-kicker">Restricted console</p>
            <h2>Sign in</h2>
            <p className="staff-auth-help">
              Use the FRINS work email and password your admin set up for you.
            </p>

            <StaffSignInGate
              consoleName={consoleName}
              allowedRoles={allowedRoles}
              onSuccess={() => navigate(destination, { replace: true })}
              layout="plain"
            />

            <p className="staff-auth-assist">
              Locked out? Ask an admin to reset your password. Staff accounts are not created from this page.
            </p>
          </div>

          <p className="staff-auth-legal">
            Access is limited to FRINS staff. Sign-ins are recorded.
          </p>
        </main>
      </div>
    </div>
  );
};

export default StaffSignInPage;
