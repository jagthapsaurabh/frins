import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Globe,
  LayoutDashboard,
  Users,
  ShieldCheck,
  Sparkles,
  LogOut,
  ChevronDown,
  Repeat,
  Menu,
  X,
  BookOpenCheck,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog } from './ConfirmDialog';

export type ShellRole = 'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  staffOnly?: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  LEARNER: 'Student',
  GUIDE: 'Learning Guide',
  ADMIN: 'Administrator',
  CURRICULUM_OWNER: 'Curriculum Owner'
};

const navForRole = (role: string | undefined): NavItem[] => {
  const isAdmin = role === 'ADMIN' || role === 'CURRICULUM_OWNER';
  const isStaff = isAdmin || role === 'GUIDE';

  return [
    { path: '/dashboard', label: 'My Learning', icon: <LayoutDashboard size={17} /> },
    ...(isStaff ? [{ path: '/guide', label: 'Guide Console', icon: <Users size={17} /> }] : []),
    ...(isAdmin ? [{ path: '/admin', label: 'Admin Console', icon: <ShieldCheck size={17} /> }] : []),
    ...(isAdmin ? [{ path: '/ai-pipeline', label: 'AI Engine', icon: <Sparkles size={17} /> }] : []),
    { path: '/', label: 'Public Website', icon: <Globe size={17} /> }
  ];
};

const initialsOf = (name?: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, demoAccounts, switchAccount, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switchBusy, setSwitchBusy] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    setMenuOpen(false);
    setSwitcherOpen(false);
  }, [location.pathname]);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER';
  const nav = navForRole(user?.role);
  const current = nav.find((n) => n.path === location.pathname) ||
    (location.pathname === '/prototype' ? nav[0] : undefined);

  const handleSwitch = async (email: string) => {
    setSwitchError(null);
    setSwitchBusy(email);
    const res = await switchAccount(email);
    setSwitchBusy(null);
    if (!res.ok) {
      setSwitchError(res.error || 'Could not switch workspace.');
      return;
    }
    setMenuOpen(false);
    setSwitcherOpen(false);
  };

  return (
    <div className="app-shell">
      {/* ---------- Sidebar ---------- */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="app-sidebar-brand">
          <button
            type="button"
            className="app-brand-button"
            onClick={() => navigate('/dashboard')}
            aria-label="FRINS dashboard home"
          >
            <span className="app-brand-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                <path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" />
                <circle cx="18" cy="15" r="3" />
              </svg>
            </span>
            <span className="app-brand-text">
              <strong>FRINS</strong>
              <small>Learning Platform</small>
            </span>
          </button>
          <button
            type="button"
            className="app-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="app-sidebar-nav" aria-label="Dashboard navigation">
          <span className="app-nav-section">Workspace</span>
          {nav.map((item) => {
            const active =
              location.pathname === item.path ||
              (item.path === '/dashboard' && (location.pathname === '/prototype' || location.pathname === '/learner'));
            return (
              <button
                key={item.path}
                type="button"
                className={`app-nav-item ${active ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className="app-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-sidebar-card">
            <BookOpenCheck size={16} />
            <div>
              <strong>Need a hand?</strong>
              <p>Book a 1-on-1 call with your learning team.</p>
              <button type="button" onClick={() => navigate('/')}>
                Book a Call
              </button>
            </div>
          </div>
          <button type="button" className="app-nav-item subtle" onClick={() => setSignOutOpen(true)}>
            <span className="app-nav-icon">
              <LogOut size={17} />
            </span>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="app-sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

      {/* ---------- Main column ---------- */}
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <button
              type="button"
              className="app-icon-button mobile-only"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={19} />
            </button>
            <div className="app-breadcrumb">
              <span>Dashboard</span>
              <span className="app-breadcrumb-sep">/</span>
              <strong>{current?.label || 'Workspace'}</strong>
            </div>
          </div>

          <div className="app-topbar-right">
            <button type="button" className="app-ghost-button desktop-only" onClick={() => navigate('/')}>
              <ArrowLeft size={15} />
              Back to website
            </button>

            <div className="app-account" ref={menuRef}>
              <button
                type="button"
                className="app-account-trigger"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="app-avatar">{initialsOf(user?.name)}</span>
                <span className="app-account-meta">
                  <strong>{user?.name || 'Guest'}</strong>
                  <small>{ROLE_LABEL[user?.role || ''] || 'Visitor'}</small>
                </span>
                <ChevronDown size={15} className={`app-chevron ${menuOpen ? 'up' : ''}`} />
              </button>

              {menuOpen && (
                <div className="app-menu" role="menu">
                  <div className="app-menu-identity">
                    <span className="app-avatar lg">{initialsOf(user?.name)}</span>
                    <div>
                      <strong>{user?.name}</strong>
                      <small>{user?.email}</small>
                      <span className="app-role-chip">{ROLE_LABEL[user?.role || ''] || 'Visitor'}</span>
                    </div>
                  </div>

                  <button type="button" className="app-menu-item" onClick={() => navigate('/')}>
                    <Globe size={16} /> View public website
                  </button>
                  <button type="button" className="app-menu-item" onClick={() => navigate('/dashboard')}>
                    <LayoutDashboard size={16} /> My learning dashboard
                  </button>

                  {isAdmin ? (
                    <>
                      <div className="app-menu-divider" />
                      <button
                        type="button"
                        className="app-menu-item"
                        onClick={() => setSwitcherOpen((v) => !v)}
                      >
                        <Repeat size={16} /> Switch workspace
                        <ChevronDown size={14} className={`app-chevron ${switcherOpen ? 'up' : ''}`} />
                      </button>
                      {switcherOpen && (
                        <div className="app-switch-list">
                          {demoAccounts.map((acc) => (
                            <button
                              key={acc.id}
                              type="button"
                              disabled={switchBusy === acc.email || acc.email === user?.email}
                              onClick={() => handleSwitch(acc.email)}
                              className={acc.email === user?.email ? 'current' : ''}
                            >
                              <span className="app-avatar sm">{initialsOf(acc.name)}</span>
                              <span className="app-switch-line">
                                <strong>{acc.name}</strong>
                                <small>{ROLE_LABEL[acc.role] || acc.role}</small>
                              </span>
                              {switchBusy === acc.email && <span className="app-switch-busy">…</span>}
                            </button>
                          ))}
                          {switchError && <p className="app-switch-error">{switchError}</p>}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="app-menu-divider" />
                      <button
                        type="button"
                        className="app-menu-item"
                        onClick={() => {
                          setMenuOpen(false);
                          setSignOutOpen(true);
                        }}
                      >
                        <Repeat size={16} /> Switch account
                      </button>
                      <p className="app-menu-hint">You will be signed out so you can sign in with another account.</p>
                    </>
                  )}

                  <div className="app-menu-divider" />
                  <button
                    type="button"
                    className="app-menu-item danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setSignOutOpen(true);
                    }}
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>

      <ConfirmDialog
        open={signOutOpen}
        title="Sign out of FRINS?"
        message={
          <>
            You are signed in as <strong>{user?.name}</strong>. You will need to enter your credentials again to
            return to your dashboard.
          </>
        }
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        variant="primary"
        onCancel={() => setSignOutOpen(false)}
        onConfirm={async () => {
          await logout();
          setSignOutOpen(false);
          navigate('/');
        }}
      />
    </div>
  );
};
