import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StaffSignInGate } from '../components/StaffSignInGate';

interface StaffSignInPageProps {
  consoleName: string;
  allowedRoles: string[];
  /** Console opened once the credentials are accepted. */
  destination: string;
}

/**
 * Standalone staff sign-in page.
 *
 * /admin/login, /guide/login and /ai-pipeline/login each render this page on its own,
 * without the dashboard chrome. On success we send the person straight to their console.
 */
export const StaffSignInPage: React.FC<StaffSignInPageProps> = ({ consoleName, allowedRoles, destination }) => {
  const navigate = useNavigate();

  return (
    <div className="auth-page">
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

      <div className="auth-staff-wrap">
        <StaffSignInGate
          consoleName={consoleName}
          allowedRoles={allowedRoles}
          onSuccess={() => navigate(destination, { replace: true })}
        />
        <p className="auth-staff-note">
          This page is not linked from the public website. Keep the URL for your bookmarks.
        </p>
      </div>
    </div>
  );
};

export default StaffSignInPage;
